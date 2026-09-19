# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Manifest V3 extension ("Meta-Prompt Motoru") that rewrites raw user text inside any page's `<input>`/`<textarea>` into an expert-grade prompt, in place. It calls either the Anthropic Messages API directly or OpenRouter, with automatic failover across a configured model list.

The extension itself has no build step: development means editing the JS files and
reloading the unpacked extension in Chrome. There is no lint config.

Checks are offline and need no API key, network, or build — run them with `npm test`
(or individually: `node verify_prompt.js`, `node verify_brain.js`,
`node verify_runtime.mjs`, `node macos/verify_desktop.mjs`). Run them after any
change to the prompt, brain, config, API, or content-script layers.

The repo is git-tracked. Build output (`dist/`, `macos/.build/`) and the
third-party `macos/runtime/` tree are ignored, so only hand-written sources are
committed. The macOS app under `macos/` is built separately with
`npm run build:macos` (`python3 macos/build.py`); it reuses the same prompt engine
behind a `chrome.*` shim.

## Loading / "running" the extension

1. `chrome://extensions` → enable Developer mode → "Load unpacked" → select this directory.
2. After edits, hit the reload icon on the extension card (or use the keyboard shortcut on the extensions page). The service worker (`background.js`) is re-spun on reload; content scripts only re-inject on next page load, so refresh the target tab too.
3. Trigger paths: right-click context menu on a selection/editable field, or `Ctrl+Shift+L` (mac: `Cmd+Shift+L`) — bound in `manifest.json` under `commands.revise-in-place`. `Ctrl+Shift+U` (`commands.undo-revise`) or the "Undo last revision" context menu item undoes the last in-place revision.

To inspect logs: `chrome://extensions` → "service worker" link opens DevTools for `background.js`; popup and options pages have their own DevTools (right-click → Inspect).

## Architecture

The flow on shortcut/menu trigger:

```
content.js  ──GET_EDITABLE_TEXT──▶  background.js
                                      │
                                      ├─ config.js          (active provider + key + model)
                                      ├─ brain_helper.js    (runs SNN tick via brain_network.js)
                                      ├─ prompt.js          (detectTaskType, buildSystemPrompt, buildUserMessage)
                                      └─ api.js             (reviseWithFailover → Anthropic or OpenRouter)
                                      │
content.js  ◀──SET_EDITABLE_TEXT──────┘   (badge on chrome.action shows status)
```

Key cross-file contracts:

