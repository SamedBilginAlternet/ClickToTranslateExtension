let copyMode = "sentence"; // default
let active = true; // default on; will read storage

// Load initial mode + activation
chrome.storage.sync.get(["copyMode", "active"], (res) => {
  if (res.copyMode) copyMode = res.copyMode;
  if (typeof res.active === "boolean") active = res.active;
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
  }
});

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
  saveToHistory(textToCopy, copyMode);
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
    chrome.storage.local.get({ history: [] }, (res) => {
      const history = res.history || [];
      history.unshift({ text, mode, ts: Date.now() });
      // keep max 20
      const max = 20;
      chrome.storage.local.set({ history: history.slice(0, max) });
    });
  } catch (e) {
    // ignore
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

    const result = await sendMessageSafe(msg, 4, 500);
    if (!result.ok) {
      const errMsg = result.error || "unknown";
      console.warn("Translation request failed:", errMsg);
      updateSidebar(text, `Translation request failed: ${errMsg}`, mode);
    } else {
      // background will still post translation-result; handle immediate errors if present
      if (result.resp && result.resp.error) {
        updateSidebar(text, `Translation error: ${result.resp.error}`, mode);
      }
    }
  } catch (e) {
    console.error("onCopiedForSidebar unexpected error:", e);
    updateSidebar(text, `Client error: ${e && e.message ? e.message : String(e)}`, mode);
  }
}

// listen for background translate result
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "translation-result") {
    updateSidebar(msg.original || "", msg.translated || msg.error || "", msg.mode || "sentence");
  } else if (msg?.type === "activation-changed") {
    // existing message handling you may have
  }
});
