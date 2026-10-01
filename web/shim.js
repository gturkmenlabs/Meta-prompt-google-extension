// Web bridge: runs the prompt engine (engine.js and friends) in an ordinary
// browser tab. It provides the small slice of the chrome.* API the engine
// uses — storage backed by localStorage, plus in-page runtime messages and
// ports. Load it as a classic script BEFORE any module script.
(() => {
  const PREFIX = "metaprompt:";
  const NON_FINITE = ["Infinity", "-Infinity", "NaN"];

  // JSON drops Infinity/NaN to null; the SNN state stores them, so tag them.
  const encode = (value) => JSON.stringify(value, (_key, v) =>
    typeof v === "number" && !Number.isFinite(v) ? { __mpNumber: String(v) } : v);
  const decode = (text) => JSON.parse(text, (_key, v) =>
    v && typeof v === "object" && Object.keys(v).length === 1 && NON_FINITE.includes(v.__mpNumber)
      ? Number(v.__mpNumber) : v);

  const event = () => {
    const listeners = [];
    return {
      addListener(fn) { listeners.push(fn); },
      removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      hasListeners() { return listeners.length > 0; },
      emit(...args) { return listeners.map((fn) => fn(...args)); }
    };
  };

  const readAll = (store) => {
    const all = {};
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try { all[key.slice(PREFIX.length)] = decode(store.getItem(key)); }
      catch (error) { console.warn(`MetaPrompt: unreadable stored value for "${key}"`, error); }
    }
    return all;
  };

  const pick = (all, keys) => {
    if (keys == null) return all;
    if (typeof keys === "string") keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));
    // Object form: keys are names, values are defaults.
    return { ...keys, ...Object.fromEntries(Object.keys(keys).filter((k) => k in all).map((k) => [k, all[k]])) };
  };

  const settle = (promise, callback) => {
    if (typeof callback === "function") promise.then(callback, (error) => console.error(error));
    return promise;
  };

  const createStorage = (store) => ({
    get(keys, callback) {
      return settle(Promise.resolve().then(() => pick(readAll(store), keys)), callback);
    },
    set(values, callback) {
      return settle(Promise.resolve().then(() => {
        for (const [key, value] of Object.entries(values || {})) {
          try { store.setItem(PREFIX + key, encode(value)); }
          catch (error) {
            throw new Error(`Browser storage is full; could not save "${key}". Clear the semantic cache in Settings.`);
          }
        }
      }), callback);
    },
    remove(keys, callback) {
      return settle(Promise.resolve().then(() => {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => store.removeItem(PREFIX + key));
      }), callback);
    },
    clear(callback) {
      return settle(Promise.resolve().then(() => {
        Object.keys(readAll(store)).forEach((key) => store.removeItem(PREFIX + key));
      }), callback);
    }
  });

  const onConnect = event();
  const onMessage = event();
  const settingsUrl = globalThis.METAPROMPT_SETTINGS_URL || "settings.html";

  const runtime = {
    id: "metaprompt-web",
    lastError: undefined,
    onConnect,
    onMessage,
    getURL(path) { return new URL(path, globalThis.location?.href || "http://localhost/").href; },
    openOptionsPage() {
      if (globalThis.location) globalThis.location.href = settingsUrl;
      return Promise.resolve();
    },
    // Listeners answer through sendResponse (and return true when async).
    sendMessage(message, callback) {
      const promise = new Promise((resolve) => {
        let answered = false;
        const sendResponse = (response) => { if (!answered) { answered = true; resolve(response); } };
        const results = onMessage.emit(message, { id: runtime.id }, sendResponse);
        if (!results.some((r) => r === true) && !answered) resolve(undefined);
      });
      return settle(promise, callback);
    },
    connect({ name } = {}) {
      const toUI = event(), toWorker = event(), disconnected = event();
      let closed = false;
      const disconnect = () => { if (!closed) { closed = true; disconnected.emit(); } };
      onConnect.emit({
        name,
        onMessage: toWorker,
        onDisconnect: disconnected,
        disconnect,
        postMessage(msg) { if (!closed) queueMicrotask(() => toUI.emit(msg)); }
      });
      return {
        name,
        onMessage: toUI,
        onDisconnect: disconnected,
        disconnect,
        postMessage(msg) { if (!closed) queueMicrotask(() => toWorker.emit(msg)); }
      };
    }
  };

  globalThis.chrome = {
    storage: { local: createStorage(globalThis.localStorage) },
    runtime
  };
  globalThis.metaPromptWeb = true;
})();
