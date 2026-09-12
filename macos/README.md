# MetaPrompt for macOS

A standalone Apple Silicon macOS app. The Chrome extension remains available
and is not modified by the app build.

## Open

Open ../dist/MetaPrompt.app, or copy it into your Applications folder.
Requires macOS 13 or newer on Apple Silicon (M1 or later).

Open Settings using the gear button or Command-comma. Enter your Anthropic or
OpenRouter key, select a model, then save. App settings are separate from Chrome.

The "Connected accounts" panel at the top can generate without an API key by
calling a CLI you have already signed in to: Codex (ChatGPT account), Claude
Code (Claude account) or OpenCode. Claude Code is always run with the public
"sonnet" alias so a custom model in ~/.claude/settings.json does not leak in.
OpenCode uses whatever default model you configured in it; with no provider
credentials it falls back to OpenCode's free models. Sign in for OpenCode opens
Terminal, because `opencode auth login` is an interactive picker.
Paste source text, select an approach and create a prompt. Copy the result into
the application where you want to use it. Standard Command-C/V/A shortcuts work.

Page rewriting and Chrome context menus belong to the extension. The macOS app
does not edit other apps or request Accessibility access.

## Data and networking

Settings and the five-item revision history are stored in
~/Library/Application Support/MetaPrompt/state.json. The directory and file are
restricted to the current user. API keys are stored as plain text, not in Keychain.
History uses the extension's reversible obfuscation and best-effort redaction.

Requests go directly to Anthropic or OpenRouter. The Swift bridge allows only the
three API URLs needed by the existing engine. The app serves its interface from
bundled files; no local web server, Node installation, or Chrome is required.
Generation supports streamed results, timeout cancellation, and the shared
engine's failover behavior.

## Build and checks

Install Apple's Command Line Tools, then from the project root:

    python3 macos/build.py
    node macos/verify_desktop.mjs
    node verify_runtime.mjs
    node verify_prompt.js
    node verify_brain.js

The build copies the shared interface and engine files into the app, adds the
desktop bridge and layout, compiles the Swift host, and applies a local ad-hoc
signature. Rebuild after changing shared sources. Source extension files are
never rewritten by the build.

The included build targets arm64. It is locally signed, not Developer ID signed
or notarized. Public distribution requires your Apple Developer signing identity
and Apple's notarization process.

## Verified

- App compilation and local code signature.
- Native app launch, mode switching, separate Settings window.
- Public OpenRouter model catalog loading through the native network bridge.
- Offline bridge tests: storage, callback API, message ports, clipboard,
  streamed UTF-8 data, cancellation.
- Existing runtime regression checks.

Paid generation was not exercised without user-supplied API credentials.
