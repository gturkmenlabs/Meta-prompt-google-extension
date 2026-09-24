// Offline checks for the efficiency layer (semantic cache, Psi-safe
// compression, ConciseRL-style reward, block/pyramid KV). No API key or
// network required: `node verify_efficiency.js`.
import assert from "node:assert/strict";
import {
  normalizeForSemanticCache,
  hashString,
  semanticSimilarity,
  getSemanticCacheKey,
  semanticCacheLookup,
  semanticCacheStore,
  clearSemanticCache,
  compressSystemPrompt,
  estimatePsi,
  isProtectedLine,
  scoreConciseness,
  conciseReward,
  countThoughtChains,
  getReasoningBudget,
  overthinkingPenalty,
  splitSystemIntoBlocks,
  pyramidRetentionForBlock,
  applyPyramidRetention,
  toCacheableSystemBlocks,
  flattenCacheableBlocks,
  prefixCacheKey
} from "./efficiency.js";
import { buildSystemBase, CONCISE_REASONING_GUARD } from "./prompt.js";

let pass = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  pass++;
  console.log(`[PASS] ${message}`);
};

// 1. Outermost semantic cache: repeats hit without normalization gaps.
await clearSemanticCache();
ok(normalizeForSemanticCache("Özetle  bu METNİ") === "ozetle bu metni", "diacritic/case folding normalizes repeats");
ok(hashString("abc") === hashString("abc") && hashString("abc") !== hashString("abd"), "hash is stable and distinctive");
ok(semanticSimilarity("summarize this text", "summarize this text!") >= 0.9, "near-duplicate scores high");
ok(semanticSimilarity("write python code", "bake a chocolate cake") < 0.3, "unrelated queries score low");

const config = { language: "auto", length: "orta", mode: "standard" };
await semanticCacheStore("Summarize this text", config, { result: "CACHED PROMPT", usedModel: "test-model" });
const exact = await semanticCacheLookup("summarize this text", config);
ok(exact && exact.result === "CACHED PROMPT" && exact.matchType === "exact", "exact repeat hits the outermost cache");
const diacritic = await semanticCacheLookup("SUMMARIZE  this text!", config);
ok(diacritic && diacritic.result === "CACHED PROMPT", "reworded repeat hits via semantic similarity");
const otherConfig = await semanticCacheLookup("summarize this text", { ...config, length: "uzun" });
ok(otherConfig === null, "different config does not hit (no cross-contamination)");
ok(getSemanticCacheKey("a", config) !== getSemanticCacheKey("b", config), "cache keys differ per query");

// 2. Psi-safe compression: protected directives always survive.
const system = buildSystemBase("write code function api", null, "orta");
ok(isProtectedLine("Preserve every concrete detail, insert [BRACKETED_PLACEHOLDER]"), "placeholder line is protected");
ok(isProtectedLine("CRITICAL OUTPUT LANGUAGE: Write the ENTIRE expert prompt in TURKISH"), "language mandate is protected");
ok(isProtectedLine(`${CONCISE_REASONING_GUARD.slice(0, 40)}...`) || isProtectedLine(CONCISE_REASONING_GUARD), "concise-reasoning guard is protected");
const longSystem = `${system}\n\n${"Filler line with very really just padding for compression testing.\n".repeat(200)}`;
const compressed = compressSystemPrompt(longSystem, { maxChars: 6000 });
ok(compressed.psi >= 1 && compressed.protectedSurvival >= 1, "Psi stays high (protected survival = 1)");
ok(compressed.text.includes("[BRACKETED_PLACEHOLDER]"), "fidelity rule survives compression");
ok(compressed.text.includes("CONCISE REASONING"), "anti-overthinking guard survives compression");
ok(compressed.text.length < longSystem.length, "redundant filler is pruned");
ok(estimatePsi(["keep [BRACKETED_PLACEHOLDER]", "drop me"], ["keep [BRACKETED_PLACEHOLDER]"]) === 1, "Psi estimator counts protected survival");
const short = compressSystemPrompt("short system", { maxChars: 6000 });
ok(short.changed === false && short.psi === 1, "short prompts pass through untouched");

