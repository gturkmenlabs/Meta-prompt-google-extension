// Revizyon background'daki port kanali uzerinden yapilir; popup yalnizca
// yapilandirma okur. prompt.js/api.js buraya import edilmemeli (gereksiz yuk).
import { getActiveConfig } from "./config.js";


const HISTORY_KEY = "history";
const HISTORY_LIMIT = 5;

async function getOrCreateEncryptionKey() {
  const data = await chrome.storage.local.get("encryption_key");
  if (data.encryption_key) {
    return data.encryption_key;
  }
  const randomKey = Array.from({ length: 16 }, () => 
    Math.random().toString(36).substring(2, 10)
  ).join("");
  await chrome.storage.local.set({ encryption_key: randomKey });
  return randomKey;
}

function encryptText(text, key) {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(unescape(encodeURIComponent(result)));
}

function decryptText(ciphertext, key) {
  try {
    const raw = decodeURIComponent(escape(atob(ciphertext)));
    let result = "";
    for (let i = 0; i < raw.length; i++) {
      const charCode = raw.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    console.error("Geçmiş verisi çözülemedi:", e);
    return "";
  }
}

function sanitizeForHistory(text) {
  if (!text) return "";
  let cleaned = text.replace(/(sk-[a-zA-Z0-9]{20,})/g, "[API-KEY-HIDDEN]");
  cleaned = cleaned.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4})/g, "[EMAIL-HIDDEN]");
  cleaned = cleaned.replace(/(password|sifre|şifre)\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, "$1: [PASSWORD-HIDDEN]");
  return cleaned;
}

// "Çıktı" (dil) ve "Uzunluk" aciklamalari (secime gore arayuzde gosterilir).
const LANG_DESCS = {
  auto: "Ham metnin diliyle aynı dilde üretir.",
  tr:   "Çıktı her zaman Türkçe olur.",
  en:   "Çıktı her zaman İngilizce olur."
};

const LEN_DESCS = {
  kisa: "Sıkı ve öz (~600 karakter): yalnızca çekirdek rol, görev ve kısıtlamalar.",
  orta: "Dengeli (600–1500 karakter): rol, görev, yöntem ve kısıtlamalar.",
  uzun: "Ayrıntılı (1500–3500 karakter): iş akışı adımları, rubrikler, gerekirse örnek.",
  maks: "Eksiksiz: tüm bölümler, doğrulama protokolü ve örneklerle (8192 token)."
};

// "Geliştirme Modu" ve strateji aciklamalari (secime gore arayuzde gosterilir).
const MODE_DESCS = {
  standard:   "Dengeli meta-prompt: rol, görev, yöntem ve kısıtlamalarla genel amaçlı uzman prompt üretir.",
  vibecoding: "Kod üretimi için akış odaklı prompt: mimari sezgi ile mühendislik disiplinini birleştirir.",
  research:   "Web/akademik araştırma prompt'u: arama operatörleri, kaynak ve atıf stratejileri ekler.",
  antihallu:  "Doğruluk odaklı prompt: kaynak doğrulama ve kendini denetleme teknikleriyle halüsinasyonu azaltır."
};

