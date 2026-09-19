// Native Windows host for the shared prompt engine: a WebView2 window that
// serves the extension's own HTML/JS from disk and answers the bridge actions
// windows/desktop.js sends. The Swift host (macos/Main.swift) is the twin of
// this file; the action names and the streaming frames are the same contract.
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MetaPrompt;

internal static class Program
{
    // The web assets are mapped under a virtual host so the pages get a normal
    // https origin; nothing is served over a real socket.
    internal const string VirtualHost = "app.metaprompt";
    internal const string BaseUrl = "https://" + VirtualHost + "/";

    // The bridge is a proxy for the engine's own requests, not a general one.
    // Anything not on this list is refused, so a compromised page cannot use the
    // native network stack to reach elsewhere. Keep it in step with the Swift host.
    internal static readonly HashSet<string> AllowedEndpoints = new(StringComparer.Ordinal)
    {
        "https://api.anthropic.com/v1/messages",
        "https://openrouter.ai/api/v1/chat/completions",
        "https://openrouter.ai/api/v1/models",
        "https://api.typesafe.ai/v1/systemone",
    };

    internal static readonly string StateDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MetaPrompt");
    internal static readonly string StatePath = Path.Combine(StateDirectory, "state.json");

    internal static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new DesktopAppContext());
    }
}

// Owns the windows so "Settings" reuses an open one instead of stacking copies,
// and so closing the last window ends the process.
internal sealed class DesktopAppContext : ApplicationContext
{
    private readonly Dictionary<string, MainWindow> _windows = new(StringComparer.Ordinal);
    internal JsonObject State = new();

    internal DesktopAppContext()
    {
        LoadState();
        Open("popup.html", "MetaPrompt");
    }

    private void LoadState()
    {
        try
        {
            if (File.Exists(Program.StatePath))
            {
                State = JsonNode.Parse(File.ReadAllText(Program.StatePath)) as JsonObject ?? new JsonObject();
            }
        }
        catch (Exception)
        {
            // A corrupt state file must not stop the app from opening; the user
            // can re-enter settings, which is better than a launch failure.
            State = new JsonObject();
        }
    }

    internal void SaveState()
    {
        Directory.CreateDirectory(Program.StateDirectory);
        // Write beside the target and swap, so a crash mid-write cannot leave a
        // truncated settings file behind.
        var temporary = Program.StatePath + ".tmp";
        File.WriteAllText(temporary, State.ToJsonString(), new UTF8Encoding(false));
        File.Move(temporary, Program.StatePath, overwrite: true);
    }

    internal void Open(string page, string title)
    {
        if (_windows.TryGetValue(title, out var existing) && !existing.IsDisposed)
        {
            existing.Activate();
            return;
        }
        var window = new MainWindow(this, page, title);
        _windows[title] = window;
        window.FormClosed += (_, _) =>
        {
            _windows.Remove(title);
            if (_windows.Count == 0) ExitThread();
        };
        window.Show();
    }

    internal void OpenSettings() => Open("options.html", "MetaPrompt Settings");
}

internal sealed class MainWindow : Form
{
    private readonly DesktopAppContext _app;
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly string _page;
    // One entry per in-flight bridge fetch, so "cancel" can stop a stream.
    private readonly Dictionary<string, CancellationTokenSource> _requests = new(StringComparer.Ordinal);

    internal MainWindow(DesktopAppContext app, string page, string title)
    {
        _app = app;
        _page = page;
        Text = title;
        ClientSize = new Size(780, 850);
        MinimumSize = new Size(480, 560);
        StartPosition = FormStartPosition.CenterScreen;
        var icon = Path.Combine(AppContext.BaseDirectory, "app.ico");
        if (File.Exists(icon)) Icon = new Icon(icon);
        Controls.Add(_web);
        _ = InitialiseAsync();
    }

    private async Task InitialiseAsync()
    {
        // Keep the browser profile inside the app's own data folder rather than
        // the default next to the executable, which may be read-only.
        var environment = await CoreWebView2Environment.CreateAsync(
            userDataFolder: Path.Combine(Program.StateDirectory, "WebView2"));
        await _web.EnsureCoreWebView2Async(environment);
        var core = _web.CoreWebView2;

        core.SetVirtualHostNameToFolderMapping(
            Program.VirtualHost,
            Path.Combine(AppContext.BaseDirectory, "web"),
            CoreWebView2HostResourceAccessKind.Allow);

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        // The interface never opens another page; anything that tries is a bug or
        // an injection, so refuse it rather than navigating away from the app.
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(Program.BaseUrl, StringComparison.Ordinal)) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.WebMessageReceived += OnWebMessage;

