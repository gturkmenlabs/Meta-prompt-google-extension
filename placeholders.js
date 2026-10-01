// Placeholder filler: finds the [UPPERCASE_PLACEHOLDER]s a generated prompt
// left open and proposes values for them — deterministically, in the browser,
// with no model call. A proposed value only ever comes from the user: what
// they typed for the same slot before (remembered locally) or a verbatim span
// of their raw text. Nothing is invented, so the prompt's fidelity rules hold.
// Pure functions: they take and return plain data and never touch storage.
import { foldDiacritics } from "./prompt.js";
import { sanitizeForHistory } from "./redact.js";

export const PLACEHOLDER_MEMORY_KEY = "placeholderValues";
export const MAX_REMEMBERED_NAMES = 30;
export const MAX_VALUES_PER_NAME = 5;

// Uppercase-only on purpose: lowercase brackets are mostly real text
// (checkboxes [x], citations [1], markdown links, research templates such as
// [MeSH term]) and filling them would change the prompt, not complete it.
// Turkish capitals count as uppercase. Not preceded by a word character or "]"
// (code indexing: items[IDX]) and not followed by "(" (markdown link).
const UPPER = "A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc";
const PLACEHOLDER_RE = new RegExp(`(?<![\\w\\]])\\[([${UPPER}][${UPPER}0-9_ \\-/&.]*[${UPPER}0-9_])\\](?!\\()`, "gu");

// "[SCOPE & ROLE]:" at the start of a line is a section label, not a slot.
function isSectionLabel(text, offset, token) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const after = text.slice(offset + token.length);
  return /^[\s>*#-]*$/.test(before) && /^\s*:/.test(after);
}

function forEachPlaceholder(text, fn) {
  const source = String(text || "");
  return source.replace(PLACEHOLDER_RE, (token, name, offset) =>
    isSectionLabel(source, offset, token) ? token : fn(token, name));
}

// Ordered, de-duplicated slots: [{ token, name, count }].
export function extractPlaceholders(text) {
  const slots = new Map();
  forEachPlaceholder(text, (token, name) => {
    const slot = slots.get(token) || { token, name, count: 0 };
    slot.count += 1;
    slots.set(token, slot);
    return token;
  });
  return [...slots.values()];
}

// One pass with a callback: "$&"/"$1" inside a value stay literal, and a value
// that itself contains a [TOKEN] is never expanded again. Empty values keep
// their token so the gap stays visible.
export function fillPlaceholders(text, values = {}) {
  return forEachPlaceholder(text, (token) => {
    const value = values[token];
    return typeof value === "string" && value.trim() ? value : token;
  });
}

export function countUnfilled(text, values = {}) {
  return extractPlaceholders(text).filter(({ token }) => !(values[token] || "").trim()).length;
}

