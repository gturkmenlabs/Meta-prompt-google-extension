# Meta-Prompt Engine & Revision System 🚀

This project is a modern Google Chrome extension (Manifest V3) that revises ordinary text found in web-page text fields (input/textarea) in place, turning it into **expert-grade prompts (meta-prompts)** by leveraging Claude (the Anthropic Messages API) or OpenRouter integration.

---

## ✨ Features

- **In-place Revision**: Improve the text in any text field directly in place with a keyboard shortcut. The result is written in a **streaming** fashion — it appears in the field as it is generated.
- **Undo**: If the in-place revision has overwritten the text in the field, restore the original text with `Ctrl + Shift + U` or the **"Undo last revision"** item in the right-click menu.
- **Enhancement Modes**: In addition to the standard meta-prompt, there are **Vibe Coding** (6 strategies), **Web Research** (Boolean/dorking/academic/OSINT), and **Anti-Hallucination** (RAG, ReAct, CoN, CoK, LogiCoT, CoVe, Atomic Claim Verification, Self-Consistency, Semantic Triangulation) modes; with the "Auto" selection, the strategy is determined automatically based on the intent in the text.
- **Smart Task Detection**: The raw text is classified as coding / analysis / email / summary / translation / explanation / planning / creative writing, and the prompt is specialized accordingly.
- **SNN "Ana Beyin" (Main Brain) Simulation**: A biophysical spiking neural network runs before every revision; the ACh/NE/DA neuromodulator levels are folded into the prompt as a cognitive-style parameter and adapt over time through usage feedback (reward/penalty).
- **Multi-Provider Support (Anthropic & OpenRouter)**:
  - Direct Anthropic Messages API (Claude Sonnet, Haiku, Opus, etc.).
  - Support for hundreds of open-source and commercial models via the OpenRouter API.
- **Smart Error Handling and Failover**:
  - When a model is busy or returns an error, automatic switching to the next alternative model. At most 3 backup models are tried per revision, so a failing provider cannot hang the request for minutes.
  - Backups stay within the active provider. Sending your text to the *other* provider is opt-in, off by default, and enabled with a single checkbox in Settings.
  - Halting needless retries on critical authorization errors such as 401/403; 90 s request / 30 s stream-silence timeouts.
- **Quick Shortcuts**:
  - `Ctrl + Shift + L` (Mac: `Cmd + Shift + L`) — instant in-place revision.
  - `Ctrl + Shift + U` (Mac: `Cmd + Shift + U`) — undo the last revision.
- **Output Control**: Choice of output language (Auto/Turkish/English) and four length tiers (Short/Medium/Long/Max).
- **Revision History**: The last 5 revisions are stored locally using reversible obfuscation (not secure encryption); they can be deleted individually or cleared all at once. Common API key and email patterns are redacted before saving; this is best-effort and does not detect all sensitive data.
- **Secure Storage**: Your API keys and preferences are stored entirely in local browser storage (`chrome.storage.local`); keys are sent only to their matching API provider for authentication. Source text and generated prompts are sent to the model you selected, and to backup models on that same provider if it fails. They reach a different provider only if you turn on cross-provider fallback in Settings, and reach a second model only if you turn on the consensus check.

---

## 📂 Project Structure

```text
├── manifest.json          # Chrome Extension configuration file (V3)
├── icons/                 # Extension icons (SVG source + 16/32/48/128 PNG)
├── background.js          # Background worker (Service Worker), shortcut and menu listeners
├── content.js             # Script that provides access to text fields on pages
├── api.js                 # Anthropic and OpenRouter API integrations
├── config.js              # Provider definitions and local settings management helpers
├── popup.html / popup.js  # Quick-access and status display interface
├── options.html / options.js # Detailed model and API key settings page
├── prompt.js              # Revision system prompts and templates
├── brain_network.js       # Advanced prompt optimization network logic
├── brain_helper.js        # Helper functions
├── package.json           # Offline check runner (npm test); no bundler, no build step
├── verify_brain.js        # SNN validation and testing tool
├── verify_prompt.js       # Prompt layer validation tool (npm run test:prompt)
├── verify_runtime.mjs     # Config, failover, streaming and undo contracts
├── compliance.md          # Compliance and standards document
├── methodology.md         # Prompt revision methodology
└── performance_report.md  # Performance analysis report
```

---

## 🛠️ Installation and Loading

Follow these steps to load the extension into your browser locally:

1. Clone or download this repository.
2. Open your Google Chrome browser and navigate to `chrome://extensions/`.
3. Enable the **"Developer mode"** option in the top-right corner.
4. Click the **"Load unpacked"** button in the top left.
5. Select this project's folder (the root directory containing the files) to load it.

---

## ⚙️ Configuration and Usage

1. Click the **Meta-Prompt** icon in your browser's extension bar, or go to the **Options** page.
2. Select your preferred provider (Anthropic or OpenRouter).
3. Enter your API Key and configure the models you want to use.
4. After typing your text into a text field on any web page:
   - Select the text and right-click to choose the **"Revise with Meta-Prompt"** option, or
   - Use the `Ctrl + Shift + L` (`Cmd + Shift + L`) shortcut.
5. If the result is not what you expected, you can restore the original text with `Ctrl + Shift + U` (`Cmd + Shift + U`).


## Reliability and verification

In-place revisions keep the original target even if focus moves. If you edit the
field during generation, automatic writing stops and the completed result is
available in the popup. Interrupted streams retain an undo snapshot. Repeated
in-place triggers on a busy tab are ignored until the current operation finishes.
A stream that ends without its completion marker is reported as incomplete.

Run the offline checks (no API keys, network requests, or build step required):

```sh
npm test
```

That runs the prompt layer (122 structural checks, including Turkish task
detection), the brain simulation, the runtime contracts, and the macOS desktop
bridge. Individual suites are available as `npm run test:prompt`, `test:brain`,
`test:runtime` and `test:desktop`.

After changes, reload the unpacked extension and refresh the target page. For a
manual smoke test, revise a textarea, switch focus while generation is running,
then undo. Also check popup generation, copy, write to page, and provider switching
in Settings. Restricted Chrome pages and some custom editors cannot be edited;
use Copy in those cases. Live provider calls require your configured credentials.

## Interface styling

`popup.css` and `options.css` define screen-specific layout. `theme.css` holds the
shared warm neutral and forest-green palette, typography, focus states, mode cards,
and responsive settings layout. Fonts use the system stack; no external font
requests are needed. Reload the extension after updating styles.

## Standalone macOS app

An additional Apple Silicon desktop app is available at `dist/MetaPrompt.app`.
It uses the same prompt engine with native windows, menus, clipboard integration,
and separate local settings. See [macOS instructions](macos/README.md).
Build it with `python3 macos/build.py`; Chrome is not required to run it.
