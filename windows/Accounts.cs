// Login is owned by the official CLIs; this app never reads or copies OAuth tokens.
// The Swift twin is macos/Accounts.swift — same providers, same operations, same
// reply shapes; only process launching and the search paths are Windows-specific.
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MetaPrompt;

internal static class Accounts
{
    internal delegate void Responder(bool ok, JsonNode? value, string? error);

    private static readonly string[] Providers = ["chatgpt", "claude", "opencode"];
    private static readonly string[] Operations = ["status", "login", "generate"];

    private static string DisplayName(string provider) =>
        provider == "chatgpt" ? "ChatGPT" : provider == "opencode" ? "OpenCode" : "Claude";

    private static string CliName(string provider) =>
        provider == "chatgpt" ? "codex" : provider == "opencode" ? "opencode" : "claude";

    // The CLIs install as .cmd/.ps1 shims under npm or as a bare .exe; look for
    // each spelling rather than assuming one installer.
    private static string? FindCli(string provider)
    {
        var name = CliName(provider);
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var directories = new List<string>
        {
            Path.Combine(home, ".local", "bin"),
            Path.Combine(roaming, "npm"),
            Path.Combine(local, "Programs", name),
            Path.Combine(local, "Microsoft", "WinGet", "Links"),
        };
        foreach (var entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            if (!string.IsNullOrWhiteSpace(entry)) directories.Add(entry);
        }
        foreach (var directory in directories)
        {
            foreach (var extension in new[] { ".exe", ".cmd", ".bat", ".ps1", "" })
            {
                var candidate = Path.Combine(directory, name + extension);
                if (File.Exists(candidate)) return candidate;
            }
        }
        return null;
    }

