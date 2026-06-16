// Revision client for the two providers:
//  - Anthropic Messages API (x-api-key, separate system field, content block array)
//  - OpenRouter Chat Completions API (Bearer, system as a message, choices[].message)

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_VERSION = "2023-06-01";

// OpenRouter/upstream errors can be nested JSON; collapse to a readable single line.
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
      } catch (_) { /* raw may be plain text */ }
      if (inner && !msg.includes(inner)) msg += ` — ${inner}`;
    }
    return msg;
  } catch (_) {
    return detail;
  }
}

// Upper bound so a hung request doesn't leave the badge stuck on "…".
const REQUEST_TIMEOUT_MS = 90000;

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (networkError) {
    if (networkError.name === "AbortError") {
      throw new Error(`Request timed out (${REQUEST_TIMEOUT_MS / 1000} s).`);
    }
    throw new Error(`Could not connect to the network: ${networkError.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${parseErrorMessage(detail) || res.statusText}`);
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
  if (!text) throw new Error("The model returned an empty response.");
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
  if (!text) throw new Error("The model returned an empty response.");
  return text;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

function isFreeModel(m) {
  const p = m.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

// Fetches the OpenRouter model list. tier: "free" | "paid" | "all".
// The list is public, so no API key is required.
export async function fetchOpenRouterModels(tier = "all") {
  let res;
  try {
    res = await fetch(OPENROUTER_MODELS_URL);
  } catch (networkError) {
    throw new Error(`Could not fetch the model list: ${networkError.message}`);
  }
  if (!res.ok) {
    throw new Error(`Model list error ${res.status}`);
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

export function detectProvider(model, defaultProvider = "anthropic") {
  if (!model) return defaultProvider;
  const m = model.trim();
  if (m.includes("/")) {
    return "openrouter";
  }
  if (m.startsWith("claude-")) {
    return "anthropic";
  }
  return defaultProvider;
}

export async function revise({ provider, apiKey, apiKeys, model, system, userText, maxTokens = 2048 }) {
  const modelClean = (model || "").trim();
  if (!modelClean) {
    throw new Error("No model selected. Choose a model in the Settings screen.");
  }
  const detectedProv = detectProvider(modelClean, provider);
  
  let activeKey = "";
  if (apiKeys && apiKeys[detectedProv]) {
    activeKey = apiKeys[detectedProv].trim();
  } else if (apiKey) {
    activeKey = apiKey.trim();
  }
  
  if (!activeKey) {
    throw new Error(`API key not set (${detectedProv === "openrouter" ? "OpenRouter" : "Anthropic"}). Enter your key in the Settings screen first.`);
  }
  
  const params = { apiKey: activeKey, model: modelClean, system, userText, maxTokens };
  return detectedProv === "openrouter" ? reviseOpenRouter(params) : reviseAnthropic(params);
}

// ============================================================================
// STREAMING (SSE)
// So the popup can show the revision result as it is generated. Both
// providers support streaming in Server-Sent Events format; the line formats
// differ (Anthropic: content_block_delta, OpenRouter: OpenAI-style delta).
// ============================================================================

// If the silence between packets in the stream exceeds this duration, the request is aborted.
const STREAM_IDLE_TIMEOUT_MS = 30000;

async function streamSSE(url, headers, body, onData) {
  const controller = new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (networkError) {
    clearTimeout(idleTimer);
    if (networkError.name === "AbortError") {
      throw new Error(`Stream timed out (${STREAM_IDLE_TIMEOUT_MS / 1000} s of silence).`);
    }
    throw new Error(`Could not connect to the network: ${networkError.message}`);
  }
  if (!res.ok) {
    clearTimeout(idleTimer);
    const detail = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${parseErrorMessage(detail) || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // the last chunk may be incomplete; keep it for the next round
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let json;
        try { json = JSON.parse(payload); } catch (_) { continue; }
        onData(json);
      }
    }
  } catch (streamError) {
    if (streamError.name === "AbortError") {
      throw new Error(`Stream timed out (${STREAM_IDLE_TIMEOUT_MS / 1000} s of silence).`);
    }
    throw streamError;
  } finally {
    clearTimeout(idleTimer);
  }
}

async function reviseAnthropicStream({ apiKey, model, system, userText, maxTokens, onDelta }) {
  let text = "";
  await streamSSE(
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
      stream: true,
      system,
      messages: [{ role: "user", content: userText }]
    },
    (json) => {
      if (json.type === "content_block_delta" && json.delta && json.delta.type === "text_delta") {
        text += json.delta.text;
        onDelta(json.delta.text);
      } else if (json.type === "error") {
        throw new Error(`API error: ${(json.error && json.error.message) || "unknown stream error"}`);
      }
    }
  );
  const result = text.trim();
  if (!result) throw new Error("The model returned an empty response.");
  return result;
}

async function reviseOpenRouterStream({ apiKey, model, system, userText, maxTokens, onDelta }) {
  let text = "";
  await streamSSE(
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
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText }
      ]
    },
    (json) => {
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }
  );
  const result = text.trim();
  if (!result) throw new Error("The model returned an empty response.");
  return result;
}