// "TARGET_DIR" -> "Target dir"
export function humanizePlaceholder(name) {
  // "İ".toLowerCase() adds a combining dot; map it to a plain "i" first.
  const words = String(name).replace(/İ/g, "i").toLowerCase().replace(/[_\-/.]+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Name parts after folding, so "HEDEF_DİZİN" and "HEDEF_DIZIN" classify alike.
const TYPE_WORDS = [
  ["secret",  ["KEY", "APIKEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "SIFRE", "PAROLA", "CREDENTIAL", "CREDENTIALS"]],
  ["url",     ["URL", "LINK", "ENDPOINT", "WEBSITE", "DOMAIN"]],
  ["email",   ["EMAIL", "MAIL", "EPOSTA"]],
  ["command", ["COMMAND", "CMD", "SCRIPT", "KOMUT", "KOMUTU"]],
  ["dir",     ["DIR", "DIRECTORY", "FOLDER", "DIZIN", "DIZINI", "KLASOR", "KLASORU"]],
  ["path",    ["FILE", "PATH", "MODULE", "DOSYA", "DOSYASI", "MODUL"]],
  ["branch",  ["BRANCH", "DAL", "DALI"]],
  ["version", ["VERSION", "SURUM", "VER"]],
  ["date",    ["DATE", "DEADLINE", "TARIH", "TARIHI"]],
  ["number",  ["NUMBER", "COUNT", "AMOUNT", "PORT", "LIMIT", "SAYI", "SAYISI", "ADET", "MIKTAR"]]
];

export function classifyPlaceholder(name) {
  const parts = foldDiacritics(String(name)).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const joined = parts.join("");
  for (const [type, words] of TYPE_WORDS) {
    if (parts.some((part) => words.includes(part)) || (type === "email" && joined.includes("EPOSTA"))) return type;
  }
  return "unknown";
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FILE_EXT = "js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|hpp|swift|md|json|ya?ml|toml|ini|env|html|css|scss|sql|sh|ps1|bat|txt|csv|xml|lock|dockerfile";
const PATH_RE = new RegExp(`(?:[A-Za-z]:\\\\|~?\\.{0,2}\\/)?[\\w.@-]+(?:[\\/\\\\][\\w.@-]+)+[\\/\\\\]?|\\b[\\w-]+\\.(?:${FILE_EXT})\\b`, "gi");
const CLI_TOOLS = "npm|pnpm|yarn|npx|bun|deno|node|pytest|python3?|pip|go|cargo|make|mvn|gradle|dotnet|docker|git|jest|vitest|tsc|eslint|ruff|uv|poetry|rake|bundle|composer|phpunit";
// A command ends at a line break, a comma/semicolon, a quote or bracket, or a
// sentence-ending "." / ":" (one followed by a space); dots inside paths stay.
const COMMAND_RE = new RegExp(`(?:^|[\\s(])((?:${CLI_TOOLS})\\s(?:[^\\n,;\`"'().:]|[.:](?=\\S))+)`, "gi");
const BACKTICK_RE = /`([^`\n]+)`/g;
const BRANCH_RE = /\b(?:branch|dal[ıi]?|branşı?)\s*[:=]?\s*[`"']?([\w./-]*[\w-])/gi;
const VERSION_RE = /\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g;
const NUMBER_RE = /(?<![\w.])\d+(?:[.,]\d+)?(?![\w.])/g;

const uniq = (items) => [...new Set(items.map((s) => s.trim()).filter(Boolean))];
const all = (re, text, group = 0) => [...String(text).matchAll(re)].map((m) => m[group]);

// Verbatim spans of the raw text that fit a slot type, in order of appearance.
export function rawTextCandidates(type, rawText = "") {
  const text = String(rawText || "");
  const withoutUrls = text.replace(URL_RE, " ").replace(EMAIL_RE, " ");
  switch (type) {
    case "url": return uniq(all(URL_RE, text));
    case "email": return uniq(all(EMAIL_RE, text));
    case "path": {
      // A named branch ("branch: feature/x") looks like a path; it is not one.
      const branches = new Set(rawTextCandidates("branch", text));
      return uniq(all(PATH_RE, withoutUrls).map((p) => p.replace(/[.,:;]+$/, "")))
        .filter((p) => !branches.has(p) && !/^v?\d+(\.\d+)+$/.test(p) && !/^\d+[./]\d+([./]\d+)?$/.test(p));
    }
    case "dir": return uniq(rawTextCandidates("path", text).map((p) =>
      // A file names its directory; a path without an extension already is one.
      /\.\w+$/.test(p) ? p.replace(/[\/\\][^\/\\]*$/, "") : p.replace(/[\/\\]$/, ""))
    ).filter((d) => d && !/\.\w+$/.test(d));
    case "command": return uniq([
      ...all(BACKTICK_RE, text, 1).filter((c) => new RegExp(`^(?:${CLI_TOOLS})\\s`, "i").test(c)),
      ...all(COMMAND_RE, text, 1)
    ]);
    case "branch": return uniq(all(BRANCH_RE, text, 1));
    case "version": return uniq(all(VERSION_RE, withoutUrls));
    case "date": return uniq(all(DATE_RE, text));
    case "number": return uniq(all(NUMBER_RE, withoutUrls.replace(DATE_RE, " ").replace(VERSION_RE, " ")));
    default: return [];
  }
}

// Proposal for one slot: { type, value, source, options }.
// Prefill only when the answer is unambiguous: the value typed last for this
// slot, or the single raw-text candidate. Several candidates become options.
// Secrets are never proposed.
export function proposeValue(slot, { rawText = "", remembered = {} } = {}) {
  const type = classifyPlaceholder(slot.name);
  if (type === "secret") return { type, value: "", source: "", options: [] };
  const past = Array.isArray(remembered[slot.name]) ? remembered[slot.name] : [];
  const fromText = rawTextCandidates(type, rawText);
  const options = uniq([...past, ...fromText]);
  if (past.length) return { type, value: past[0], source: "remembered", options };
  if (fromText.length === 1) return { type, value: fromText[0], source: "your text", options };
  return { type, value: "", source: fromText.length ? "suggestions" : "", options };
}

// New remembered-values store with the given fills added (most recent first).
// Skips secret-looking slots, values that redact.js would mask, and redact
// markers, so nothing sensitive is ever written. Least recently used names
// fall off past MAX_REMEMBERED_NAMES.
export function rememberValues(store = {}, values = {}) {
  const next = new Map(Object.entries(store || {}));
  for (const [token, raw] of Object.entries(values || {})) {
    const value = typeof raw === "string" ? raw.trim() : "";
    const name = token.replace(/^\[|\]$/g, "");
    if (!value || classifyPlaceholder(name) === "secret") continue;
    if (sanitizeForHistory(value) !== value || /-HIDDEN\]/.test(value)) continue;
    const previous = (next.get(name) || []).filter((v) => v !== value);
    next.delete(name);
    next.set(name, [value, ...previous].slice(0, MAX_VALUES_PER_NAME));
  }
  return Object.fromEntries([...next.entries()].slice(-MAX_REMEMBERED_NAMES));
}
