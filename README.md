# Meta-Prompt Engine & Revision System 🚀

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![macOS Companion](https://img.shields.io/badge/macOS-Apple_Silicon_Native-000000?logo=apple&logoColor=white)](macos/README.md)
[![Tests](https://img.shields.io/badge/Offline_Checks-200%2B_Passing-success?logo=node.js&logoColor=white)](package.json)
[![Providers](https://img.shields.io/badge/Providers-Anthropic_%7C_OpenRouter-blueviolet)](config.js)
[![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_Storage-green)](compliance.md)

An intelligent, context-aware prompt enhancement engine available as both a **Google Chrome Extension (Manifest V3)** and a **standalone native macOS companion application**. 

Meta-Prompt transforms raw user thoughts, drafts, and queries in real time into **expert-grade prompts** tailored for frontier LLMs. It streams the revised prompt directly into any web text field in place or native desktop windows, backed by a biophysical Spiking Neural Network (SNN) cognitive model and automated multi-model failover.

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [🧠 Architecture & Cognitive Engine](#-architecture--cognitive-engine)
- [🎯 Enhancement Modes & Strategies](#-enhancement-modes--strategies)
- [🖥️ Standalone macOS App](#️-standalone-macos-app)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [📂 Project Structure](#-project-structure)
- [🛠️ Installation & Setup](#️-installation--setup)
  - [Google Chrome Extension](#google-chrome-extension)
  - [macOS Desktop App](#macos-desktop-app)
- [🧪 Offline Verification & Tests](#-offline-verification--tests)
- [🔒 Privacy & Security Model](#-privacy--security-model)
- [📄 References & Methodology](#-references--methodology)

---

## ✨ Key Features

- **In-Place Live Streaming**: Type your idea into any `<input>` or `<textarea>`, trigger the shortcut, and watch the prompt stream into the field character-by-character.
- **One-Key Undo & Snapshot Safety**: Accidental revision or unexpected output? Hit `Ctrl+Shift+U` (`Cmd+Shift+U` on macOS) or right-click to restore your original text instantly.
- **Focus-Lock & Edit Protection**: If focus leaves the field during generation, streaming safely finishes in the background and saves to popup clipboard history. If you begin typing while a stream is running, auto-writing ceases immediately to preserve your edits.
- **Partial Stream Resilience**: Service worker evictions never lose your generation — partial stream states are mirrored to storage every second for seamless recovery.
- **Bilingual Smart Task Detection**: Robust ASCII-folded classification for Turkish and English. Distinguishes Coding, Analysis, Email, Summary, Translation, Explanation, Planning, and Creative Writing without tripping over false positives (e.g. "posta kodu", "barkod", "çalışma programı").
- **Biophysical SNN Simulation ("Ana Beyin")**: Simulates a Leaky Integrate-and-Fire (LIF) network with Tsodyks-Markram dynamic synapses and neuromodulators (ACh, NE, DA). Modulator values modulate prompt cognition and adapt via reward/penalty feedback.
- **Resilient Dual-Provider Integration**:
  - Direct Anthropic Messages API (Claude 3.5 Sonnet, Haiku, Opus).
  - OpenRouter API access to hundreds of open-source and commercial models.
  - Automatic model failover (capped at 3 backup retries to prevent prolonged hangs).
  - Cross-provider fallback is strictly opt-in and off by default.
  - Immediate failover halt on authentication errors (401/403).
- **HDA Thinking Algorithm**: A five-phase audit (epistemic filter, conceptual analysis, intentionality check, rational inference, hylomorphic synthesis) runs on every revision — either as five sequential phase agents (default, deepest) or as a single inline directive with no extra calls. If a phase agent fails, the revision falls back to the inline audit instead of stopping.
- **Efficiency Layer**: A local semantic cache (50 entries, 24 h TTL) returns repeated requests without an API call; system prompts are compressed only when every protected rule survives; long Anthropic system prompts use prompt-cache breakpoints on the stable prefix.
- **Optional TypeSafe Task Classification**: Off by default. When enabled in Settings, the first 2,000 characters are sent to TypeSafe to pick the task type; any failure or low confidence falls back to the keyword classifier.

---

## 🧠 Architecture & Cognitive Engine

```text
┌────────────────────────────────────────────────────────┐
│               User Trigger (Shortcut / Menu)           │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │      Semantic Cache       │  (Hit → return cached prompt)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   Task Intent Classifier  │  (TR/EN keywords, optional TypeSafe)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   SNN "Ana Beyin" Tick    │  (LIF Neurons + ACh/NE/DA Modulators)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    HDA Phase Agents       │  (5-phase audit, inline fallback)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    System Prompt Builder  │  (Mode Strategy + Length Budget + Guardrails)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │ Failover Streaming Router │  (Anthropic / OpenRouter SSE Engine)
              └─────────────┬─────────────┘
                            │
       ┌────────────────────┴────────────────────┐
       ▼                                         ▼
┌──────────────┐                         ┌──────────────┐
│  Chrome MV3  │                         │ macOS Native │
│ In-Place Text│                         │ App Window   │
└──────────────┘                         └──────────────┘
```

The system prompt follows the **Ana Beyin methodology**: it produces a prompt *for another LLM* rather than directly answering the request. It enforces strict fidelity rules: verbatim specifics (names, endpoints, values) must be preserved, while missing critical context uses standardized placeholders like `[PLACEHOLDER]` rather than hallucinated details.

---

## 🎯 Enhancement Modes & Strategies

Select between multiple specialized prompting modes in the popup or settings:

| Mode | Available Strategies | Purpose & Capabilities |
| :--- | :--- | :--- |
| **Standard Meta-Prompt** | Auto / Structured | General expert prompting, task-specialized role definition, chain-of-thought instructions. |
| **Vibe Coding** | Standard, Jazz, Fractal, Emotive, Hydrological, Alchemical | Deep programming prompts, iterative verification loops, v1.0 architecture contracts, security review checklists. |
| **Web Research** | Boolean, Dorking, Academic, OSINT | Search engine syntax, targeted domain filters, academic citation guidelines, investigation frameworks. |
| **Anti-Hallucination** | RAG, ReAct, CoN, CoK, LogiCoT, CoVe, Atomic Claim, Self-Consistency, Semantic Triangulation | Strict factual bounding, multi-angle claim decomposition, formal reasoning, zero unverified assumptions. |

---

## 🖥️ Standalone macOS App

In addition to the browser extension, this repository contains a standalone Apple Silicon macOS app (`dist/MetaPrompt.app`):

- **Native Swift Host**: Fast, lightweight macOS interface using system windows, menus, and clipboard shortcuts.
- **No Chrome Dependency**: Runs independently of browser sessions or node runtime installations.
- **Connected CLI Accounts**: Can leverage local signed-in developer CLIs without needing separate API keys:
  - **Claude Code** (`claude` CLI with Sonnet profile)
  - **Codex** (ChatGPT developer account)
  - **OpenCode** (Local / OpenCode account)
- Build instructions located in [macos/README.md](macos/README.md).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | macOS | Action |
| :--- | :--- | :--- |
| `Ctrl + Shift + L` | `Cmd + Shift + L` | **Revise in place**: Transforms selected or focused text field |
| `Ctrl + Shift + U` | `Cmd + Shift + U` | **Undo revision**: Restores original text prior to last enhancement |
| `Command + ,` | `Cmd + ,` | Open Settings window (macOS app) |

---

## 📂 Project Structure

```text
├── manifest.json            # Chrome Extension Manifest V3 configuration
├── icons/                   # High-resolution extension and app icons
├── background.js            # Service worker, message router, stream controller
├── content.js               # In-place page DOM accessor, undo snapshot manager
├── api.js                   # Unified Anthropic & OpenRouter SSE client with failover
├── config.js                # Provider schemas, model catalogs, failover constraints
├── prompt.js                # Task detection, Ana Beyin prompt synthesis, mode engines
├── brain_network.js         # Biophysical LIF Spiking Neural Network simulation
├── brain_helper.js          # SNN persistence, modulator integration, synaptic reward
├── hda_agents.js            # HDA five-phase audit agents with inline fallback
├── efficiency.js            # Semantic cache, safe prompt compression, KV prefix caching
├── typesafe.js              # Optional TypeSafe task classifier (opt-in, fail-open)
├── popup.html / popup.js    # Browser action popup UI & streaming port bridge
├── popup.css                # Extension popup layout and styling
├── options.html / options.js# Settings page for keys, providers, and failover options
├── options.css              # Settings layout styling
├── theme.css                # Shared design system (warm neutral & forest-green palette)
├── package.json             # Test runner configuration (npm test)
├── verify_prompt.js         # 184 structural, bilingual & HDA prompt checks
├── verify_brain.js          # SNN biophysical unit tests, benchmarks, stress tests
├── verify_runtime.mjs       # Mock-based runtime failover, undo, & isolation tests
├── verify_efficiency.js     # Semantic cache, compression & KV caching checks
├── macos/                   # Native macOS companion application
│   ├── Main.swift           # Swift macOS app delegate & window manager
│   ├── Accounts.swift       # Connected CLI accounts bridge (Claude, Codex, OpenCode)
│   ├── desktop.js           # Desktop environment adapter
│   ├── accounts.js          # Connected-accounts UI bridge
│   ├── build.py             # Packaging & ad-hoc code signing script
│   ├── verify_desktop.mjs   # Native desktop bridge test suite
│   └── README.md            # macOS app documentation and build manual
├── methodology.md           # Formal Ana Beyin prompt architecture specification
├── compliance.md            # Privacy and data handling disclosures
├── performance_report.md    # SNN latency and throughput benchmark results
└── CLAUDE.md                # Development guide and developer contracts
```

---

## 🛠️ Installation & Setup

### Google Chrome Extension

1. Clone or download this repository to your computer:
   ```sh
   git clone https://github.com/gturkmenlabs/Meta-prompt-google-extension.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the repository root folder.
6. Click the extension icon to open Settings and configure your Anthropic or OpenRouter API key.

### macOS Desktop App

Requires macOS 13 or newer on Apple Silicon (M1/M2/M3/M4):

1. Ensure Xcode Command Line Tools are installed: `xcode-select --install`
2. Build the app bundle:
   ```sh
   npm run build:macos
   ```
3. The built application will be ready at `dist/MetaPrompt.app`. Double-click or copy to `/Applications`.

---

## 🧪 Offline Verification & Tests

All tests run completely **offline** without requiring API credentials, network access, or build steps:

```sh
npm test
```

This runs the comprehensive verification suite:
- **`npm run test:prompt`**: 184 prompt structure tests, bilingual English & Turkish task classifiers, HDA directive and phase agents, token boundaries, and anti-injection sanitization.
- **`npm run test:brain`**: SNN neuron membrane dynamics, Tsodyks-Markram plasticity, STDP pruning, serialization round-trips, and 10,000-step latency benchmarks.
- **`npm run test:runtime`**: API key isolation, failover limits, SSE stream recovery, target element locking, and TypeSafe opt-in / fail-open behavior.
- **`npm run test:desktop`**: Native Swift/JS message bridges, Unicode clipboard buffers, stream cancellation, and the macOS build file list.
- **`npm run test:efficiency`**: Semantic cache, protected-line compression, conciseness-scaled reward, and block/pyramid KV caching.

---

## 🔒 Privacy & Security Model

- **Zero External Telemetry**: The extension contains no third-party tracking, analytics, or remote logging.
- **100% Local Storage**: Settings, preferences, and neural synaptic weights are stored exclusively in Chrome's `chrome.storage.local` (or `state.json` on macOS).
- **Direct API Connections**: Prompts are transmitted directly between your device and your chosen AI provider (Anthropic or OpenRouter). The only other destination is TypeSafe, and only if you enable its classifier in Settings (first 2,000 characters).
- **Cross-Provider Protection**: Your text is never routed to an alternative provider during failover unless you explicitly opt in via Settings.
- **Local History Redaction**: Reversible obfuscation is applied to recent history, with best-effort masking of common API keys and sensitive tokens.

---

## 📄 References & Methodology

- [CLAUDE.md](CLAUDE.md): Internal developer guidelines and cross-file contracts.
- [methodology.md](methodology.md): The full Ana Beyin prompt revision design document.
- [compliance.md](compliance.md): Detailed compliance and privacy disclosures.
- [performance_report.md](performance_report.md): Computational benchmarks for the SNN engine.
- [macos/README.md](macos/README.md): macOS app architecture and CLI bridge manual.

