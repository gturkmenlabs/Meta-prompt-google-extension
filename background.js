// Sag tik menulerini kurar.
//  - "popup'a gonder": secili metni popup'in okuyacagi yere kaydeder.
//  - "yerinde revize": aktif metin kutusunu okur, API ile revize eder ve geri yazar.

import { reviseWithFailover, reviseStreamWithFailover } from "./api.js";
import { getFailoverConfig } from "./config.js";
import { buildSystemPrompt, buildUserMessage, buildConsensusJudgeMessages, maxTokensFor, detectTaskType, resolveAutoStrategy } from "./prompt.js";
import { runBrainSimulation } from "./brain_helper.js";

const MENU_TO_POPUP = "revizeMetaPrompt";
const MENU_INPLACE = "revizeInPlace";
const MENU_UNDO = "revizeUndo";

chrome.runtime.onInstalled.addListener(() => {
  // Mevcut menüleri temizle (duplicate id hatasını engeller).
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TO_POPUP,
      title: "Metni Meta-Prompt Motoruna gonder (popup)",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_INPLACE,
      title: "Bu kutuyu Meta-Prompt ile revize et (yerine yaz)",
      contexts: ["editable", "selection"]
    });
    chrome.contextMenus.create({
      id: MENU_UNDO,
      title: "Son revizyonu geri al",
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

// Klavye kisayollari (varsayilan: revize Ctrl/Cmd+Shift+L, geri al Ctrl/Cmd+Shift+U).
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

// Son yerinde revizyonu geri alir; orijinal metin content script'te saklanir.
async function undoInPlace(tab) {
  if (!tab || tab.id == null) return;
  const tabId = tab.id;
  const restored = await sendToTab(tabId, { type: "RESTORE_EDITABLE_TEXT" });
  if (restored && restored.ok) {
    setBadge(tabId, "↩", "#5f6368");
    // Geri alma, sonucun begenilmedigi sinyali: negatif odul uygula.
    try {
      const { rewardBrain } = await import("./brain_helper.js");
      await rewardBrain(-1.0);
    } catch (_) {}
  } else {
    setBadge(tabId, "?", "#d93025");
    chrome.storage.local.set({ lastError: "Geri alinacak revizyon yok (ayni sayfada bir revizyon yapilmis olmali)." });
  }
  clearBadgeLater(tabId);
}

// content script'e mesaj gonderir; hata olursa null doner (sayfa enjekte
// edilememis olabilir).
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

// Capraz-model konsensus denetimi: uretilen promptu, ureten modelden FARKLI
// bir modele hakem olarak denetletir. consensusCheck kapali ise null doner.
// Hata/eksik alternatif model durumlari "skipped" olarak raporlanir — ana
// akisi asla bozmaz.
async function runConsensusCheck({ provider, apiKeys, models, usedModel, rawText, result }) {
  try {
    const { consensusCheck } = await chrome.storage.local.get("consensusCheck");
    if (!consensusCheck) return null;
    const judgeModels = (models || []).filter((m) => m !== usedModel);
    if (!judgeModels.length) return { status: "skipped", reason: "Hakemlik için farklı model yok" };
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

    // 1) Metni al: once aktif kutu, yoksa secili metin.
    const got = await sendToTab(tabId, { type: "GET_EDITABLE_TEXT" });
    let text = (got && got.text) || selectionText || "";
    text = text.trim();
    if (!text) {
      setBadge(tabId, "?", "#d93025");
      chrome.storage.local.set({ lastError: "Revize edilecek metin bulunamadi (kutuya yazip tekrar deneyin)." });
      clearBadgeLater(tabId);
      return;
    }

    // 2) Yapilandirma (aktif model + capraz saglayici yedek listesi).
    const { provider, apiKey, apiKeys, models } = await getFailoverConfig();
    if (!apiKey) {
      setBadge(tabId, "key", "#d93025");
      chrome.storage.local.set({ lastError: "API anahtari yok. Ayarlar'dan girin." });
      clearBadgeLater(tabId);
      return;
    }

    // Popup'ta secilen dil/uzunluk/Gelistirme Modu tercihleri (yoksa varsayilan).
    // Boylece kisayol/sag-tik yolu da popup ile ayni modu kullanir.
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

    // 4) Revize et — akisli: sonuc uretildikce kutuya yazilir.
    // Ara yazimlar ~150ms'de bir TAM birikmis metinle yapilir (fire-and-forget);
    // ilk basarisiz yazimda akis-yazimi birakilir, sonuc en sonda kopya yoluna duser.
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
          streamWrite(acc, false); // beklemeden devam; siralama tab basina FIFO
        }
      }
    });

    // 5) Son yazim: tam sonuc + done=true (undo durumunu baglar).
    const wroteOk = !writeBroken && await streamWrite(result, true);
    if (wroteOk) {
      setBadge(tabId, "✓", "#34a853");
      try {
        const { rewardBrain } = await import("./brain_helper.js");
        await rewardBrain(1.0);
      } catch (_) {}
      // Istege bagli capraz-model konsensus: hakem sorun bulursa "≠" rozeti
      // goster ve bulgulari lastError'a yaz (popup'tan okunabilir).
      const consensus = await runConsensusCheck({ provider, apiKeys, models, usedModel, rawText: text, result });
      if (consensus && consensus.status === "issues") {
        setBadge(tabId, "≠", "#f9ab00");
        chrome.storage.local.set({ lastError: `Konsensüs uyarısı (${consensus.judgeModel}):\n${consensus.issues}` });
      }
    } else {
      // Kutuya yazilamadi: sonucu sakla, popup'tan kopyalanabilir.
      chrome.storage.local.set({ selectedText: text, lastInPlaceResult: result });
      setBadge(tabId, "kopya", "#f9ab00");
    }
  } catch (error) {
    chrome.storage.local.set({ lastError: String((error && error.message) || error) });
    setBadge(tabId, "hata", "#d93025");
  } finally {
    clearBadgeLater(tabId);
  }
}

// Arka planda prompt revizyonu gerçekleştiren mesaj dinleyicisi.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "REVISE_PROMPT") {
    handleRevisePromptMessage(message, sendResponse);
    return true; // asenkron yanit verilecegini belirtir
  }
  if (message.type === "REWARD_BRAIN") {
    handleRewardBrainMessage(message, sendResponse);
    return true; // asenkron yanit verilecegini belirtir
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

// REVISE_PROMPT / akis yolu icin ortak hazirlik: stratejileri coz, SNN'i
// calistir, saglayici/model plani ve prompt'lari kur.
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

// Akisli revizyon kanali: popup chrome.runtime.connect({name:"revise"}) ile
// baglanir, sonuc uretildikce "delta" mesajlariyla akar. Port acik kaldigi
// surece service worker uyumaz.
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

