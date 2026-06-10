// Sayfaya enjekte olur. Aktif duzenlenebilir alani (textarea, input veya
// contenteditable; orn. Gemini/ChatGPT prompt kutusu) takip eder; background'in
// istegiyle metni okur ve revize edilmis metni ayni kutuya geri yazar.

(() => {
  let lastEditable = null;
  // Son SET_EDITABLE_TEXT oncesi durum; RESTORE_EDITABLE_TEXT ile geri alinir.
  let undoState = null; // { el, prevText }
  // Devam eden akisli yazim: hedef element ve akis ONCESI metin. Undo anlik
  // goruntusu akisin ilk yaziminda BIR KEZ alinir; her delta'da alinsaydi
  // geri alma yarim ciktiya donerdi.
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

  // Odak duzenlenebilir bir alana geldiyse hatirla (sag tik odagi bozsa bile
  // en son kutuya yazabilelim).
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
    // Tum mevcut icerigi sec.
    if (el.isContentEditable) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
    } else {
      el.select();
    }

    // insertText, React/Angular gibi framework'lerin dinledigi gercek input
    // olaylarini tetikler (dogrudan value atamasi cogu zaman algilanmaz).
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      // Yedek yol.
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
      // Akisli yazim: her mesaj o ana kadarki TAM metni tasir; done=true son
      // mesajdir ve undo durumunu akis oncesi metne baglar.
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
    return true; // async sendResponse icin
  });
})();