const STRATEGY_DESCS = {
  vibecoding: {
    auto:        "Metnindeki niyete göre en uygun vibe stratejisi otomatik seçilir.",
    standard:    "Hibrit mühendislik: yapı ve yaratıcılık dengesi, üretim kalitesi odaklı.",
    jazz:        "Doğaçlama akışı: hızlı keşif, deneysel ve cesur çözümler.",
    fractal:     "Küçük bir çekirdekten organik olarak büyüyen, kendini tekrarlayan mimari.",
    emotive:     "Kullanıcı deneyimi ve duygu durumunu merkeze alan tasarım yaklaşımı.",
    hydrological:"Veri akışını merkeze alır: kaynaktan denize, katmanlar arası doğal akış.",
    alchemical:  "Mevcut kodu adım adım damıtarak dönüştürme (refactor) odaklı."
  },
  research: {
    auto:          "Metnindeki niyete göre en uygun araştırma stratejisi otomatik seçilir.",
    comprehensive: "Tüm arama tekniklerini tek prompt'ta birleştirir.",
    web:           "Boolean operatörleri ve Google dorking ile hassas web araması.",
    academic:      "Google Scholar, atıf zinciri ve hakemli kaynak odaklı tarama.",
    osint:         "Açık kaynak istihbarat (OSINT) teknikleri ağırlıklı sorgular.",
    paywall:       "Yasal erişim yolları: açık arşivler, ön baskılar, kurumsal erişim.",
    literature:    "PRISMA tarzı sistematik literatür tarama protokolü kurar."
  },
  antihallu: {
    auto:     "Metnindeki niyete göre en uygun teknik otomatik seçilir.",
    ensemble: "RAG + ReAct + CoN + CoVe tekniklerini birlikte uygular.",
    rag:      "Yanıtı yalnızca verilen/getirilen kaynaklarla sınırlar.",
    react:    "Akıl yürütme + araç kullanımı döngüsüyle adım adım doğrulama.",
    con:      "Kaynakları not alıp güvenilirliğine göre filtreler (Chain-of-Note).",
    cok:      "Dinamik kanıt toplayarak bilgi zinciri kurar (Chain-of-Knowledge).",
    logicot:  "Sembolik mantıkla her adımı doğrular (LogiCoT).",
    cove:     "Modele kendi yanıtını doğrulatır (Chain-of-Verification).",
    atomic:   "Yanıtı atomik iddialara böler, her birini kaynakla eşler ve revize eder (FActScore + RARR).",
    selfcheck: "Çoklu bağımsız taslak üretip tutarsız iddiaları işaretler; bağlam-önbilgi çelişkisinde bağlamı esas alır.",
    triangulate: "Kodu, ters/eşlenik problemin bağımsız çözümüyle çapraz doğrular; uyuşmazsa çekimser kalır (Semantik Triangülasyon)."
  }
};

const REVISE_STEPS = [
  "Ham niyet ve hedef uzmanlık analiz ediliyor…",
  "Yüklü çerçeveleme nötralize ediliyor…",
  "Dürüstlük talimatı ve anti-sycophancy ekleniyor…",
  "Nesnel değerlendirme rubrikleri yapılandırılıyor…",
  "Sistematik muhakeme ve düşünce blokları kuruluyor…",
  "Aşamalı iş akışı ve değişken etiketleri yerleştiriliyor…",
  "Kısıtlamalar belirlenip ROL · GÖREV · YÖNTEM yapılandırılıyor…",
];

