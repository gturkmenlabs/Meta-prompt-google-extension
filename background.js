// Sets up the right-click context menus.
//  - "send to popup": stores the selected text where the popup will read it.
//  - "revise in place": reads the active text box, revises it via the API, and writes it back.

import { reviseWithFailover, reviseStreamWithFailover } from "./api.js";
import { getFailoverConfig, getTypesafeConfig } from "./config.js";
import { classifyTaskType } from "./typesafe.js";
import { buildSystemPrompt, buildUserMessage, buildConsensusJudgeMessages, maxTokensFor, detectTaskType, resolveAutoStrategy } from "./prompt.js";
import { runBrainSimulation } from "./brain_helper.js";
import { runHdaAgents, buildHdaReportBlock } from "./hda_agents.js";
import { detectClaudeCodeCommand } from "./claude_commands.js";
import { semanticCacheLookup, semanticCacheStore, compressSystemPrompt } from "./efficiency.js";

const MENU_TO_POPUP = "revizeMetaPrompt";
const MENU_INPLACE = "revizeInPlace";
const MENU_UNDO = "revizeUndo";
const activeRevisions = new Set();
// How often the in-place stream mirrors its accumulated text into storage, so a
// service-worker eviction cannot silently discard a revision in progress.
const PARTIAL_SAVE_MS = 1000;
const badgeTimers = new Map();

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

chrome.runtime.onInstalled.addListener(() => {
  // Clear existing menus (prevents duplicate id errors).
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TO_POPUP,
      title: "Send text to Meta-Prompt Engine (popup)",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_INPLACE,
      title: "Revise this box with Meta-Prompt (write in place)",
      contexts: ["editable", "selection"]
    });
    chrome.contextMenus.create({
      id: MENU_UNDO,
      title: "Undo last revision",
      contexts: ["editable"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_TO_POPUP) {
    const text = (info.selectionText || "").trim();
    if (text) chrome.storage.local.set({ selectedText: text });
    return;
  }
  if (info.menuItemId === MENU_INPLACE) {
    reviseInPlace(tab, info.selectionText || "");
    return;
  }
  if (info.menuItemId === MENU_UNDO) {
    undoInPlace(tab);
  }
});

// Keyboard shortcuts (default: revise Ctrl/Cmd+Shift+L, undo Ctrl/Cmd+Shift+U).
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "revise-in-place" && command !== "undo-revise") return;
  let target = tab;
  if (!target || target.id == null) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    target = active;
  }
  if (!target) return;
  if (command === "revise-in-place") reviseInPlace(target, "");
  else undoInPlace(target);
});

// Undoes the last in-place revision; the original text is kept in the content script.
async function undoInPlace(tab) {
  if (!tab || tab.id == null) return;
  const tabId = tab.id;
  const restored = await sendToTab(tabId, { type: "RESTORE_EDITABLE_TEXT" });
  if (restored && restored.ok) {
    setBadge(tabId, "↩", "#5f6368");
    // An undo signals the result was disliked: apply a negative reward.
    try {
      const { rewardBrain } = await import("./brain_helper.js");
      await rewardBrain(-1.0);
    } catch (_) {}
  } else {
    setBadge(tabId, "?", "#d93025");
    chrome.storage.local.set({ lastError: "No revision to undo (a revision must have been made on the same page)." });
  }
  clearBadgeLater(tabId);
}

// Sends a message to the content script; returns null on error (the page may
// not have been injected).
function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(response);
    });
  });
}

function setBadge(tabId, text, color) {
  clearTimeout(badgeTimers.get(tabId));
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text, tabId });
}

function clearBadgeLater(tabId, ms = 4000) {
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    chrome.action.setBadgeText({ text: "", tabId });
  }, ms));
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

