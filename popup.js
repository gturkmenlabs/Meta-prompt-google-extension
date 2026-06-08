import { reviseWithFailover } from "./api.js";
import { getActiveConfig } from "./config.js";
import { buildSystemPrompt, buildUserMessage, maxTokensFor } from "./prompt.js";
import { runBrainSimulation, rewardBrain } from "./brain_helper.js";

const HISTORY_KEY = "history";
const HISTORY_LIMIT = 5;

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
  const histCount      = document.getElementById("histCount");
  const reviseProgress = document.getElementById("reviseProgress");
  const btnSpin        = revizeEtBtn.querySelector(".btn-spin");
  const btnStep        = revizeEtBtn.querySelector(".btn-step");

  let stepInterval = null;

  // ——— Helpers ———
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

  // ——— Segmented length control ———
  const syncLenSeg = (val) => {
    lenSegBtns.forEach((btn) => btn.classList.toggle("on", btn.dataset.val === val));
  };

  lenSegBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      lenSelect.value = btn.dataset.val;
      lenSelect.dispatchEvent(new Event("change"));
      syncLenSeg(btn.dataset.val);
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
  const renderHistory = (history) => {
    if (!history || history.length === 0) {
      historyRow.style.display = "none";
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
    history.forEach((item) => {
      const li = document.createElement("li");
      li.className = "mp-recent-item";
      const when = item.at ? getRelTime(item.at) : "";
      li.innerHTML =
        `<span class="mp-recent-txt">${escapeHtml(item.raw.slice(0, 52).replace(/\s+/g, " "))}</span>` +
        (when ? `<span class="mp-recent-when">${when}</span>` : "");
      li.addEventListener("click", () => {
        rawInput.value = item.raw;
        output.value = item.result;
        if (doneMsg) doneMsg.textContent = "Geçmişten yüklendi";
        showResult();
        setStatus("", "info");
      });
      historyList.appendChild(li);
    });
  };

  const loadHistory = async () => {
    const { history } = await chrome.storage.local.get(HISTORY_KEY);
    renderHistory(history || []);
    return history || [];
  };

  const saveToHistory = async (raw, result) => {
    const existing = (await chrome.storage.local.get(HISTORY_KEY)).history || [];
    const next = [{ raw, result, at: Date.now() }, ...existing].slice(0, HISTORY_LIMIT);
    await chrome.storage.local.set({ [HISTORY_KEY]: next });
    renderHistory(next);
  };

  // ——— Load initial state from storage ———
  chrome.storage.local.get(
    ["selectedText", "lastInPlaceResult", "lastError", "language", "length"],
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
      chrome.storage.local.remove(["selectedText", "lastInPlaceResult", "lastError"]);
    }
  );

  // ——— Preference persistence ———
  langSelect.addEventListener("change", () =>
    chrome.storage.local.set({ language: langSelect.value })
  );
  lenSelect.addEventListener("change", () =>
    chrome.storage.local.set({ length: lenSelect.value })
  );

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
      recentHead.closest(".mp-recent").classList.toggle("open", !isOpen);
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
      rewardBrain(-1.0); // LTD penalty
    });
  }

  // ——— Revize ———
  revizeEtBtn.addEventListener("click", async () => {
    const hamMetin = rawInput.value.trim();
    if (!hamMetin) {
      setStatus("Lütfen önce bir metin seçin veya yazın.", "error");
      return;
    }

    const { provider, apiKey, model } = await getActiveConfig();
    if (!apiKey) {
      setStatus("API anahtarı yok. Ayarlar'dan ekleyin.", "error");
      return;
    }

    const language = langSelect.value;
    const length   = lenSelect.value;

    let models = [model];
    if (provider === "openrouter") {
      const working = (await chrome.storage.local.get("openrouterWorkingModels")).openrouterWorkingModels || [];
      const backups = working.map((m) => m.id).filter((id) => id && id !== model);
      models = [model, ...backups];
    }

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

    try {
      // Run biophysical SNN simulation tick before prompting
      let snnValues = null;
      try {
        const detectType = (await import("./prompt.js")).detectTaskType;
        const taskType = detectType(hamMetin);
        snnValues = await runBrainSimulation(taskType);
      } catch (snnError) {
        console.warn("SNN simulation failed, using static fallback:", snnError);
      }

      const { result, usedModel, fellBack } = await reviseWithFailover({
        provider,
        apiKey,
        models,
        system:    buildSystemPrompt(language, hamMetin, snnValues),
        userText:  buildUserMessage(hamMetin, { language, length }),
        maxTokens: maxTokensFor(length),
      });

      clearInterval(stepInterval);
      stepInterval = null;

      output.value = result;
      if (reviseProgress) reviseProgress.style.width = "100%";

      // Show shortened model name and neuromodulators in done bar
      const shortModel = usedModel.split("/").pop();
      let snnStats = "";
      if (snnValues) {
        snnStats = ` | ACh:${snnValues.ACh.toFixed(2)} NE:${snnValues.NE.toFixed(2)}`;
      }
      if (doneMsg) {
        doneMsg.textContent = fellBack
          ? `Hazır · ${shortModel} (yedek)${snnStats}`
          : `Hazır · ${shortModel}${snnStats}`;
      }

      showResult();
      await saveToHistory(hamMetin, result);
    } catch (error) {
      clearInterval(stepInterval);
      stepInterval = null;
      setStatus(error.message, "error");
    } finally {
      revizeEtBtn.disabled = false;
      revizeEtBtn.classList.remove("busy");
      if (reviseProgress) reviseProgress.style.width = "0%";
    }
  });

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
      rewardBrain(1.0); // positive LTP reward
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
        rewardBrain(1.0); // positive LTP reward
      } else {
        setStatus("Sayfada yazılabilir kutu yok. Kutuya tıklayıp tekrar deneyin.", "error");
      }
    });
  });
});
