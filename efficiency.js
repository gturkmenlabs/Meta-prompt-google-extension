// Efficiency layer: outermost semantic cache, Psi-safe prompt compression,
// ConciseRL-style brevity reward, and block-level / pyramidal KV prefix caching.
//
// All helpers are pure and chrome-optional so the offline verify scripts can
// import this module in Node. Storage helpers fall back to an in-memory map
// when `chrome.storage.local` is unavailable.

import { foldDiacritics } from "./prompt.js";

// ---------------------------------------------------------------------------
// 1. Outermost semantic cache (repeated-query short-circuit)
// ---------------------------------------------------------------------------

export const SEMANTIC_CACHE_KEY = "semanticCacheV1";
export const SEMANTIC_CACHE_MAX_ENTRIES = 50;
export const SEMANTIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
export const SEMANTIC_CACHE_SIMILARITY_THRESHOLD = 0.92;

const memoryFallback = new Map();

function storageAvailable() {
  return typeof chrome !== "undefined" && chrome?.storage?.local;
}

export function normalizeForSemanticCache(text) {
  if (!text) return "";
  return foldDiacritics(String(text).toLowerCase())
    .replace(/\s+/g, " ")
    .trim();
}

// FNV-1a 32-bit hex digest (no dependency, stable across runtimes).
export function hashString(text) {
  let hash = 0x811c9dc5;
  const input = String(text || "");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function configFingerprint({ language = "auto", length = "orta", mode = "standard", vibeStrategy = "", researchStrategy = "", antihalluStrategy = "", taskTypeOverride = null, hda = true, claudeCommand = "" } = {}) {
  return [language, length, mode, vibeStrategy || "", researchStrategy || "", antihalluStrategy || "", taskTypeOverride || "", String(hda), claudeCommand || ""].join("|");
}

export function getSemanticCacheKey(rawText, config = {}) {
  return `${hashString(normalizeForSemanticCache(rawText))}:${hashString(configFingerprint(config))}`;
}

function tokenSet(text) {
  const tokens = normalizeForSemanticCache(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return new Set(tokens);
}

// Jaccard similarity over folded token sets; cheap semantic proxy that catches
// reworded repeats ("ozetle" vs "özetle", punctuation/case variants).
export function semanticSimilarity(a, b) {
  if (a === b) return 1;
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

export async function readSemanticCacheMap() {
  if (storageAvailable()) {
    try {
      const data = await chrome.storage.local.get(SEMANTIC_CACHE_KEY);
      const map = data?.[SEMANTIC_CACHE_KEY];
      return map && typeof map === "object" ? map : {};
    } catch (_) {
      return {};
    }
  }
  return Object.fromEntries(memoryFallback.entries());
}

export async function writeSemanticCacheMap(map) {
  const entries = Object.entries(map || {}).slice(-SEMANTIC_CACHE_MAX_ENTRIES);
  const trimmed = Object.fromEntries(entries);
  if (storageAvailable()) {
    try {
      await chrome.storage.local.set({ [SEMANTIC_CACHE_KEY]: trimmed });
    } catch (_) {}
  } else {
    memoryFallback.clear();
    for (const [key, value] of entries) memoryFallback.set(key, value);
  }
  return trimmed;
}

// Outermost lookup: exact key first, then a same-config near-duplicate scan.
// Returns the cached entry or null. Expired entries are ignored (lazy eviction).
export async function semanticCacheLookup(rawText, config = {}) {
  const map = await readSemanticCacheMap();
  const now = Date.now();
  const key = getSemanticCacheKey(rawText, config);
  const exact = map[key];
  if (exact && now - (exact.createdAt || 0) < SEMANTIC_CACHE_TTL_MS && exact.result) {
    return { ...exact, cacheHit: true, matchType: "exact", key };
  }
  const wantFingerprint = configFingerprint(config);
  let best = null;
  let bestScore = 0;
  for (const [entryKey, entry] of Object.entries(map)) {
    if (!entry || !entry.result) continue;
    if (now - (entry.createdAt || 0) >= SEMANTIC_CACHE_TTL_MS) continue;
    if ((entry.fingerprint || "") !== wantFingerprint) continue;
    const score = semanticSimilarity(rawText || "", entry.rawText || "");
    if (score >= SEMANTIC_CACHE_SIMILARITY_THRESHOLD && score > bestScore) {
      bestScore = score;
      best = { ...entry, cacheHit: true, matchType: "semantic", similarity: score, key: entryKey };
    }
  }
  return best;
}

export async function semanticCacheStore(rawText, config = {}, { result, usedModel = "" } = {}) {
  if (!rawText || !result) return null;
  const map = await readSemanticCacheMap();
  const key = getSemanticCacheKey(rawText, config);
  map[key] = {
    rawText: String(rawText).slice(0, 4000),
    fingerprint: configFingerprint(config),
    result,
    usedModel,
    createdAt: Date.now(),
    hits: (map[key]?.hits || 0) + 1
  };
  await writeSemanticCacheMap(map);
  return key;
}

export async function clearSemanticCache() {
  if (storageAvailable()) {
    try {
      await chrome.storage.local.remove(SEMANTIC_CACHE_KEY);
    } catch (_) {}
  }
  memoryFallback.clear();
}

// TTL-aware counters for the Settings screen (no behavior change to lookup).
export async function getSemanticCacheStats() {
  const map = await readSemanticCacheMap();
  const now = Date.now();
  let live = 0;
  for (const entry of Object.values(map || {})) {
    if (entry && entry.result && now - (entry.createdAt || 0) < SEMANTIC_CACHE_TTL_MS) live++;
  }
  return { entries: live, maxEntries: SEMANTIC_CACHE_MAX_ENTRIES };
}

// ---------------------------------------------------------------------------
// 2. Psi-safe prompt compression (Instruction Survival Probability)
// ---------------------------------------------------------------------------
//
// Psi (Ψ) = fraction of protected instruction lines that survive pruning.
// Critical format and system directives are never pruned, so Psi stays 1.0 by
// construction; if a budget would force a protected line out, compression
// stops and returns the input unchanged.

export const PROTECTED_PATTERNS = [
  /BRACKETED_PLACEHOLDER/i,
  /ignore previous instructions/i,
  /CRITICAL OUTPUT LANGUAGE/i,
  /SAME language as the RAW TEXT/i,
  /Fidelity rules/i,
  /Output rules/i,
  /OUTPUT FORMAT/i,
  /HDA AUDIT/i,
  /HDA AGENT REPORT/i,
  /RAW TEXT wins/i,
  /ROLE SPECIFICATION/i,
  /NEUTRAL FRAMING/i,
  /CONSTRAINTS/i,
  /CONCISE REASONING/i,
  /anti-overthinking/i,
  /^ROLE[:\s]/i,
  /^TASK[:\s]/i,
  /^METHOD[:\s]/i,
  /^CONSTRAINTS[:\s]/i
];

export function isProtectedLine(line) {
  const text = String(line || "");
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(text));
}

const FILLER_PATTERNS = [
  /\bvery\b/i,
  /\breally\b/i,
  /\bjust\b/i,
  /\bin order to\b/i,
  /\bdue to the fact that\b/i,
  /\bat this point in time\b/i
];

function lineValue(line) {
  // Protected lines have infinite value: they are never pruned.
  if (isProtectedLine(line)) return Number.POSITIVE_INFINITY;
  let value = String(line || "").length;
  for (const filler of FILLER_PATTERNS) {
    if (filler.test(line)) value -= 40;
  }
  // Short connective lines carry little information; prune them first.
  if (String(line || "").length < 40) value -= 20;
  return value;
}

export function estimatePsi(originalLines, keptLines) {
  const protectedOriginal = originalLines.filter(isProtectedLine);
  if (protectedOriginal.length === 0) return 1;
  const keptSet = new Set(keptLines);
  const survived = protectedOriginal.filter((line) => keptSet.has(line)).length;
  return survived / protectedOriginal.length;
}

export function compressSystemPrompt(system, { maxChars = 6000 } = {}) {
  const input = String(system || "");
  if (input.length <= maxChars) {
    const lines = input.split("\n");
    return { text: input, psi: 1, pruned: 0, protectedSurvival: 1, changed: false };
  }
  const lines = input.split("\n");
  const order = lines
    .map((line, index) => ({ line, index, value: lineValue(line) }))
    .sort((a, b) => a.value - b.value);
  const drop = new Set();
  let currentLength = input.length;
  for (const candidate of order) {
    if (currentLength <= maxChars) break;
    // Never drop a protected line: Psi must stay high.
    if (!Number.isFinite(candidate.value)) continue;
    drop.add(candidate.index);
    currentLength -= (candidate.line.length + 1);
  }
  const kept = lines.filter((_, index) => !drop.has(index));
  const psi = estimatePsi(lines, kept);
  // Safety net: any protected loss aborts compression entirely.
  if (psi < 1) {
    return { text: input, psi: 1, pruned: 0, protectedSurvival: 1, changed: false };
  }
  const text = kept.join("\n");
  return {
    text,
    psi,
    pruned: drop.size,
    protectedSurvival: psi,
    changed: drop.size > 0
  };
}

// ---------------------------------------------------------------------------
// 3. ConciseRL-style brevity reward (anti-overthinking)
// ---------------------------------------------------------------------------
//
// Rewards semantic density and penalizes redundant reasoning chains
// (repeated <thought> blocks, filler restatements). The result is a dynamic
// scalar in [-1, 1] that scales the dopaminergic update in brain_helper.js.

const OVERTHINKING_PATTERNS = [
  /<thought>[\s\S]*?<\/thought>/gi,
  /\blet me think again\b/i,
  /\bthinking step by step again\b/i,
  /\bas I already said\b/i
];

export function countThoughtChains(text) {
  const matches = String(text || "").match(/<thought>[\s\S]*?<\/thought>/gi);
  return matches ? matches.length : 0;
}

// Reasoning budget by task: simple single-output tasks get a tight budget so
// the model cannot wander into unnecessary chains; complex tasks get more room.
export function getReasoningBudget(taskType = "general", length = "orta") {
  const simple = taskType === "email" || taskType === "summary" || taskType === "translation";
  if (simple) return 1;
  if (length === "kisa") return 1;
  if (taskType === "coding" || taskType === "analysis") return 3;
  return 2;
}

export function overthinkingPenalty(text, { budget = 2 } = {}) {
  const chains = countThoughtChains(text);
  if (chains <= budget) return 0;
  return Math.min(0.6, 0.2 * (chains - budget));
}

export function scoreConciseness(result, { rawText = "", budget = 2 } = {}) {
  const output = String(result || "");
  if (!output) return 0;
  const words = output.split(/\s+/).filter(Boolean).length || 1;
  const unique = new Set(output.toLowerCase().split(/\s+/).filter(Boolean)).size;
  const lexicalDensity = unique / words; // 0..1, higher = less repetition
  const inputWords = String(rawText || "").split(/\s+/).filter(Boolean).length || 1;
  // Prefer outputs proportional to the input instead of runaway expansions.
  const expansion = words / Math.max(20, inputWords);
  const expansionPenalty = expansion > 8 ? 0.4 : expansion > 4 ? 0.15 : 0;
  const thoughtPenalty = overthinkingPenalty(output, { budget });
  const score = 0.5 * lexicalDensity - expansionPenalty - thoughtPenalty;
  return Math.max(-1, Math.min(1, Number(score.toFixed(3))));
}

// Dynamic RL weighting: scale the base reward by brevity so concise,
// non-redundant outputs reinforce more strongly (ConciseRL analogue).
export function conciseReward(baseReward, result, options = {}) {
  const brevity = scoreConciseness(result, options);
  const scaled = Number(baseReward) * (1 + 0.5 * brevity);
  return Math.max(-1, Math.min(1, Number(scaled.toFixed(3))));
}

// ---------------------------------------------------------------------------
// 4. Block-level KV prefix cache + PyramidKV-style pyramidal retention
// ---------------------------------------------------------------------------
//
// Client-side analogue of inference-engine KV reuse: split the stable system
// prompt into blocks, mark the stable prefix as cacheable (Anthropic
// `cache_control` breakpoints), and retain fewer tokens in deeper blocks
// (pyramidal allocation: early context at full resolution, later layers
// progressively compressed).

export const KV_CACHEABLE_BLOCKS = 3;
export const PYRAMID_MIN_RETAIN = 0.25;
export const PYRAMID_DECAY = 0.22;

export function splitSystemIntoBlocks(system) {
  return String(system || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

// Retention ratio for block `index` of `total`: 1.0 at the top, decaying with
// depth, floored at PYRAMID_MIN_RETAIN. Mirrors PyramidKV's layer-wise budget.
export function pyramidRetentionForBlock(index, total) {
  if (total <= 1) return 1;
  const depth = index / Math.max(1, total - 1);
  const retention = 1 - depth * 0.75;
  return Math.max(PYRAMID_MIN_RETAIN, Number(retention.toFixed(3)));
}

export function applyPyramidRetention(blocks, { minRetain = PYRAMID_MIN_RETAIN } = {}) {
  const total = blocks.length;
  return blocks.map((block, index) => {
    const retention = Math.max(minRetain, pyramidRetentionForBlock(index, total));
    if (retention >= 1) return block;
    // Truncate low-priority tail of deeper blocks; head (role/format) survives.
    const keepChars = Math.max(64, Math.floor(block.length * retention));
    if (block.length <= keepChars) return block;
    return `${block.slice(0, keepChars)}\n[…pyramid-truncated ${block.length - keepChars} chars]`;
  });
}

// Convert a system string into Anthropic-style cacheable content blocks. The
// stable instruction prefix gets `cache_control` breakpoints so the inference
// engine can reuse KV across calls; the trailing dynamic block (SNN values,
// language mandate) stays uncached.
export function toCacheableSystemBlocks(system, { cacheableBlocks = KV_CACHEABLE_BLOCKS } = {}) {
  const blocks = splitSystemIntoBlocks(system);
  return blocks.map((text, index) => {
    const block = { type: "text", text };
    if (index < cacheableBlocks && index < blocks.length - 1) {
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });
}

// Flatten cacheable blocks back to plain text for providers that only accept
// a system string (OpenRouter chat completions).
export function flattenCacheableBlocks(blocks) {
  return (blocks || []).map((block) => (typeof block === "string" ? block : block.text || "")).join("\n\n");
}

// Fingerprint of the stable prefix: identical fingerprints mean the inference
// engine can hit its block-level KV cache instead of recomputing the prefix.
export function prefixCacheKey(system, { prefixBlocks = KV_CACHEABLE_BLOCKS } = {}) {
  const blocks = splitSystemIntoBlocks(system).slice(0, prefixBlocks);
  return hashString(blocks.join("\n\n"));
}
