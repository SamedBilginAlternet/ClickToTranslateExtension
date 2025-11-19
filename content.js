let copyMode = "sentence"; // default
let active = true; // default on; will read storage
let doubleClickMode = true; // show meanings on double-click (default enabled)
let doubleClickAction = "definition"; // "definition" | "translate"

// Load initial mode + activation
chrome.storage.sync.get(["copyMode", "active", "doubleClickMode", "doubleClickAction"], (res) => {
  if (res.copyMode) copyMode = res.copyMode;
  if (typeof res.active === "boolean") active = res.active;
  if (typeof res.doubleClickMode === "boolean") doubleClickMode = res.doubleClickMode;
  if (res.doubleClickAction) doubleClickAction = res.doubleClickAction;
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "context-copy" && msg.mode) {
    // emulate copy at selection or caret for chosen mode
    const mode = msg.mode; // "word" | "sentence" | "paragraph"
    handleContextCopy(mode, sendResponse);
    return true; // will respond asynchronously
  }
});

// Update when popup changes it
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.copyMode) {
    copyMode = changes.copyMode.newValue;
    } else if (area === "sync" && changes.doubleClickMode) {
      doubleClickMode = changes.doubleClickMode.newValue;
    } else if (area === "sync" && changes.doubleClickAction) {
      doubleClickAction = changes.doubleClickAction.newValue;
  }
});

// Double-click handler: show meaning tooltip above the word
document.addEventListener(
  "dblclick",
  (event) => {
    try {
      if (!active || !doubleClickMode) return;

      // prefer user selection if present
      const sel = window.getSelection()?.toString()?.trim();
      let word = sel && sel.length ? sel : null;

      if (!word) {
        const range = getCaretRangeFromPoint(event.clientX, event.clientY);
        if (!range) return;
        word = getWordFromRange(range);
      }

      word = (word || "").trim();
      if (!word) return;

      // only single words (no spaces)
      if (/\s/.test(word)) {
        // do nothing for multi-word selections
        return;
      }

      // compute rect for positioning
      let rect = null;
      try {
        const r = window.getSelection()?.getRangeAt(0) || null;
        if (r) rect = r.getBoundingClientRect();
      } catch (e) {
        rect = null;
      }

      // fallback to mouse point
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        rect = { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY, width: 0, height: 0 };
      }

      showDefinitionForWord(word, rect);
    } catch (e) {
      console.error("dblclick handler error:", e);
    }
  },
  true
);

// remove tooltip on any interaction
document.addEventListener("click", (e) => {
  const t = document.getElementById("sch-dbl-tooltip");
  if (t) t.remove();
  window._sch_dbl_current = null;
}, true);

let _sch_dbl_timeout = null;