// Streaming failover: if a model fails (while no text has been produced yet),
// move to the next model. If an error happens after the stream has started,
// partial output will already be shown, so no failover is done and the error is rethrown.
export async function reviseStreamWithFailover({ provider, apiKey, apiKeys, models, system, userText, maxTokens = 2048, onDelta = () => {} }) {
  const list = (models || []).filter(Boolean);
  if (list.length === 0) {
    throw new Error("No models to try. Choose a model in Settings.");
  }

  let lastError = null;
  for (let i = 0; i < list.length; i++) {
    const modelClean = list[i].trim();
    const detectedProv = detectProvider(modelClean, provider);
    const activeKey = ((apiKeys && apiKeys[detectedProv]) || apiKey || "").trim();
    if (!activeKey) {
      lastError = new Error(`API anahtari ayarlanmamis (${detectedProv}).`);
      continue;
    }

    let started = false;
    const guardedDelta = (chunk) => { started = true; onDelta(chunk); };
    const params = { apiKey: activeKey, model: modelClean, system, userText, maxTokens, onDelta: guardedDelta };

    try {
      const result = detectedProv === "openrouter"
        ? await reviseOpenRouterStream(params)
        : await reviseAnthropicStream(params);
      return { result, usedModel: modelClean, fellBack: i > 0, triedCount: i + 1 };
    } catch (error) {
      lastError = error;
      if (started) throw error;            // partial output exists: do not silently fail over
      if (isFatalError(error.message)) break; // key error: stop trying
    }
  }
  throw new Error(`All models failed. Last error: ${lastError ? lastError.message : "unknown"}`);
}

// On auth/permission errors all models will fail, so failover is pointless.
function isFatalError(message) {
  return /\b401\b/.test(message) || /\b403\b/.test(message);
}

// Tries the model list in order; if a model is busy/failing (429, 5xx, 400/404
// model error) it moves to the next. Returns the first successful response.
export async function reviseWithFailover({ provider, apiKey, apiKeys, models, system, userText, maxTokens = 2048 }) {
  const list = (models || []).filter(Boolean);
  if (list.length === 0) {
    throw new Error("No models to try. Choose a model in Settings.");
  }

  let lastError = null;
  for (let i = 0; i < list.length; i++) {
    try {
      const result = await revise({ provider, apiKey, apiKeys, model: list[i], system, userText, maxTokens });
      return { result, usedModel: list[i], fellBack: i > 0, triedCount: i + 1 };
    } catch (error) {
      lastError = error;
      if (isFatalError(error.message)) break; // key error: stop trying
    }
  }
  throw new Error(`All models failed. Last error: ${lastError ? lastError.message : "unknown"}`);
}