async function reviseInPlace(tab, selectionText = "") {
  if (!tab || tab.id == null || activeRevisions.has(tab.id)) return;
  const tabId = tab.id;
  activeRevisions.add(tabId);
  let writeQueue = Promise.resolve();
  let text = "";
  let acc = "";

  try {
    setBadge(tabId, "…", "#1a73e8");

    // 1) Get the text: active box first, otherwise the selected text.
    const got = await sendToTab(tabId, { type: "GET_EDITABLE_TEXT", captureTarget: true });
    text = (got && got.text) || selectionText || "";
    text = text.trim();
    if (!text) {
      setBadge(tabId, "?", "#d93025");
      chrome.storage.local.set({ lastError: "No text found to revise (type into the box and try again)." });
      clearBadgeLater(tabId);
      return;
    }

    // 2) Configuration (active model + cross-provider backup list).
    const { provider, apiKey, apiKeys, models } = await getFailoverConfig();
    if (!apiKey) {
      setBadge(tabId, "key", "#d93025");
      chrome.storage.local.set({ lastError: "No API key. Enter one in Settings." });
      clearBadgeLater(tabId);
      return;
    }

    // Language/length/Development Mode preferences selected in the popup (default if absent).
    // This way the shortcut/right-click path uses the same mode as the popup.
    const prefs = await chrome.storage.local.get([
      "language", "length", "mode", "vibeStrategy", "researchStrategy", "antihalluStrategy"
    ]);
    const hdaMode = await getHdaMode();
    const language = prefs.language || "auto";
    const length = prefs.length || "orta";
    const mode = prefs.mode || "standard";
    const vibeStrategy      = resolveAutoStrategy("vibecoding", prefs.vibeStrategy      || "auto", text);
    const researchStrategy  = resolveAutoStrategy("research",   prefs.researchStrategy  || "auto", text);
    const antihalluStrategy = resolveAutoStrategy("antihallu",  prefs.antihalluStrategy || "auto", text);

    const typesafeTaskType = await resolveStandardTaskType(mode, text);

    const inPlaceCacheConfig = cacheConfigFor(text, {
      language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy,
      taskTypeOverride: typesafeTaskType, hdaMode
    });

    // 0) Outermost semantic cache for the in-place path as well.
    try {
      const hit = await semanticCacheLookup(text, inPlaceCacheConfig);
      if (hit && hit.result) {
        await writeQueue;
        const wroteOk = await sendToTab(tabId, { type: "STREAM_EDITABLE_TEXT", text: hit.result, done: true });
        if (wroteOk && wroteOk.ok) {
          setBadge(tabId, "✓", "#34a853");
        } else {
          chrome.storage.local.set({ selectedText: text, lastInPlaceResult: hit.result });
          setBadge(tabId, "copy", "#f9ab00");
        }
        clearBadgeLater(tabId);
        return;
      }
    } catch (_) {}

    // 3) Run biophysical SNN simulation tick
    let snnValues = null;
    try {
      const taskType = mode === "vibecoding"
        ? `vibecoding_${vibeStrategy}`
        : mode === "research"
          ? `research_${researchStrategy || "comprehensive"}`
          : mode === "antihallu"
            ? `antihallu_${antihalluStrategy || "ensemble"}`
            : (typesafeTaskType || detectTaskType(text));
      snnValues = await runBrainSimulation(taskType);
    } catch (snnError) {
      console.warn("SNN simulation failed, using static fallback:", snnError);
    }

    // 3b) HDA phase agents: the badge shows which phase is running (H1…H5).
    const { hda, hdaReport } = await resolveHda({
      hdaMode, rawText: text, length, provider, apiKeys, models,
      onPhase: ({ agent }) => setBadge(tabId, `H${agent.id.slice(-1)}`, "#7b1fa2")
    });
    setBadge(tabId, "…", "#1a73e8");

    // 4) Revise — streaming: the result is written to the box as it is generated.
    // Intermediate writes happen ~every 150ms with the FULL accumulated text (fire-and-forget);
    // on the first failed write, stream-writing is abandoned and the result falls back to the copy path at the end.
    let lastWriteAt = 0;
    let lastSaveAt = 0;
    let writeBroken = false;
    let savedPartial = false;
    // The service worker can be evicted mid-stream — most likely once page writes
    // stop (writeBroken), because then nothing but the fetch is keeping it busy.
    // Persisting the text generated so far means an eviction loses nothing: the
    // popup still finds the partial under lastInPlaceResult and can copy it.
    const persistPartial = (textSoFar) => {
      if (!textSoFar) return;
      savedPartial = true;
      chrome.storage.local.set({ lastInPlaceResult: textSoFar });
    };
    const streamWrite = async (chunkText, done) => {
      if (writeBroken) return false;
      const resp = await sendToTab(tabId, { type: "STREAM_EDITABLE_TEXT", text: chunkText, done });
      if (!resp || !resp.ok) {
        writeBroken = true;
        return false;
      }
      return true;
    };

    const { result, usedModel } = await reviseStreamWithFailover({
      provider,
      apiKey,
      apiKeys,
      models,
      system: compressSystemSafe(buildSystemPrompt(language, text, snnValues, mode, vibeStrategy, researchStrategy, antihalluStrategy, length, typesafeTaskType, hda), length),
      userText: buildUserMessage(text, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, hdaReport }),
      maxTokens: maxTokensFor(length),
      onDelta: (chunk) => {
        acc += chunk;
        const now = Date.now();
        if (!writeBroken && now - lastWriteAt >= 150) {
          lastWriteAt = now;
          const snapshot = acc;
          writeQueue = writeQueue.then(() => streamWrite(snapshot, false));
        }
        if (now - lastSaveAt >= PARTIAL_SAVE_MS) {
          lastSaveAt = now;
          persistPartial(acc);
        }
      }
    });

    // 5) Final write: full result + done=true (binds the undo state).
    await writeQueue;
    try {
      await semanticCacheStore(text, inPlaceCacheConfig, { result, usedModel });
    } catch (_) {}
    const wroteOk = !writeBroken && await streamWrite(result, true);
    if (wroteOk) {
      // The page holds the result, so drop the crash-recovery copy; otherwise the
      // popup would keep presenting it as an unwritten in-place result.
      if (savedPartial) chrome.storage.local.remove("lastInPlaceResult");
      setBadge(tabId, "✓", "#34a853");
      try {
        const { rewardBrainWithConciseness } = await import("./brain_helper.js");
        await rewardBrainWithConciseness(1.0, result, { rawText: text, length });
      } catch (_) {}
      // Optional cross-model consensus: if the judge finds issues, show the "≠"
      // badge and write the findings to lastError (readable from the popup).
      const consensus = await runConsensusCheck({ provider, apiKeys, models, usedModel, rawText: text, result });
      if (consensus && consensus.status === "issues") {
        setBadge(tabId, "≠", "#f9ab00");
        chrome.storage.local.set({ lastError: `Consensus warning (${consensus.judgeModel}):\n${consensus.issues}` });
      }
    } else {
      // Could not write to the box: store the result so it can be copied from the popup.
      chrome.storage.local.set({ selectedText: text, lastInPlaceResult: result });
      setBadge(tabId, "copy", "#f9ab00");
    }
  } catch (error) {
    // Keep whatever was generated before the failure so it is recoverable.
    const partial = { lastError: String((error && error.message) || error) };
    if (acc) {
      partial.selectedText = text;
      partial.lastInPlaceResult = acc;
    }
    chrome.storage.local.set(partial);
    setBadge(tabId, acc ? "copy" : "err", acc ? "#f9ab00" : "#d93025");
  } finally {
    await writeQueue;
    await sendToTab(tabId, { type: "END_EDITABLE_STREAM" });
    activeRevisions.delete(tabId);
    clearBadgeLater(tabId);
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
// `onPhase` reports HDA agent progress to the caller (the popup port).
//
// Efficiency order (outermost first):
//   1. semantic cache lookup (repeated queries never reach SNN/HDA/API),
//   2. SNN tick + HDA agents,
//   3. Psi-safe compression of the assembled system prompt.
// The Claude Code command is part of the config: without it a near-duplicate text
// with or without "/plan" (or with a different command) would share a cache entry.
function cacheConfigFor(rawText, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, taskTypeOverride = null, hdaMode = "agents" }) {
  const claudeCommand = detectClaudeCodeCommand(rawText)?.id || "";
  return { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, taskTypeOverride, hda: hdaMode, claudeCommand };
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

  const { provider, apiKeys, models } = await getFailoverConfig();
  const typesafeTaskType = await resolveStandardTaskType(mode, rawText);
  let hdaMode = await getHdaMode();
  // The desktop account providers (Claude Code / Codex / OpenCode) revise
  // without an API key, so the phase agents have nothing to call there.
  if (hdaMode === "agents" && globalThis.desktopAccountProvider) hdaMode = "inline";

  // 0) Outermost semantic cache: identical or near-duplicate queries with the
  // same config short-circuit before SNN, HDA agents, or any model call.
  try {
    const cacheConfig = cacheConfigFor(rawText, {
      language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy,
      taskTypeOverride: typesafeTaskType, hdaMode
    });
    const hit = await semanticCacheLookup(rawText, cacheConfig);
    if (hit) {
      return {
        provider, apiKeys, models, snnValues: null, resolvedStrategy: null,
        hdaStatus: "cache-hit", system: "", userText: "", maxTokens: maxTokensFor(length),
        cached: true, cachedResult: hit.result, cachedModel: hit.usedModel || "",
        cacheConfig
      };
    }
  } catch (_) {}

  let snnValues = null;
  try {
    const taskType = mode === "vibecoding"
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

  const resolvedStrategy = mode === "vibecoding" ? vibeStrategy
    : mode === "research" ? researchStrategy
    : mode === "antihallu" ? antihalluStrategy
    : null;

  const { hda, hdaReport, hdaStatus } = await resolveHda({
    hdaMode, rawText, length, provider, apiKeys, models, onPhase
  });

  const rawSystem = buildSystemPrompt(language, rawText, snnValues, mode, vibeStrategy, researchStrategy, antihalluStrategy, length, typesafeTaskType, hda);
  const cacheConfig = cacheConfigFor(rawText, {
    language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy,
    taskTypeOverride: typesafeTaskType, hdaMode
  });

  return {
    provider,
    apiKeys,
    models,
    snnValues,
    resolvedStrategy,
    hdaStatus,
    cacheConfig,
    system: compressSystemSafe(rawSystem, length),
    userText: buildUserMessage(rawText, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy, hdaReport }),
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
    sendResponse({ ok: true, result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
}

// Streaming revision channel: the popup connects via
// chrome.runtime.connect({name:"revise"}) and the result streams in as "delta"
// messages while it is produced. The service worker stays awake as long as the port is open.
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
      if (globalThis.desktopAccountProvider && globalThis.desktopRevise) {
        const provider = globalThis.desktopAccountProvider;
        safePost({ type: "delta", text: "" });
        const result = await globalThis.desktopRevise(provider, plan);
        safePost({ type: "done", result, usedModel: { chatgpt: "ChatGPT account (Codex)", opencode: "OpenCode (default model)" }[provider] || "Claude account (Claude Code)",
          fellBack: false, consensus: null, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus });
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
      safePost({ type: "done", result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy, hdaStatus: plan.hdaStatus });
    } catch (error) {
      safePost({ type: "error", error: error.message || String(error) });
    } finally {
      busy = false;
    }
  });
});