async function showDefinitionForWord(word, rect) {
  try {
    // remove any existing tooltip
    const existing = document.getElementById("sch-dbl-tooltip");
    if (existing) existing.remove();
    if (_sch_dbl_timeout) {
      clearTimeout(_sch_dbl_timeout);
      _sch_dbl_timeout = null;
    }

    const tooltip = document.createElement("div");
    tooltip.id = "sch-dbl-tooltip";
    tooltip.dataset.original = word;
    tooltip.innerHTML = `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(word)}</div><div style="font-size:13px;color:#111" id="sch-dbl-def">Loading…</div>`;
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: 2147483647,
      background: "rgba(255,255,255,0.88)",
      color: "#111",
      padding: "8px 10px",
      borderRadius: "8px",
      boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
      maxWidth: "360px",
      fontSize: "13px",
      lineHeight: "1.28",
      pointerEvents: "auto",
      backdropFilter: "saturate(120%) blur(4px)",
    });

    document.body.appendChild(tooltip);
    // remember original rect for repositioning later
    tooltip.dataset.rectTop = String(rect.top || 0);
    tooltip.dataset.rectBottom = String(rect.bottom || 0);

    // measure and position
    const pad = 8;
    const ttRect = tooltip.getBoundingClientRect();
    const centerX = (rect.left + (rect.width || 0) / 2) || rect.left || (rect.right || 0);
    let left = Math.round(centerX - ttRect.width / 2);
    left = Math.max(pad, Math.min(left, window.innerWidth - ttRect.width - pad));
    // prefer above the selection
    let top = Math.round(rect.top - ttRect.height - 10);
    if (top < 8) {
      top = Math.round(rect.bottom + 10);
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";

    // fetch definition or request translation asynchronously based on action
    const defEl = tooltip.querySelector("#sch-dbl-def");
    // expose current word for translation-result handling
    window._sch_dbl_current = word;

    if (doubleClickAction === "translate") {
      defEl.textContent = "Translating…";
      // ask background to translate; background will post back a translation-result message
      storageGet({ targetLang: "tr" }).then((res) => {
        const target = (res.targetLang || "tr").trim() || "tr";
        try {
          chrome.runtime.sendMessage({ type: "translate", text: word, mode: "word", source: "en", target });
        } catch (e) {
          console.warn("translate sendMessage failed", e);
          defEl.textContent = "(translate request failed)";
        }
      });
    } else {
      // definition
      fetchDefinition(word).then((defText) => {
        if (!defText) defEl.textContent = "(no definition found)";
        else defEl.textContent = defText;
        // reposition in case height changed
        const newRect = tooltip.getBoundingClientRect();
        let newTop = Math.round(rect.top - newRect.height - 10);
        if (newTop < 8) newTop = Math.round(rect.bottom + 10);
        tooltip.style.top = newTop + "px";
      }).catch((err) => {
        console.warn("definition fetch failed", err);
        defEl.textContent = "(definition fetch failed)";
      });
    }

    // auto-dismiss after 7s
    _sch_dbl_timeout = setTimeout(() => {
      tooltip.remove();
      window._sch_dbl_current = null;
      _sch_dbl_timeout = null;
    }, 7000);
  } catch (e) {
    console.error("showDefinitionForWord error:", e);
  }
}