- **Provider config** is split per-provider so switching doesn't wipe the other's key/model. `config.js` defines the `PROVIDERS` map (field names, defaults, suggestions). `getActiveConfig()` returns `{ provider, apiKey, model }`; `getFailoverConfig()` returns `{ provider, apiKey, apiKeys, models }` — both revision paths in `background.js` use the latter. Two invariants live here: the list is capped at `MAX_BACKUP_MODELS + 1` entries, and backups stay **inside the active provider** unless the user ticks the `crossProviderFallback` option in Settings. Widening either one means the source text reaches models the user never chose, so change them deliberately. Everything reads these from `chrome.storage.local` — do not hardcode storage keys elsewhere.
- **API layer** (`api.js`) exposes `reviseWithFailover({ provider, apiKey, apiKeys, models, system, userText, maxTokens })` and a streaming twin `reviseStreamWithFailover({ ..., onDelta })` (SSE; 30s idle timeout; fails over to the next model only if no text has streamed yet — after first delta, errors propagate instead of silently restarting). Both iterate the `models` array, stop early on 401/403, and (for OpenRouter) read/maintain `openrouterWorkingModels` in storage to seed future failover. The two providers have different request/response shapes — Anthropic uses `x-api-key` + separate `system` field + content blocks; OpenRouter uses Bearer + system-as-message + `choices[].message`. Both are handled in this one file.
- **Prompt building** (`prompt.js`) is the "Ana Beyin" methodology: `detectTaskType()` classifies the raw text score-based into coding/analysis/email/summary/translation/explain/planning/creative/general. It is bilingual: text and keywords are folded to plain ASCII via `foldDiacritics()`, so "ozetle" and "özetle" both match and `"İ".toLowerCase()`'s combining dot stops mattering. False positives are stripped before scoring — English "postal code"/"barcode" and Turkish "posta kodu"/"barkod"/"güvenlik kodu" — and "<qualifier> programı" is rewritten to a planning marker, because it is a schedule while the English "program" keyword would score it as coding. Ties break specific-to-general via `TASK_PRIORITY`, then `buildSystemPrompt(language, rawText, snnValues, mode?, vibeStrategy?, researchStrategy?, antihalluStrategy?, length?)` assembles the system message. The standard path is length-aware: `kisa` prunes the rubric/workflow/tools modules and the format few-shot example; it always appends fidelity rules (preserve verbatim details, no invented facts — use `[PLACEHOLDER]`s) and a prompt-injection guard for RAW TEXT. The output is intended to be a **prompt for another LLM**, not an answer to the user's question — keep that invariant when editing prompt templates.
- **TypeSafe classifier** (`typesafe.js`) is an optional, opt-in layer over the prompt brain's task detection. It asks TypeSafe one System One **Choice** question — which of the nine task types the raw text is — and `background.js` passes the answer to `buildSystemPrompt(..., taskTypeOverride)`, which prefers it over `detectTaskType()`. It is deliberately **not** in `PROVIDERS`: it never serves a revision and must never enter the failover model list. It fails open at every step (no key, opt-in off, HTTP error, timeout, unknown task type, confidence below the user's threshold) by returning `null`, which both revision paths read as "use the keyword detector" — preserve that, a classifier outage must not break a revision. Only the first `MAX_CLASSIFY_CHARS` of the source text are sent, and the toggle defaults off for the same reason `crossProviderFallback` does: it ships user text to a third service. The live docs were unreachable when this was written, so the wire format is unverified; everything version-dependent is confined to the constants, `buildClassifyRequest()` and `readChoiceAnswer()` in that one file.
- **SNN simulation** (`brain_network.js` + `brain_helper.js`): a biophysical Leaky-Integrate-and-Fire network with Tsodyks-Markram STP, STDP, and neuromodulators (NE/ACh). `runBrainSimulation(taskType)` is called before each revision to produce `snnValues` that are folded into the system prompt; `rewardBrain(value)` applies reward-modulated plasticity after a successful write-back. State is persisted to `chrome.storage.local`. If the simulation throws, `background.js` logs a warning and falls back to a static prompt — preserve this fault tolerance when modifying.
- **`background.js` message router** handles two `chrome.runtime` message types: `REVISE_PROMPT` (one-shot revision, kept for compatibility) and `REWARD_BRAIN` (post-hoc reward signal) — both async, return `true` from the listener so `sendResponse` works. The popup's primary path is now a long-lived port (`chrome.runtime.connect({ name: "revise" })` + `REVISE_PROMPT_STREAM` message) that streams `{type:"delta"}` chunks followed by `{type:"done"|"error"}`; the open port also keeps the service worker alive during generation. Both paths share `prepareRevision()` for strategy resolution, SNN tick and prompt assembly. The in-place path (`reviseInPlace`) reads the same `mode`/strategy preferences from storage, so the shortcut/context-menu flow honors whatever "Development Mode" was last selected in the popup.
- **`content.js`** exposes `GET_EDITABLE_TEXT` / `SET_EDITABLE_TEXT` / `STREAM_EDITABLE_TEXT` / `RESTORE_EDITABLE_TEXT` against `document.activeElement`. `SET_EDITABLE_TEXT` snapshots the previous text so `RESTORE_EDITABLE_TEXT` can undo the last write (one level, per page load); a successful undo sends `rewardBrain(-1.0)`. `STREAM_EDITABLE_TEXT` carries the FULL accumulated text each message (not appends), locks onto the target element and takes the undo snapshot only on the FIRST write of a stream; `done: true` finalizes the stream and arms undo. `reviseInPlace` streams via this message (throttled to ~150ms full-text writes, fire-and-forget; first failed write aborts streaming and the result falls back to the `lastInPlaceResult` copy path). It runs on `<all_urls>` at `document_idle`. Write-back may fail on sites with custom editors (contenteditable, CodeMirror, etc.); `background.js` handles this by stashing the result in `chrome.storage.local` under `lastInPlaceResult` and showing a "copy" badge so the popup can offer copy. Independently of that, the in-place stream mirrors its accumulated text into `lastInPlaceResult` roughly once a second (`PARTIAL_SAVE_MS`) so an MV3 worker eviction mid-stream cannot silently discard the revision; a successful final write clears that recovery copy. Keep this — once page writes break, nothing but the fetch keeps the worker busy.

## Conventions worth knowing

- Code comments and UI strings are in English — keep new user-facing strings and comments in English to match.
- All persistent state lives in `chrome.storage.local`. Notable keys: `provider`, `anthropicKey`/`anthropicModel`, `openrouterKey`/`openrouterModel`, `openrouterWorkingModels`, `crossProviderFallback`, `typesafeKey`/`typesafeEnabled`/`typesafeMinConfidence`, `language`, `length`, `mode`, `consensusCheck`, `selectedText`, `lastInPlaceResult`, `lastError`, plus the SNN state keys written by `brain_helper.js`.
- `background.js` is an ES module service worker (`"type": "module"` in manifest) — use `import` statements, not `importScripts`. Dynamic `import()` is used for `brain_helper.js` reward path to avoid loading it on every cold start.
- Badge text on `chrome.action` is the primary user feedback for the in-place flow (`…`, `✓`, `copy`, `key`, `err`, `?`, `↩`). Always pair `setBadge` with `clearBadgeLater` to avoid sticky badges.
- The verification scripts are standalone — not wired into the extension runtime. `verify_prompt.js` covers the prompt layer (122 structural checks, 22 of them Turkish task detection); `verify_brain.js` covers the SNN; `verify_runtime.mjs` covers provider key isolation, the failover contract, streaming failure handling, focus locking and undo against offline mocks; `macos/verify_desktop.mjs` covers the desktop bridge, including a check that every module imported by the shared engine is in `macos/build.py`'s copy list — that list is explicit, so a new module is otherwise only missed once the app launches. `node verify_prompt.js --show "<raw text>"` dumps the system prompt + user message a given input would produce.
- When you change behaviour that a script asserts, update the assertion to the new contract rather than loosening it until it passes.

## Reference docs in repo

- `README.md` — user-facing install/usage (English).
- `methodology.md` — the Ana Beyin prompt methodology this extension implements.
- `compliance.md`, `performance_report.md` — design notes; read these before substantive changes to `prompt.js` or `brain_network.js`.
