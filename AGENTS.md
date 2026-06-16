# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A Chrome Manifest V3 extension ("Meta-Prompt Motoru") that rewrites raw user text inside any page's `<input>`/`<textarea>` into an expert-grade prompt, in place. It calls either the Anthropic Messages API directly or OpenRouter, with automatic failover across a configured model list.

There is no build step, no package.json, no tests, and no lint config. Development means editing the JS files and reloading the unpacked extension in Chrome.

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

- **Provider config** is split per-provider so switching doesn't wipe the other's key/model. `config.js` defines the `PROVIDERS` map (field names, defaults, suggestions). `getActiveConfig()` returns `{ provider, apiKey, model }`; `getFailoverConfig()` returns `{ provider, apiKey, apiKeys, models }` including the cross-provider backup model list — both revision paths in `background.js` use the latter. Everything reads these from `chrome.storage.local` — do not hardcode storage keys elsewhere.
- **API layer** (`api.js`) exposes `reviseWithFailover({ provider, apiKey, apiKeys, models, system, userText, maxTokens })` and a streaming twin `reviseStreamWithFailover({ ..., onDelta })` (SSE; 30s idle timeout; fails over to the next model only if no text has streamed yet — after first delta, errors propagate instead of silently restarting). Both iterate the `models` array, stop early on 401/403, and (for OpenRouter) read/maintain `openrouterWorkingModels` in storage to seed future failover. The two providers have different request/response shapes — Anthropic uses `x-api-key` + separate `system` field + content blocks; OpenRouter uses Bearer + system-as-message + `choices[].message`. Both are handled in this one file.
- **Prompt building** (`prompt.js`) is the "Ana Beyin" methodology: `detectTaskType()` classifies the raw text score-based into coding/analysis/email/summary/translation/explain/planning/creative/general (Turkish keyword heuristics strip false positives like "posta kodu"; ties break specific-to-general), then `buildSystemPrompt(language, rawText, snnValues, mode?, vibeStrategy?, researchStrategy?, antihalluStrategy?, length?)` assembles the system message. The standard path is length-aware: `kisa` prunes the rubric/workflow/tools modules and the format few-shot example; it always appends fidelity rules (preserve verbatim details, no invented facts — use `[PLACEHOLDER]`s) and a prompt-injection guard for RAW TEXT. The output is intended to be a **prompt for another LLM**, not an answer to the user's question — keep that invariant when editing prompt templates.
- **SNN simulation** (`brain_network.js` + `brain_helper.js`): a biophysical Leaky-Integrate-and-Fire network with Tsodyks-Markram STP, STDP, and neuromodulators (NE/ACh). `runBrainSimulation(taskType)` is called before each revision to produce `snnValues` that are folded into the system prompt; `rewardBrain(value)` applies reward-modulated plasticity after a successful write-back. State is persisted to `chrome.storage.local`. If the simulation throws, `background.js` logs a warning and falls back to a static prompt — preserve this fault tolerance when modifying.
- **`background.js` message router** handles two `chrome.runtime` message types: `REVISE_PROMPT` (one-shot revision, kept for compatibility) and `REWARD_BRAIN` (post-hoc reward signal) — both async, return `true` from the listener so `sendResponse` works. The popup's primary path is now a long-lived port (`chrome.runtime.connect({ name: "revise" })` + `REVISE_PROMPT_STREAM` message) that streams `{type:"delta"}` chunks followed by `{type:"done"|"error"}`; the open port also keeps the service worker alive during generation. Both paths share `prepareRevision()` for strategy resolution, SNN tick and prompt assembly. The in-place path (`reviseInPlace`) reads the same `mode`/strategy preferences from storage, so the shortcut/context-menu flow honors whatever "Development Mode" was last selected in the popup.
- **`content.js`** exposes `GET_EDITABLE_TEXT` / `SET_EDITABLE_TEXT` / `STREAM_EDITABLE_TEXT` / `RESTORE_EDITABLE_TEXT` against `document.activeElement`. `SET_EDITABLE_TEXT` snapshots the previous text so `RESTORE_EDITABLE_TEXT` can undo the last write (one level, per page load); a successful undo sends `rewardBrain(-1.0)`. `STREAM_EDITABLE_TEXT` carries the FULL accumulated text each message (not appends), locks onto the target element and takes the undo snapshot only on the FIRST write of a stream; `done: true` finalizes the stream and arms undo. `reviseInPlace` streams via this message (throttled to ~150ms full-text writes, fire-and-forget; first failed write aborts streaming and the result falls back to the `lastInPlaceResult` copy path). It runs on `<all_urls>` at `document_idle`. Write-back may fail on sites with custom editors (contenteditable, CodeMirror, etc.); `background.js` handles this by stashing the result in `chrome.storage.local` under `lastInPlaceResult` and showing a "copy" badge so the popup can offer copy.

## Conventions worth knowing

- Code comments and UI strings are in English — keep new user-facing strings and comments in English to match.
- All persistent state lives in `chrome.storage.local`. Notable keys: `provider`, `anthropicKey`/`anthropicModel`, `openrouterKey`/`openrouterModel`, `openrouterWorkingModels`, `language`, `length`, `consensusCheck`, `selectedText`, `lastInPlaceResult`, `lastError`, plus the SNN state keys written by `brain_helper.js`.
- `background.js` is an ES module service worker (`"type": "module"` in manifest) — use `import` statements, not `importScripts`. Dynamic `import()` is used for `brain_helper.js` reward path to avoid loading it on every cold start.
- Badge text on `chrome.action` is the primary user feedback for the in-place flow (`…`, `✓`, `copy`, `key`, `err`, `?`, `↩`). Always pair `setBadge` with `clearBadgeLater` to avoid sticky badges.
- `verify_brain.js` (SNN) and `verify_prompt.js` (prompt layer) are standalone diagnostic scripts — not wired into the extension runtime. Run with `node verify_prompt.js` after changing `prompt.js` (60 structural checks); `node verify_prompt.js --show "<raw text>"` dumps the system prompt + user message a given input would produce.

## Reference docs in repo

- `README.md` — user-facing install/usage (English).
- `methodology.md` — the Ana Beyin prompt methodology this extension implements.
- `compliance.md`, `performance_report.md` — design notes; read these before substantive changes to `prompt.js` or `brain_network.js`.
