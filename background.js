// Sag tik menulerini kurar.
//  - "popup'a gonder": secili metni popup'in okuyacagi yere kaydeder.
//  - "yerinde revize": aktif metin kutusunu okur, API ile revize eder ve geri yazar.

import { reviseWithFailover } from "./api.js";
import { getActiveConfig } from "./config.js";
import { buildSystemPrompt, buildUserMessage, maxTokensFor, detectTaskType } from "./prompt.js";
import { runBrainSimulation } from "./brain_helper.js";

const MENU_TO_POPUP = "revizeMetaPrompt";
const MENU_INPLACE = "revizeInPlace";

chrome.runtime.onInstalled.addListener(() => {
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
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_TO_POPUP) {
    const text = (info.selectionText || "").trim();
    if (text) chrome.storage.local.set({ selectedText: text });
    return;
  }
  if (info.menuItemId === MENU_INPLACE) {
    reviseInPlace(tab, info.selectionText || "");
  }
});

// Klavye kisayolu (varsayilan: Ctrl/Command+Shift+L).
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "revise-in-place") return;
  let target = tab;
  if (!target || target.id == null) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    target = active;
  }
  if (target) reviseInPlace(target, "");
});

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

    // 2) Yapilandirma.
    const { provider, apiKey, model } = await getActiveConfig();
    if (!apiKey) {
      setBadge(tabId, "key", "#d93025");
      chrome.storage.local.set({ lastError: "API anahtari yok. Ayarlar'dan girin." });
      clearBadgeLater(tabId);
      return;
    }

    // OpenRouter'da failover icin dogrulanmis calisan modelleri yedek ekle.
    let models = [model];
    if (provider === "openrouter") {
      const working = (await chrome.storage.local.get("openrouterWorkingModels")).openrouterWorkingModels || [];
      models = [model, ...working.map((m) => m.id).filter((id) => id && id !== model)];
    }

    // Popup'ta secilen dil/uzunluk tercihleri (yoksa varsayilan).
    const prefs = await chrome.storage.local.get(["language", "length"]);
    const language = prefs.language || "auto";
    const length = prefs.length || "orta";

    // 3) Run biophysical SNN simulation tick
    let snnValues = null;
    try {
      const taskType = detectTaskType(text);
      snnValues = await runBrainSimulation(taskType);
    } catch (snnError) {
      console.warn("SNN simulation failed, using static fallback:", snnError);
    }

    // 4) Revize et.
    const { result } = await reviseWithFailover({
      provider,
      apiKey,
      models,
      system: buildSystemPrompt(language, text, snnValues),
      userText: buildUserMessage(text, { language, length }),
      maxTokens: maxTokensFor(length)
    });

    // 5) Kutuya geri yaz.
    const wrote = await sendToTab(tabId, { type: "SET_EDITABLE_TEXT", text: result });
    if (wrote && wrote.ok) {
      setBadge(tabId, "✓", "#34a853");
      try {
        const { rewardBrain } = await import("./brain_helper.js");
        await rewardBrain(1.0);
      } catch (_) {}
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
