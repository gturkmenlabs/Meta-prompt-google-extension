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
