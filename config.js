// Saglayici tanimlari ve aktif yapilandirmayi okuma yardimcilari.
// Her saglayicinin anahtari ve modeli ayri saklanir; saglayici degistirince
// digerinin bilgileri kaybolmaz.

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (dogrudan)",
    keyField: "anthropicKey",
    modelField: "anthropicModel",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-6",
    // Bilinen, sabit model kimlikleri.
    modelSuggestions: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-8"
    ],
    modelHint: "Anthropic model kimligi (orn. claude-sonnet-4-6)."
  },
  openrouter: {
    label: "OpenRouter",
    keyField: "openrouterKey",
    modelField: "openrouterModel",
    keyPlaceholder: "sk-or-...",
    defaultModel: "anthropic/claude-sonnet-4.6",
    // OpenRouter'da yuzlerce model var ve slug'lar degisebilir;
    // bunlar yalnizca ornek. Guncel liste: https://openrouter.ai/models
    modelSuggestions: [
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-opus-4.8",
      "openai/gpt-4o",
      "google/gemini-2.0-flash-001",
      "meta-llama/llama-3.3-70b-instruct"
    ],
    modelHint: "OpenRouter slug'i (orn. anthropic/claude-sonnet-4.6). Liste: openrouter.ai/models"
  }
};

export const DEFAULT_PROVIDER = "anthropic";

const ALL_FIELDS = [
  "provider",
  "anthropicKey", "anthropicModel",
  "openrouterKey", "openrouterModel"
];

export async function getStoredConfig() {
  const data = await chrome.storage.local.get(ALL_FIELDS);
  return { provider: DEFAULT_PROVIDER, ...data };
}

// Aktif saglayicinin {provider, apiKey, model} bilgisini dondurur.
export async function getActiveConfig() {
  const stored = await getStoredConfig();
  const provider = stored.provider || DEFAULT_PROVIDER;
  const meta = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  return {
    provider,
    apiKey: stored[meta.keyField] || "",
    model: stored[meta.modelField] || meta.defaultModel
  };
}

// Failover icin tam plan: aktif model + yedek model listesi + tum anahtarlar.
// Hem popup (REVISE_PROMPT) hem kisayol/sag-tik (reviseInPlace) yollari bunu
// kullanir; model listesi mantigi tek yerde kalsin.
export async function getFailoverConfig() {
  const stored = await chrome.storage.local.get([...ALL_FIELDS, "openrouterWorkingModels"]);
  const provider = stored.provider || DEFAULT_PROVIDER;
  const meta = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  const apiKeys = {
    anthropic: stored.anthropicKey || "",
    openrouter: stored.openrouterKey || ""
  };
  const activeModel = stored[meta.modelField] || meta.defaultModel;

  const working = stored.openrouterWorkingModels || [];
  let models = [activeModel];
  if (provider === "openrouter") {
    models = [activeModel, ...working.map((m) => m.id).filter((id) => id && id !== activeModel)];
  } else if (apiKeys.openrouter) {
    // Anthropic aktifken OpenRouter anahtari varsa, dogrulanmis modelleri
    // capraz yedek olarak ekle (api.js detectProvider dogru anahtari secer).
    models = [activeModel, ...working.map((m) => m.id).filter(Boolean)];
  }

  return { provider, apiKey: apiKeys[provider], apiKeys, models };
}
