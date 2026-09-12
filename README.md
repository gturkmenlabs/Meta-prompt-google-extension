# Meta-Prompt Engine & Revision System 🚀

This project is a modern Google Chrome extension (Manifest V3) that revises ordinary text found in web-page text fields (input/textarea) in place, turning it into **expert-grade prompts (meta-prompts)** by leveraging Claude (the Anthropic Messages API) or OpenRouter integration.

---

## ✨ Features

- **In-place Revision**: Improve the text in any text field directly in place with a keyboard shortcut. The result is written in a **streaming** fashion — it appears in the field as it is generated.
- **Undo**: If the in-place revision has overwritten the text in the field, restore the original text with `Ctrl + Shift + U` or the **"Undo last revision"** item in the right-click menu.
- **Enhancement Modes**: In addition to the standard meta-prompt, there are **Vibe Coding** (6 strategies), **Web Research** (Boolean/dorking/academic/OSINT), and **Anti-Hallucination** (RAG, ReAct, CoN, CoK, LogiCoT, CoVe, Atomic Claim Verification, Self-Consistency, Semantic Triangulation) modes; with the "Auto" selection, the strategy is determined automatically based on the intent in the text.
- **Prompt Quality Rules**: All modes preserve explicit requirements, limit missing-context questions, avoid unnecessary scope, and define observable success criteria. Length targets yield to source fidelity. These are generation instructions, not a guarantee of model output quality.
- **Smart Task Detection**: English and Turkish task keywords with word boundaries reduce accidental matches. The raw text is classified as coding / analysis / email / summary / translation / explanation / planning / creative writing, and the prompt is specialized accordingly.
- **SNN "Ana Beyin" (Main Brain) Simulation**: A biophysical spiking neural network runs before every revision; the ACh/NE/DA neuromodulator levels are folded into the prompt as a cognitive-style parameter and adapt over time through usage feedback (reward/penalty).
- **Multi-Provider Support (Anthropic & OpenRouter)**:
  - Direct Anthropic Messages API (Claude Sonnet, Haiku, Opus, etc.).
  - Support for hundreds of open-source and commercial models via the OpenRouter API.
- **Smart Error Handling and Failover**:
  - When a model is busy or returns an error, automatic switching to the next alternative model (including across providers).
  - Halting needless retries on critical authorization errors such as 401/403; 90 s request / 30 s stream-silence timeouts.
- **Quick Shortcuts**:
  - `Ctrl + Shift + L` (Mac: `Cmd + Shift + L`) — instant in-place revision.
  - `Ctrl + Shift + U` (Mac: `Cmd + Shift + U`) — undo the last revision.
- **Output Control**: Choice of output language (Auto/Turkish/English) and four length tiers (Short/Medium/Long/Max).
- **Revision History**: The last 5 revisions are stored locally in encrypted form; they can be deleted individually or cleared all at once. API keys/emails are stripped out before being saved to history.
- **Secure Storage**: Your API keys and preferences are stored entirely in local browser storage (`chrome.storage.local`); they are not sent to any third-party servers.

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
├── verify_brain.js        # SNN validation and testing tool
├── verify_prompt.js       # Prompt layer validation tool (node verify_prompt.js)
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
