# Meta-Prompt Engine & Revision System 🚀

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![macOS Companion](https://img.shields.io/badge/macOS-Apple_Silicon_Native-000000?logo=apple&logoColor=white)](macos/README.md)
[![Windows Companion](https://img.shields.io/badge/Windows-WebView2_Native-0078D4?logo=windows&logoColor=white)](windows/README.md)
[![Tests](https://img.shields.io/badge/Offline_Checks-122%2B_Passing-success?logo=node.js&logoColor=white)](package.json)
[![Providers](https://img.shields.io/badge/Providers-Anthropic_%7C_OpenRouter-blueviolet)](config.js)
[![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_Storage-green)](compliance.md)

An intelligent, context-aware prompt enhancement engine available as a **Google Chrome Extension (Manifest V3)** and as standalone native **macOS** and **Windows** companion applications. 

Meta-Prompt transforms raw user thoughts, drafts, and queries in real time into **expert-grade prompts** tailored for frontier LLMs. It streams the revised prompt directly into any web text field in place or native desktop windows, backed by a biophysical Spiking Neural Network (SNN) cognitive model and automated multi-model failover.

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [🧠 Architecture & Cognitive Engine](#-architecture--cognitive-engine)
- [🎯 Enhancement Modes & Strategies](#-enhancement-modes--strategies)
- [🖥️ Standalone Desktop Apps](#️-standalone-desktop-apps)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [📂 Project Structure](#-project-structure)
- [🛠️ Installation & Setup](#️-installation--setup)
  - [Google Chrome Extension](#google-chrome-extension)
  - [macOS Desktop App](#macos-desktop-app)
  - [Windows Desktop App](#windows-desktop-app)
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

---

## 🧠 Architecture & Cognitive Engine

```text
┌────────────────────────────────────────────────────────┐
│               User Trigger (Shortcut / Menu)           │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   Task Intent Classifier  │  (Bilingual TR/EN Keyword Scoring)
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   SNN "Ana Beyin" Tick    │  (LIF Neurons + ACh/NE/DA Modulators)
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

## 🖥️ Standalone Desktop Apps

In addition to the browser extension, this repository contains two native apps built from the same prompt engine — an Apple Silicon macOS app (`dist/MetaPrompt.app`) and a Windows app (`dist/MetaPrompt-Windows/MetaPrompt.exe`):

- **Native Hosts**: Swift + WKWebView on macOS, C# + WebView2 on Windows, both using system windows and clipboard shortcuts.
- **No Chrome Dependency**: Runs independently of browser sessions or node runtime installations.
- **Shared Bridge Contract**: Both hosts answer the same actions and stream results identically, so the engine, interface and settings behave the same on either platform.
- **Connected CLI Accounts**: Can leverage local signed-in developer CLIs without needing separate API keys:
  - **Claude Code** (`claude` CLI with Sonnet profile)
  - **Codex** (ChatGPT developer account)
  - **OpenCode** (Local / OpenCode account)
- Build instructions in [macos/README.md](macos/README.md) and [windows/README.md](windows/README.md).

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
├── popup.html / popup.js    # Browser action popup UI & streaming port bridge
├── popup.css                # Extension popup layout and styling
├── options.html / options.js# Settings page for keys, providers, and failover options
├── options.css              # Settings layout styling
├── theme.css                # Shared design system (warm neutral & forest-green palette)
├── package.json             # Test runner configuration (npm test)
├── verify_prompt.js         # 122 structural & bilingual prompt checks
├── verify_brain.js          # SNN biophysical unit tests, benchmarks, stress tests
├── verify_runtime.mjs       # Mock-based runtime failover, undo, & isolation tests
├── macos/                   # Native macOS companion application
│   ├── Main.swift           # Swift macOS app delegate & window manager
│   ├── Accounts.swift       # Connected CLI accounts bridge (Claude, Codex, OpenCode)
│   ├── accounts.js          # Connected-accounts panel, shared by both desktop apps
│   ├── desktop.js           # Desktop environment adapter (WKWebView transport)
│   ├── build.py             # Packaging & ad-hoc code signing script
│   ├── verify_desktop.mjs   # Native desktop bridge test suite
│   └── README.md            # macOS app documentation and build manual
├── windows/                 # Native Windows companion application
│   ├── Program.cs           # C# host: windows, bridge dispatch, streamed fetch
│   ├── Accounts.cs          # Connected CLI accounts bridge (Claude, Codex, OpenCode)
│   ├── desktop.js           # Desktop environment adapter (WebView2 transport)
│   ├── MetaPrompt.csproj    # .NET 8 single-file, self-contained win-x64 build
│   ├── build.py             # Publishes the host and assembles the web assets
│   ├── verify_desktop.mjs   # Bridge, build-list & endpoint-allowlist test suite
│   └── README.md            # Windows app documentation and build manual
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

### Windows Desktop App

Requires Windows 10 (1809) or newer, 64-bit, with the Microsoft Edge WebView2 runtime (preinstalled on current Windows 10 and 11):

1. Install the [.NET 8 SDK](https://dotnet.microsoft.com/download).
2. Build the application:
   ```sh
   npm run build:windows
   ```
3. The built application will be ready at `dist/MetaPrompt-Windows/MetaPrompt.exe`. The folder is self-contained and can be copied anywhere.

---

## 🧪 Offline Verification & Tests

All tests run completely **offline** without requiring API credentials, network access, or build steps:

```sh
npm test
```

This runs the comprehensive verification suite:
- **`npm run test:prompt`**: 122 prompt structure tests, bilingual English & Turkish task classifiers, token boundaries, and anti-injection sanitization.
- **`npm run test:brain`**: SNN neuron membrane dynamics, Tsodyks-Markram plasticity, STDP pruning, serialization round-trips, and 10,000-step latency benchmarks.
- **`npm run test:runtime`**: API key isolation, failover limits, SSE stream recovery, and target element locking.
- **`npm run test:desktop`**: Native Swift/JS message bridges, Unicode clipboard buffers, and stream cancellation.

---

## 🔒 Privacy & Security Model

- **Zero External Telemetry**: The extension contains no third-party tracking, analytics, or remote logging.
- **100% Local Storage**: Settings, preferences, and neural synaptic weights are stored exclusively in Chrome's `chrome.storage.local` (or `state.json` on macOS).
- **Direct API Connections**: Prompts are transmitted strictly between your device and your chosen AI provider (Anthropic or OpenRouter).
- **Cross-Provider Protection**: Your text is never routed to an alternative provider during failover unless you explicitly opt in via Settings.
- **Local History Redaction**: Reversible obfuscation is applied to recent history, with best-effort masking of common API keys and sensitive tokens.

---

## 📄 References & Methodology

- [CLAUDE.md](CLAUDE.md): Internal developer guidelines and cross-file contracts.
- [methodology.md](methodology.md): The full Ana Beyin prompt revision design document.
- [compliance.md](compliance.md): Detailed compliance and privacy disclosures.
- [performance_report.md](performance_report.md): Computational benchmarks for the SNN engine.
- [macos/README.md](macos/README.md): macOS app architecture and CLI bridge manual.

