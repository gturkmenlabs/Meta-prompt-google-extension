// Sets up the right-click context menus.
//  - "send to popup": stores the selected text where the popup will read it.
//  - "revise in place": reads the active text box, revises it via the API, and writes it back.

import { reviseWithFailover, reviseStreamWithFailover } from "./api.js";
import { getFailoverConfig } from "./config.js";
import { buildSystemPrompt, buildUserMessage, buildConsensusJudgeMessages, maxTokensFor, detectTaskType, resolveAutoStrategy } from "./prompt.js";
import { runBrainSimulation } from "./brain_helper.js";

const MENU_TO_POPUP = "revizeMetaPrompt";
const MENU_INPLACE = "revizeInPlace";
const MENU_UNDO = "revizeUndo";

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
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text, tabId });
}

function clearBadgeLater(tabId, ms = 4000) {
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }), ms);
}

// Cross-model consensus check: has a model DIFFERENT from the producing model
// review the generated prompt as a judge. Returns null if consensusCheck is off.
// Errors / missing alternative model cases are reported as "skipped" — they
// never break the main flow.
async function runConsensusCheck({ provider, apiKeys, models, usedModel, rawText, result }) {
  try {
    const { consensusCheck } = await chrome.storage.local.get("consensusCheck");
    if (!consensusCheck) return null;
    const judgeModels = (models || []).filter((m) => m !== usedModel);
    if (!judgeModels.length) return { status: "skipped", reason: "No different model available to judge" };
    const { system, userText } = buildConsensusJudgeMessages(rawText, result);
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
  if (!tab || tab.id == null) return;
  const tabId = tab.id;

  try {
    setBadge(tabId, "…", "#1a73e8");

    // 1) Get the text: active box first, otherwise the selected text.
    const got = await sendToTab(tabId, { type: "GET_EDITABLE_TEXT" });
    let text = (got && got.text) || selectionText || "";
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
    const language = prefs.language || "auto";
    const length = prefs.length || "orta";
    const mode = prefs.mode || "standard";
    const vibeStrategy      = resolveAutoStrategy("vibecoding", prefs.vibeStrategy      || "auto", text);
    const researchStrategy  = resolveAutoStrategy("research",   prefs.researchStrategy  || "auto", text);
    const antihalluStrategy = resolveAutoStrategy("antihallu",  prefs.antihalluStrategy || "auto", text);

    // 3) Run biophysical SNN simulation tick
    let snnValues = null;
    try {
      const taskType = mode === "vibecoding"
        ? `vibecoding_${vibeStrategy}`
        : mode === "research"
          ? `research_${researchStrategy || "comprehensive"}`
          : mode === "antihallu"
            ? `antihallu_${antihalluStrategy || "ensemble"}`
            : detectTaskType(text);
      snnValues = await runBrainSimulation(taskType);
    } catch (snnError) {
      console.warn("SNN simulation failed, using static fallback:", snnError);
    }

    // 4) Revise — streaming: the result is written to the box as it is generated.
    // Intermediate writes happen ~every 150ms with the FULL accumulated text (fire-and-forget);
    // on the first failed write, stream-writing is abandoned and the result falls back to the copy path at the end.
    let acc = "";
    let lastWriteAt = 0;
    let writeBroken = false;
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
      system: buildSystemPrompt(language, text, snnValues, mode, vibeStrategy, researchStrategy, antihalluStrategy, length),
      userText: buildUserMessage(text, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy }),
      maxTokens: maxTokensFor(length),
      onDelta: (chunk) => {
        acc += chunk;
        const now = Date.now();
        if (!writeBroken && now - lastWriteAt >= 150) {
          lastWriteAt = now;
          streamWrite(acc, false); // continue without awaiting; ordering is FIFO per tab
        }
      }
    });

    // 5) Final write: full result + done=true (binds the undo state).
    const wroteOk = !writeBroken && await streamWrite(result, true);
    if (wroteOk) {
      setBadge(tabId, "✓", "#34a853");
      try {
        const { rewardBrain } = await import("./brain_helper.js");
        await rewardBrain(1.0);
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
    chrome.storage.local.set({ lastError: String((error && error.message) || error) });
    setBadge(tabId, "err", "#d93025");
  } finally {
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
    const { rewardBrain } = await import("./brain_helper.js");
    await rewardBrain(rewardVal);
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || String(error) });
  }
}

// Shared preparation for the REVISE_PROMPT / stream path: resolve strategies,
// run the SNN, and build the provider/model plan and the prompts.
async function prepareRevision(message) {
  const { language, length, mode, rawText } = message;
  // Auto-resolve sub-strategies based on raw text intent when "auto" or absent.
  const vibeStrategy      = resolveAutoStrategy("vibecoding", message.vibeStrategy      || "auto", rawText);
  const researchStrategy  = resolveAutoStrategy("research",   message.researchStrategy  || "auto", rawText);
  const antihalluStrategy = resolveAutoStrategy("antihallu",  message.antihalluStrategy || "auto", rawText);

  const { provider, apiKeys, models } = await getFailoverConfig();

  let snnValues = null;
  try {
    const taskType = mode === "vibecoding"
      ? `vibecoding_${vibeStrategy}`
      : mode === "research"
        ? `research_${researchStrategy || "comprehensive"}`
        : mode === "antihallu"
          ? `antihallu_${antihalluStrategy || "ensemble"}`
          : detectTaskType(rawText);
    snnValues = await runBrainSimulation(taskType);
  } catch (snnError) {
    console.warn("Background SNN simulation failed:", snnError);
  }

  const resolvedStrategy = mode === "vibecoding" ? vibeStrategy
    : mode === "research" ? researchStrategy
    : mode === "antihallu" ? antihalluStrategy
    : null;

  return {
    provider,
    apiKeys,
    models,
    snnValues,
    resolvedStrategy,
    system: buildSystemPrompt(language, rawText, snnValues, mode, vibeStrategy, researchStrategy, antihalluStrategy, length),
    userText: buildUserMessage(rawText, { language, length, mode, vibeStrategy, researchStrategy, antihalluStrategy }),
    maxTokens: maxTokensFor(length)
  };
}

async function handleRevisePromptMessage(message, sendResponse) {
  try {
    const plan = await prepareRevision(message);
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
    sendResponse({ ok: true, result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy });
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
  port.onDisconnect.addListener(() => { disconnected = true; });
  const safePost = (msg) => {
    if (disconnected) return;
    try { port.postMessage(msg); } catch (_) { disconnected = true; }
  };

  port.onMessage.addListener(async (message) => {
    if (message.type !== "REVISE_PROMPT_STREAM") return;
    try {
      const plan = await prepareRevision(message);
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
      safePost({ type: "done", result, usedModel, fellBack, consensus, snnValues: plan.snnValues, resolvedStrategy: plan.resolvedStrategy });
    } catch (error) {
      safePost({ type: "error", error: error.message || String(error) });
    }
  });
});

