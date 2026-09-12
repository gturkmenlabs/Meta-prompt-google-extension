import Cocoa
import WebKit

extension AppDelegate {
    func cliPath(_ provider: String) -> String? {
        let name = provider == "chatgpt" ? "codex" : provider == "opencode" ? "opencode" : "claude"
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [home + "/.local/bin/" + name, "/opt/homebrew/bin/" + name, "/usr/local/bin/" + name].first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    func accountEnvironment() -> [String: String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        // Use the CLI's saved account, never inherited API keys or endpoint overrides.
        return ["HOME": home, "PATH": home + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                "LANG": "en_US.UTF-8", "TMPDIR": NSTemporaryDirectory()]
    }
    // Turn raw CLI output into a short, actionable message. The CLIs echo the whole
    // prompt and long diagnostics; surface only the line that explains the failure.
    func accountErrorMessage(provider: String, stdout: String, stderr: String) -> String {
        let account = provider == "chatgpt" ? "ChatGPT" : provider == "opencode" ? "OpenCode" : "Claude"
        let prefix = "^(ERROR|Error|error|Warning|WARN)\\s*:\\s*"
        let raw = (stderr + "\n" + stdout).split(whereSeparator: { $0 == "\n" || $0 == "\r" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
        // Lines the CLI itself flagged as errors (never the echoed prompt).
        let flagged = raw.filter { $0.range(of: prefix, options: .regularExpression) != nil }
            .map { $0.replacingOccurrences(of: prefix, with: "", options: .regularExpression) }
        func find(_ needles: [String], in pool: [String]) -> String? {
            pool.first { line in needles.contains { line.range(of: $0, options: .caseInsensitive) != nil } }
        }
        if let line = find(["usage limit", "rate limit"], in: flagged + raw) {
            return account + " account limit reached. " + String(line.prefix(400))
        }
        if find(["unrecognized_model", "not_found_error", "model not found", "unknown model"], in: raw) != nil {
            return account + " account rejected the requested model. Update the app or switch to \"API key · advanced\"."
        }
        if find(["not logged in", "not authenticated", "login required", "please log in", "invalid api key", "authentication_error", "unauthorized"], in: raw) != nil {
            return "Sign in to your " + account + " account first, then check connection in Settings."
        }
        if let line = flagged.first {
            return account + " account request failed. " + String(line.prefix(400))
        }
        let tail = String((stderr.isEmpty ? stdout : stderr).suffix(400)).trimmingCharacters(in: .whitespacesAndNewlines)
        return "Account request failed or timed out. Check your login and plan limits." + (tail.isEmpty ? "" : " " + tail)
    }
    enum OpenCodeOutcome { case success(String); case failure(String) }
    // `opencode run --format json` prints one JSON event per line; collect the
    // assistant text parts, or surface the first error event.
    func parseOpenCodeEvents(_ stdout: String) -> OpenCodeOutcome {
        var pieces: [String] = []
        for line in stdout.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            guard let data = line.data(using: .utf8), let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = event["type"] as? String else { continue }
            if type == "error" {
                let error = event["error"] as? [String: Any]
                let payload = error?["data"] as? [String: Any]
                return .failure(payload?["message"] as? String ?? error?["name"] as? String ?? "Unknown error.")
            }
            if type == "text", let part = event["part"] as? [String: Any], let text = part["text"] as? String { pieces.append(text) }
        }
        return .success(pieces.joined())
    }
    func openCodeLoginInTerminal(executable: String, completion: @escaping (Any?, String?) -> Void) {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MetaPrompt")
        let script = support.appendingPathComponent("opencode-login.command")
        do {
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try ("#!/bin/zsh\nexec \"" + executable + "\" auth login\n").write(to: script, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        } catch { completion(nil, error.localizedDescription); return }
        NSWorkspace.shared.open(script)
        completion(["installed": true, "message": "Finish the provider sign-in in the Terminal window, then check connection."], nil)
    }
    func runAccountCLI(provider: String, operation: String, prompt: String = "", completion: @escaping (Any?, String?) -> Void) {
        guard ["chatgpt", "claude", "opencode"].contains(provider), ["status", "login", "generate"].contains(operation) else { completion(nil, "Unsupported account operation"); return }
        guard let executable = cliPath(provider) else {
            let cli = provider == "chatgpt" ? "Codex CLI" : provider == "opencode" ? "OpenCode CLI" : "Claude Code"
            completion(["installed": false, "connected": false, "message": "Install the official " + cli + " first."], nil); return
        }
        if provider == "opencode" && operation == "login" {
            // `opencode auth login` is an interactive picker, so hand it to Terminal.
            openCodeLoginInTerminal(executable: executable, completion: completion); return
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("MetaPrompt-" + UUID().uuidString)
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { completion(nil, error.localizedDescription); return }
        let output = directory.appendingPathComponent("stdout")
        let errors = directory.appendingPathComponent("stderr")
        let input = directory.appendingPathComponent("input")
        let final = directory.appendingPathComponent("answer")
        do {
            try Data().write(to: output); try Data().write(to: errors); try Data(prompt.utf8).write(to: input)
            let out = try FileHandle(forWritingTo: output), err = try FileHandle(forWritingTo: errors), stdin = try FileHandle(forReadingFrom: input)
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.environment = accountEnvironment(); process.currentDirectoryURL = directory
            process.standardOutput = out; process.standardError = err; process.standardInput = stdin
            if operation == "status" {
                process.arguments = provider == "chatgpt" ? ["login", "status"] : provider == "opencode" ? ["auth", "list"] : ["auth", "status"]
            } else if operation == "login" {
                process.arguments = provider == "chatgpt" ? ["login"] : ["auth", "login", "--claudeai"]
            } else if provider == "opencode" {
                // Prompt arrives on stdin; the plan agent has edit/shell tools disabled and
                // the working directory is an empty temp folder, so nothing can be touched.
                process.arguments = ["run", "--pure", "--format", "json", "--agent", "plan", "--dir", directory.path]
            } else if provider == "chatgpt" {
                process.arguments = ["exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral",
                                     "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "apps",
                                     "--disable", "skill_search", "-c", "web_search=\"disabled\"",
                                     "-c", "model_provider=\"openai\"", "--output-last-message", final.path, "-"]
            } else {
                // Pin the model explicitly: without --model, Claude Code falls back to the
                // user's global ~/.claude/settings.json, which may name a model that only
                // works through a proxy (e.g. an OpenRouter slug) and is rejected here.
                process.arguments = ["--print", "--output-format", "json", "--model", "sonnet", "--tools", "", "--safe-mode",
                                     "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
                                     "--no-session-persistence", "--permission-mode", "dontAsk"]
            }
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            process.terminationHandler = { finished in
                timeout.cancel()
                try? out.close(); try? err.close(); try? stdin.close()
                let text = (try? String(contentsOf: output, encoding: .utf8)) ?? ""
                let diagnostic = (try? String(contentsOf: errors, encoding: .utf8)) ?? ""
                let answer = (try? String(contentsOf: final, encoding: .utf8)) ?? ""
                try? FileManager.default.removeItem(at: directory)
                DispatchQueue.main.async {
                    if operation == "status" {
                        var connected = false
                        if provider == "chatgpt" { connected = finished.terminationStatus == 0 && (text + diagnostic).contains("ChatGPT") }
                        else if provider == "opencode" {
                            // OpenCode works without credentials via its free models, so a
                            // successful `auth list` counts as connected.
                            connected = finished.terminationStatus == 0
                            let count = (text + diagnostic).range(of: "([0-9]+) credentials?", options: .regularExpression)
                                .map { String((text + diagnostic)[$0]).split(separator: " ").first.map(String.init) ?? "0" } ?? "0"
                            let message = !connected ? "Sign in with your OpenCode providers" :
                                count == "0" ? "Connected · no provider signed in, OpenCode free models are used" :
                                "Connected · " + count + " provider credential" + (count == "1" ? "" : "s") + " · default OpenCode model"
                            completion(["installed": true, "connected": connected, "message": message], nil); return
                        }
                        else if let data = text.data(using: .utf8), let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            connected = json["loggedIn"] as? Bool == true && json["authMethod"] as? String == "claude.ai"
                        }
                        completion(["installed": true, "connected": connected, "message": connected ? "Connected · subscription account" : "Sign in with your subscription account"], nil)
                    } else if finished.terminationStatus != 0 {
                        completion(nil, self.accountErrorMessage(provider: provider, stdout: text, stderr: diagnostic))
                    } else if operation == "login" {
                        completion(["installed": true, "message": "Sign-in completed. Check connection to confirm."], nil)
                    } else {
                        var result = answer
                        if provider == "opencode" {
                            switch self.parseOpenCodeEvents(text) {
                            case .failure(let message): completion(nil, "OpenCode account request failed. " + message); return
                            case .success(let output): result = output
                            }
                        }
                        if provider == "claude", let data = text.data(using: .utf8),
                           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                            if json["is_error"] as? Bool == true { completion(nil, json["result"] as? String ?? "Claude request failed."); return }
                            result = json["result"] as? String ?? ""
                        }
                        if result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { completion(nil, "The account returned no prompt."); return }
                        completion(["result": result], nil)
                    }
                }
            }
            try process.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + (operation == "status" ? 20 : 240), execute: timeout)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            completion(nil, error.localizedDescription)
        }
    }
}
