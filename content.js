// Injected into the page. Tracks the active editable field (textarea, input, or
// contenteditable; e.g. the Gemini/ChatGPT prompt box); on the background's
// request it reads the text and writes the revised text back into the same box.

(() => {
  let lastEditable = null;
  // State before the last SET_EDITABLE_TEXT; undone via RESTORE_EDITABLE_TEXT.
  let undoState = null; // { el, prevText }
  // Ongoing streaming write: target element and the text BEFORE the stream. The
  // undo snapshot is taken ONCE on the stream's first write; if it were taken on
  // every delta, undo would revert to partial output.
  let streamState = null; // { el, prevText }

  const isEditable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "url", "email", ""].includes(t);
    }
    return el.isContentEditable === true;
  };

  // Remember when focus lands on an editable field (so we can still write to the
  // last box even if a right-click breaks focus).
  document.addEventListener(
    "focusin",
    (e) => {
      if (isEditable(e.target)) lastEditable = e.target;
    },
    true
  );

  const currentTarget = () => {
    const active = document.activeElement;
    if (isEditable(active)) return active;
    if (lastEditable && document.contains(lastEditable)) return lastEditable;
    return null;
  };

  const readText = (el) => (el.isContentEditable ? el.innerText : el.value) || "";

  const writeText = (el, text) => {
    el.focus();
    // Select all current content.
    if (el.isContentEditable) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
    } else {
      el.select();
    }

    // insertText fires the real input events that frameworks like React/Angular
    // listen for (a direct value assignment often goes undetected).
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      // Fallback path.
      if (el.isContentEditable) {
        el.innerText = text;
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_EDITABLE_TEXT") {
      const el = currentTarget();
      sendResponse({ text: el ? readText(el) : null });
    } else if (msg.type === "SET_EDITABLE_TEXT") {
      const el = currentTarget();
      if (!el) {
        sendResponse({ ok: false });
      } else {
        try {
          undoState = { el, prevText: readText(el) };
          writeText(el, msg.text);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error && error.message) });
        }
      }
    } else if (msg.type === "STREAM_EDITABLE_TEXT") {
      // Streaming write: each message carries the FULL text so far; done=true is
      // the last message and binds the undo state to the pre-stream text.
      try {
        if (!streamState) {
          const el = currentTarget();
          if (!el) {
            sendResponse({ ok: false });
            return true;
          }
          streamState = { el, prevText: readText(el) };
        }
        if (!document.contains(streamState.el)) {
          streamState = null;
          sendResponse({ ok: false, reason: "target-lost" });
          return true;
        }
        writeText(streamState.el, msg.text);
        if (msg.done) {
          undoState = streamState;
          streamState = null;
        }
        sendResponse({ ok: true });
      } catch (error) {
        streamState = null;
        sendResponse({ ok: false, error: String(error && error.message) });
      }
    } else if (msg.type === "RESTORE_EDITABLE_TEXT") {
      if (!undoState || !document.contains(undoState.el)) {
        sendResponse({ ok: false, reason: "no-undo" });
      } else {
        try {
          writeText(undoState.el, undoState.prevText);
          undoState = null;
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error && error.message) });
        }
      }
    }
    return true; // for async sendResponse
  });
})();
