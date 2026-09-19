# MetaPrompt for Windows

A standalone Windows app. The Chrome extension and the macOS app remain
available and are not modified by this build.

## Open

Run ../dist/MetaPrompt-Windows/MetaPrompt.exe, or copy that folder anywhere and
run it from there. Requires Windows 10 (1809) or newer, 64-bit, with the
Microsoft Edge WebView2 runtime — present by default on current Windows 10 and
11; otherwise install the Evergreen Runtime from Microsoft. The .NET runtime is
bundled, so nothing else needs installing.

Open Settings with the gear button. Enter your Anthropic or OpenRouter key,
select a model, then save. App settings are separate from Chrome and from the
macOS app.

The "Connected accounts" panel at the top can generate without an API key by
calling a CLI you have already signed in to: Codex (ChatGPT account), Claude
Code (Claude account) or OpenCode. Claude Code is always run with the public
"sonnet" alias so a custom model in your global settings does not leak in.
OpenCode uses whatever default model you configured in it; with no provider
credentials it falls back to OpenCode's free models. Sign in for OpenCode opens
its own console window, because `opencode auth login` is an interactive picker.
The app looks for these CLIs in `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`,
`%LOCALAPPDATA%\Programs`, the WinGet links folder, and everything on PATH.

Paste source text, select an approach and create a prompt. Copy the result into
the application where you want to use it. Standard Ctrl-C/V/A shortcuts work.

Page rewriting and Chrome context menus belong to the extension. The Windows app
does not edit other applications.

## Data and networking

Settings and the five-item revision history are stored in
`%LOCALAPPDATA%\MetaPrompt\state.json`, written atomically through a temporary
file. That folder is per-user but is not additionally locked down with an ACL,
so treat a shared machine accordingly. API keys are stored as plain text, not in
Credential Manager. History uses the extension's reversible obfuscation and
best-effort redaction.

Requests go directly to Anthropic, OpenRouter or TypeSafe. The C# bridge allows
only the four API URLs the engine actually uses, and `windows/verify_desktop.mjs`
asserts that list matches the macOS one. The interface is served from files next
to the executable through a WebView2 virtual host mapping; no local web server,
Node installation or Chrome is required. Navigation away from that host is
refused, developer tools are off, and new windows are blocked. Generation
supports streamed results, timeout cancellation and the shared engine's failover.

The CLI account mode runs the official CLI as a child process with
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` and the matching
base-URL overrides removed from its environment, so it uses the account you
signed in to rather than any key configured for the extension.

## Build and checks

Install the [.NET 8 SDK](https://dotnet.microsoft.com/download), then from the
project root:

    npm run build:windows
    npm test

The build copies the shared interface and engine files next to the host, adds
the desktop bridge and layout, and publishes a self-contained single-file
executable for win-x64. Rebuild after changing shared sources. Source extension
files are never rewritten by the build. `pip install pillow` is optional and
only adds the app icon.

The executable is not Authenticode-signed, so SmartScreen will warn on first
run. Public distribution needs your own code-signing certificate.

## Verified

- Offline bridge checks: request/reply correlation, storage, callback API,
  message ports, clipboard, streamed UTF-8 data, cancellation.
- The Windows and macOS builds copy the same shared file list, and the two
  native hosts allow the same API endpoints.
- Existing runtime and prompt regression checks.

Not verified: the C# host has not been compiled or run. It was written on Linux,
where neither the .NET SDK nor WebView2 is available, so `npm run build:windows`
and a launch on real hardware are still the first things to try.
