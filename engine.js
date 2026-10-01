// Prompt engine router for the web app. It runs in the page (see web/shim.js)
// and answers the studio over chrome.runtime: a "revise" port that streams the
// prompt, a one-shot REVISE_PROMPT message, and REWARD_BRAIN.

import { reviseWithFailover, reviseStreamWithFailover } from "./api.js";
import { getFailoverConfig, getTypesafeConfig } from "./config.js";
import { classifyTaskType } from "./typesafe.js";
import { buildSystemPrompt, buildUserMessage, buildConsensusJudgeMessages, maxTokensFor, detectTaskType, resolveAutoStrategy } from "./prompt.js";
import { runBrainSimulation } from "./brain_helper.js";
import { runHdaAgents, buildHdaReportBlock } from "./hda_agents.js";
import { semanticCacheLookup, semanticCacheStore, compressSystemPrompt } from "./efficiency.js";
import { isMemoryEnabled, recallForRevision, rememberRevision, formatMemoryContext, forgetMemory } from "./memory.js";

// Resolves the standard-mode task type through TypeSafe when the user enabled it,
// so the prompt brain can pick its modules from a judgment instead of keyword
// hits. Returns null whenever the keyword detector should stay in charge: the
// non-standard modes (they label the SNN from their strategy), the feature off,
// low confidence, or any failure. Both revision paths treat null as "use
// detectTaskType", so this can never block a revision.
async function resolveStandardTaskType(mode, rawText) {
  if (mode !== "standard") return null;
  try {
    const { apiKey, enabled, minConfidence } = await getTypesafeConfig();
    if (!enabled) return null;
    const judged = await classifyTaskType({ apiKey, rawText, minConfidence });
    return judged ? judged.taskType : null;
  } catch (error) {
    console.warn("TypeSafe task classification skipped:", error);
    return null;
  }
}

// HDA setting: "agents" (default), "inline" or "off". The older boolean
// `hdaEnabled: false` still reads as off.
const HDA_MODES = ["agents", "inline", "off"];
async function getHdaMode() {
  const { hdaMode, hdaEnabled } = await chrome.storage.local.get(["hdaMode", "hdaEnabled"]);
  if (HDA_MODES.includes(hdaMode)) return hdaMode;
  return hdaEnabled === false ? "off" : "agents";
}

// Runs the HDA phase agents (sequential calls over the same failover model
// list as the revision) and returns what buildSystemPrompt/buildUserMessage
// need. Any phase failure falls back to the single-pass inline audit, so the
// agents can slow a revision down but never block it.
async function resolveHda({ hdaMode, rawText, length, provider, apiKeys, models, onPhase = null }) {
  if (hdaMode === "off") return { hda: false, hdaReport: "", hdaStatus: "off" };
  if (hdaMode === "inline") return { hda: true, hdaReport: "", hdaStatus: "inline" };
  try {
    const run = await runHdaAgents({
      rawText,
      length,
      onPhase,
      call: async ({ system, userText, maxTokens }) => (await reviseWithFailover({
        provider, apiKey: apiKeys[provider], apiKeys, models, system, userText, maxTokens
      })).result
    });
    return { hda: "agents", hdaReport: buildHdaReportBlock(run), hdaStatus: run.short ? "agents-short" : "agents" };
  } catch (error) {
    console.warn("HDA agents failed; using the inline HDA audit:", error);
    return { hda: true, hdaReport: "", hdaStatus: "inline-fallback" };
  }
}

// Cross-model consensus check: has a model DIFFERENT from the producing model
// review the generated prompt as a judge. Returns null if consensusCheck is off.
// Errors / missing alternative model cases are reported as "skipped" — they
// never break the main flow.
async function runConsensusCheck({ provider, apiKeys, models, usedModel, rawText, result }) {
  try {
    const { consensusCheck } = await chrome.storage.local.get("consensusCheck");
    if (!consensusCheck) return null;
    const hdaMode = await getHdaMode();
    const judgeModels = (models || []).filter((m) => m !== usedModel);
    if (!judgeModels.length) return { status: "skipped", reason: "No different model available to judge" };
    const { system, userText } = buildConsensusJudgeMessages(rawText, result, { hda: hdaMode !== "off" });
    const { result: verdictRaw, usedModel: judgeModel } = await reviseWithFailover({
      provider,
      apiKey: apiKeys[provider],
      apiKeys,
      models: judgeModels,
      system,
      userText,
      maxTokens: 512
    });
    const ok = /^\s*VERDICT:\s*OK\b/i.test(verdictRaw);
    const issues = ok ? "" : verdictRaw.replace(/^\s*VERDICT:\s*\w+\s*/i, "").trim();
    return { status: ok ? "ok" : "issues", issues, judgeModel };
  } catch (error) {
    return { status: "skipped", reason: String((error && error.message) || error) };
  }
}