// 3. ConciseRL-style reward: brevity wins, overthinking loses.
ok(getReasoningBudget("summary", "orta") === 1, "simple tasks get budget 1");
ok(getReasoningBudget("coding", "orta") === 3, "coding gets budget 3");
ok(countThoughtChains("<thought>a</thought> text <thought>b</thought>") === 2, "thought chains are counted");
ok(overthinkingPenalty("<thought>a</thought>".repeat(5), { budget: 2 }) > 0, "excess chains are penalized");
ok(overthinkingPenalty("<thought>a</thought>", { budget: 2 }) === 0, "in-budget reasoning is free");
const concise = scoreConciseness("ROLE: expert. TASK: deliver X. CONSTRAINTS: none.", { rawText: "do X" });
const bloated = scoreConciseness(`${"<thought>repeat</thought> ".repeat(6)} word `.repeat(200), { rawText: "do X", budget: 2 });
ok(concise > bloated, "concise output scores higher than bloated overthinking");
ok(conciseReward(1, "ROLE: expert. TASK: deliver X.", { rawText: "do X" }) > 0, "concise success keeps positive reward");
ok(conciseReward(1, `${"<thought>x</thought> ".repeat(10)}`.repeat(50), { rawText: "hi", budget: 1 }) < 1, "overthinking scales the reward down");

// 4. Block-level KV + PyramidKV-style retention.
const blocks = splitSystemIntoBlocks("block one\n\nblock two\n\nblock three\n\nblock four");
ok(blocks.length === 4, "system splits into blocks");
ok(pyramidRetentionForBlock(0, 4) === 1, "top block retained fully");
ok(pyramidRetentionForBlock(3, 4) < pyramidRetentionForBlock(0, 4), "retention decays with depth (pyramidal)");
const retained = applyPyramidRetention(["a".repeat(500), "b".repeat(500), "c".repeat(500), "d".repeat(500)]);
ok(retained[0].length >= retained[3].length, "deeper blocks compress more");
const cacheable = toCacheableSystemBlocks("intro one\n\nintro two\n\nintro three\n\nSNN dynamic tail 0.123");
ok(cacheable[0].cache_control?.type === "ephemeral", "stable prefix gets KV cache breakpoints");
ok(!cacheable[cacheable.length - 1].cache_control, "dynamic tail stays uncached");
ok(flattenCacheableBlocks(cacheable).includes("intro one"), "blocks flatten for string-only providers");
ok(prefixCacheKey("a\n\nb\n\nc\n\nd") === prefixCacheKey("a\n\nb\n\nc\n\nDIFFERENT TAIL"), "prefix key ignores the dynamic tail");

// A Claude Code command is part of the cache config: a near-duplicate with a
// different (or no) command must not reuse the other prompt.
await clearSemanticCache();
const longTask = "add google oauth login to the auth module and keep the existing session cookies working for all current users";
const ccBase = { language: "en", length: "orta", mode: "standard" };
await semanticCacheStore(longTask, { ...ccBase, claudeCommand: "" }, { result: "PLAIN PROMPT" });
ok(semanticSimilarity(longTask, "/plan " + longTask) >= 0.92, "the /plan variant is a Jaccard near-duplicate");
ok(await semanticCacheLookup("/plan " + longTask, { ...ccBase, claudeCommand: "plan" }) === null, "a command does not reuse the plain-text cache entry");
await semanticCacheStore("/plan " + longTask, { ...ccBase, claudeCommand: "plan" }, { result: "PLAN PROMPT" });
ok(await semanticCacheLookup("/review " + longTask, { ...ccBase, claudeCommand: "review" }) === null, "different commands do not share a cache entry");
ok((await semanticCacheLookup("/plan  " + longTask, { ...ccBase, claudeCommand: "plan" }))?.result === "PLAN PROMPT", "the same command still hits the cache");

await clearSemanticCache();
console.log(`\nEfficiency checks passed: ${pass} assertions.`);
