// Revision happens over the background's port channel; the popup only reads
// configuration. prompt.js/api.js must not be imported here (unnecessary load).
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
    console.error("Could not decrypt history data:", e);
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

// "Output" (language) and "Length" descriptions (shown in the UI per selection).
const LANG_DESCS = {
  auto: "Produces output in the same language as the raw text.",
  tr:   "Output is always Turkish.",
  en:   "Output is always English."
};

const LEN_DESCS = {
  kisa: "Tight and concise (~600 characters): only the core role, task, and constraints.",
  orta: "Balanced (600–1500 characters): role, task, method, and constraints.",
  uzun: "Detailed (1500–3500 characters): workflow steps, rubrics, and an example if needed.",
  maks: "Complete: all sections, verification protocol, and examples (8192 tokens)."
};

// "Development Mode" and strategy descriptions (shown in the UI per selection).
const MODE_DESCS = {
  standard:   "Balanced meta-prompt: produces a general-purpose expert prompt with role, task, method, and constraints.",
  vibecoding: "Flow-focused prompt for code generation: combines architectural intuition with engineering discipline.",
  research:   "Web/academic research prompt: adds search operators, source, and citation strategies.",
  antihallu:  "Accuracy-focused prompt: reduces hallucination with source verification and self-checking techniques."
};

const STRATEGY_DESCS = {
  vibecoding: {
    auto:        "Automatically picks the most suitable vibe strategy based on the intent in your text.",
    standard:    "Hybrid engineering: balance of structure and creativity, focused on production quality.",
    jazz:        "Improvisational flow: rapid exploration, experimental and bold solutions.",
    fractal:     "A self-repeating architecture that grows organically from a small core.",
    emotive:     "A design approach centered on user experience and emotional state.",
    hydrological:"Centers the data flow: a natural flow from source to sea, across layers.",
    alchemical:  "Focused on transforming existing code by distilling it step by step (refactor)."
  },
  research: {
    auto:          "Automatically picks the most suitable research strategy based on the intent in your text.",
    comprehensive: "Combines all search techniques into a single prompt.",
    web:           "Precise web search using Boolean operators and Google dorking.",
    academic:      "Scanning focused on Google Scholar, citation chains, and peer-reviewed sources.",
    osint:         "Queries weighted toward open-source intelligence (OSINT) techniques.",
    paywall:       "Legal access routes: open archives, preprints, institutional access.",
    literature:    "Sets up a PRISMA-style systematic literature review protocol."
  },
  antihallu: {
    auto:     "Automatically picks the most suitable technique based on the intent in your text.",
    ensemble: "Applies RAG + ReAct + CoN + CoVe techniques together.",
    rag:      "Limits the answer strictly to the provided/retrieved sources.",
    react:    "Step-by-step verification via a reasoning + tool-use loop.",
    con:      "Notes sources and filters them by reliability (Chain-of-Note).",
    cok:      "Builds a knowledge chain by dynamically gathering evidence (Chain-of-Knowledge).",
    logicot:  "Verifies each step with symbolic logic (LogiCoT).",
    cove:     "Has the model verify its own answer (Chain-of-Verification).",
    atomic:   "Splits the answer into atomic claims, maps each to a source, and revises (FActScore + RARR).",
    selfcheck: "Generates multiple independent drafts and flags inconsistent claims; on context vs. prior-knowledge conflicts, defers to the context.",
    triangulate: "Cross-verifies the code with an independent solution to the inverse/conjugate problem; abstains on a mismatch (Semantic Triangulation)."
  }
};

