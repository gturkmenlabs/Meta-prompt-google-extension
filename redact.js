// Masks secrets before text is persisted locally (history, memory). Pure and
// dependency-free so the studio can import it without loading the engine.
export function sanitizeForHistory(text) {
  if (!text) return "";
  let cleaned = text.replace(/(sk-[a-zA-Z0-9_-]{20,})/g, "[API-KEY-HIDDEN]");
  cleaned = cleaned.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "[EMAIL-HIDDEN]");
  cleaned = cleaned.replace(/(password|sifre|şifre)\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, "$1: [PASSWORD-HIDDEN]");
  return cleaned;
}
