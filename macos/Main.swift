import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKURLSchemeHandler, WKNavigationDelegate, WKUIDelegate {
    var windows: [NSWindow] = []
    var requests: [String: Task<Void, Never>] = [:]
    let stateURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MetaPrompt/state.json")
    var state: [String: Any] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let data = try? Data(contentsOf: stateURL), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { state = saved }
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About MetaPrompt", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit MetaPrompt", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem); let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        NSApp.mainMenu = menu
        openWindow(page: "popup.html", title: "MetaPrompt")
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func openSettings() { openWindow(page: "options.html", title: "MetaPrompt Settings") }
    func openWindow(page: String, title: String) {
        if let existing = windows.first(where: { $0.title == title }) { existing.makeKeyAndOrderFront(nil); return }
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(self, forURLScheme: "metaprompt")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 780, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = title; window.minSize = NSSize(width: 480, height: 560)
        window.isReleasedWhenClosed = false; window.contentView = web; window.center()
        windows.append(window)
        web.load(URLRequest(url: URL(string: "metaprompt://app/" + page)!))
        window.makeKeyAndOrderFront(nil)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { windows.first?.makeKeyAndOrderFront(nil) }; return true
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.scheme == "metaprompt" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        if let window = webView.window { alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) } } else { completionHandler(false) }
    }
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "app", !url.path.contains(".."),
              let root = Bundle.main.resourceURL?.appendingPathComponent("web"),
              let data = try? Data(contentsOf: root.appendingPathComponent(url.lastPathComponent)) else {
            urlSchemeTask.didFailWithError(NSError(domain: "MetaPrompt", code: 404)); return
        }
        let mime = ["html":"text/html", "js":"text/javascript", "css":"text/css", "png":"image/png"][url.pathExtension] ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "metaprompt", let body = message.body as? [String: Any], let action = body["action"] as? String else { replyHandler(nil, "Invalid request"); return }
        switch action {
        case "account":
            guard let provider = body["provider"] as? String, let operation = body["operation"] as? String else { replyHandler(nil, "Invalid account request"); return }
            let prompt = body["prompt"] as? String ?? ""
            if operation == "generate" && (prompt.isEmpty || prompt.count > 250000) { replyHandler(nil, "Invalid prompt length"); return }
            if operation == "generate" {
                runAccountCLI(provider: provider, operation: "status") { status, error in
                    guard error == nil, let info = status as? [String: Any], info["connected"] as? Bool == true else {
                        replyHandler(nil, "Connect your subscription account first. API credentials are not used in account mode."); return
                    }
                    self.runAccountCLI(provider: provider, operation: operation, prompt: prompt, completion: replyHandler)
                }
            } else {
                runAccountCLI(provider: provider, operation: operation, completion: replyHandler)
            }
        case "get": replyHandler(state, nil)
        case "set", "remove":
            var next = state
            if action == "set", let values = body["values"] as? [String: Any] { next.merge(values) { _, new in new } }
            if action == "remove", let keys = body["keys"] as? [String] { keys.forEach { next.removeValue(forKey: $0) } }
            guard JSONSerialization.isValidJSONObject(next) else { replyHandler(nil, "Invalid storage value"); return }
            do {
                try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                try JSONSerialization.data(withJSONObject: next).write(to: stateURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
                state = next; replyHandler(true, nil)
            } catch { replyHandler(nil, "Could not save settings: " + error.localizedDescription) }
        case "settings": openSettings(); replyHandler(true, nil)
        case "copy": NSPasteboard.general.clearContents(); NSPasteboard.general.setString(body["text"] as? String ?? "", forType: .string); replyHandler(true, nil)
        case "cancel": if let id = body["id"] as? String { requests[id]?.cancel() }; replyHandler(true, nil)
        case "fetch":
            guard let id = body["id"] as? String, let rawURL = body["url"] as? String, let url = URL(string: rawURL),
                  ["https://api.anthropic.com/v1/messages", "https://openrouter.ai/api/v1/chat/completions", "https://openrouter.ai/api/v1/models", "https://api.typesafe.ai/v1/systemone"].contains(rawURL) else { replyHandler(nil, "Unsupported API endpoint"); return }
            var request = URLRequest(url: url); request.httpMethod = body["method"] as? String ?? "GET"; request.timeoutInterval = 90
            request.allHTTPHeaderFields = body["headers"] as? [String: String]
            if let text = body["body"] as? String { request.httpBody = Data(text.utf8) }
            requests[id] = Task { @MainActor in
                var replied = false
                defer { self.requests.removeValue(forKey: id) }
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                    replyHandler(["status": http.statusCode], nil); replied = true
                    var buffer = Data()
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        buffer.append(byte)
                        if byte == 10 || buffer.count >= 4096 {
                            await self.emit(message.webView, id: id, data: buffer); buffer.removeAll(keepingCapacity: true)
                        }
                    }
                    if !buffer.isEmpty { await self.emit(message.webView, id: id, data: buffer) }
                    await self.emit(message.webView, id: id, done: true)
                } catch {
                    if !replied { replyHandler(nil, error.localizedDescription) }
                    else { await self.emit(message.webView, id: id, error: error.localizedDescription) }
                }
            }
        default: replyHandler(nil, "Unknown action")
        }
    }
    @MainActor func emit(_ web: WKWebView?, id: String, data: Data? = nil, done: Bool = false, error: String? = nil) async {
        var payload: [String: Any] = ["id": id, "done": done]
        if let data { payload["data"] = data.base64EncodedString() }
        if let error { payload["error"] = error }
        guard let encoded = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: encoded, encoding: .utf8) else { return }
        _ = try? await web?.evaluateJavaScript("window.desktopReceive(" + json + ")")
    }
}
@main
struct MetaPromptApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { application.run() }
    }
}
