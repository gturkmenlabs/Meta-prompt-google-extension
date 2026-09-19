// Provider definitions and helpers for reading the active configuration.
// Each provider's key and model are stored separately, so switching providers
// does not wipe the other one's settings.

import { DEFAULT_MIN_CONFIDENCE } from "./typesafe.js";

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

// Hard ceiling on how many backup models a single revision may try. Each attempt
// sends the full source text to another model and can burn the 90 s request
// timeout, so an unbounded list means both minutes of hanging and the text
// reaching models the user never picked.
export const MAX_BACKUP_MODELS = 3;

// Sending the source text to a DIFFERENT provider than the active one is opt-in:
// the user enables it explicitly in Settings. Default off.
export const CROSS_PROVIDER_FALLBACK_KEY = "crossProviderFallback";

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
  const stored = await chrome.storage.local.get([
    ...ALL_FIELDS, "openrouterWorkingModels", CROSS_PROVIDER_FALLBACK_KEY
  ]);
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
  const workingIds = working.map((m) => m.id);

  // Backups stay INSIDE the active provider unless the user opted in. Otherwise a
  // transient 5xx would quietly ship the source text to a provider they did not choose.
  let backups = [];
  if (provider === "openrouter") {
    backups = workingIds;
  } else if (apiKeys.openrouter && stored[CROSS_PROVIDER_FALLBACK_KEY] === true) {
    // Anthropic active + explicit opt-in: verified OpenRouter models become
    // cross-provider backups (api.js detectProvider picks the matching key).
    backups = workingIds;
  }

  const models = [...new Set([activeModel, ...backups].map((m) => (m || "").trim()).filter(Boolean))]
    .slice(0, MAX_BACKUP_MODELS + 1);

  return { provider, apiKey: apiKeys[provider], apiKeys, models };
}

// ——— TypeSafe (prompt brain task classifier) ———
// Not a revision provider: TypeSafe never sees a revision request and is never
// part of the failover list. It answers one Choice question about the raw text
// so the prompt brain can pick its modules. Kept out of PROVIDERS deliberately —
// putting it there would let it into the model failover list.
//
// Opt-in, default off: turning it on sends the opening of the source text to a
// third service the user has not otherwise chosen, the same reason
// crossProviderFallback defaults off.
export const TYPESAFE_KEY_FIELD = "typesafeKey";
export const TYPESAFE_ENABLED_KEY = "typesafeEnabled";
export const TYPESAFE_MIN_CONFIDENCE_KEY = "typesafeMinConfidence";

export async function getTypesafeConfig() {
  const stored = await chrome.storage.local.get([
    TYPESAFE_KEY_FIELD, TYPESAFE_ENABLED_KEY, TYPESAFE_MIN_CONFIDENCE_KEY
  ]);
  const apiKey = stored[TYPESAFE_KEY_FIELD] || "";
  const raw = Number(stored[TYPESAFE_MIN_CONFIDENCE_KEY]);
  const minConfidence = Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_MIN_CONFIDENCE;
  return {
    apiKey,
    // Both the key and the explicit opt-in are required; a leftover key from an
    // earlier experiment must not silently start shipping text again.
    enabled: stored[TYPESAFE_ENABLED_KEY] === true && Boolean(apiKey),
    minConfidence
  };
}
