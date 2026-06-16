import { PROVIDERS, DEFAULT_PROVIDER, getStoredConfig } from "./config.js";
import { fetchOpenRouterModels, revise } from "./api.js";

document.addEventListener("DOMContentLoaded", async () => {
  const providerSelect = document.getElementById("provider");
  const apiKeyInput    = document.getElementById("apiKey");
  const modelInput     = document.getElementById("model");
  const modelList      = document.getElementById("modelList");
  const modelHint      = document.getElementById("modelHint");
  const tierSelect     = document.getElementById("tierSelect");
  const loadFreeBtn    = document.getElementById("loadFreeBtn");
  const verifyBtn      = document.getElementById("verifyBtn");
  const modelSelect    = document.getElementById("modelSelect");
  const freeHint       = document.getElementById("freeHint");
  const testBtn        = document.getElementById("testBtn");
  const testResult     = document.getElementById("testResult");
  const saveBtn        = document.getElementById("saveBtn");
  const saved          = document.getElementById("saved");
  const showKeyBtn     = document.getElementById("showKeyBtn");

  // ——— Provider segmented buttons ———
  const providerBtns = document.querySelectorAll("[data-provider]");
  const syncProviderBtns = (p) => {
    providerBtns.forEach((b) => b.classList.toggle("on", b.dataset.provider === p));
  };
  providerBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      captureCurrent();
      state.provider = btn.dataset.provider;
      providerSelect.value = btn.dataset.provider;
      syncProviderBtns(btn.dataset.provider);
      renderProvider(btn.dataset.provider);
    });
  });

  // ——— Show/hide API key ———
  if (showKeyBtn) {
    showKeyBtn.addEventListener("click", () => {
      const isPassword = apiKeyInput.type === "password";
      apiKeyInput.type = isPassword ? "text" : "password";
      showKeyBtn.textContent = isPassword ? "Hide" : "Show";
    });
  }

  // The most recently loaded model list (by selected tier: free/paid/all).
  let loadedModels = null;
  // Models previously tested and verified as "working" (persistent).
  let workingModels =
    (await chrome.storage.local.get("openrouterWorkingModels")).openrouterWorkingModels || null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const escapeHtml = (text) =>
    String(text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));

  const fillDatalist = (items) => {
    modelList.innerHTML = items
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
      .join("");
  };

  const fillSelect = (items, current) => {
    const options = ['<option value="">— Pick from free models —</option>'];
    items.forEach((m) => {
      const selected = m.id === current ? " selected" : "";
      options.push(`<option value="${escapeHtml(m.id)}"${selected}>${escapeHtml(m.name)} (${escapeHtml(m.id)})</option>`);
    });
    modelSelect.innerHTML = options.join("");
    modelSelect.style.display = items.length ? "block" : "none";
  };

  modelSelect.addEventListener("change", () => {
    if (modelSelect.value) modelInput.value = modelSelect.value;
  });

  const stored = await getStoredConfig();
  const state = {
    provider:        stored.provider || DEFAULT_PROVIDER,
    anthropicKey:    stored.anthropicKey || "",
    anthropicModel:  stored.anthropicModel || "",
    openrouterKey:   stored.openrouterKey || "",
    openrouterModel: stored.openrouterModel || "",
  };

  const renderProvider = (provider) => {
    syncProviderBtns(provider);

    const meta = PROVIDERS[provider];
    apiKeyInput.value       = state[meta.keyField];
    apiKeyInput.placeholder = meta.keyPlaceholder;
    modelInput.value        = state[meta.modelField] || meta.defaultModel;
    modelHint.textContent   = meta.modelHint;
    if (modelHint.textContent) {
      modelHint.className = "ms-hint";
    }

    const isOpenRouter = provider === "openrouter";
    tierSelect.style.display  = isOpenRouter ? "block" : "none";
    loadFreeBtn.style.display = isOpenRouter ? "flex" : "none";
    verifyBtn.style.display   = isOpenRouter ? "flex" : "none";
    freeHint.textContent      = "";

    const orList = workingModels || loadedModels;
    if (isOpenRouter && orList) {
      fillDatalist(orList);
      fillSelect(orList, modelInput.value);
      freeHint.textContent = workingModels
        ? `${workingModels.length} verified working models in the list.`
        : `${loadedModels.length} models in the list.`;
    } else {
      fillDatalist(meta.modelSuggestions.map((id) => ({ id, name: id })));
      modelSelect.style.display = "none";
    }
  };

  const tierLabel = { free: "free", paid: "paid", all: "all" };

  loadFreeBtn.addEventListener("click", async () => {
    const tier     = tierSelect.value;
    const original = loadFreeBtn.textContent;
    loadFreeBtn.disabled     = true;
    loadFreeBtn.textContent  = "Loading…";
    freeHint.style.color     = "";
    freeHint.textContent     = "";
    try {
      loadedModels = await fetchOpenRouterModels(tier);
      if (loadedModels.length === 0) {
        freeHint.textContent = `No ${tierLabel[tier]} models found right now.`;
      } else {
        fillDatalist(loadedModels);
        fillSelect(loadedModels, modelInput.value);
        freeHint.textContent = `${loadedModels.length} ${tierLabel[tier]} models loaded. Pick one from the dropdown below.`;
      }
    } catch (error) {
      freeHint.textContent = error.message;
    } finally {
      loadFreeBtn.disabled    = false;
      loadFreeBtn.textContent = original;
    }
  });

  const captureCurrent = () => {
    const meta               = PROVIDERS[state.provider];
    state[meta.keyField]     = apiKeyInput.value.trim();
    state[meta.modelField]   = modelInput.value.trim();
  };

  providerSelect.value = state.provider;
  renderProvider(state.provider);

  providerSelect.addEventListener("change", () => {
    captureCurrent();
    state.provider = providerSelect.value;
    syncProviderBtns(state.provider);
    renderProvider(state.provider);
  });

  const probeModel = async (apiKey, model) => {
    const attempt = () =>
      revise({
        provider: "openrouter",
        apiKey,
        model,
        system:   "You are a connection test.",
        userText: "Reply with the single word OK.",
        maxTokens: 5,
      });
    try {
      await attempt();
      return "ok";
    } catch (error) {
      if (/\b429\b/.test(error.message)) {
        await sleep(5000);
        try {
          await attempt();
          return "ok";
        } catch (retryError) {
          return /\b429\b/.test(retryError.message) ? "rate" : "fail";
        }
      }
      return "fail";
    }
  };

  verifyBtn.addEventListener("click", async () => {
    captureCurrent();
    const apiKey = state.openrouterKey;
    if (!apiKey) {
      freeHint.textContent   = "Enter your OpenRouter API key first.";
      freeHint.style.color   = "var(--del, #FF8A92)";
      return;
    }
    freeHint.style.color = "";

    if (!loadedModels) {
      try {
        loadedModels = await fetchOpenRouterModels(tierSelect.value);
      } catch (error) {
        freeHint.textContent = error.message;
        return;
      }
    }
    const total = loadedModels.length;
    if (total === 0) {
      freeHint.textContent = "No models to test.";
      return;
    }

    const hasPaid = loadedModels.some((m) => !m.free);
    if (hasPaid || total > 40) {
      const confirmed = confirm(
        `${total} models will be tested. ` +
        (hasPaid ? "The list contains PAID models; each test incurs a real, if small, charge. " : "") +
        "Continue?"
      );
      if (!confirmed) return;
    }

    verifyBtn.disabled   = true;
    loadFreeBtn.disabled = true;
    const working = [];
    let skipped   = 0;

    for (let i = 0; i < total; i++) {
      const model      = loadedModels[i];
      freeHint.textContent =
        `Testing ${i + 1}/${total} — ${working.length} working` +
        (skipped ? `, ${skipped} skipped` : "") +
        ` | ${model.id}`;
      const result = await probeModel(apiKey, model.id);
      if (result === "ok") working.push(model);
      else if (result === "rate") skipped += 1;
      await sleep(900);
    }

    workingModels = working;
    await chrome.storage.local.set({ openrouterWorkingModels: working });
    fillDatalist(working);
    fillSelect(working, modelInput.value);
    freeHint.textContent =
      `Done: ${working.length}/${total} models working and added.` +
      (skipped ? ` ${skipped} models skipped due to rate limits — you can try again.` : "");

    verifyBtn.disabled   = false;
    loadFreeBtn.disabled = false;
  });

  testBtn.addEventListener("click", async () => {
    captureCurrent();
    const meta   = PROVIDERS[state.provider];
    const apiKey = state[meta.keyField];
    const model  = state[meta.modelField] || meta.defaultModel;

    if (!apiKey) {
      testResult.textContent = "Enter an API key first.";
      testResult.style.color = "var(--del, #FF8A92)";
      return;
    }

    const original        = testBtn.textContent;
    testBtn.disabled      = true;
    testBtn.textContent   = "Testing…";
    testResult.textContent = `Trying ${state.provider} / ${model}…`;
    testResult.style.color = "";

    try {
      await revise({
        provider:  state.provider,
        apiKey,
        model,
        system:    "You are a connection test.",
        userText:  "Reply with the single word OK.",
        maxTokens: 10,
      });
      testResult.textContent = "✓ Connection successful. Key and model are working.";
      testResult.style.color = "var(--add, #5FE0A0)";
    } catch (error) {
      testResult.textContent = `✗ ${error.message}`;
      testResult.style.color = "var(--del, #FF8A92)";
    } finally {
      testBtn.disabled    = false;
      testBtn.textContent = original;
    }
  });

  saveBtn.addEventListener("click", async () => {
    captureCurrent();
    const meta = PROVIDERS[state.provider];

    if (!state[meta.keyField]) {
      saved.textContent   = "Please enter a valid API key.";
      saved.style.color   = "var(--del, #FF8A92)";
      return;
    }

    await chrome.storage.local.set({
      provider:        state.provider,
      anthropicKey:    state.anthropicKey,
      anthropicModel:  state.anthropicModel,
      openrouterKey:   state.openrouterKey,
      openrouterModel: state.openrouterModel,
    });

    saved.textContent = "Saved ✓";
    saved.style.color = "var(--add, #5FE0A0)";
    setTimeout(() => { saved.textContent = ""; }, 2000);
  });
});
