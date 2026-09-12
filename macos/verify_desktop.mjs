import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const state = {};
let copied = '';
let receiver;
let fetchID;
const context = {
  console, crypto: webcrypto, queueMicrotask, ReadableStream, Response,
  DOMException, Uint8Array, atob, navigator: {},
  webkit: { messageHandlers: { native: { async postMessage(msg) {
    switch (msg.action) {
      case 'get': return structuredClone(state);
      case 'set': Object.assign(state, msg.values); return true;
      case 'remove': msg.keys.forEach(k => delete state[k]); return true;
      case 'copy': copied = msg.text; return true;
      case 'fetch': fetchID = msg.id; return {status: 200};
      case 'cancel': return true;
    }
  }}}}
};
context.window = context;
vm.runInNewContext(readFileSync(new URL('./desktop.js', import.meta.url), 'utf8'), context);
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
const response = await context.fetch('https://openrouter.ai/api/v1/models');
context.desktopReceive({id:fetchID, data:Buffer.from('Türkçe 🌍').toString('base64')});
context.desktopReceive({id:fetchID, done:true});
assert.equal(await response.text(), 'Türkçe 🌍');
const controller = new AbortController();
const interrupted = await context.fetch('https://openrouter.ai/api/v1/models', {signal:controller.signal});
controller.abort();
await assert.rejects(interrupted.text(), {name:'AbortError'});
console.log('Desktop bridge checks passed: persistent API contract, callbacks, ports, Unicode clipboard, streamed bytes and cancellation.');
