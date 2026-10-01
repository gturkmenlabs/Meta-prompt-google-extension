// Studio page logic (index.html). Revision happens over the engine's port
// channel (engine.js); this file only reads configuration. prompt.js/api.js must not be imported here (unnecessary load).
import { getActiveConfig, PROVIDERS } from "./config.js";
import { sanitizeForHistory } from "./redact.js";
import { extractPlaceholders, fillPlaceholders, countUnfilled, humanizePlaceholder, proposeValue, rememberValues, PLACEHOLDER_MEMORY_KEY } from "./placeholders.js";


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
  antihallu:  "Accuracy-focused prompt: reduces hallucination with source verification and self-checking techniques.",
  agentcli:   "Coding-agent prompt for Claude Code or Codex CLI: picks the right command and writes scope, steps, constraints and verification."
};

const STRATEGY_DESCS = {
  agentcli: {
    auto:       "Picks the agent from your text (mentions of Codex or AGENTS.md → Codex CLI, otherwise Claude Code).",
    claudecode: "Claude Code: /init, plan mode, /code-review, /goal, /simplify, /compact, worktrees and claude -p.",
    codex:      "OpenAI Codex CLI: /init, /plan, /review, /goal, sandbox modes, codex exec and codex cloud."
  },
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

const LANG_LABELS = { auto: "Auto language", en: "English", tr: "Turkish" };
const LANG_ORDER = ["auto", "en", "tr"];
const LEN_NAMES = { kisa: "Short", orta: "Medium", uzun: "Long", maks: "Max" };
const MODE_NAMES = { standard: "Standard", vibecoding: "Vibe Coding", research: "Web Research", antihallu: "Accuracy", agentcli: "Agent CLI" };

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  // ——— DOM refs ———
  const rawInput       = $("rawInput");
  const output         = $("output");
  const revizeEtBtn    = $("revizeEtBtn");
  const copyBtn        = $("copyBtn");
  const redoBtn        = $("redoBtn");
  const status         = $("status");
  const langSelect     = $("langSelect");
  const lenSelect      = $("lenSelect");
  const modeSelect     = $("modeSelect");
  const modeSeg        = $("modeSeg");
  const modeSegBtns    = modeSeg.querySelectorAll(".mode-btn");
  const lenSeg         = $("lenSeg");
  const vibeStrategySelect      = $("vibeStrategySelect");
  const researchStrategySelect  = $("researchStrategySelect");
  const antihalluStrategySelect = $("antihalluStrategySelect");
  const agentTargetSelect       = $("agentTargetSelect");
  const consensusCheckToggle    = $("consensusCheckToggle");
  const hdaModeSelect           = $("hdaModeSelect");
  const langDesc = $("langDesc");
  const lenDesc  = $("lenDesc");
  const modeDesc = $("modeDesc");
  const strategyDescEls = {
    vibecoding: $("vibeStrategyDesc"),
    research:   $("researchStrategyDesc"),
    antihallu:  $("antihalluStrategyDesc"),
    agentcli:   $("agentTargetDesc")
  };
  const strategySelects = {
    vibecoding: vibeStrategySelect,
    research:   researchStrategySelect,
    antihallu:  antihalluStrategySelect,
    agentcli:   agentTargetSelect
  };
  const strategyRows = {
    vibecoding: $("vibeStrategyControls"),
    research:   $("researchStrategyControls"),
    antihallu:  $("antihalluStrategyControls"),
    agentcli:   $("agentTargetControls")
  };

  const appMain        = $("top");
  const emptyView      = $("emptyView");
  const threadView     = $("threadView");
  const threadInput    = $("threadInput");
  const doneMsg        = $("doneMsg");
  const stepLine       = $("stepLine");
  const stepText       = $("stepText");
  const reviseProgress = $("reviseProgress");
  const answerActions  = $("answerActions");
  const copiedMsg      = $("copiedMsg");
  const fillPanel      = $("fillPanel");
  const fillFields     = $("fillFields");
  const fillCount      = $("fillCount");
  const starters       = $("starters");
  const fineprint      = $("fineprint");
  const composer       = $("composer");
  const optionsBtn     = $("optionsBtn");
  const optionsPanel   = $("optionsPanel");
  const langPillText   = $("langPillText");
  const depthPillText  = $("depthPillText");
  const titleDepth     = $("titleDepth");
  const modePill       = $("modePill");
  const historyList    = $("historyList");
  const historyEmpty   = $("historyEmpty");
  const histClearBtn   = $("histClearBtn");
  const sidebar        = $("sidebar");
  const sideScrim      = $("sideScrim");
  const openSidebarBtn = $("openSidebarBtn");
  const tipsDialog     = $("tipsDialog");
  const depthDialog    = $("depthDialog");
  const addKeyBtn      = $("addKeyBtn");
  const connectedBadge = $("connectedBadge");
  const providerName   = $("providerName");
  const keyStatus      = $("keyStatus");
  const depthProvider  = $("depthProvider");

  let stepInterval = null;
  let busy = false;
  let lastRaw = "";
  let lastFocus = null;

  // ——— Helpers ———
  const sendBrainReward = (val) => {
    chrome.runtime.sendMessage({ type: "REWARD_BRAIN", rewardVal: val });
  };
  const setStatus = (message, kind = "info") => {
    status.textContent = message;
    status.className = "mp-status" + (message ? " " + kind : "");
  };

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

  const syncSendBtn = () => {
    revizeEtBtn.disabled = busy || !rawInput.value.trim();
  };

  const autoGrow = () => {
    rawInput.style.height = "auto";
    rawInput.style.height = Math.min(rawInput.scrollHeight, 220) + "px";
  };

  // ——— Placeholder filler ———
  // The unfilled result stays the source of truth (history keeps it); the
  // output shows it with the user's values substituted, so Copy copies that.
  let fillResult = "";
  let fillRaw = null;
  let fillValues = {};
  let placeholderStore = {};

  const applyFill = () => {
    if (!fillResult) return;
    output.textContent = fillPlaceholders(fillResult, fillValues);
    const open = countUnfilled(fillResult, fillValues);
    fillCount.textContent = open ? `${open} unfilled` : "";
  };

  const hideFill = () => {
    fillResult = "";
    fillPanel.hidden = true;
    fillFields.replaceChildren();
    fillCount.textContent = "";
  };

  const renderFill = (result, raw) => {
    // A new source text starts clean; a redo of the same text keeps the values.
    if (raw !== fillRaw) fillValues = {};
    fillRaw = raw;
    fillResult = result;
    const slots = extractPlaceholders(result);
    fillFields.replaceChildren();
    fillPanel.hidden = slots.length === 0;
    slots.forEach((slot, i) => {
      const proposal = proposeValue(slot, { rawText: raw, remembered: placeholderStore });
      if (fillValues[slot.token] === undefined && proposal.value) fillValues[slot.token] = proposal.value;
      const row = document.createElement("div");
      row.className = "opt-row";
      const label = document.createElement("label");
      label.className = "opt-label";
      label.htmlFor = `fill-${i}`;
      label.textContent = humanizePlaceholder(slot.name);
      if (proposal.source) {
        const source = document.createElement("span");
        source.className = "fill-source";
        source.textContent = ` · ${proposal.source}`;
        label.append(source);
      }
      const input = document.createElement("input");
      input.className = "opt-select fill-input";
      input.id = `fill-${i}`;
      input.type = proposal.type === "secret" ? "password" : "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = slot.token;
      input.value = fillValues[slot.token] || "";
      input.addEventListener("input", () => {
        fillValues[slot.token] = input.value;
        applyFill();
      });
      row.append(label, input);
      if (proposal.options.length) {
        const list = document.createElement("datalist");
        list.id = `fill-${i}-options`;
        proposal.options.forEach((value) => {
          const option = document.createElement("option");
          option.value = value;
          list.append(option);
        });
        input.setAttribute("list", list.id);
        row.append(list);
      }
      fillFields.append(row);
    });
    if (slots.length) applyFill();
    else { output.textContent = result; fillCount.textContent = ""; }
  };

  // ——— Views: empty vs. thread ———
  const showThread = (raw) => {
    appMain.classList.add("has-thread");
    emptyView.hidden = true;
    threadView.hidden = false;
    starters.hidden = true;
    fineprint.hidden = true;
    threadInput.textContent = raw;
    rawInput.placeholder = "Start another prompt…";
  };

  const showEmpty = () => {
    stopSteps();
    appMain.classList.remove("has-thread");
    emptyView.hidden = false;
    threadView.hidden = true;
    starters.hidden = false;
    fineprint.hidden = false;
    output.textContent = "";
    hideFill();
    doneMsg.textContent = "";
    answerActions.hidden = true;
    rawInput.placeholder = "Describe your idea in plain words…";
    setStatus("", "info");
  };

  const stopSteps = () => {
    if (stepInterval) clearInterval(stepInterval);
    stepInterval = null;
    stepLine.hidden = true;
  };

  // ——— Language / length / mode ———
  const updateOutputDescs = () => {
    langDesc.textContent = LANG_DESCS[langSelect.value] || "";
    lenDesc.textContent = LEN_DESCS[lenSelect.value] || "";
    langPillText.textContent = LANG_LABELS[langSelect.value] || LANG_LABELS.auto;
  };

  const syncLenSeg = (val) => {
    lenSeg.querySelectorAll(".plan").forEach((card) => {
      const on = card.dataset.val === val;
      card.classList.toggle("on", on);
      const btn = card.querySelector(".plan-btn");
      btn.textContent = on ? "Current depth" : `Use ${LEN_NAMES[card.dataset.val]}`;
      btn.classList.toggle("current", on);
      btn.setAttribute("aria-pressed", String(on));
    });
    depthPillText.textContent = titleDepth.textContent = LEN_NAMES[val] || LEN_NAMES.orta;
    updateOutputDescs();
  };

  const updateModeDescs = () => {
    modeDesc.textContent = MODE_DESCS[modeSelect.value] || "";
    Object.keys(strategyDescEls).forEach((m) => {
      strategyDescEls[m].textContent = (STRATEGY_DESCS[m] || {})[strategySelects[m].value] || "";
    });
  };

  const syncModeSeg = (val) => {
    modeSegBtns.forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.val === val);
      btn.setAttribute("aria-pressed", String(btn.dataset.val === val));
    });
    Object.keys(strategyRows).forEach((m) => { strategyRows[m].hidden = m !== val; });
    modePill.textContent = MODE_NAMES[val] || MODE_NAMES.standard;
    updateModeDescs();
  };

  const setMode = (val) => {
    modeSelect.value = val;
    modeSelect.dispatchEvent(new Event("change"));
    syncModeSeg(val);
  };

  modeSegBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.val);
      closeSidebar();
    });
  });

  lenSeg.querySelectorAll(".plan-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      lenSelect.value = btn.dataset.val;
      lenSelect.dispatchEvent(new Event("change"));
      syncLenSeg(btn.dataset.val);
      closeDialog(depthDialog);
    });
  });

  $("langPill").addEventListener("click", () => {
    const next = LANG_ORDER[(LANG_ORDER.indexOf(langSelect.value) + 1) % LANG_ORDER.length];
    langSelect.value = next;
    langSelect.dispatchEvent(new Event("change"));
  });

  syncLenSeg(lenSelect.value);
  syncModeSeg(modeSelect.value);

  // ——— Options panel ———
  optionsBtn.addEventListener("click", () => {
    const open = optionsPanel.hidden;
    optionsPanel.hidden = !open;
    optionsBtn.setAttribute("aria-expanded", String(open));
    optionsBtn.classList.toggle("on", open);
  });

  // ——— Sidebar (drawer on small screens) ———
  const openSidebar = () => {
    sidebar.classList.add("open");
    sideScrim.hidden = false;
    openSidebarBtn.setAttribute("aria-expanded", "true");
  };
  function closeSidebar() {
    sidebar.classList.remove("open");
    sideScrim.hidden = true;
    openSidebarBtn.setAttribute("aria-expanded", "false");
  }
  openSidebarBtn.addEventListener("click", openSidebar);
  $("closeSidebarBtn").addEventListener("click", closeSidebar);
  sideScrim.addEventListener("click", closeSidebar);

  // ——— Dialogs ———
  const openDialog = (dlg) => {
    lastFocus = document.activeElement;
    closeSidebar();
    dlg.hidden = false;
    // Prefer the current depth / primary action over the close button.
    const target = [".plan.on .plan-btn", ".btn-dark", "button"].map((sel) => dlg.querySelector(sel)).find(Boolean);
    if (target) target.focus();
  };
  function closeDialog(dlg) {
    dlg.hidden = true;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  const closeTips = () => {
    closeDialog(tipsDialog);
    chrome.storage.local.set({ tipsSeen: true });
  };

  ["openDepthBtn", "titleDepthBtn", "depthPill"].forEach((id) =>
    $(id).addEventListener("click", () => openDialog(depthDialog)));
  $("closeDepthBtn").addEventListener("click", () => closeDialog(depthDialog));
  $("openTipsBtn").addEventListener("click", () => openDialog(tipsDialog));
  $("closeTipsBtn").addEventListener("click", closeTips);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!depthDialog.hidden) closeDialog(depthDialog);
    else if (!tipsDialog.hidden) closeTips();
    else if (sidebar.classList.contains("open")) closeSidebar();
    else if (!optionsPanel.hidden) optionsBtn.click();
  });

  // ——— Settings + key status ———
  const openSettings = () => chrome.runtime.openOptionsPage();
  $("settingsLink").addEventListener("click", openSettings);
  addKeyBtn.addEventListener("click", openSettings);
  $("keyStatusBtn").addEventListener("click", openSettings);

  const refreshKeyStatus = async () => {
    const { provider, apiKey } = await getActiveConfig();
    const label = provider === "openrouter" ? "OpenRouter" : "Anthropic";
    providerName.textContent = label;
    depthProvider.textContent = (PROVIDERS[provider] || {}).label || label;
    keyStatus.textContent = apiKey ? "Key saved in this browser" : "No API key yet — add one";
    addKeyBtn.hidden = !!apiKey;
    connectedBadge.hidden = !apiKey;
    return !!apiKey;
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

  // Deleted history is also forgotten by the Mnemonist memory (engine.js).
  const forgetInMemory = (raw) => chrome.runtime.sendMessage({ type: "MEMORY_FORGET", raw });

  const deleteHistoryItem = async (index) => {
    const history = await loadHistory();
    const [removed] = history.splice(index, 1);
    await persistHistory(history);
    if (removed) await forgetInMemory(removed.raw);
  };

  const openHistoryItem = (item) => {
    if (busy) return; // a running revision still owns the thread
    stopSteps();
    lastRaw = item.raw;
    showThread(item.raw);
    renderFill(item.result, item.raw);
    doneMsg.textContent = "· Loaded from history";
    answerActions.hidden = false;
    copiedMsg.textContent = "";
    setStatus("", "info");
    closeSidebar();
  };

  const renderHistory = (history) => {
    const items = history || [];
    historyEmpty.hidden = items.length > 0;
    histClearBtn.hidden = items.length === 0;
    historyList.replaceChildren(...items.map((item, index) => {
      const li = document.createElement("li");
      li.className = "recent-item";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "recent-open";
      const txt = document.createElement("span");
      txt.className = "recent-txt";
      txt.textContent = item.raw.slice(0, 80).replace(/\s+/g, " ");
      open.append(txt);
      if (item.at) {
        const when = document.createElement("span");
        when.className = "recent-when";
        when.textContent = getRelTime(item.at);
        open.append(when);
      }
      open.addEventListener("click", () => openHistoryItem(item));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "recent-del";
      del.setAttribute("aria-label", "Delete this entry");
      del.textContent = "✕";
      del.addEventListener("click", () => deleteHistoryItem(index));
      li.append(open, del);
      return li;
    }));
  };

  const loadHistory = async () => {
    const key = await getOrCreateEncryptionKey();
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const encryptedHistory = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
    const decryptedHistory = encryptedHistory.map(item => {
      const rawDecrypted = decryptText(item.encryptedData || "", key);
      try {
        return JSON.parse(rawDecrypted);
      } catch (e) {
        return null;
      }
    }).filter((item) => item && typeof item.raw === "string" && typeof item.result === "string");

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
    // One entry per source text: a redo replaces the older result.
    const others = existing.filter((item) => item.raw !== newItem.raw);
    await persistHistory([newItem, ...others].slice(0, HISTORY_LIMIT));
  };

  histClearBtn.addEventListener("click", async () => {
    if (!confirm("Delete all revision history?")) return;
    const history = await loadHistory();
    await persistHistory([]);
    for (const item of history) await forgetInMemory(item.raw);
    // Remembered placeholder values are forgotten with the history.
    placeholderStore = {};
    await chrome.storage.local.remove(PLACEHOLDER_MEMORY_KEY);
  });

  // ——— Load initial state from storage ———
  chrome.storage.local.get(
    ["lastError", "language", "length", "mode", "vibeStrategy", "researchStrategy", "antihalluStrategy", "agentTarget", PLACEHOLDER_MEMORY_KEY, "consensusCheck", "hdaMode", "hdaEnabled", "tipsSeen"],
    (data) => {
      if (data.lastError) setStatus(data.lastError, "error");
      if (data.language) langSelect.value = data.language;
      if (data.length) {
        lenSelect.value = data.length;
        syncLenSeg(data.length);
      }
      if (data.researchStrategy) researchStrategySelect.value = data.researchStrategy;
      if (data.antihalluStrategy) antihalluStrategySelect.value = data.antihalluStrategy;
      if (data.vibeStrategy) vibeStrategySelect.value = data.vibeStrategy;
      if (data.agentTarget) agentTargetSelect.value = data.agentTarget;
      if (data[PLACEHOLDER_MEMORY_KEY] && typeof data[PLACEHOLDER_MEMORY_KEY] === "object") placeholderStore = data[PLACEHOLDER_MEMORY_KEY];
      if (data.mode) {
        modeSelect.value = data.mode;
        syncModeSeg(data.mode);
      }
      consensusCheckToggle.checked = !!data.consensusCheck;
      // Same resolution as engine.js getHdaMode(): legacy hdaEnabled=false means off.
      hdaModeSelect.value = ["agents", "inline", "off"].includes(data.hdaMode)
        ? data.hdaMode
        : (data.hdaEnabled === false ? "off" : "agents");
      updateModeDescs();
      updateOutputDescs();
      chrome.storage.local.remove("lastError");
      if (!data.tipsSeen) openDialog(tipsDialog);
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
  [["researchStrategy", researchStrategySelect], ["antihalluStrategy", antihalluStrategySelect], ["vibeStrategy", vibeStrategySelect], ["agentTarget", agentTargetSelect]]
    .forEach(([storageKey, sel]) => {
      sel.addEventListener("change", () => {
        chrome.storage.local.set({ [storageKey]: sel.value });
        updateModeDescs();
      });
    });
  consensusCheckToggle.addEventListener("change", () =>
    chrome.storage.local.set({ consensusCheck: consensusCheckToggle.checked })
  );
  hdaModeSelect.addEventListener("change", () =>
    chrome.storage.local.set({ hdaMode: hdaModeSelect.value })
  );

  refreshKeyStatus();
  loadHistory();

  // ——— New prompt ———
  const newPrompt = () => {
    if (busy) return;
    showEmpty();
    rawInput.value = "";
    autoGrow();
    syncSendBtn();
    closeSidebar();
    rawInput.focus();
  };
  $("newPromptBtn").addEventListener("click", newPrompt);
  $("newPromptTopBtn").addEventListener("click", newPrompt);

  // ——— Composer ———
  rawInput.addEventListener("input", () => { autoGrow(); syncSendBtn(); });
  rawInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    run(rawInput.value);
  });

  starters.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setMode(chip.dataset.mode);
      run(chip.dataset.text);
    });
  });

  // ——— Redo: re-send the same text (new API call) and record the LTD penalty ———
  redoBtn.addEventListener("click", () => {
    if (busy || !lastRaw) return;
    sendBrainReward(-1.0);
    run(lastRaw, { fresh: true });
  });

  // ——— Revise ———
  // `fresh` skips the semantic cache so Redo really writes a new prompt.
  async function run(text, { fresh = false } = {}) {
    const rawText = (text || "").trim();
    if (busy) return;
    if (!rawText) {
      setStatus("Please type some text first.", "error");
      return;
    }

    const hasKey = await refreshKeyStatus();
    if (!hasKey) {
      setStatus("No API key. Add one in Settings.", "error");
      return;
    }

    const language = langSelect.value;
    const length   = lenSelect.value;
    const mode     = modeSelect.value;
    const vibeStrategy = vibeStrategySelect.value;
    const researchStrategy = researchStrategySelect.value;
    const antihalluStrategy = antihalluStrategySelect.value;
    const agentTarget = agentTargetSelect.value;

    // Start busy state
    busy = true;
    lastRaw = rawText;
    rawInput.value = "";
    autoGrow();
    syncSendBtn();
    showThread(rawText);
    output.textContent = "";
    hideFill();
    output.classList.add("streaming");
    doneMsg.textContent = `· ${MODE_NAMES[mode] || mode} · ${LEN_NAMES[length] || length}`;
    answerActions.hidden = true;
    copiedMsg.textContent = "";
    setStatus("", "info");

    // Step animation
    let stepIdx = 0;
    stepLine.hidden = false;
    reviseProgress.parentElement.hidden = false;
    stepText.textContent = REVISE_STEPS[0];
    reviseProgress.style.width = "5%";
    if (stepInterval) clearInterval(stepInterval);
    stepInterval = setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, REVISE_STEPS.length - 1);
      stepText.textContent = REVISE_STEPS[stepIdx];
      reviseProgress.style.width = (10 + ((stepIdx + 1) / REVISE_STEPS.length) * 72) + "%";
    }, 550);

    // Nothing streamed: hand the text back so the user can retry without retyping.
    const restoreDraft = () => {
      if (rawInput.value.trim()) return;
      rawInput.value = rawText;
      autoGrow();
    };

    const finish = () => {
      busy = false;
      stopSteps();
      output.classList.remove("streaming");
      reviseProgress.parentElement.hidden = true;
      reviseProgress.style.width = "0%";
      answerActions.hidden = !output.textContent;
      syncSendBtn();
    };

    // Streaming revision: open a persistent port to the engine and show the
    // result as it arrives in deltas.
    try {
      const port = chrome.runtime.connect({ name: "revise" });
      let streamed = "";
      let finished = false;

      port.onMessage.addListener(async (response) => {
        if (response.type === "delta") {
          if (!streamed) stopSteps(); // first chunk: the text itself is the progress now
          streamed += response.text;
          output.textContent = streamed;
          reviseProgress.style.width = "90%";
          return;
        }

        if (response.type === "hda") {
          // HDA phase agents run before the prompt streams: show the real phase
          // instead of the canned step animation.
          if (stepInterval) clearInterval(stepInterval);
          stepInterval = null;
          stepLine.hidden = false;
          stepText.textContent = `HDA ${response.index + 1}/${response.total}: ${response.name}…`;
          reviseProgress.style.width = `${10 + ((response.index + 1) / response.total) * 60}%`;
          return;
        }

        if (response.type === "checking") {
          stepLine.hidden = false;
          stepText.textContent = "Judge model reviewing…";
          return;
        }

        finished = true;

        if (response.type === "error") {
          setStatus(response.error || "A background error occurred", "error");
          doneMsg.textContent = streamed ? "· Incomplete response" : "· Failed";
          if (!streamed) restoreDraft();
          finish();
          port.disconnect();
          return;
        }

        // done
        const { result, usedModel, fellBack, consensus, snnValues, resolvedStrategy, hdaStatus, cached, memoryUsed } = response;
        renderFill(result, rawText);

        const shortModel = usedModel.split("/").pop();
        let snnStats = "";
        if (snnValues) {
          snnStats = ` | ACh:${snnValues.ACh.toFixed(2)} NE:${snnValues.NE.toFixed(2)}`;
        }
        const isAutoChosen = mode !== "standard" && resolvedStrategy &&
          ((mode === "vibecoding"  && vibeStrategy      === "auto") ||
           (mode === "research"    && researchStrategy  === "auto") ||
           (mode === "antihallu"   && antihalluStrategy === "auto") ||
           (mode === "agentcli"    && agentTarget       === "auto"));
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
        const hdaLabel = {
          agents: " · HDA 5/5",
          "agents-short": " · HDA 2/5 (short)",
          inline: " · HDA inline",
          "inline-fallback": " · HDA inline (agents failed)"
        }[hdaStatus] || "";
        const cachedLabel = cached ? " · from cache (no API call)" : "";
        const memoryLabel = memoryUsed ? ` · memory ${memoryUsed}` : "";
        doneMsg.textContent = fellBack
          ? `· ${shortModel} (backup)${autoLabel}${hdaLabel}${memoryLabel}${consensusLabel}${cachedLabel}${snnStats}`
          : `· ${shortModel}${autoLabel}${hdaLabel}${memoryLabel}${consensusLabel}${cachedLabel}${snnStats}`;

        try {
          await saveToHistory(rawText, result);
        } catch (_) {
          setStatus("Prompt is ready, but history could not be saved. You can still copy it.", "error");
        } finally {
          finish();
          port.disconnect();
        }
      });

      port.onDisconnect.addListener(() => {
        if (finished) return;
        setStatus("Lost connection to the prompt engine. Try again.", "error");
        if (!streamed) restoreDraft();
        finish();
      });

      port.postMessage({
        type: "REVISE_PROMPT_STREAM",
        language,
        length,
        mode,
        vibeStrategy,
        researchStrategy,
        antihalluStrategy,
        agentTarget,
        rawText: rawText,
        skipCache: fresh
      });
    } catch (error) {
      setStatus(error.message, "error");
      restoreDraft();
      finish();
    }
  }

  // ——— Copy ———
  copyBtn.addEventListener("click", async () => {
    const text = output.textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copiedMsg.textContent = "Copied";
      setTimeout(() => { copiedMsg.textContent = ""; }, 1400);
      sendBrainReward(1.0); // positive LTP reward
      // Copying commits the fills: remember them (locally, secrets skipped).
      if (fillResult) {
        placeholderStore = rememberValues(placeholderStore, fillValues);
        chrome.storage.local.set({ [PLACEHOLDER_MEMORY_KEY]: placeholderStore });
      }
    } catch (error) {
      setStatus(`Could not copy: ${error.message}`, "error");
    }
  });

  autoGrow();
  syncSendBtn();
});
