// Sayfaya enjekte olur. Aktif duzenlenebilir alani (textarea, input veya
// contenteditable; orn. Gemini/ChatGPT prompt kutusu) takip eder; background'in
// istegiyle metni okur ve revize edilmis metni ayni kutuya geri yazar.

(() => {
  let lastEditable = null;

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
          writeText(el, msg.text);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error && error.message) });
        }
      }
    }
    return true; // async sendResponse icin
  });
})();