document.addEventListener("DOMContentLoaded", () => {
  // ——— DOM refs (original) ———
  const rawInput       = document.getElementById("rawInput");
  const output         = document.getElementById("output");
  const revizeEtBtn    = document.getElementById("revizeEtBtn");
  const copyBtn        = document.getElementById("copyBtn");
  const writePageBtn   = document.getElementById("writePageBtn");
  const settingsLink   = document.getElementById("settingsLink");
  const status         = document.getElementById("status");
  const langSelect     = document.getElementById("langSelect");
  const lenSelect      = document.getElementById("lenSelect");
  const historyRow     = document.getElementById("historyRow");
  const historySelect  = document.getElementById("historySelect");
  const modeSelect     = document.getElementById("modeSelect");
  const modeSeg        = document.getElementById("modeSeg");
  const modeSegBtns    = modeSeg ? modeSeg.querySelectorAll(".mp-seg-btn") : [];
  const vibeStrategySelect = document.getElementById("vibeStrategySelect");
  const researchStrategySelect = document.getElementById("researchStrategySelect");
  const antihalluStrategySelect = document.getElementById("antihalluStrategySelect");
  const langDesc = document.getElementById("langDesc");
  const lenDesc = document.getElementById("lenDesc");
  const modeDesc = document.getElementById("modeDesc");
  const strategyDescEls = {
    vibecoding: document.getElementById("vibeStrategyDesc"),
    research:   document.getElementById("researchStrategyDesc"),
    antihallu:  document.getElementById("antihalluStrategyDesc")
  };
  const strategySelects = {
    vibecoding: vibeStrategySelect,
    research:   researchStrategySelect,
    antihallu:  antihalluStrategySelect
  };

  // ——— DOM refs (new UI) ———
  const resultSection  = document.getElementById("resultSection");
  const doneBar        = document.getElementById("doneBar");
  const doneMsg        = document.getElementById("doneMsg");
  const redoBtn        = document.getElementById("redoBtn");
  const fromPagePill   = document.getElementById("fromPagePill");
  const lenSeg         = document.getElementById("lenSeg");
  const lenSegBtns     = lenSeg ? lenSeg.querySelectorAll(".mp-seg-btn") : [];
  const recentHead     = document.getElementById("recentHead");
  const historyList    = document.getElementById("historyList");
  const histClearBtn   = document.getElementById("histClearBtn");
  const histCount      = document.getElementById("histCount");
  const reviseProgress = document.getElementById("reviseProgress");
  const btnSpin        = revizeEtBtn.querySelector(".btn-spin");
  const btnStep        = revizeEtBtn.querySelector(".btn-step");

  let stepInterval = null;

  // ——— Helpers ———
  const sendBrainReward = (val) => {
    chrome.runtime.sendMessage({ type: "REWARD_BRAIN", rewardVal: val });
  };
  const setStatus = (message, kind = "info") => {
    status.textContent = message;
    status.className = "mp-status" + (message ? " " + kind : "");
  };

  const escapeHtml = (text) =>
    String(text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  const getRelTime = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1) return "Az önce";
    if (m < 60) return `${m}d önce`;
    if (h < 24) return `${h}s önce`;
    return `${d}g önce`;
  };

  // ——— Output (language/length) descriptions ———
  const updateOutputDescs = () => {
    if (langDesc) langDesc.textContent = LANG_DESCS[langSelect.value] || "";
    if (lenDesc) lenDesc.textContent = LEN_DESCS[lenSelect.value] || "";
  };

  // ——— Segmented length control ———
  const syncLenSeg = (val) => {
    lenSegBtns.forEach((btn) => btn.classList.toggle("on", btn.dataset.val === val));
    updateOutputDescs();
  };

  lenSegBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      lenSelect.value = btn.dataset.val;
      lenSelect.dispatchEvent(new Event("change"));
      syncLenSeg(btn.dataset.val);
    });
  });

  // ——— Mode / strategy descriptions ———
  const updateModeDescs = () => {
    const mode = modeSelect.value;
    if (modeDesc) modeDesc.textContent = MODE_DESCS[mode] || "";
    Object.keys(strategyDescEls).forEach((m) => {
      const el = strategyDescEls[m];
      const sel = strategySelects[m];
      if (el && sel) el.textContent = (STRATEGY_DESCS[m] || {})[sel.value] || "";
    });
  };

  // ——— Segmented mode control ———
  const syncModeSeg = (val) => {
    modeSegBtns.forEach((btn) => btn.classList.toggle("on", btn.dataset.val === val));
    const vibeControls = document.getElementById("vibeStrategyControls");
    if (vibeControls) {
      vibeControls.style.display = val === "vibecoding" ? "grid" : "none";
    }
    const researchControls = document.getElementById("researchStrategyControls");
    if (researchControls) {
      researchControls.style.display = val === "research" ? "grid" : "none";
    }
    const antihalluControls = document.getElementById("antihalluStrategyControls");
    if (antihalluControls) {
      antihalluControls.style.display = val === "antihallu" ? "grid" : "none";
    }
    updateModeDescs();
  };

  modeSegBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeSelect.value = btn.dataset.val;
      modeSelect.dispatchEvent(new Event("change"));
      syncModeSeg(btn.dataset.val);
    });
  });

  // ——— Result show/hide ———
  const showResult = () => {
    resultSection.style.display = "block";
    doneBar.style.display = "flex";
    revizeEtBtn.style.display = "none";
  };

  const hideResult = () => {
    resultSection.style.display = "none";
    doneBar.style.display = "none";
    revizeEtBtn.style.display = "";
  };

  // ——— History ———
  // Verilen listeyi sifreleyip kaydeder ve arayuzu tazeler (tek kayit noktasi).
  const persistHistory = async (items) => {
    const key = await getOrCreateEncryptionKey();
    const encryptedHistory = items.map((item) => ({
      encryptedData: encryptText(JSON.stringify(item), key)
    }));
    await chrome.storage.local.set({ [HISTORY_KEY]: encryptedHistory });
    renderHistory(items);
  };

  const deleteHistoryItem = async (index) => {
    const history = await loadHistory();
    history.splice(index, 1);
    await persistHistory(history);
  };

  const renderHistory = (history) => {
    if (!history || history.length === 0) {
      historyRow.style.display = "none";
      if (histClearBtn) histClearBtn.style.display = "none";
      return;
    }
    historyRow.style.display = "block";
    if (histCount) histCount.textContent = history.length;

    // Keep hidden select in sync (used by legacy change handler below)
    const options = ['<option value="">— Gecmisten sec —</option>'];
    history.forEach((item, index) => {
      const preview = escapeHtml(item.raw.slice(0, 40).replace(/\s+/g, " "));
      options.push(`<option value="${index}">${preview}…</option>`);
    });
    historySelect.innerHTML = options.join("");

    // Render custom visual list
    if (!historyList) return;
    historyList.innerHTML = "";
    history.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "mp-recent-item";
      const when = item.at ? getRelTime(item.at) : "";
      li.innerHTML =
        `<span class="mp-recent-txt">${escapeHtml(item.raw.slice(0, 52).replace(/\s+/g, " "))}</span>` +
        (when ? `<span class="mp-recent-when">${when}</span>` : "") +
        `<button class="mp-recent-del" title="Bu kaydı sil">✕</button>`;
      li.addEventListener("click", () => {
        rawInput.value = item.raw;
        output.value = item.result;
        if (doneMsg) doneMsg.textContent = "Geçmişten yüklendi";
        showResult();
        setStatus("", "info");
      });
      li.querySelector(".mp-recent-del").addEventListener("click", (e) => {
        e.stopPropagation(); // satira tiklama (yukleme) tetiklenmesin
        deleteHistoryItem(index);
      });
      historyList.appendChild(li);
    });
  };

  const loadHistory = async () => {
    const key = await getOrCreateEncryptionKey();
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const encryptedHistory = data[HISTORY_KEY] || [];
    const decryptedHistory = encryptedHistory.map(item => {
      const rawDecrypted = decryptText(item.encryptedData || "", key);
      try {
        return JSON.parse(rawDecrypted);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
    
    renderHistory(decryptedHistory);
    return decryptedHistory;
  };

  const saveToHistory = async (raw, result) => {
    const existing = await loadHistory();
    const newItem = {
      raw: sanitizeForHistory(raw),
      result: sanitizeForHistory(result),
      at: Date.now()
    };
    await persistHistory([newItem, ...existing].slice(0, HISTORY_LIMIT));
  };

  // ——— Load initial state from storage ———
  chrome.storage.local.get(
    ["selectedText", "lastInPlaceResult", "lastError", "language", "length", "mode", "vibeStrategy", "researchStrategy", "antihalluStrategy", "consensusCheck"],
    (data) => {
      if (data.selectedText) {
        rawInput.value = data.selectedText;
        if (fromPagePill) fromPagePill.style.display = "inline-flex";
      }
      if (data.lastInPlaceResult) {
        output.value = data.lastInPlaceResult;
        if (doneMsg) doneMsg.textContent = "Yerinde revize sonucu";
        showResult();
      }
      if (data.lastError) setStatus(data.lastError, "error");
      if (data.language) langSelect.value = data.language;
      if (data.length) {
        lenSelect.value = data.length;
        syncLenSeg(data.length);
      }
      if (data.mode) {
        modeSelect.value = data.mode;
        syncModeSeg(data.mode);
      }
      if (data.researchStrategy && researchStrategySelect) {
        researchStrategySelect.value = data.researchStrategy;
      }
      if (data.antihalluStrategy && antihalluStrategySelect) {
        antihalluStrategySelect.value = data.antihalluStrategy;
      }
      if (data.vibeStrategy && vibeStrategySelect) {
        vibeStrategySelect.value = data.vibeStrategy;
      }
      const consensusToggle = document.getElementById("consensusCheckToggle");
      if (consensusToggle) consensusToggle.checked = !!data.consensusCheck;
      updateModeDescs();
      updateOutputDescs();
      chrome.storage.local.remove(["selectedText", "lastInPlaceResult", "lastError"]);
    }
  );

  // ——— Preference persistence ———
  langSelect.addEventListener("change", () => {
    chrome.storage.local.set({ language: langSelect.value });
    updateOutputDescs();
  });
  lenSelect.addEventListener("change", () =>
    chrome.storage.local.set({ length: lenSelect.value })
  );
  modeSelect.addEventListener("change", () =>
    chrome.storage.local.set({ mode: modeSelect.value })
  );
  if (researchStrategySelect) {
    researchStrategySelect.addEventListener("change", () => {
      chrome.storage.local.set({ researchStrategy: researchStrategySelect.value });
      updateModeDescs();
    });
  }
  if (antihalluStrategySelect) {
    antihalluStrategySelect.addEventListener("change", () => {
      chrome.storage.local.set({ antihalluStrategy: antihalluStrategySelect.value });
      updateModeDescs();
    });
  }
  if (vibeStrategySelect) {
    vibeStrategySelect.addEventListener("change", () => {
      chrome.storage.local.set({ vibeStrategy: vibeStrategySelect.value });
      updateModeDescs();
    });
  }
  const consensusCheckToggle = document.getElementById("consensusCheckToggle");
  if (consensusCheckToggle) {
    consensusCheckToggle.addEventListener("change", () =>
      chrome.storage.local.set({ consensusCheck: consensusCheckToggle.checked })
    );
  }

  loadHistory();

  // Legacy hidden-select change (still fires if anything uses it)
  historySelect.addEventListener("change", async () => {
    const index = historySelect.value;
    if (index === "") return;
    const history = await loadHistory();
    const item = history[Number(index)];
    if (item) {
      rawInput.value = item.raw;
      output.value = item.result;
      if (doneMsg) doneMsg.textContent = "Geçmişten yüklendi";
      showResult();
      setStatus("", "info");
    }
  });

  // ——— Recent revisions toggle ———
  if (recentHead) {
    recentHead.addEventListener("click", () => {
      if (!historyList) return;
      const isOpen = historyList.style.display !== "none";
      historyList.style.display = isOpen ? "none" : "flex";
      if (histClearBtn) histClearBtn.style.display = isOpen ? "none" : "block";
      recentHead.closest(".mp-recent").classList.toggle("open", !isOpen);
    });
  }

  // ——— Clear all history ———
  if (histClearBtn) {
    histClearBtn.addEventListener("click", async () => {
      if (!confirm("Tüm revizyon geçmişi silinsin mi?")) return;
      await persistHistory([]);
    });
  }

  // ——— Settings ———
  settingsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());

  // ——— Redo ———
  if (redoBtn) {
    redoBtn.addEventListener("click", () => {
      output.value = "";
      hideResult();
      setStatus("", "info");
      sendBrainReward(-1.0); // LTD penalty
    });
  }

  // ——— Revize ———
  revizeEtBtn.addEventListener("click", async () => {
    const hamMetin = rawInput.value.trim();
    if (!hamMetin) {
      setStatus("Lütfen önce bir metin seçin veya yazın.", "error");
      return;
    }

    const { apiKey } = await getActiveConfig();
    if (!apiKey) {
      setStatus("API anahtarı yok. Ayarlar'dan ekleyin.", "error");
      return;
    }

    const language = langSelect.value;
    const length   = lenSelect.value;
    const mode     = modeSelect.value;
    const vibeStrategy = vibeStrategySelect ? vibeStrategySelect.value : "auto";
    const researchStrategy = researchStrategySelect ? researchStrategySelect.value : "auto";
    const antihalluStrategy = antihalluStrategySelect ? antihalluStrategySelect.value : "auto";

    // Start busy state
    revizeEtBtn.disabled = true;
    revizeEtBtn.classList.add("busy");
    output.value = "";
    setStatus("", "info");

    // Step animation
    let stepIdx = 0;
    if (btnStep) btnStep.textContent = REVISE_STEPS[0];
    if (reviseProgress) reviseProgress.style.width = "5%";
    if (stepInterval) clearInterval(stepInterval);
    stepInterval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, REVISE_STEPS.length - 1);
      if (btnStep) btnStep.textContent = REVISE_STEPS[stepIdx];
      const pct = 10 + ((stepIdx + 1) / REVISE_STEPS.length) * 72;
      if (reviseProgress) reviseProgress.style.width = pct + "%";
    }, 550);

    // Akisli revizyon: background ile kalici port ac, sonucu delta'lar
    // halinde geldikce goster.
    try {
      const port = chrome.runtime.connect({ name: "revise" });
      let streamed = "";
      let finished = false;

      port.onMessage.addListener(async (response) => {
        if (response.type === "delta") {
          if (!streamed) {
            // Ilk parca: sonuc alanini ac, adim animasyonunu durdur.
            clearInterval(stepInterval);
            stepInterval = null;
            if (doneMsg) doneMsg.textContent = "Yazılıyor…";
            showResult();
          }
          streamed += response.text;
          output.value = streamed;
          output.scrollTop = output.scrollHeight;
          if (reviseProgress) reviseProgress.style.width = "90%";
          return;
        }

        if (response.type === "checking") {
          if (doneMsg) doneMsg.textContent = "Hakem model denetliyor…";
          return;
        }

        clearInterval(stepInterval);
        stepInterval = null;
        finished = true;

        if (response.type === "error") {
          setStatus(response.error || "Arka plan hatası oluştu", "error");
          if (!streamed) hideResult();
          resetReviseBtn();
          port.disconnect();
          return;
        }

        // done
        const { result, usedModel, fellBack, consensus, snnValues, resolvedStrategy } = response;
        output.value = result;
        if (reviseProgress) reviseProgress.style.width = "100%";

        const shortModel = usedModel.split("/").pop();
        let snnStats = "";
        if (snnValues) {
          snnStats = ` | ACh:${snnValues.ACh.toFixed(2)} NE:${snnValues.NE.toFixed(2)}`;
        }
        const isAutoChosen = mode !== "standard" && resolvedStrategy &&
          ((mode === "vibecoding"  && vibeStrategy      === "auto") ||
           (mode === "research"    && researchStrategy  === "auto") ||
           (mode === "antihallu"   && antihalluStrategy === "auto"));
        const autoLabel = isAutoChosen ? ` · auto→${resolvedStrategy}` : "";
        let consensusLabel = "";
        if (consensus) {
          if (consensus.status === "ok") {
            consensusLabel = ` · ✓✓ ${(consensus.judgeModel || "").split("/").pop()}`;
          } else if (consensus.status === "issues") {
            const judge = (consensus.judgeModel || "hakem").split("/").pop();
            setStatus(`Konsensüs uyarısı (${judge}):\n${consensus.issues}`, "error");
          }
        }
        if (doneMsg) {
          doneMsg.textContent = fellBack
            ? `Hazır · ${shortModel} (yedek)${autoLabel}${consensusLabel}${snnStats}`
            : `Hazır · ${shortModel}${autoLabel}${consensusLabel}${snnStats}`;
        }

        showResult();
        await saveToHistory(hamMetin, result);
        resetReviseBtn();
        port.disconnect();
      });

      port.onDisconnect.addListener(() => {
        if (finished) return;
        clearInterval(stepInterval);
        stepInterval = null;
        setStatus("Arka planla bağlantı koptu. Tekrar deneyin.", "error");
        if (!streamed) hideResult();
        resetReviseBtn();
      });

      port.postMessage({
        type: "REVISE_PROMPT_STREAM",
        language,
        length,
        mode,
        vibeStrategy,
        researchStrategy,
        antihalluStrategy,
        rawText: hamMetin
      });
    } catch (error) {
      clearInterval(stepInterval);
      stepInterval = null;
      setStatus(error.message, "error");
      resetReviseBtn();
    }
  });

  function resetReviseBtn() {
    revizeEtBtn.disabled = false;
    revizeEtBtn.classList.remove("busy");
    if (reviseProgress) reviseProgress.style.width = "0%";
  }

  // ——— Copy ———
  copyBtn.addEventListener("click", async () => {
    if (!output.value) return;
    const copyLabel = copyBtn.querySelector(".copy-label");
    try {
      await navigator.clipboard.writeText(output.value);
      copyBtn.classList.add("flash");
      if (copyLabel) copyLabel.textContent = "Kopyalandı";
      setTimeout(() => {
        copyBtn.classList.remove("flash");
        if (copyLabel) copyLabel.textContent = "Kopyala";
      }, 1400);
      sendBrainReward(1.0); // positive LTP reward
    } catch (error) {
      setStatus(`Kopyalanamadı: ${error.message}`, "error");
    }
  });

  // ——— Write to page ———
  writePageBtn.addEventListener("click", async () => {
    if (!output.value) {
      setStatus("Önce bir prompt üretin.", "error");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) {
      setStatus("Aktif sekme bulunamadı.", "error");
      return;
    }
    const writeLabel = writePageBtn.querySelector(".write-label");
    chrome.tabs.sendMessage(tab.id, { type: "SET_EDITABLE_TEXT", text: output.value }, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus("Sayfaya ulaşılamadı. Sayfayı yenileyip tekrar deneyin.", "error");
      } else if (resp && resp.ok) {
        writePageBtn.classList.add("flash");
        if (writeLabel) writeLabel.textContent = "Yazıldı ✓";
        setTimeout(() => {
          writePageBtn.classList.remove("flash");
          if (writeLabel) writeLabel.textContent = "Sayfaya Yaz";
        }, 1600);
        setStatus("", "info");
        sendBrainReward(1.0); // positive LTP reward
      } else {
        setStatus("Sayfada yazılabilir kutu yok. Kutuya tıklayıp tekrar deneyin.", "error");
      }
    });
  });
});
