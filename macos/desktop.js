// Compatibility bridge: reuse the extension's prompt engine in a native window.
(() => {
  const native = (action, values = {}) => window.webkit.messageHandlers.native.postMessage({ action, ...values });
  const event = () => {
    const listeners = [];
    return { addListener(fn) { listeners.push(fn); }, emit(...args) { listeners.forEach(fn => fn(...args)); } };
  };
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
