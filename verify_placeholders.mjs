// Offline checks for the placeholder filler (placeholders.js). No API key or
// network required: `node verify_placeholders.mjs`.
import assert from "node:assert/strict";
import {
  extractPlaceholders,
  fillPlaceholders,
  countUnfilled,
  humanizePlaceholder,
  classifyPlaceholder,
  rawTextCandidates,
  proposeValue,
  rememberValues,
  MAX_REMEMBERED_NAMES,
  MAX_VALUES_PER_NAME
} from "./placeholders.js";

let pass = 0;
const ok = (cond, label) => { assert.ok(cond, label); pass += 1; console.log(`[PASS] ${label}`); };
const tokens = (text) => extractPlaceholders(text).map((s) => s.token);

// 1. Extraction: real slots in order, de-duplicated, with counts.
const sample = "Work in @[TARGET_DIR]. Run [TEST_COMMAND], then run [TEST_COMMAND] again. Read [TARGET_DIR]/[FILE].";
ok(JSON.stringify(tokens(sample)) === JSON.stringify(["[TARGET_DIR]", "[TEST_COMMAND]", "[FILE]"]), "slots come in order of first appearance, de-duplicated");
ok(extractPlaceholders(sample).find((s) => s.token === "[TEST_COMMAND]").count === 2, "repeated slots are counted");
ok(JSON.stringify(tokens("Deploy to [HEDEF_DİZİN] on [SON TARİH] with [API-KEY-HIDDEN] and [V2_URL]")) ===
  JSON.stringify(["[HEDEF_DİZİN]", "[SON TARİH]", "[API-KEY-HIDDEN]", "[V2_URL]"]), "Turkish capitals, spaces, hyphens, digits and redact markers are slots");

// 2. Extraction false positives.
ok(tokens("const x = items[IDX] + arr[0] + map[KEY_NAME];").length === 0, "code indexing is not a slot");
ok(tokens("See [DOCS](https://example.com) and [README](./README.md).").length === 0, "markdown links are not slots");
ok(tokens("- [ ] todo\n- [x] done\nsee [1] and [2]").length === 0, "checkboxes and numeric citations are not slots");
ok(tokens("[Scope & Role]: x\n[SCOPE & ROLE]: y\n  [KAPSAM & ROL]: z\n- [STEPS]: w").length === 0, "section labels at line start followed by ':' are not slots");
ok(JSON.stringify(tokens("[Steps]: 1. Read [FILE]: it holds the config.")) === JSON.stringify(["[FILE]"]), "a slot mid-line before ':' is still a slot");
ok(tokens("Search [MeSH term]/ AND [free text].ti,ab").length === 0, "mixed-case research templates are left alone (deliberate)");
ok(tokens("[A] and [x]").length === 0, "single letters are not slots");

// 3. Substitution.
ok(fillPlaceholders(sample, { "[TARGET_DIR]": "src/auth", "[TEST_COMMAND]": "npm test" }) ===
  "Work in @src/auth. Run npm test, then run npm test again. Read src/auth/[FILE].", "partial fill replaces every occurrence and keeps unfilled slots");
ok(fillPlaceholders("Use [SHELL_VAR]", { "[SHELL_VAR]": "$env:PATH $& $1" }) === "Use $env:PATH $& $1", "$ patterns in values stay literal");
ok(fillPlaceholders("[A_B] then [C_D]", { "[A_B]": "[C_D]", "[C_D]": "x" }) === "[C_D] then x", "a value containing a slot is not expanded again");
ok(fillPlaceholders("Run [CMD]", { "[CMD]": "   " }) === "Run [CMD]", "blank values keep the slot visible");
ok(fillPlaceholders("[SCOPE & ROLE]: in [DIR]", { "[SCOPE & ROLE]": "no", "[DIR]": "src" }) === "[SCOPE & ROLE]: in src", "section labels are never replaced");
ok(countUnfilled(sample, { "[FILE]": "a.js" }) === 2, "unfilled slots are counted");
ok(humanizePlaceholder("TARGET_DIR") === "Target dir" && humanizePlaceholder("HEDEF_DİZİN") === "Hedef dizin", "names are humanized for labels");

// 4. Type classification (bilingual through diacritic folding).
for (const [name, type] of [
  ["TARGET_DIR", "dir"], ["HEDEF_DİZİN", "dir"], ["CONFIG_FILE", "path"], ["TEST_COMMAND", "command"], ["TEST_KOMUTU", "command"],
  ["API_URL", "url"], ["RECIPIENT_EMAIL", "email"], ["E_POSTA", "email"], ["BASE_BRANCH", "branch"], ["DAL_ADI", "branch"],
  ["NODE_VERSION", "version"], ["SON_TARİH", "date"], ["RETRY_COUNT", "number"], ["API_KEY", "secret"], ["ŞİFRE", "secret"],
  ["PROJECT_NAME", "unknown"]
]) {
  ok(classifyPlaceholder(name) === type, `${name} is a ${type} slot`);
}

// 5. Raw-text candidates are verbatim spans.
const raw = "auth testleri patlıyor: src/auth/service.py ve tests/test_auth.py. `npm test` çalıştır, sonra pytest -q tests. " +
  "Branch: feature/login-fix. Docs: https://example.com/api/v2 — mail ops@example.com, v1.4.2, deadline 2026-10-15, 3 retries.";