async function fetchDefinition(word) {
  try {
    // use free Dictionary API
    const api = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(api, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    // collect first few definitions
    const meanings = data[0].meanings || [];
    const defs = [];
    for (const m of meanings) {
      for (const d of (m.definitions || [])) {
        if (d.definition) defs.push(d.definition);
        if (defs.length >= 3) break;
      }
      if (defs.length >= 3) break;
    }
    return defs.join(" — ");
  } catch (e) {
    return null;
  }
}

// Global Alt+Click handler
document.addEventListener(
  "click",
  (event) => {
    if (!active) return; // do nothing unless activated
    // Require Alt key so we don't break normal usage
    if (!event.altKey) return;

    // Avoid triggering links/forms
    event.preventDefault();
    event.stopPropagation();

    handleSmartCopy(event).catch((err) => console.error(err));
  },
  true
);

async function handleSmartCopy(event) {
  const range = getCaretRangeFromPoint(event.clientX, event.clientY);
  if (!range) return;

  let textToCopy = "";

  if (copyMode === "word") {
    textToCopy = getWordFromRange(range);
  } else if (copyMode === "sentence") {
    textToCopy = getSentenceFromRange(range);
  } else {
    textToCopy = getParagraphFromRange(range);
  }

  textToCopy = (textToCopy || "").trim();
  if (!textToCopy) return;

  await navigator.clipboard.writeText(textToCopy);
  const label = capitalize(copyMode);
  showToast(`${label} copied: "${shorten(textToCopy)}"`);
  await saveToHistory(textToCopy, copyMode);
  onCopiedForSidebar(textToCopy, copyMode);
}

async function handleContextCopy(mode, respond) {
  try {
    let text = "";
    if (window.getSelection && window.getSelection().toString().trim()) {
      text = window.getSelection().toString();
      // If selection is empty but mode is sentence/word, you may compute from caret
    } else {
      // attempt to use caret from viewport center
      const x = window.innerWidth / 2,
        y = window.innerHeight / 2;
      const range = getCaretRangeFromPoint(x, y);
      if (!range) return;
      if (mode === "word") text = getWordFromRange(range);
      else if (mode === "sentence") text = getSentenceFromRange(range);
      else text = getParagraphFromRange(range);
    }
    text = (text || "").trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    showToast(`${capitalize(mode)} copied`);
    await saveToHistory(text, mode);
    onCopiedForSidebar(text, mode);
    // save history (see next section)
  } catch (e) {
    console.error(e);
  }
}

// ---- helpers ----

function getCaretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  const pos = document.caretPositionFromPoint?.(x, y);
  if (pos) {
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

function getWordFromRange(range) {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    const text = node.textContent || "";
    return text.trim().split(/\s+/)[0] || "";
  }
  const text = node.data;
  let index = Math.max(0, Math.min(range.startOffset, text.length));
  let start = index;
  // Expand left
  while (start > 0 && !/\s/.test(text[start - 1])) start--;

  // Expand right
  let end = index;
  while (end < text.length && !/\s/.test(text[end])) end++;

  return text.slice(start, end);
}

function getSentenceFromRange(range) {
  const block = findBlockAncestor(range.startContainer) || document.body;
  const fullText = block.innerText || block.textContent || "";
  const caretIndex = getCaretIndexWithin(block, range);

  // Split into sentences, keep delimiters with them
  const parts = fullText.split(/([.!?]+["']?\s+)/);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = parts[i] || "";
    const sep = parts[i + 1] || "";
    sentences.push(chunk + sep);
  }

  let acc = 0;
  for (const s of sentences) {
    const start = acc;
    const end = acc + s.length;
    if (caretIndex >= start && caretIndex <= end) {
      return s;
    }
    acc = end;
  }

  // Fallback: whole block
  return fullText;
}

function getParagraphFromRange(range) {
  const block = findBlockAncestor(range.startContainer) || document.body;
  return (block.innerText || block.textContent || "").trim();
}

function findBlockAncestor(node) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (el && el !== document.body) {
    const display = window.getComputedStyle(el).display;
    if (
      display === "block" ||
      display === "list-item" ||
      display === "table-cell"
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function getCaretIndexWithin(container, range) {
  const r = document.createRange();
  try {
    r.setStart(container, 0);
    r.setEnd(range.startContainer, range.startOffset);
    return r.toString().length;
  } catch {
    return 0;
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    fontSize: "12px",
    borderRadius: "4px",
    zIndex: 2147483647,
    maxWidth: "320px",
    wordBreak: "break-word",
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1400);
}

function shorten(text, max = 40) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

async function saveToHistory(text, mode) {
  try {
    return new Promise((resolve) => {
      chrome.storage.local.get({ history: [] }, (res) => {
        const history = res.history || [];
        const entry = { text, mode, ts: Date.now() };
        history.unshift(entry);
        // keep max 20
        const max = 20;
        chrome.storage.local.set({ history: history.slice(0, max) }, () => resolve(entry.ts));
      });
    });
  } catch (e) {
    return null;
  }
}

// add these helper functions and message handling near the bottom of the file
function ensureSidebar() {
  if (document.getElementById("sch-sidebar")) return;
  const sb = document.createElement("div");
  sb.id = "sch-sidebar";
  Object.assign(sb.style, {
    position: "fixed",
    right: "8px",
    top: "60px",
    width: "360px",
    height: "60vh",
    background: "#fff",
    color: "#111",
    border: "1px solid rgba(0,0,0,0.12)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
    zIndex: 2147483646,
    padding: "10px",
    overflow: "auto",
    fontSize: "13px",
    borderRadius: "6px",
  });
  sb.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px">Smart Copy — Sidebar</div>
    <div id="sch-sidebar-body" style="white-space:pre-wrap"></div>
    <div style="margin-top:8px">
      <button id="sch-close" style="float:right">Close</button>
    </div>
  `;
  document.body.appendChild(sb);
  document.getElementById("sch-close").onclick = () => sb.remove();
}

function updateSidebar(original, translated, mode) {
  ensureSidebar();
  const body = document.getElementById("sch-sidebar-body");
  body.innerHTML = `<div style="font-size:12px;color:#666">Mode: ${mode}</div>
    <div style="margin-top:6px"><strong>Original</strong><div>${escapeHtml(original)}</div></div>
    <hr />
    <div><strong>Translation</strong><div>${escapeHtml(translated || "(no translation)")}</div></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// small promise wrapper for chrome.storage.sync.get
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, (res) => resolve(res)));
}

/* safe sendMessage with retries to avoid "Extension context invalidated" */
async function sendMessageSafe(msg, retries = 3, delay = 400) {
  for (let i = 0; i < retries; i++) {
    const result = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve({ resp });
        });
      } catch (e) {
        resolve({ error: String(e) });
      }
    });

    if (!result.error) return { ok: true, resp: result.resp };
    const errText = (result.error || "").toLowerCase();
    // retry on context invalidated or transient failures
    if (errText.includes("extension context invalidated") || i < retries - 1) {
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return { ok: false, error: result.error };
  }
  return { ok: false, error: "sendMessage failed after retries" };
}

