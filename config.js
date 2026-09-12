// Provider definitions and helpers for reading the active configuration.
// Each provider's key and model are stored separately, so switching providers
// does not wipe the other one's settings.

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (direct)",
    keyField: "anthropicKey",
    modelField: "anthropicModel",
    keyPlaceholder: "sk-ant-...",
    defaultModel: "claude-sonnet-4-6",
    // Known, fixed model IDs.
    modelSuggestions: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-6",
      "claude-opus-4-8"
    ],
    modelHint: "Anthropic model ID (e.g. claude-sonnet-4-6)."
  },
  openrouter: {
    label: "OpenRouter",
    keyField: "openrouterKey",
    modelField: "openrouterModel",
    keyPlaceholder: "sk-or-...",
    defaultModel: "anthropic/claude-sonnet-4.6",
    // OpenRouter has hundreds of models and slugs may change;
    // these are only examples. Current list: https://openrouter.ai/models
    modelSuggestions: [
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-opus-4.8",
      "openai/gpt-4o",
      "google/gemini-2.0-flash-001",
      "meta-llama/llama-3.3-70b-instruct"
    ],
    modelHint: "OpenRouter slug (e.g. anthropic/claude-sonnet-4.6). List: openrouter.ai/models"
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
  return { ...data, provider: Object.hasOwn(PROVIDERS, data.provider) ? data.provider : DEFAULT_PROVIDER };
}

// Returns the active provider's {provider, apiKey, model}.
export async function getActiveConfig() {
  const stored = await getStoredConfig();
  const provider = Object.hasOwn(PROVIDERS, stored.provider) ? stored.provider : DEFAULT_PROVIDER;
  const meta = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  return {
    provider,
    apiKey: stored[meta.keyField] || "",
    model: stored[meta.modelField] || meta.defaultModel
  };
}

// Full failover plan: active model + backup model list + all keys.
// Both the popup (REVISE_PROMPT) and the shortcut/right-click (reviseInPlace)
// paths use this, so the model-list logic stays in one place.
export async function getFailoverConfig() {
  const stored = await chrome.storage.local.get([...ALL_FIELDS, "openrouterWorkingModels"]);
  const provider = Object.hasOwn(PROVIDERS, stored.provider) ? stored.provider : DEFAULT_PROVIDER;
  const meta = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  const apiKeys = {
    anthropic: stored.anthropicKey || "",
    openrouter: stored.openrouterKey || ""
  };
  const activeModel = stored[meta.modelField] || meta.defaultModel;

  const working = Array.isArray(stored.openrouterWorkingModels)
    ? stored.openrouterWorkingModels.filter((m) => m && typeof m.id === "string" && m.id.trim())
    : [];
  let models = [activeModel];
  if (provider === "openrouter") {
    models = [activeModel, ...working.map((m) => m.id).filter((id) => id && id !== activeModel)];
  } else if (apiKeys.openrouter) {
    // When Anthropic is active but an OpenRouter key exists, add the verified
    // models as cross-provider backups (api.js detectProvider picks the right key).
    models = [activeModel, ...working.map((m) => m.id).filter(Boolean)];
  }

  return { provider, apiKey: apiKeys[provider], apiKeys, models: [...new Set(models.map((m) => m.trim()).filter(Boolean))] };
}