ok(JSON.stringify(rawTextCandidates("path", raw)) === JSON.stringify(["src/auth/service.py", "tests/test_auth.py"]), "paths come from the raw text, URLs excluded");
ok(JSON.stringify(rawTextCandidates("command", raw)) === JSON.stringify(["npm test", "pytest -q tests"]), "backticked and known CLI commands are found and end at the sentence");
ok(JSON.stringify(rawTextCandidates("command", "run pytest tests/test_a.py -k login, then stop")) === JSON.stringify(["pytest tests/test_a.py -k login"]), "dots inside a command's paths are kept");
ok(JSON.stringify(rawTextCandidates("url", raw)) === JSON.stringify(["https://example.com/api/v2"]), "URLs are found");
ok(JSON.stringify(rawTextCandidates("email", raw)) === JSON.stringify(["ops@example.com"]), "emails are found");
ok(JSON.stringify(rawTextCandidates("branch", raw)) === JSON.stringify(["feature/login-fix"]), "branch names are found");
ok(rawTextCandidates("version", raw).includes("v1.4.2"), "versions are found");
ok(JSON.stringify(rawTextCandidates("date", raw)) === JSON.stringify(["2026-10-15"]), "dates are found");
ok(JSON.stringify(rawTextCandidates("number", raw)) === JSON.stringify(["3"]), "plain numbers skip dates and versions");
ok(JSON.stringify(rawTextCandidates("dir", raw)) === JSON.stringify(["src/auth", "tests"]), "directory slots get the folders of the files in the text");
ok(rawTextCandidates("unknown", raw).length === 0 && rawTextCandidates("secret", raw).length === 0, "unknown and secret slots get no text candidates");

// 6. Proposals: prefill only when unambiguous.
const one = proposeValue({ name: "BASE_BRANCH" }, { rawText: raw });
ok(one.value === "feature/login-fix" && one.source === "your text", "a single text candidate is prefilled");
const many = proposeValue({ name: "TARGET_FILE" }, { rawText: raw });
ok(many.value === "" && many.source === "suggestions" && many.options.length === 2, "several candidates become suggestions, not a guess");
const past = proposeValue({ name: "TARGET_FILE" }, { rawText: raw, remembered: { TARGET_FILE: ["app/main.py"] } });
ok(past.value === "app/main.py" && past.source === "remembered" && past.options[0] === "app/main.py" && past.options.length === 3, "a remembered value wins and text candidates stay as options");
const unknown = proposeValue({ name: "PROJECT_NAME" }, { rawText: raw });
ok(unknown.value === "" && unknown.source === "" && unknown.options.length === 0, "unknown slots are never guessed");
const secret = proposeValue({ name: "API_KEY" }, { rawText: "key sk-abcdefghijklmnopqrstuvwxyz", remembered: { API_KEY: ["x"] } });
ok(secret.value === "" && secret.options.length === 0, "secret slots are never proposed");

// 7. Remembered values: recency, caps, and nothing sensitive.
let store = rememberValues({}, { "[TEST_COMMAND]": "npm test" });
store = rememberValues(store, { "[TEST_COMMAND]": "pnpm test", "[TARGET_DIR]": " src " });
ok(JSON.stringify(store.TEST_COMMAND) === JSON.stringify(["pnpm test", "npm test"]) && store.TARGET_DIR[0] === "src", "most recent value comes first, trimmed");
store = rememberValues(store, { "[TEST_COMMAND]": "npm test" });
ok(JSON.stringify(store.TEST_COMMAND) === JSON.stringify(["npm test", "pnpm test"]), "a re-used value moves to the front without duplicates");
const secrets = rememberValues({}, {
  "[API_KEY]": "abc", "[ŞİFRE]": "x", "[NOTE]": "use sk-abcdefghijklmnopqrstuvwxyz", "[OWNER]": "ops@example.com", "[CTX]": "[EMAIL-HIDDEN]", "[EMPTY]": "  "
});
ok(Object.keys(secrets).length === 0, "secret slots, values redact.js would mask, redact markers and blanks are never remembered");
let capped = {};
for (let i = 0; i < 8; i += 1) capped = rememberValues(capped, { "[CMD]": `run ${i}` });
ok(capped.CMD.length === MAX_VALUES_PER_NAME && capped.CMD[0] === "run 7", "values per slot are capped");
let names = {};
for (let i = 0; i < MAX_REMEMBERED_NAMES + 5; i += 1) names = rememberValues(names, { [`[SLOT_${i}]`]: "v" });
ok(Object.keys(names).length === MAX_REMEMBERED_NAMES && !names.SLOT_0 && names[`SLOT_${MAX_REMEMBERED_NAMES + 4}`], "least recently used slot names fall off");
const before = { CMD: ["a"] };
rememberValues(before, { "[CMD]": "b" });
ok(JSON.stringify(before) === JSON.stringify({ CMD: ["a"] }), "the input store is not mutated");

console.log(`\nPlaceholder checks passed: ${pass} assertions.`);
