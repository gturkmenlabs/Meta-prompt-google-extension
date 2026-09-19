// Offline checks for the Windows bridge. Same battery as macos/verify_desktop.mjs
// — the two hosts must behave identically from the page's point of view — plus
// the request/reply correlation that WebView2 needs and WKWebView does not.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const state = {};
let copied = '';
let fetchID;
const listeners = [];

// Stand-in for window.chrome.webview: collects posted requests and answers them
// with the __mpReply frames the real host sends.
const webview = {
  addEventListener(_type, fn) { listeners.push(fn); },
  postMessage(message) {
    const { __mpRequest: id, action } = message;
    const reply = (ok, value, error) =>
      queueMicrotask(() => listeners.forEach(fn => fn({ data: { __mpReply: id, ok, value, error } })));
    switch (action) {
      case 'get': return reply(true, structuredClone(state));
      case 'set': Object.assign(state, message.values); return reply(true, true);
      case 'remove': message.keys.forEach(k => delete state[k]); return reply(true, true);
      case 'copy': copied = message.text; return reply(true, true);
      case 'settings': return reply(true, true);
      case 'fetch': fetchID = message.id; return reply(true, { status: 200 });
      case 'cancel': return reply(true, true);
      case 'account': return reply(true, { connected: true, message: 'Connected' });
      default: return reply(false, null, 'Unknown action');
    }
  },
};

const context = {
  console, crypto: webcrypto, queueMicrotask, ReadableStream, Response,
  DOMException, Uint8Array, atob, navigator: {},
  chrome: { webview },
};
context.window = context;
vm.runInNewContext(readFileSync(new URL('./desktop.js', import.meta.url), 'utf8'), context);

// The shim replaces window.chrome wholesale; the transport must survive that.
assert.equal(typeof context.desktopNative, 'function', 'accounts.js entry point is exposed');
assert.equal(context.chrome.webview, undefined, 'window.chrome is the extension shim, not WebView2');

await context.chrome.storage.local.set({ language: 'tr', length: 'orta' });
assert.equal((await context.chrome.storage.local.get('language')).language, 'tr');
await new Promise(resolve => context.chrome.storage.local.get(['length'], value => { assert.equal(value.length, 'orta'); resolve(); }));
await context.chrome.storage.local.set({brain: {lastSpike: -Infinity, positive: Infinity, missing: NaN}});
const brain = (await context.chrome.storage.local.get('brain')).brain;
assert.equal(brain.lastSpike, -Infinity);
assert.equal(brain.positive, Infinity);
assert.ok(Number.isNaN(brain.missing));
await context.chrome.storage.local.remove('length');
assert.equal((await context.chrome.storage.local.get('length')).length, undefined);

// Replies are matched by id, so overlapping requests cannot cross answers.
const [first, second] = await Promise.all([
  context.desktopNative('account', { provider: 'claude', operation: 'status' }),
  context.chrome.storage.local.get('language'),
]);
assert.equal(first.connected, true);
assert.equal(second.language, 'tr');
await assert.rejects(context.desktopNative('nonsense'), /Unknown action/, 'Host errors reject the promise');

context.chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(message => port.postMessage({type:'delta', text:message.text}));
});
const port = context.chrome.runtime.connect({name:'revise'});
await new Promise(resolve => {
  port.onMessage.addListener(message => { assert.equal(message.text, 'test'); resolve(); });
  port.postMessage({text:'test'});
});

await context.navigator.clipboard.writeText('Türkçe 🌍');
assert.equal(copied, 'Türkçe 🌍');

const emit = (frame) => listeners.forEach(fn => fn({ data: { __mpStream: true, ...frame } }));
const response = await context.fetch('https://api.typesafe.ai/v1/systemone', {method:'POST'});
emit({id:fetchID, data:Buffer.from('Türkçe 🌍').toString('base64')});
emit({id:fetchID, done:true});
assert.equal(await response.text(), 'Türkçe 🌍');

const controller = new AbortController();
const interrupted = await context.fetch('https://openrouter.ai/api/v1/models', {signal:controller.signal});
controller.abort();
await assert.rejects(interrupted.text(), {name:'AbortError'});

// windows/build.py copies an explicit file list, so a module imported by the
// shared engine but missing from that list only fails once the app is launched.
{
  const root = new URL('../', import.meta.url);
  const buildList = new Set(
    (readFileSync(new URL('build.py', import.meta.url), 'utf8')
      .match(/SHARED = \[([\s\S]*?)\]/)[1]
      .match(/"([^"]+\.js)"/g) || []).map((m) => m.slice(1, -1))
  );
  for (const file of buildList) {
    const source = readFileSync(new URL(file, root), 'utf8');
    for (const [, spec] of source.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)) {
      if (!buildList.has(spec)) {
        throw new Error(`${file} imports ./${spec}, which windows/build.py does not copy.`);
      }
    }
  }
  // The two desktop builds ship the same engine; a file added to one and
  // forgotten in the other is the failure this catches.
  const macList = new Set(
    (readFileSync(new URL('../macos/build.py', import.meta.url), 'utf8')
      .match(/for name in \[([\s\S]*?)\]:/)[1]
      .match(/"([^"]+)"/g) || []).map((m) => m.slice(1, -1))
  );
  const winAll = new Set(
    (readFileSync(new URL('build.py', import.meta.url), 'utf8')
      .match(/SHARED = \[([\s\S]*?)\]/)[1]
      .match(/"([^"]+)"/g) || []).map((m) => m.slice(1, -1))
  );
  for (const name of macList) {
    if (!winAll.has(name)) throw new Error(`macos/build.py copies ${name}, windows/build.py does not.`);
  }
  for (const name of winAll) {
    if (!macList.has(name)) throw new Error(`windows/build.py copies ${name}, macos/build.py does not.`);
  }
}

// The native hosts proxy only the engine's own endpoints; a URL allowed on one
// platform and not the other is a bug that only shows up at runtime.
{
  const swift = readFileSync(new URL('../macos/Main.swift', import.meta.url), 'utf8');
  const csharp = readFileSync(new URL('./Program.cs', import.meta.url), 'utf8');
  const allowed = [...csharp.matchAll(/"(https:\/\/[^"]+)",/g)].map((m) => m[1]);
  assert.ok(allowed.length >= 4, 'The C# host has an endpoint allowlist');
  for (const url of allowed) {
    assert.ok(swift.includes(`"${url}"`), `${url} is allowed on Windows but not on macOS`);
  }
}

console.log('Windows bridge checks passed: reply correlation, storage, callbacks, ports, Unicode clipboard, streamed bytes, cancellation, build file lists and endpoint allowlists.');
