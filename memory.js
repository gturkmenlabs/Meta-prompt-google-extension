// Mnemonist memory: an opt-in, local long-term memory of past revisions.
// Ported from mnemonist_memory.py (after A. R. Luria, "The Mind of a Mnemonist").
// Layers kept from the original:
//   1. Synesthetic signature — a colour/texture/taste/pitch/temperature label
//      derived from a hash of the text. It is a stable fingerprint for display
//      and debugging only: it carries no meaning, so it never affects ranking.
//   2. Eidetic shorthand — a short symbolic key (first word, longest word, last word).
//   3. Loci route — memories are placed in order along a walk of named places,
//      so they can be read forward or backward.
//   4. Active forgetting — memories are tombstoned on request and later swept.
// Recall ranks by folded-token overlap with the new request. The pure functions
// take and return plain state objects (no mutation); the storage helpers at the
// bottom read and write that state through chrome.storage.local (the web shim).
import { hashString, normalizeForSemanticCache } from "./efficiency.js";
import { sanitizeForHistory } from "./redact.js";

export const MEMORY_KEY = "mnemonistMemoryV1";
export const MEMORY_ENABLED_KEY = "memoryEnabled";
export const MEMORY_MAX_NODES = 100;
export const MEMORY_RECALL_TOP_K = 3;
// Share of the request's content words that must reappear in a memory.
export const MEMORY_MIN_SCORE = 0.34;
export const MEMORY_RAW_CHARS = 1200;
export const MEMORY_PROMPT_CHARS = 600;

export const DEFAULT_ROUTE = Object.freeze([
  "Mayakovsky Meydanı",
  "Gorky Caddesi 12 Numara Vitrini",
  "Puşkin Meydanı Köşesi",
  "Sukharev Şehir Kapısı",
  "Tiyatro Parkı Havuz Kenarı",
  "Moskova Tarih Müzesi Girişi",
  "Aleksandrovsky Bahçesi Fıskiyeleri",
  "Eski Çocukluk Evi Bahçesi (Torzhok)"
]);

const TEXTURES = ["pürüzsüz", "pürüzlü", "kadifemsi", "dikenli", "yağlı", "cam gibi", "sert"];
const TASTES = ["tatlı", "tuzlu", "ekşi", "acı", "metalik", "turşu tadında", "nötr"];
const PITCHES = ["pes (bas)", "tiz", "yankılı", "patlamalı", "ritmik", "fısıltılı"];
const COLORS = ["#FF5733", "#33FF57", "#3357FF", "#F39C12", "#8E44AD", "#1ABC9C", "#2C3E50", "#E74C3C"];

// ——— Layer 1: synesthetic label (hash-derived, display only) ———
export function encodeSynesthesia(text) {
  const hex = hashString(String(text || ""));
  const h = parseInt(hex, 16);
  return {
    color: COLORS[h % COLORS.length],
    texture: TEXTURES[(h >>> 4) % TEXTURES.length],
    taste: TASTES[(h >>> 8) % TASTES.length],
    pitch: PITCHES[(h >>> 12) % PITCHES.length],
    temperature: Math.round((15 + ((h >>> 16) % 300) / 10) * 10) / 10,
    hash: hex
  };
}

// ——— Layer 2: eidetic shorthand ———
export function compressShorthand(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 3) return `İmge:[${words.join(" ")}]`;
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  return `Simgesel-İmge:[${words[0].toUpperCase()} -> ${longest} (${words[words.length - 1]})]`;
}

// ——— Layer 3: loci route ———
export function locationName(step, route = DEFAULT_ROUTE) {
  const base = route[step % route.length];
  const lap = Math.floor(step / route.length);
  return lap > 0 ? `${base} (Tur ${lap + 1})` : base;
}

