// Compatibility bridge: reuse the extension's prompt engine in a native window.
//
// The macOS twin (macos/desktop.js) builds the same `chrome` shim; only the
// transport differs, and the two are deliberately kept as separate files rather
// than a shared one so neither host's quirks leak into the other. Both are
// exercised by the same battery of offline checks (windows/verify_desktop.mjs,
// macos/verify_desktop.mjs) — keep them in step when either changes.
//
// WKWebView hands JS a reply promise per message; WebView2 has no such thing,
// so requests carry an id and the host answers with a matching __mpReply frame.
(() => {
  // WebView2 lives at window.chrome.webview and this file replaces window.chrome
  // wholesale a few lines down — grab the transport before it disappears.
  const webview = window.chrome.webview;
  const pending = new Map();

  webview.addEventListener('message', (incoming) => {
    const message = incoming.data;
    if (!message || typeof message !== 'object') return;
    if (message.__mpStream) { window.desktopReceive(message); return; }
    const entry = pending.get(message.__mpReply);
    if (!entry) return;
    pending.delete(message.__mpReply);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new Error(message.error || 'Native request failed.'));
  });

  const native = (action, values = {}) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    try {
      webview.postMessage({ __mpRequest: id, action, ...values });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });

  const event = () => {
    const listeners = [];
    return { addListener(fn) { listeners.push(fn); }, emit(...args) { listeners.forEach(fn => fn(...args)); } };
  };
  // Shared with accounts.js, which runs on both hosts and must not care
  // which transport is underneath.
  window.desktopNative = native;
  const onConnect = event(), onMessage = event();
  window.chrome = {
    storage: { local: {
      get(keys, callback) {
        const promise = native('get').then(stored => {
          const all = JSON.parse(JSON.stringify(stored), (_key, value) =>
            value && typeof value === 'object' && Object.keys(value).length === 1 && ['Infinity', '-Infinity', 'NaN'].includes(value.__mpNumber)
              ? Number(value.__mpNumber) : value);
          if (keys == null) return all;
          if (typeof keys === 'string') keys = [keys];
          if (!Array.isArray(keys)) return { ...keys, ...Object.fromEntries(Object.keys(keys).filter(k => k in all).map(k => [k, all[k]])) };
          return Object.fromEntries(keys.filter(k => k in all).map(k => [k, all[k]]));
        });
        if (callback) promise.then(callback);
        return promise;
      },
      set(values) {
        const encoded = JSON.parse(JSON.stringify(values, (_key, value) =>
          typeof value === 'number' && !Number.isFinite(value) ? {__mpNumber:String(value)} : value));
        return native('set', { values: encoded });
      },
      remove(keys) { return native('remove', { keys: Array.isArray(keys) ? keys : [keys] }); }
    }},
    runtime: {
      onConnect, onMessage, onInstalled: event(),
      openOptionsPage() { return native('settings'); },
      sendMessage(message) { return new Promise(resolve => onMessage.emit(message, {}, resolve)); },
      connect({ name }) {
        const toUI = event(), toWorker = event(), disconnected = event();
        let closed = false;
        const disconnect = () => { if (!closed) { closed = true; disconnected.emit(); } };
        onConnect.emit({ name, onMessage: toWorker, onDisconnect: disconnected, postMessage(msg) { if (!closed) queueMicrotask(() => toUI.emit(msg)); } });
        return { onMessage: toUI, onDisconnect: disconnected, disconnect, postMessage(msg) { if (!closed) queueMicrotask(() => toWorker.emit(msg)); } };
      }
    },
    contextMenus: { onClicked: event(), removeAll(fn) { fn(); }, create() {} },
    commands: { onCommand: event() },
    action: { setBadgeBackgroundColor() {}, setBadgeText() {} },
    tabs: { async query() { return []; } }
  };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText(text) { return native('copy', { text }); } } });

  const streams = new Map();
  window.desktopReceive = ({ id, data, done, error }) => {
    const entry = streams.get(id);
    if (!entry) return;
    if (error) { entry.controller.error(new Error(error)); entry.clean(); }
    else if (done) { entry.controller.close(); entry.clean(); }
    else if (data) entry.controller.enqueue(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
  };
  window.fetch = async (url, options = {}) => {
    const id = crypto.randomUUID();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const abort = () => {
      native('cancel', { id });
      const entry = streams.get(id);
      if (entry) { entry.controller.error(new DOMException('Aborted', 'AbortError')); entry.clean(); }
    };
    const clean = () => { streams.delete(id); options.signal?.removeEventListener('abort', abort); };
    const stream = new ReadableStream({
      start(controller) { streams.set(id, { controller, clean }); },
      cancel() { native('cancel', { id }); clean(); }
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await native('fetch', { id, url: String(url), method: options.method || 'GET', headers: options.headers || {}, body: options.body || null });
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response(stream, { status: response.status });
    } catch (error) { clean(); throw error; }
  };
})();