// Message listener that performs prompt revision in the background.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REVISE_PROMPT") {
    handleRevisePromptMessage(message, sendResponse);
    return true; // indicates an async response will be sent
  }
  if (message.type === "REWARD_BRAIN") {
    handleRewardBrainMessage(message, sendResponse);
    return true; // indicates an async response will be sent
  }
  if (message.type === "MEMORY_FORGET") {
    // Deleting a history entry also forgets that request (Mnemonist active forgetting).
    forgetMemory(typeof message.raw === "string" ? message.raw : "")
      .then((forgotten) => sendResponse({ ok: true, forgotten }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
});

async function handleRewardBrainMessage(message, sendResponse) {
  try {
    const { rewardVal } = message;
    if (!Number.isFinite(rewardVal) || Math.abs(rewardVal) > 1) throw new Error("Invalid reward value.");
    const { rewardBrain } = await import("./brain_helper.js");
    await rewardBrain(rewardVal);
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
}

// Shared preparation for the REVISE_PROMPT / stream path: resolve strategies,
// run the SNN, and build the provider/model plan and the prompts.
// `onPhase` reports HDA agent progress to the caller (the studio port).
//
// Efficiency order (outermost first):
//   1. semantic cache lookup (repeated queries never reach SNN/HDA/API),
//   2. SNN tick + HDA agents,
//   3. Psi-safe compression of the assembled system prompt.
function cacheConfigFor({ language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, agentTarget = "", taskTypeOverride = null, hdaMode = "agents", memory = false }) {
  return { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, agentTarget, taskTypeOverride, hda: hdaMode, memory };
}

const SYSTEM_COMPRESSION_BUDGET = { kisa: 4000, orta: 8000, uzun: 12000, maks: 20000 };

function compressSystemSafe(system, length) {
  const maxChars = SYSTEM_COMPRESSION_BUDGET[length] || SYSTEM_COMPRESSION_BUDGET.orta;
  if (String(system || "").length <= maxChars) return system;
  try {
    const { text, psi } = compressSystemPrompt(system, { maxChars });
    // Psi must stay high: only accept fully protected compressions.
    return psi >= 1 ? text : system;
  } catch (_) {
    return system;
  }
}

async function prepareRevision(message, { onPhase = null } = {}) {
  const { language = "auto", length = "orta", mode = "standard", rawText } = message;
  if (typeof rawText !== "string" || !rawText.trim()) throw new Error("Enter some text to revise.");
  if (rawText.length > 100000) throw new Error("Source text is too long. Use at most 100,000 characters.");
  // Auto-resolve sub-strategies based on raw text intent when "auto" or absent.
  const vibeStrategy      = resolveAutoStrategy("vibecoding", message.vibeStrategy      || "auto", rawText);
  const researchStrategy  = resolveAutoStrategy("research",   message.researchStrategy  || "auto", rawText);
  const antihalluStrategy = resolveAutoStrategy("antihallu",  message.antihalluStrategy || "auto", rawText);
  const agentTarget       = resolveAutoStrategy("agentcli",   message.agentTarget       || "auto", rawText);

  const { provider, apiKeys, models } = await getFailoverConfig();
  const typesafeTaskType = await resolveStandardTaskType(mode, rawText);
  const hdaMode = await getHdaMode();
  let memoryOn = false;
  try { memoryOn = await isMemoryEnabled(); } catch (_) {}

  // 0) Outermost semantic cache: identical or near-duplicate queries with the
  // same config short-circuit before SNN, HDA agents, or any model call.
  // `skipCache` (the studio's Redo) asks for a fresh write; the new result still
  // replaces the cached one after it finishes.
  try {
    const cacheConfig = cacheConfigFor({
      language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, agentTarget,
      taskTypeOverride: typesafeTaskType, hdaMode, memory: memoryOn
    });
    const hit = message.skipCache === true ? null : await semanticCacheLookup(rawText, cacheConfig);
    if (hit) {
      return {
        provider, apiKeys, models, snnValues: null, resolvedStrategy: null,
        hdaStatus: "cache-hit", system: "", userText: "", maxTokens: maxTokensFor(length),
        cached: true, cachedResult: hit.result, cachedModel: hit.usedModel || "", memoryUsed: 0,
        cacheConfig
      };
    }
  } catch (_) {}

  let snnValues = null;
  try {
    const taskType = mode === "agentcli"
      ? "coding"
      : mode === "vibecoding"
      ? `vibecoding_${vibeStrategy}`
      : mode === "research"
        ? `research_${researchStrategy || "comprehensive"}`
        : mode === "antihallu"
          ? `antihallu_${antihalluStrategy || "ensemble"}`
          : (typesafeTaskType || detectTaskType(rawText));
    snnValues = await runBrainSimulation(taskType);
  } catch (snnError) {
    console.warn("Background SNN simulation failed:", snnError);
  }

  const resolvedStrategy = mode === "agentcli" ? agentTarget
    : mode === "vibecoding" ? vibeStrategy
    : mode === "research" ? researchStrategy
    : mode === "antihallu" ? antihalluStrategy
    : null;

  const { hda, hdaReport, hdaStatus } = await resolveHda({
    hdaMode, rawText, length, provider, apiKeys, models, onPhase
  });

  // Mnemonist memory (opt-in): related earlier requests become escaped context.
  const recalled = memoryOn ? await recallForRevision(rawText) : [];

  const rawSystem = buildSystemPrompt(language, rawText, snnValues, mode, vibeStrategy, researchStrategy, antihalluStrategy, length, typesafeTaskType, hda, agentTarget);
  const cacheConfig = cacheConfigFor({
    language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, agentTarget,
    taskTypeOverride: typesafeTaskType, hdaMode, memory: memoryOn
  });

  return {
    provider,
    apiKeys,
    models,
    snnValues,
    resolvedStrategy,
    hdaStatus,
    cacheConfig,
    memoryUsed: recalled.length,
    system: compressSystemSafe(rawSystem, length),
    userText: buildUserMessage(rawText, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, agentTarget, hdaReport, memoryContext: formatMemoryContext(recalled) }),
    maxTokens: maxTokensFor(length)
  };
}

async function handleRevisePromptMessage(message, sendResponse) {
  try {
    const plan = await prepareRevision(message);
    if (plan.cached) {
      sendResponse({ ok: true, result: plan.cachedResult, usedModel: plan.cachedModel, fellBack: false, consensus: null, snnValues: null, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus, cached: true });
      return;
    }
    const { result, usedModel, fellBack } = await reviseWithFailover({
      provider: plan.provider,
      apiKey: plan.apiKeys[plan.provider],
      apiKeys: plan.apiKeys,
      models: plan.models,
      system: plan.system,
      userText: plan.userText,
      maxTokens: plan.maxTokens
    });
    const consensus = await runConsensusCheck({
      provider: plan.provider, apiKeys: plan.apiKeys, models: plan.models,
      usedModel, rawText: message.rawText, result
    });
    try {
      await semanticCacheStore(message.rawText, plan.cacheConfig || {}, { result, usedModel });
    } catch (_) {}
    await rememberRevision({ raw: message.rawText, prompt: result, meta: { mode: message.mode, length: message.length } });
    sendResponse({ ok: true, result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus, memoryUsed: plan.memoryUsed });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
}

// Streaming revision channel: the studio connects via
// chrome.runtime.connect({name:"revise"}) and the result streams in as "delta"
// messages while it is produced.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "revise") return;

  let disconnected = false;
  let busy = false;
  port.onDisconnect.addListener(() => { disconnected = true; });
  const safePost = (msg) => {
    if (disconnected) return;
    try { port.postMessage(msg); } catch (_) { disconnected = true; }
  };

  port.onMessage.addListener(async (message) => {
    if (message.type !== "REVISE_PROMPT_STREAM" || busy || disconnected) return;
    busy = true;
    try {
      const plan = await prepareRevision(message, {
        onPhase: ({ index, total, agent }) => safePost({ type: "hda", index, total, name: agent.name })
      });
      if (plan.cached) {
        safePost({ type: "done", result: plan.cachedResult, usedModel: plan.cachedModel, fellBack: false, consensus: null, snnValues: null, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus, cached: true });
        return;
      }
      const { result, usedModel, fellBack } = await reviseStreamWithFailover({
        provider: plan.provider,
        apiKey: plan.apiKeys[plan.provider],
        apiKeys: plan.apiKeys,
        models: plan.models,
        system: plan.system,
        userText: plan.userText,
        maxTokens: plan.maxTokens,
        onDelta: (chunk) => safePost({ type: "delta", text: chunk })
      });
      const { consensusCheck } = await chrome.storage.local.get("consensusCheck");
      if (consensusCheck) safePost({ type: "checking" });
      const consensus = await runConsensusCheck({
        provider: plan.provider, apiKeys: plan.apiKeys, models: plan.models,
        usedModel, rawText: message.rawText, result
      });
      try {
        await semanticCacheStore(message.rawText, plan.cacheConfig || {}, { result, usedModel });
      } catch (_) {}
      await rememberRevision({ raw: message.rawText, prompt: result, meta: { mode: message.mode, length: message.length } });
      safePost({ type: "done", result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus, memoryUsed: plan.memoryUsed });
    } catch (error) {
      safePost({ type: "error", error: error.message || String(error) });
    } finally {
      busy = false;
    }
  });
});

