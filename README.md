# Meta-Prompt Engine

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![macOS Companion](https://img.shields.io/badge/macOS-Apple_Silicon_Native-000000?logo=apple&logoColor=white)](macos/README.md)
[![Tests](https://img.shields.io/badge/Offline_Checks-npm_test-success?logo=node.js&logoColor=white)](package.json)
[![Providers](https://img.shields.io/badge/Providers-Anthropic_%7C_OpenRouter-blueviolet)](config.js)

**You type a rough idea into any text box. You press one key. The box fills with a clear, well-structured prompt that another AI will understand much better.**

Meta-Prompt is a Chrome extension (Manifest V3) with a standalone macOS companion app. It does not answer your question. It rewrites your question so a model like Claude or GPT answers it well.

---

## Contents

- [The idea in one picture](#the-idea-in-one-picture)
- [What happens when you press the key](#what-happens-when-you-press-the-key)
- [The parts, explained plainly](#the-parts-explained-plainly)
- [Modes](#modes)
- [Install](#install)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Tests](#tests)
- [Privacy](#privacy)
- [Costs and trade-offs to know about](#costs-and-trade-offs-to-know-about)
- [Project layout](#project-layout)
- [Further reading](#further-reading)

---

## The idea in one picture

Think of a clerk who helps you write a letter. You say *"need a deadline extension"*. The clerk writes *"Dear Professor, because of X, I am asking for an extension until Y…"*. The clerk does not send the letter for you. They only write it better.

This extension is that clerk:

1. Type into any `<input>` or `<textarea>` on any website, such as a chatbot's message box.
2. Press `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS).
3. Your text is replaced, character by character, with an expert-grade prompt.
4. If you don't like it, press `Ctrl+Shift+U` to get your original text back.

---

## What happens when you press the key

A kitchen analogy: each step is a station the order passes through.

```text
 your text
    │
    ▼
 1. Notebook check ......... "Did we cook this exact order recently?"  → yes: serve it, skip the rest
    │                         (efficiency.js – semantic cache)
    ▼
 2. Read the order ......... "Is this code, an email, a summary, a plan…?"
    │                         (prompt.js – detectTaskType, optional TypeSafe)
    ▼
 3. Brain tick ............. a small simulation produces three "mood" numbers
    │                         (brain_network.js, brain_helper.js)
    ▼
 4. Five tasters ........... a five-step quality check of the request
    │                         (hda_agents.js – HDA audit)
    ▼
 5. Write the recipe card .. the instructions sent to the model
    │                         (prompt.js – buildSystemPrompt)
    ▼
 6. Send to the chef ....... Anthropic or OpenRouter, with backup chefs
    │                         (api.js – streaming + failover)
    ▼
 7. Serve .................. the result streams back into your text box
                              (content.js)
```

---

## The parts, explained plainly

### 1. Semantic cache: the notebook
If you asked for nearly the same thing recently (same settings, text at least 92% similar), the saved answer is returned without calling any API. The notebook holds 50 entries and forgets anything older than 24 hours.

### 2. Task detection: reading the order
The text is sorted into one of nine kinds: coding, analysis, email, summary, translation, explanation, planning, creative writing, or general. The sorter works in both English and Turkish. It removes accents first, so `özetle` and `ozetle` count as the same word. It also knows common traps: *"postal code"* and *"barkod"* are not about programming, and *"çalışma programı"* is a schedule, not software.

An optional TypeSafe classifier can make this decision instead. It is off by default. If it fails or isn't confident enough, the keyword sorter takes over.

### 3. The "Ana Beyin" brain simulation
A small simulated network of neurons (leaky integrate-and-fire neurons with adaptive synapses) runs before each revision. It outputs three numbers named after brain chemicals: ACh (focus), NE (exploration) and DA (reward).

**What these numbers actually do:** they are written into the instructions as text, for example `Acetylcholine (ACh) = 0.730 (High focus & strict logical flow)`. The model reads that line like a sticky note that says "stay focused". After a successful revision the network gets a reward, and that reward is bigger when the output is concise. If the simulation crashes, a fixed set of instructions is used instead.

### 4. HDA audit: five tasters
Before the final prompt is written, the request goes through five checks in order:

1. Filter out what isn't known.
2. Clarify the concepts.
3. Check what the user actually intends.
4. Reason step by step.
5. Combine everything into a whole.

By default, each check is a separate model call (`agents` mode). If any check fails, the system falls back to doing all five checks inside the main call (`inline` mode), so a failed check can slow a revision down but never stops it. You can switch to `inline` or `off` in the popup.

### 5. The system prompt: the recipe card
This is the set of instructions sent along with your text. It always includes these rules:

- **Keep specifics word for word.** Names, URLs, numbers and endpoints are never changed.
- **Never invent facts.** Missing information becomes a `[PLACEHOLDER]` instead of a guess.
- **Your text is data, not commands.** If the text box contains "ignore all previous instructions", it is treated as text to rewrite, not as an order. This guards against prompt injection.
- **The output is a prompt for another AI**, not an answer to your question.

### 6. Failover: backup chefs
If the chosen model is down, up to three backup models are tried. Two guard rails apply:

- **Bad key, stop.** A 401 or 403 error means the key itself is wrong, so trying more models would be pointless.
- **No surprise providers.** Backups stay with the provider you picked. Moving your text to a different provider only happens if you turn on *cross-provider fallback* in Settings.

Once text has started streaming, the extension will not silently switch models halfway through.

### 7. Writing back safely
- If you click away while the text is streaming, generation finishes in the background and the result is saved to the popup history.
- If you start typing while the text is streaming, the extension stops writing so your edits are preserved.
- Partial results are saved every second. If Chrome shuts down the background worker, nothing is lost.

---

## Modes

Choose a mode in the popup:

| Mode | Strategies | Good for |
| :--- | :--- | :--- |
| **Standard** | Auto, Structured | General prompts with a role, steps and output format |
| **Vibe Coding** | Standard, Jazz, Fractal, Emotive, Hydrological, Alchemical | Programming prompts with verification loops and security checklists |
| **Web Research** | Boolean, Dorking, Academic, OSINT | Search syntax, domain filters, citation rules |
| **Anti-Hallucination** | RAG, ReAct, CoN, CoK, LogiCoT, CoVe, Atomic Claim, Self-Consistency, Semantic Triangulation | Fact-heavy work where every claim must be checked |

A **length** setting (Short `kisa`, Medium `orta`, Long `uzun`) controls how much detail the generated prompt includes.

---

## Install

### Chrome extension

1. Clone the repository:
   ```sh
   git clone https://github.com/gturkmenlabs/Meta-prompt-google-extension.git
   ```
2. Open `chrome://extensions/` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Open the extension's Settings and add an **Anthropic** or **OpenRouter** API key.
   The default models are `claude-sonnet-4-6` for Anthropic and `anthropic/claude-sonnet-4.6` for OpenRouter.

There is no build step. After editing code, click reload on the extension card and refresh the page you're testing.

### macOS app

Requires macOS 13 or newer on Apple Silicon and the Xcode Command Line Tools (`xcode-select --install`).

```sh
npm run build:macos   # produces dist/MetaPrompt.app
```

The app reuses the same prompt engine. Instead of an API key, it can use a signed-in local CLI: **Claude Code**, **Codex** or **OpenCode**. Those accounts always use `inline` HDA. See [macos/README.md](macos/README.md).

---

## Keyboard shortcuts

| Windows / Linux | macOS | Action |
| :--- | :--- | :--- |
| `Ctrl+Shift+L` | `Cmd+Shift+L` | Revise the focused text box in place |
| `Ctrl+Shift+U` | `Cmd+Shift+U` | Undo the last revision |
| — | `Cmd+,` | Open Settings (macOS app) |

You can also right-click a text box and use the context menu.

---

## Tests

Every test runs offline. None of them needs an API key, a network connection or a build step.

```sh
npm test
```

| Script | What it checks |
| :--- | :--- |
| `npm run test:prompt` | 184 checks: task detection in English and Turkish, prompt structure, HDA, injection guard |
| `npm run test:brain` | Neuron dynamics, synapse plasticity, save/load round-trips, speed benchmarks |
| `npm run test:runtime` | Key isolation, failover limits, broken streams, undo, user-edit protection, TypeSafe fail-open |
| `npm run test:desktop` | macOS bridge: callbacks, Unicode clipboard, streaming, cancellation |
| `npm run test:efficiency` | 33 checks: cache, safe compression, conciseness reward, prompt caching |

The runtime suite prints `TypeSafe classification failed: HTTP 500` and `offline`. These messages are expected: they come from mocks that test the fail-open path.

---

## Privacy

- **No telemetry.** The extension has no analytics, tracking or remote logging.
- **Local storage only.** Settings and brain state stay in `chrome.storage.local` (or `state.json` on macOS).
- **Direct connections.** Your text goes straight from your device to the provider you chose.
- **Third services are opt-in.** TypeSafe (first 2,000 characters only) and cross-provider fallback are both off by default.
- **History masking.** Common API-key patterns are masked in the local history on a best-effort basis.

Details: [compliance.md](compliance.md).

---

## Costs and trade-offs to know about

- **HDA `agents` mode costs extra calls.** It is the default, and it adds five model calls before each revision (two in `kisa` length). Switch to `inline` if speed or cost matters more than depth.
- **The brain simulation's effect is indirect.** Its numbers reach the model only as a line of text in the instructions. No A/B measurement of how much it improves output is included in this repository.
- **The cache can return an older answer** for text that is at least 92% similar under the same settings. If you need a fresh result, change the text or wait for the 24-hour expiry.

---

## Project layout

```text
manifest.json         Chrome MV3 manifest (permissions, shortcuts)
background.js         Service worker: message router, revision pipeline, streaming
content.js            Reads/writes the page's text box, undo snapshots
api.js                Anthropic + OpenRouter client, SSE streaming, failover
config.js             Providers, default models, failover limits
prompt.js             Task detection and system-prompt builders for every mode
hda_agents.js         The five HDA phase agents with inline fallback
brain_network.js      Spiking neural network simulation
brain_helper.js       Brain persistence, ticks and rewards
efficiency.js         Semantic cache, safe compression, prompt-cache blocks
typesafe.js           Optional TypeSafe task classifier (opt-in, fail-open)
popup.* / options.*   Popup and Settings UI
theme.css             Shared styles
verify_*.js / .mjs    Offline test suites
macos/                Native macOS app (Swift host + JS bridge + build script)
```

---

## Further reading

- [CLAUDE.md](CLAUDE.md): developer guide and the contracts between files
- [methodology.md](methodology.md): the full Ana Beyin prompt design
- [compliance.md](compliance.md): privacy and data handling
- [performance_report.md](performance_report.md): brain simulation benchmarks
- [macos/README.md](macos/README.md): macOS app and CLI account bridge
