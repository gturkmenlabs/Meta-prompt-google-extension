// Offline checks for the web app: the chrome.* bridge (web/shim.js), the static
// server's path guard (web/server.mjs) and the page/script DOM contract.
// No network, browser or API key needed: `npm run test:web`.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRequest, ROOT } from "./web/server.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
};

// ——— Shim, run against an in-memory localStorage ———
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      if (String(v).length > 200_000) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      data.set(k, String(v));
    },
    removeItem(k) { data.delete(k); },
    _data: data
  };
}

function loadShim(storage, location = { href: "http://127.0.0.1:5173/index.html" }) {
  const context = { console, queueMicrotask, localStorage: storage, location, URL, Promise };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(join(here, "web", "shim.js"), "utf8"), context);
  return context;
}

const storage = memoryStorage({ "unrelated-app-key": "keep me" });
const ctx = loadShim(storage);
const local = ctx.chrome.storage.local;

await check("set + get by string key", async () => {
  await local.set({ language: "tr", length: "orta" });
  assert.equal((await local.get("language")).language, "tr");
});

await check("get with array, callback form", async () => {
  await new Promise((done) => local.get(["length", "missing"], (v) => {
    assert.deepEqual({ ...v }, { length: "orta" });
    done();
  }));
});

await check("get with object defaults", async () => {
  const v = await local.get({ language: "auto", mode: "standard" });
  assert.equal(v.language, "tr");
  assert.equal(v.mode, "standard");
});

await check("get(null) returns only this app's keys", async () => {
  const all = await local.get(null);
  assert.ok(!("unrelated-app-key" in all));
  assert.equal(all.length, "orta");
});

await check("non-finite numbers survive a round-trip (SNN state)", async () => {
  await local.set({ brain: { lastSpike: -Infinity, positive: Infinity, missing: NaN, n: 1.5 } });
  const { brain } = await local.get("brain");
  assert.equal(brain.lastSpike, -Infinity);
  assert.equal(brain.positive, Infinity);
  assert.ok(Number.isNaN(brain.missing));
  assert.equal(brain.n, 1.5);
});

await check("values persist across a page reload", async () => {
  const again = loadShim(storage);
  assert.equal((await again.chrome.storage.local.get("language")).language, "tr");
});

await check("remove deletes one or many keys", async () => {
  await local.set({ a: 1, b: 2, c: 3 });
  await local.remove("a");
  await local.remove(["b", "c"]);
  assert.deepEqual({ ...(await local.get(["a", "b", "c"])) }, {});
});

await check("quota errors reject with a readable message", async () => {
  await assert.rejects(local.set({ huge: "x".repeat(300_000) }), /storage is full/);
});

await check("runtime port streams messages both ways", async () => {
  ctx.chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "revise") return;
    port.onMessage.addListener((msg) => {
      port.postMessage({ type: "delta", text: msg.text.toUpperCase() });
      port.postMessage({ type: "done" });
    });
  });
  const port = ctx.chrome.runtime.connect({ name: "revise" });
  const got = [];
  await new Promise((done) => {
    port.onMessage.addListener((m) => { got.push(m.type); if (m.type === "done") done(); });
    port.postMessage({ text: "hi" });
  });
  assert.deepEqual(got, ["delta", "done"]);
});

await check("disconnect stops further messages", async () => {
  let received = 0;
  ctx.chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "quiet") port.onMessage.addListener(() => { received++; });
  });
  const port = ctx.chrome.runtime.connect({ name: "quiet" });
  port.disconnect();
  port.postMessage({});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(received, 0);
});

await check("sendMessage resolves async sendResponse", async () => {
  ctx.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "PING") return;
    setTimeout(() => sendResponse({ ok: true }), 1);
    return true;
  });
  assert.deepEqual({ ...(await ctx.chrome.runtime.sendMessage({ type: "PING" })) }, { ok: true });
});

await check("sendMessage with no async listener resolves undefined", async () => {
  assert.equal(await ctx.chrome.runtime.sendMessage({ type: "NOBODY" }), undefined);
});

await check("openOptionsPage navigates to the settings page", async () => {
  const location = { href: "http://127.0.0.1:5173/index.html" };
  const c = loadShim(memoryStorage(), location);
  await c.chrome.runtime.openOptionsPage();
  assert.equal(location.href, "settings.html");
});

// ——— Static server path guard ———
await check("server serves the app pages and engine modules", async () => {
  assert.ok(resolveRequest(ROOT, "/").file.endsWith("index.html"));
  assert.ok(resolveRequest(ROOT, "/settings.html?x=1").type.startsWith("text/html"));
  assert.ok(resolveRequest(ROOT, "/engine.js").type.startsWith("text/javascript"));
  assert.ok(resolveRequest(ROOT, "/web/shim.js"));
  assert.ok(resolveRequest(ROOT, "/icons/icon.svg"));
});

await check("server refuses traversal, dotfiles and private files", async () => {
  for (const p of [
    "/../secret.js", "/%2e%2e/secret.js", "/web/../../x.js", "/.env", "/.env.local", "/web/.hidden.js",
    "/package.json", "/README.md", "/CLAUDE.md", "/macos/desktop.js", "/web/server.mjs",
    "/manifest.json", "/a\\b.js", "/%00.js", "/%E0%A4%A.js", "/a/b/c.js"
  ]) {
    assert.equal(resolveRequest(ROOT, p), null, `should refuse ${p}`);
  }
});

// ——— Page contract: every id studio.js/settings.js looks up exists ———
// studio.js looks ids up through a `$("id")` alias for getElementById; count both forms.
const idsIn = (file) => [...readFileSync(join(here, file), "utf8").matchAll(/(?:getElementById|\$)\("([^"]+)"\)/g)].map((m) => m[1]);
const hasIds = (html, ids) => ids.filter((id) => !html.includes(`id="${id}"`));

await check("index.html carries every element studio.js uses", async () => {
  assert.deepEqual(hasIds(readFileSync(join(here, "index.html"), "utf8"), idsIn("studio.js")), []);
  // Guard against the scan going vacuous if the lookup idiom changes again.
  assert.ok(idsIn("studio.js").length >= 20, "found too few id lookups in studio.js");
});

await check("settings.html carries every element settings.js uses", async () => {
  assert.deepEqual(hasIds(readFileSync(join(here, "settings.html"), "utf8"), idsIn("settings.js")), []);
});

await check("pages load the shim before any module and pin the network allowlist", async () => {
  for (const page of ["index.html", "settings.html"]) {
    const html = readFileSync(join(here, page), "utf8");
    const shimAt = html.indexOf('src="web/shim.js"');
    const moduleAt = html.indexOf('type="module"');
    assert.ok(shimAt > 0 && shimAt < moduleAt, `${page}: shim must precede modules`);
    assert.match(html, /connect-src 'self' https:\/\/api\.anthropic\.com https:\/\/openrouter\.ai https:\/\/api\.typesafe\.ai;/);
  }
});

assert.equal(resolve(ROOT), resolve(here));
console.log(`Web app checks passed: ${passed} assertions.`);