/* replace onCopiedForSidebar with a defensive implementation */
async function onCopiedForSidebar(text, mode) {
  try {
    updateSidebar(text, "Translating…", mode);

    const res = await storageGet({ targetLang: "tr" });
    const target = (res.targetLang || "tr").trim() || "tr";
    const msg = { type: "translate", text, mode, source: "en", target };
    // Try sending message; if the service worker restarted you may get
    // 'Extension context invalidated' — in that case do one more retry with longer timeout.
    let result = await sendMessageSafe(msg, 4, 500);
    if (!result.ok) {
      const errMsg = result.error || "unknown";
      console.warn("Translation request failed:", errMsg);
      if ((errMsg || "").toLowerCase().includes("extension context invalidated")) {
        // one more attempt with higher retries/delay
        updateSidebar(text, "Background restarted — retrying translation…", mode);
        result = await sendMessageSafe(msg, 6, 1000);
      }

      if (!result.ok) {
        const finalErr = result.error || "unknown";
        updateSidebar(text, `Translation request failed: ${finalErr}`, mode);
        return;
      }
    }

    // If we get an immediate response that contains an error, show it; if it contains
    // a translated string show it immediately. Otherwise the background will later
    // post a `translation-result` message which we already handle.
    if (result.resp && result.resp.error) {
      updateSidebar(text, `Translation error: ${result.resp.error}`, mode);
    } else if (result.resp && result.resp.translated) {
      updateSidebar(text, result.resp.translated, mode);
    }
  } catch (e) {
    console.error("onCopiedForSidebar unexpected error:", e);
    const msg = e && e.message ? e.message : String(e);
    console.warn("onCopiedForSidebar caught:", msg);
    if (msg.toLowerCase().includes("extension context invalidated")) {
      // attempt a last-ditch retry
      updateSidebar(text, "Client error: background restarted — retrying…", mode);
      try {
        const res2 = await storageGet({ targetLang: "tr" });
        const target2 = (res2.targetLang || "tr").trim() || "tr";
        const msg2 = { type: "translate", text, mode, source: "en", target: target2 };
        const r2 = await sendMessageSafe(msg2, 6, 800);
        if (r2.ok && r2.resp && r2.resp.translated) {
          updateSidebar(text, r2.resp.translated, mode);
          return;
        }
      } catch (e2) {
        console.warn("retry also failed:", e2);
      }
    }
    updateSidebar(text, `Client error: ${msg}`, mode);
  }
}

// listen for background translate result
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "translation-result") {
    updateSidebar(msg.original || "", msg.translated || msg.error || "", msg.mode || "sentence");
    // If a double-click tooltip exists for the same original word, update it as well
    try {
      const cur = window._sch_dbl_current || null;
      const tt = document.getElementById("sch-dbl-tooltip");
      if (tt && cur && msg.original && cur === msg.original) {
        const defEl = tt.querySelector("#sch-dbl-def");
        if (defEl) {
          defEl.textContent = msg.translated || msg.error || "(no translation)";
          // reposition
          const newRect = tt.getBoundingClientRect();
          let newTop = Math.round((tt.dataset.rectTop ? Number(tt.dataset.rectTop) : 0) - newRect.height - 10);
          if (!newTop || newTop < 8) newTop = Math.round((tt.dataset.rectBottom ? Number(tt.dataset.rectBottom) : 0) + 10);
          tt.style.top = newTop + "px";
        }
        // clear current marker after update
        window._sch_dbl_current = null;
      }
    } catch (e) {
      // ignore
    }
    // persist translation into local history if present
    try {
      if (msg.original) {
        chrome.storage.local.get({ history: [] }, (res) => {
          const history = res.history || [];
          const idx = history.findIndex(h => h.text === msg.original && !h.translated);
          if (idx >= 0) {
            history[idx].translated = msg.translated || "";
            history[idx].translatedAt = Date.now();
            chrome.storage.local.set({ history });
          }
        });
      }
    } catch (e) {
      // ignore
    }
  } else if (msg?.type === "activation-changed") {
    // existing message handling you may have
  }
});