const REVISE_STEPS = [
  "Analyzing raw intent and target expertise…",
  "Neutralizing loaded framing…",
  "Adding honesty directive and anti-sycophancy…",
  "Structuring objective evaluation rubrics…",
  "Building systematic reasoning and thought blocks…",
  "Placing the staged workflow and variable labels…",
  "Setting constraints and structuring ROLE · TASK · METHOD…",
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
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
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
  // Encrypts and saves the given list, then refreshes the UI (single write point).
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
    const options = ['<option value="">— Pick from history —</option>'];
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
        `<button class="mp-recent-del" title="Delete this entry">✕</button>`;
      li.addEventListener("click", () => {
        rawInput.value = item.raw;
        output.value = item.result;
        if (doneMsg) doneMsg.textContent = "Loaded from history";
        showResult();
        setStatus("", "info");
      });
      li.querySelector(".mp-recent-del").addEventListener("click", (e) => {
        e.stopPropagation(); // don't trigger the row click (load)
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
        if (doneMsg) doneMsg.textContent = "In-place revision result";
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
      if (doneMsg) doneMsg.textContent = "Loaded from history";
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
      if (!confirm("Delete all revision history?")) return;
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

  // ——— Revise ———
  revizeEtBtn.addEventListener("click", async () => {
    const rawText = rawInput.value.trim();
    if (!rawText) {
      setStatus("Please select or type some text first.", "error");
      return;
    }

    const { apiKey } = await getActiveConfig();
    if (!apiKey) {
      setStatus("No API key. Add one in Settings.", "error");
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

    // Streaming revision: open a persistent port to the background and show the
    // result as it arrives in deltas.
    try {
      const port = chrome.runtime.connect({ name: "revise" });
      let streamed = "";
      let finished = false;

      port.onMessage.addListener(async (response) => {
        if (response.type === "delta") {
          if (!streamed) {
            // First chunk: open the result area, stop the step animation.
            clearInterval(stepInterval);
            stepInterval = null;
            if (doneMsg) doneMsg.textContent = "Writing…";
            showResult();
          }
          streamed += response.text;
          output.value = streamed;
          output.scrollTop = output.scrollHeight;
          if (reviseProgress) reviseProgress.style.width = "90%";
          return;
        }

        if (response.type === "checking") {
          if (doneMsg) doneMsg.textContent = "Judge model reviewing…";
          return;
        }

        clearInterval(stepInterval);
        stepInterval = null;
        finished = true;

        if (response.type === "error") {
          setStatus(response.error || "A background error occurred", "error");
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
            const judge = (consensus.judgeModel || "judge").split("/").pop();
            setStatus(`Consensus warning (${judge}):\n${consensus.issues}`, "error");
          }
        }
        if (doneMsg) {
          doneMsg.textContent = fellBack
            ? `Ready · ${shortModel} (backup)${autoLabel}${consensusLabel}${snnStats}`
            : `Ready · ${shortModel}${autoLabel}${consensusLabel}${snnStats}`;
        }

        showResult();
        await saveToHistory(rawText, result);
        resetReviseBtn();
        port.disconnect();
      });

      port.onDisconnect.addListener(() => {
        if (finished) return;
        clearInterval(stepInterval);
        stepInterval = null;
        setStatus("Lost connection to the background. Try again.", "error");
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
        rawText: rawText
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
      if (copyLabel) copyLabel.textContent = "Copied";
      setTimeout(() => {
        copyBtn.classList.remove("flash");
        if (copyLabel) copyLabel.textContent = "Copy";
      }, 1400);
      sendBrainReward(1.0); // positive LTP reward
    } catch (error) {
      setStatus(`Could not copy: ${error.message}`, "error");
    }
  });

  // ——— Write to page ———
  writePageBtn.addEventListener("click", async () => {
    if (!output.value) {
      setStatus("Generate a prompt first.", "error");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) {
      setStatus("No active tab found.", "error");
      return;
    }
    const writeLabel = writePageBtn.querySelector(".write-label");
    chrome.tabs.sendMessage(tab.id, { type: "SET_EDITABLE_TEXT", text: output.value }, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus("Could not reach the page. Refresh the page and try again.", "error");
      } else if (resp && resp.ok) {
        writePageBtn.classList.add("flash");
        if (writeLabel) writeLabel.textContent = "Written ✓";
        setTimeout(() => {
          writePageBtn.classList.remove("flash");
          if (writeLabel) writeLabel.textContent = "Write to Page";
        }, 1600);
        setStatus("", "info");
        sendBrainReward(1.0); // positive LTP reward
      } else {
        setStatus("No writable box on the page. Click a box and try again.", "error");
      }
    });
  });
});
