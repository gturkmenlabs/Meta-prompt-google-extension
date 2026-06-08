// Iki saglayici icin revizyon istemcisi:
//  - Anthropic Messages API (x-api-key, system ayri alan, content blok dizisi)
//  - OpenRouter Chat Completions API (Bearer, system bir mesaj, choices[].message)

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_VERSION = "2023-06-01";

// OpenRouter/upstream hatalari ic ice JSON olabilir; okunakli tek satira indir.
function parseErrorMessage(detail) {
  if (!detail) return "";
  try {
    const j = JSON.parse(detail);
    let msg = (j.error && j.error.message) || j.message || detail;
    const raw = j.error && j.error.metadata && j.error.metadata.raw;
    if (raw) {
      let inner = raw;
      try {
        const r = JSON.parse(raw);
        inner = (r.error && r.error.message) || raw;
      } catch (_) { /* raw duz metin olabilir */ }
      if (inner && !msg.includes(inner)) msg += ` — ${inner}`;
    }
    return msg;
  } catch (_) {
    return detail;
  }
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (networkError) {
    throw new Error(`Aga baglanilamadi: ${networkError.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API hatasi ${res.status}: ${parseErrorMessage(detail) || res.statusText}`);
  }
  return res.json();
}

async function reviseAnthropic({ apiKey, model, system, userText, maxTokens }) {
  const data = await postJson(
    ANTHROPIC_URL,
    {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userText }]
    }
  );
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) throw new Error("Modelden bos yanit dondu.");
  return text;
}

async function reviseOpenRouter({ apiKey, model, system, userText, maxTokens }) {
  const data = await postJson(
    OPENROUTER_URL,
    {
      "content-type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://meta-prompt-motoru.extension",
      "X-Title": "Meta-Prompt Motoru"
    },
    {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText }
      ]
    }
  );
  const text = (data.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Modelden bos yanit dondu.");
  return text;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

function isFreeModel(m) {
  const p = m.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

// OpenRouter model listesini ceker. tier: "free" | "paid" | "all".
// Liste herkese acik oldugundan API anahtari gerekmez.
export async function fetchOpenRouterModels(tier = "all") {
  let res;
  try {
    res = await fetch(OPENROUTER_MODELS_URL);
  } catch (networkError) {
    throw new Error(`Model listesi alinamadi: ${networkError.message}`);
  }
  if (!res.ok) {
    throw new Error(`Model listesi hatasi ${res.status}`);
  }
  const json = await res.json();
  let items = (json.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    free: isFreeModel(m)
  }));
  if (tier === "free") items = items.filter((m) => m.free);
  else if (tier === "paid") items = items.filter((m) => !m.free);
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export async function revise({ provider, apiKey, model, system, userText, maxTokens = 2048 }) {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey) {
    throw new Error("API anahtari ayarlanmamis. Once Ayarlar ekranindan anahtarinizi girin.");
  }
  if (!model) {
    throw new Error("Model secilmemis. Ayarlar ekranindan bir model secin.");
  }
  const params = { apiKey: cleanKey, model: model.trim(), system, userText, maxTokens };
  return provider === "openrouter" ? reviseOpenRouter(params) : reviseAnthropic(params);
}

// Auth/yetki hatalarinda butun modeller basarisiz olacagindan failover anlamsiz.
function isFatalError(message) {
  return /\b401\b/.test(message) || /\b403\b/.test(message);
}

// Model listesini sirayla dener; bir model mesgul/hatali ise (429, 5xx, 400/404
// model hatasi) bir sonrakine gecer. Ilk basarili yaniti dondurur.
export async function reviseWithFailover({ provider, apiKey, models, system, userText, maxTokens = 2048 }) {
  const list = (models || []).filter(Boolean);
  if (list.length === 0) {
    throw new Error("Denenecek model yok. Ayarlar'dan bir model secin.");
  }

  let lastError = null;
  for (let i = 0; i < list.length; i++) {
    try {
      const result = await revise({ provider, apiKey, model: list[i], system, userText, maxTokens });
      return { result, usedModel: list[i], fellBack: i > 0, triedCount: i + 1 };
    } catch (error) {
      lastError = error;
      if (isFatalError(error.message)) break; // anahtar hatasi: denemeyi birak
    }
  }
  throw new Error(`Tum modeller basarisiz oldu. Son hata: ${lastError ? lastError.message : "bilinmiyor"}`);
}