// Content words: folded to ASCII, punctuation stripped, words under 3 letters dropped.
function contentTokens(text) {
  return new Set(
    normalizeForSemanticCache(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

const sameRequest = (a, b) => normalizeForSemanticCache(a) === normalizeForSemanticCache(b);

export function createMemory() {
  return { v: 1, step: 0, nodes: [] };
}

// Accepts whatever storage returned; anything malformed becomes an empty memory.
export function normalizeMemory(value) {
  if (!value || value.v !== 1 || !Array.isArray(value.nodes)) return createMemory();
  const nodes = value.nodes.filter((n) => n && typeof n.id === "string" && typeof n.raw === "string" && typeof n.prompt === "string");
  const step = Number.isInteger(value.step) && value.step >= 0 ? value.step : nodes.length;
  return { v: 1, step, nodes };
}

// ——— Layer 4: active forgetting ———
// Tombstones every active memory whose id, loci location or request text matches.
export function activeForget(state, idLocationOrText) {
  const key = String(idLocationOrText || "");
  let forgotten = 0;
  const nodes = state.nodes.map((n) => {
    if (!n.active) return n;
    if (n.id === key || n.location === key || sameRequest(n.raw, key)) {
      forgotten++;
      return { ...n, active: false };
    }
    return n;
  });
  return { state: { ...state, nodes }, forgotten };
}

export function clearDeactivated(state) {
  const nodes = state.nodes.filter((n) => n.active);
  return { state: { ...state, nodes }, removed: state.nodes.length - nodes.length };
}

// Stores one revision at the next loci step. A repeated request supersedes the
// older memory, and the store stays within MEMORY_MAX_NODES (oldest dropped).
export function addMemory(state, { raw, prompt, meta = {}, at = Date.now() }) {
  const cleanRaw = sanitizeForHistory(String(raw || "")).slice(0, MEMORY_RAW_CHARS);
  const cleanPrompt = sanitizeForHistory(String(prompt || "")).slice(0, MEMORY_PROMPT_CHARS);
  if (!cleanRaw.trim() || !cleanPrompt.trim()) return { state, node: null };

  const superseded = activeForget(state, cleanRaw).state;
  const swept = clearDeactivated(superseded).state;
  const step = swept.step;
  const synesthesia = encodeSynesthesia(cleanRaw);
  const node = {
    id: `mem_${String(step).padStart(4, "0")}_${synesthesia.hash}`,
    step,
    location: locationName(step),
    raw: cleanRaw,
    prompt: cleanPrompt,
    shorthand: compressShorthand(cleanRaw),
    synesthesia,
    meta: { ...meta },
    at,
    active: true
  };
  const nodes = [...swept.nodes, node].slice(-MEMORY_MAX_NODES);
  return { state: { ...swept, step: step + 1, nodes }, node };
}

export function recallSequence(state, { reverse = false, activeOnly = true } = {}) {
  const nodes = state.nodes.filter((n) => !activeOnly || n.active);
  return reverse ? [...nodes].reverse() : nodes;
}

// Ranks active memories by the share of the query's content words they contain.
// The identical request is skipped: re-feeding its own earlier prompt would only
// anchor a redo to the answer the user asked to replace.
export function recallByQuery(state, query, { topK = MEMORY_RECALL_TOP_K, minScore = MEMORY_MIN_SCORE } = {}) {
  const queryTokens = contentTokens(query);
  if (queryTokens.size === 0) return [];
  const results = [];
  for (const node of state.nodes) {
    if (!node.active || sameRequest(node.raw, query)) continue;
    const nodeTokens = contentTokens(node.raw);
    let overlap = 0;
    for (const t of queryTokens) if (nodeTokens.has(t)) overlap++;
    const score = overlap / queryTokens.size;
    if (score >= minScore) results.push({ node, score });
  }
  // Ties go to the more recent memory (later on the route).
  results.sort((a, b) => b.score - a.score || b.node.step - a.node.step);
  return results.slice(0, topK);
}

export function exportMemoryMap(state) {
  return {
    total: state.nodes.length,
    active: state.nodes.filter((n) => n.active).length,
    nodes: state.nodes.map((n) => ({ ...n }))
  };
}

// Text handed to buildUserMessage({ memoryContext }); it escapes it there.
export function formatMemoryContext(recalled) {
  return recalled.map(({ node }, i) =>
    `[${i + 1}] ${node.location} · ${node.shorthand}\nEarlier request: ${node.raw}\nPrompt written then (excerpt): ${node.prompt}`
  ).join("\n\n");
}

// ——— Storage (chrome.storage.local via the web shim) ———
export async function loadMemory() {
  const data = await chrome.storage.local.get(MEMORY_KEY);
  return normalizeMemory(data[MEMORY_KEY]);
}

export async function saveMemory(state) {
  await chrome.storage.local.set({ [MEMORY_KEY]: state });
}

export async function isMemoryEnabled() {
  const data = await chrome.storage.local.get(MEMORY_ENABLED_KEY);
  return data[MEMORY_ENABLED_KEY] === true;
}

// Recall for a new revision. Empty when memory is off or anything fails, so a
// broken memory can never block a revision.
export async function recallForRevision(rawText) {
  try {
    if (!(await isMemoryEnabled())) return [];
    return recallByQuery(await loadMemory(), rawText);
  } catch (error) {
    console.warn("Memory recall skipped:", error);
    return [];
  }
}

export async function rememberRevision({ raw, prompt, meta }) {
  try {
    if (!(await isMemoryEnabled())) return null;
    const { state, node } = addMemory(await loadMemory(), { raw, prompt, meta });
    if (node) await saveMemory(state);
    return node;
  } catch (error) {
    console.warn("Memory store skipped:", error);
    return null;
  }
}

// Forgets and sweeps in one step: a deleted history entry should leave no trace.
export async function forgetMemory(idLocationOrText) {
  const { state, forgotten } = activeForget(await loadMemory(), idLocationOrText);
  if (forgotten) await saveMemory(clearDeactivated(state).state);
  return forgotten;
}

export async function clearMemory() {
  await chrome.storage.local.remove(MEMORY_KEY);
}

export async function getMemoryStats() {
  const state = await loadMemory();
  return { active: state.nodes.filter((n) => n.active).length, maxNodes: MEMORY_MAX_NODES };
}