    // Turn raw CLI output into a short, actionable message. The CLIs echo the whole
    // prompt and long diagnostics; surface only the line that explains the failure.
    private static string ErrorMessage(string provider, string stdout, string stderr)
    {
        var account = DisplayName(provider);
        var raw = (stderr + "\n" + stdout)
            .Split(['\n', '\r'], StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .ToList();
        var flagged = raw
            .Where(line => System.Text.RegularExpressions.Regex.IsMatch(line, @"^(ERROR|Error|error|Warning|WARN)\s*:\s*"))
            .Select(line => System.Text.RegularExpressions.Regex.Replace(line, @"^(ERROR|Error|error|Warning|WARN)\s*:\s*", ""))
            .ToList();

        static string? Find(IEnumerable<string> needles, IEnumerable<string> pool) =>
            pool.FirstOrDefault(line => needles.Any(needle =>
                line.Contains(needle, StringComparison.OrdinalIgnoreCase)));

        if (Find(["usage limit", "rate limit"], flagged.Concat(raw)) is { } limit)
        {
            return account + " account limit reached. " + Truncate(limit, 400);
        }
        if (Find(["unrecognized_model", "not_found_error", "model not found", "unknown model"], raw) is not null)
        {
            return account + " account rejected the requested model. Update the app or switch to \"API key · advanced\".";
        }
        if (Find(["not logged in", "not authenticated", "login required", "please log in", "invalid api key", "authentication_error", "unauthorized"], raw) is not null)
        {
            return "Sign in to your " + account + " account first, then check connection in Settings.";
        }
        if (flagged.FirstOrDefault() is { } first)
        {
            return account + " account request failed. " + Truncate(first, 400);
        }
        var tail = (stderr.Length == 0 ? stdout : stderr).Trim();
        if (tail.Length > 400) tail = tail[^400..];
        return "Account request failed or timed out. Check your login and plan limits." +
               (tail.Length == 0 ? "" : " " + tail);
    }

    private static string Truncate(string text, int limit) => text.Length <= limit ? text : text[..limit];

    // `opencode run --format json` prints one JSON event per line; collect the
    // assistant text parts, or surface the first error event.
    private static (bool Ok, string Text) ParseOpenCodeEvents(string stdout)
    {
        var pieces = new StringBuilder();
        foreach (var line in stdout.Split(['\n', '\r'], StringSplitOptions.RemoveEmptyEntries))
        {
            JsonObject? evt;
            try { evt = JsonNode.Parse(line) as JsonObject; }
            catch (JsonException) { continue; }
            var type = evt?["type"]?.GetValue<string>();
            if (type == "error")
            {
                var error = evt?["error"] as JsonObject;
                var message = (error?["data"] as JsonObject)?["message"]?.GetValue<string>()
                              ?? error?["name"]?.GetValue<string>()
                              ?? "Unknown error.";
                return (false, message);
            }
            if (type == "text" && (evt?["part"] as JsonObject)?["text"]?.GetValue<string>() is { } text)
            {
                pieces.Append(text);
            }
        }
        return (true, pieces.ToString());
    }

    internal static async Task HandleAsync(JsonObject body, Responder respond)
    {
        var provider = body["provider"]?.GetValue<string>();
        var operation = body["operation"]?.GetValue<string>();
        if (provider is null || operation is null || !Providers.Contains(provider) || !Operations.Contains(operation))
        {
            respond(false, null, "Unsupported account operation");
            return;
        }
        var prompt = body["prompt"]?.GetValue<string>() ?? string.Empty;
        if (operation == "generate" && (prompt.Length == 0 || prompt.Length > 250000))
        {
            respond(false, null, "Invalid prompt length");
            return;
        }

        // Generating without a signed-in account would silently fall back to
        // whatever credentials the CLI finds; check first and refuse instead.
        if (operation == "generate")
        {
            var status = await RunAsync(provider, "status", string.Empty);
            if (!status.Ok || (status.Value as JsonObject)?["connected"]?.GetValue<bool>() != true)
            {
                respond(false, null, "Connect your subscription account first. API credentials are not used in account mode.");
                return;
            }
        }

        var result = await RunAsync(provider, operation, prompt);
        respond(result.Ok, result.Value, result.Error);
    }

    private sealed record Outcome(bool Ok, JsonNode? Value, string? Error);

    private static async Task<Outcome> RunAsync(string provider, string operation, string prompt)
    {
        var executable = FindCli(provider);
        if (executable is null)
        {
            var cli = provider == "chatgpt" ? "Codex CLI" : provider == "opencode" ? "OpenCode CLI" : "Claude Code";
            return new Outcome(true, new JsonObject
            {
                ["installed"] = false,
                ["connected"] = false,
                ["message"] = "Install the official " + cli + " first.",
            }, null);
        }

        var directory = Path.Combine(Path.GetTempPath(), "MetaPrompt-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var answerPath = Path.Combine(directory, "answer");

        if (provider == "opencode" && operation == "login")
        {
            // `opencode auth login` is an interactive picker, so give it a console
            // of its own rather than capturing a prompt the user cannot answer.
            try
            {
                Process.Start(new ProcessStartInfo(executable, "auth login")
                {
                    UseShellExecute = true,
                    WorkingDirectory = directory,
                });
                return new Outcome(true, new JsonObject
                {
                    ["installed"] = true,
                    ["message"] = "Finish the provider sign-in in the console window, then check connection.",
                }, null);
            }
            catch (Exception error)
            {
                return new Outcome(false, null, error.Message);
            }
        }

        var arguments = BuildArguments(provider, operation, directory, answerPath);
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = directory,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        // Use the CLI's saved account, never inherited API keys or endpoint overrides.
        foreach (var name in new[]
                 {
                     "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
                     "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY",
                 })
        {
            start.Environment.Remove(name);
        }

        try
        {
            using var process = new Process { StartInfo = start };
            process.Start();
            if (operation == "generate")
            {
                await process.StandardInput.WriteAsync(prompt);
            }
            process.StandardInput.Close();

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            var timeout = TimeSpan.FromSeconds(operation == "status" ? 20 : 240);
            using var source = new CancellationTokenSource(timeout);
            try
            {
                await process.WaitForExitAsync(source.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            }

            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            var answer = File.Exists(answerPath) ? await File.ReadAllTextAsync(answerPath) : string.Empty;
            var exitCode = process.HasExited ? process.ExitCode : -1;

            if (operation == "status") return Status(provider, exitCode, stdout, stderr);
            if (exitCode != 0) return new Outcome(false, null, ErrorMessage(provider, stdout, stderr));
            if (operation == "login")
            {
                return new Outcome(true, new JsonObject
                {
                    ["installed"] = true,
                    ["message"] = "Sign-in completed. Check connection to confirm.",
                }, null);
            }
            return Generated(provider, stdout, answer);
        }
        catch (Exception error)
        {
            return new Outcome(false, null, error.Message);
        }
        finally
        {
            try { Directory.Delete(directory, recursive: true); } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static List<string> BuildArguments(string provider, string operation, string directory, string answerPath)
    {
        if (operation == "status")
        {
            return provider switch
            {
                "chatgpt" => ["login", "status"],
                "opencode" => ["auth", "list"],
                _ => ["auth", "status"],
            };
        }
        if (operation == "login")
        {
            return provider == "chatgpt" ? ["login"] : ["auth", "login", "--claudeai"];
        }
        if (provider == "opencode")
        {
            // Prompt arrives on stdin; the plan agent has edit/shell tools disabled and
            // the working directory is an empty temp folder, so nothing can be touched.
            return ["run", "--pure", "--format", "json", "--agent", "plan", "--dir", directory];
        }
        if (provider == "chatgpt")
        {
            return
            [
                "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral",
                "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "apps",
                "--disable", "skill_search", "-c", "web_search=\"disabled\"",
                "-c", "model_provider=\"openai\"", "--output-last-message", answerPath, "-",
            ];
        }
        // Pin the model explicitly: without --model, Claude Code falls back to the
        // user's global settings, which may name a model that only works through a
        // proxy (e.g. an OpenRouter slug) and is rejected here.
        return
        [
            "--print", "--output-format", "json", "--model", "sonnet", "--tools", "", "--safe-mode",
            "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}",
            "--no-session-persistence", "--permission-mode", "dontAsk",
        ];
    }

    private static Outcome Status(string provider, int exitCode, string stdout, string stderr)
    {
        var combined = stdout + stderr;
        if (provider == "opencode")
        {
            // OpenCode works without credentials via its free models, so a
            // successful `auth list` counts as connected.
            var connected = exitCode == 0;
            var match = System.Text.RegularExpressions.Regex.Match(combined, @"([0-9]+) credentials?");
            var count = match.Success ? match.Groups[1].Value : "0";
            var message = !connected ? "Sign in with your OpenCode providers"
                : count == "0" ? "Connected · no provider signed in, OpenCode free models are used"
                : "Connected · " + count + " provider credential" + (count == "1" ? "" : "s") + " · default OpenCode model";
            return new Outcome(true, new JsonObject
            {
                ["installed"] = true,
                ["connected"] = connected,
                ["message"] = message,
            }, null);
        }

        bool loggedIn;
        if (provider == "chatgpt")
        {
            loggedIn = exitCode == 0 && combined.Contains("ChatGPT", StringComparison.Ordinal);
        }
        else
        {
            loggedIn = false;
            try
            {
                if (JsonNode.Parse(stdout) is JsonObject json)
                {
                    loggedIn = json["loggedIn"]?.GetValue<bool>() == true
                               && json["authMethod"]?.GetValue<string>() == "claude.ai";
                }
            }
            catch (JsonException) { }
        }
        return new Outcome(true, new JsonObject
        {
            ["installed"] = true,
            ["connected"] = loggedIn,
            ["message"] = loggedIn ? "Connected · subscription account" : "Sign in with your subscription account",
        }, null);
    }

    private static Outcome Generated(string provider, string stdout, string answer)
    {
        var result = answer;
        if (provider == "opencode")
        {
            var (ok, text) = ParseOpenCodeEvents(stdout);
            if (!ok) return new Outcome(false, null, "OpenCode account request failed. " + text);
            result = text;
        }
        if (provider == "claude")
        {
            try
            {
                if (JsonNode.Parse(stdout) is JsonObject json)
                {
                    if (json["is_error"]?.GetValue<bool>() == true)
                    {
                        return new Outcome(false, null, json["result"]?.GetValue<string>() ?? "Claude request failed.");
                    }
                    result = json["result"]?.GetValue<string>() ?? string.Empty;
                }
            }
            catch (JsonException) { }
        }
        if (string.IsNullOrWhiteSpace(result)) return new Outcome(false, null, "The account returned no prompt.");
        return new Outcome(true, new JsonObject { ["result"] = result }, null);
    }
}
