import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { revise, reviseStreamWithFailover } from './api.js';
import { getFailoverConfig, getActiveConfig, MAX_BACKUP_MODELS } from './config.js';

let stored = { provider: 'invalid', anthropicKey: 'a', openrouterWorkingModels: {} };
globalThis.chrome = { storage: { local: { get: async () => stored } } };
assert.equal((await getActiveConfig()).provider, 'anthropic');
assert.equal((await getFailoverConfig()).models.length, 1);
stored = { provider: 'openrouter', openrouterKey: 'b', openrouterModel: 'test/model', openrouterWorkingModels: [null, {id:'test/model'}, {id:'other/model'}, {id:'other/model'}] };
assert.deepEqual((await getFailoverConfig()).models, ['test/model', 'other/model']);
// Backups never leave the active provider unless the user opted in.
const manyModels = Array.from({length: 12}, (_, i) => ({id: `vendor/model-${i}`}));
stored = { provider: 'anthropic', anthropicKey: 'a', openrouterKey: 'b', openrouterWorkingModels: manyModels };
assert.deepEqual((await getFailoverConfig()).models, ['claude-sonnet-4-6'], 'Cross-provider fallback is off by default');
stored = { ...stored, crossProviderFallback: true };
const optedIn = (await getFailoverConfig()).models;
assert.equal(optedIn[0], 'claude-sonnet-4-6');
assert.ok(optedIn.includes('vendor/model-0'), 'Opt-in adds cross-provider backups');
// The backup list is capped: an unbounded list means minutes of hanging and the
// source text reaching models the user never picked.
assert.equal(optedIn.length, MAX_BACKUP_MODELS + 1, 'Backup list is capped');
stored = { provider: 'openrouter', openrouterKey: 'b', openrouterModel: 'test/model', openrouterWorkingModels: manyModels };
assert.equal((await getFailoverConfig()).models.length, MAX_BACKUP_MODELS + 1, 'Same-provider list is capped too');
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('Unexpected request'); };
await assert.rejects(revise({provider:'anthropic', apiKey:'secret', model:'other/model'}), /API key not set/);
await assert.rejects(reviseStreamWithFailover({provider:'anthropic', apiKey:'secret', apiKeys:{anthropic:'secret'}, models:['other/model']}), /API key not set/);
assert.equal(calls, 0);
const delta = 'data: {"choices":[{"delta":{"content":"Merhaba 🌍"}}]}\r\n';
const serve = (body) => {
  calls++;
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  }}));
};
const params = {provider:'openrouter', apiKey:'b', models:['test/model','backup/model']};
globalThis.fetch = async () => serve(delta + 'data: [DONE]');
assert.equal((await reviseStreamWithFailover(params)).result, 'Merhaba 🌍');
calls = 0;
globalThis.fetch = async () => serve(delta);
await assert.rejects(reviseStreamWithFailover(params), /ended early/);
assert.equal(calls, 1, 'Never fail over after partial output');
globalThis.fetch = async () => serve(delta + 'data: {"error":{"message":"upstream failed"}}\n');
await assert.rejects(reviseStreamWithFailover(params), /upstream failed/);
calls = 0;
globalThis.fetch = async () => calls === 0 ? (calls++, new Response('busy', {status:503})) : serve(delta + 'data: [DONE]\n');
assert.equal((await reviseStreamWithFailover(params)).fellBack, true);

let listener;
class Field {
  constructor(value) { this.value = value; this.nodeType = 1; this.tagName = 'TEXTAREA'; }
  focus() {} select() {} dispatchEvent() {}
}
Object.defineProperty(Field.prototype, 'value', {get() { return this.text; }, set(v) { this.text = v; }});
const first = new Field('original');
const second = new Field('other');
const document = {activeElement:first, contains:()=>true, addEventListener(){}, execCommand:()=>false};
vm.runInNewContext(readFileSync(new URL('./content.js', import.meta.url), 'utf8'), {
  document, Event, HTMLTextAreaElement:Field, HTMLInputElement:Field,
  chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}
});
const send = (msg) => {let response; listener(msg, {}, (r)=>response=r); return response;};
send({type:'GET_EDITABLE_TEXT',captureTarget:true});
document.activeElement = second;
assert.equal(send({type:'STREAM_EDITABLE_TEXT',text:'partial'}).ok,true);
assert.equal(first.value,'partial');
assert.equal(second.value,'other');
send({type:'END_EDITABLE_STREAM'});
assert.equal(send({type:'RESTORE_EDITABLE_TEXT'}).ok,true);
assert.equal(first.value,'original');
send({type:'GET_EDITABLE_TEXT',captureTarget:true});
second.value='user edit';
assert.equal(send({type:'STREAM_EDITABLE_TEXT',text:'replacement'}).ok,false);
assert.equal(second.value,'user edit');
console.log('Runtime checks passed: configuration, key isolation, fragmented UTF-8 streams, premature EOF, upstream errors, failover, target locking, partial undo, user edits.');