        core.Navigate(Program.BaseUrl + _page);
    }

    private void Reply(string id, bool ok, JsonNode? value, string? error)
    {
        var frame = new JsonObject
        {
            ["__mpReply"] = id,
            ["ok"] = ok,
            ["value"] = value,
            ["error"] = error,
        };
        Post(frame);
    }

    private void Post(JsonObject frame)
    {
        if (IsDisposed || _web.CoreWebView2 is null) return;
        if (InvokeRequired) { BeginInvoke(() => Post(frame)); return; }
        try { _web.CoreWebView2.PostWebMessageAsJson(frame.ToJsonString()); }
        catch (ObjectDisposedException) { /* window closed mid-stream */ }
        catch (InvalidOperationException) { /* webview torn down mid-stream */ }
    }

    private void Emit(string id, string? data, bool done, string? error)
    {
        Post(new JsonObject
        {
            ["__mpStream"] = true,
            ["id"] = id,
            ["data"] = data,
            ["done"] = done,
            ["error"] = error,
        });
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonObject? body;
        try { body = JsonNode.Parse(e.WebMessageAsJson) as JsonObject; }
        catch (JsonException) { return; }
        if (body is null) return;

        var id = body["__mpRequest"]?.GetValue<string>();
        var action = body["action"]?.GetValue<string>();
        if (id is null || action is null) return;

        try
        {
            switch (action)
            {
                case "get":
                    Reply(id, true, _app.State.DeepClone(), null);
                    break;

                case "set":
                    if (body["values"] is JsonObject values)
                    {
                        foreach (var pair in values) _app.State[pair.Key] = pair.Value?.DeepClone();
                        _app.SaveState();
                    }
                    Reply(id, true, true, null);
                    break;

                case "remove":
                    if (body["keys"] is JsonArray keys)
                    {
                        foreach (var key in keys)
                        {
                            var name = key?.GetValue<string>();
                            if (name is not null) _app.State.Remove(name);
                        }
                        _app.SaveState();
                    }
                    Reply(id, true, true, null);
                    break;

                case "settings":
                    _app.OpenSettings();
                    Reply(id, true, true, null);
                    break;

                case "copy":
                    var text = body["text"]?.GetValue<string>() ?? string.Empty;
                    // Clipboard is STA-only; this handler already runs on the UI thread.
                    if (text.Length == 0) Clipboard.Clear(); else Clipboard.SetText(text);
                    Reply(id, true, true, null);
                    break;

                case "cancel":
                    var cancelId = body["id"]?.GetValue<string>();
                    if (cancelId is not null && _requests.TryGetValue(cancelId, out var source)) source.Cancel();
                    Reply(id, true, true, null);
                    break;

                case "account":
                    await Accounts.HandleAsync(body, (ok, value, error) => Reply(id, ok, value, error));
                    break;

                case "fetch":
                    await FetchAsync(id, body);
                    break;

                default:
                    Reply(id, false, null, "Unknown action");
                    break;
            }
        }
        catch (Exception error)
        {
            Reply(id, false, null, error.Message);
        }
    }

    private async Task FetchAsync(string replyId, JsonObject body)
    {
        var streamId = body["id"]?.GetValue<string>();
        var url = body["url"]?.GetValue<string>();
        if (streamId is null || url is null || !Program.AllowedEndpoints.Contains(url))
        {
            Reply(replyId, false, null, "Unsupported API endpoint");
            return;
        }

        using var request = new HttpRequestMessage(
            new HttpMethod(body["method"]?.GetValue<string>() ?? "GET"), url);
        if (body["body"]?.GetValue<string>() is { } payload)
        {
            request.Content = new StringContent(payload, Encoding.UTF8);
            request.Content.Headers.Remove("Content-Type");
        }
        if (body["headers"] is JsonObject headers)
        {
            foreach (var header in headers)
            {
                var value = header.Value?.GetValue<string>();
                if (value is null) continue;
                if (!request.Headers.TryAddWithoutValidation(header.Key, value))
                {
                    request.Content?.Headers.TryAddWithoutValidation(header.Key, value);
                }
            }
        }

        var source = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        _requests[streamId] = source;
        var replied = false;
        try
        {
            var response = await Program.Http.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, source.Token);
            Reply(replyId, true, new JsonObject { ["status"] = (int)response.StatusCode }, null);
            replied = true;

            await using var stream = await response.Content.ReadAsStreamAsync(source.Token);
            var buffer = new byte[4096];
            var pending = new List<byte>(4096);
            int read;
            while ((read = await stream.ReadAsync(buffer, source.Token)) > 0)
            {
                for (var i = 0; i < read; i++)
                {
                    pending.Add(buffer[i]);
                    // Flush on newline so SSE deltas reach the page as they arrive
                    // rather than at the end of the response.
                    if (buffer[i] == (byte)'\n' || pending.Count >= 4096)
                    {
                        Emit(streamId, Convert.ToBase64String(pending.ToArray()), false, null);
                        pending.Clear();
                    }
                }
            }
            if (pending.Count > 0) Emit(streamId, Convert.ToBase64String(pending.ToArray()), false, null);
            Emit(streamId, null, true, null);
        }
        catch (Exception error)
        {
            var message = error is OperationCanceledException ? "The request was cancelled." : error.Message;
            // Before the status frame the page is still awaiting the promise; after
            // it, the only way to report the failure is through the stream.
            if (!replied) Reply(replyId, false, null, message);
            else Emit(streamId, null, false, message);
        }
        finally
        {
            _requests.Remove(streamId);
            source.Dispose();
        }
    }
}
