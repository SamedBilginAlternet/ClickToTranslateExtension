let copyMode = "sentence"; // default

// Load initial mode
chrome.storage.sync.get(["copyMode"], (res) => {
  if (res.copyMode) copyMode = res.copyMode;
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
  showToast(`Copied ${copyMode}: "${shorten(textToCopy)}"`);
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
    return node.textContent || "";
  }
  const text = node.data;
  let index = range.startOffset;

  // Expand left
  let start = index;
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
  let sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = parts[i];
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
  r.setStart(container, 0);
  r.setEnd(range.startContainer, range.startOffset);
  return r.toString().length;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.bottom = "16px";
  toast.style.right = "16px";
  toast.style.padding = "6px 10px";
  toast.style.background = "rgba(0,0,0,0.8)";
  toast.style.color = "#fff";
  toast.style.fontSize = "12px";
  toast.style.borderRadius = "4px";
  toast.style.zIndex = 999999;
  toast.style.maxWidth = "260px";

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 1200);
}

function shorten(text, max = 40) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

const LANGS = [
  // [langCode, displayName, countryCodeForFlag, emojiFallback]
  ["tr","Turkish","tr","🇹🇷"],["en","English","gb","🇬🇧"],["es","Spanish","es","🇪🇸"],["fr","French","fr","🇫🇷"],
  ["de","German","de","🇩🇪"],["it","Italian","it","🇮🇹"],["pt","Portuguese","pt","🇵🇹"],["ru","Russian","ru","🇷🇺"],
  ["zh","Chinese","cn","🇨🇳"],["ja","Japanese","jp","🇯🇵"],["ko","Korean","kr","🇰🇷"],["ar","Arabic","sa","🇸🇦"],
  ["nl","Dutch","nl","🇳🇱"],["sv","Swedish","se","🇸🇪"],["no","Norwegian","no","🇳🇴"],["pl","Polish","pl","🇵🇱"]
];

document.addEventListener("DOMContentLoaded", () => {
  const radios = Array.from(document.querySelectorAll('input[name="mode"]'));
  const langGrid = document.getElementById("langGrid");
  const targetCustom = document.getElementById("targetCustom");
  const saveBtn = document.getElementById("saveTarget");
  const status = document.getElementById("status");
  const historyEl = document.getElementById("history");

  // render language grid
  function renderLangGrid(selected) {
    langGrid.innerHTML = "";
    for (const [code,name,cc,emoji] of LANGS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lang-btn" + (selected===code ? " selected" : "");
      // build flag img + fallback emoji span
      const img = document.createElement("img");
      img.className = "lang-flag-img";
      img.src = `flags/${cc}.png`;
      img.alt = code;
      img.onerror = () => {
        img.style.display = "none";
        emojiSpan.style.display = "inline";
      };
      const emojiSpan = document.createElement("span");
      emojiSpan.className = "lang-flag-emoji";
      emojiSpan.textContent = emoji;
      // layout
      const info = document.createElement("div");
      info.style.flex = "1";
      info.style.textAlign = "left";
      info.innerHTML = `<div style="font-weight:600">${code}</div><div style="font-size:11px;color:#666">${name}</div>`;
      b.appendChild(img);
      b.appendChild(emojiSpan);
      b.appendChild(info);
      b.onclick = () => {
        targetCustom.value = code;
        selectLang(code);
      };
      langGrid.appendChild(b);
    }
  }

  function selectLang(code){
    Array.from(langGrid.children).forEach(btn => {
      const txt = btn.querySelector("div")?.textContent || "";
      btn.classList.toggle("selected", txt.trim().startsWith(code));
    });
  }

  // load saved state
  chrome.storage.sync.get(["copyMode","targetLang"], (res) => {
    const mode = res.copyMode || "sentence";
    radios.forEach(r => r.checked = r.value === mode);
    const t = res.targetLang || "tr";
    targetCustom.value = t;
    renderLangGrid(t);
  });

  // save mode radio changes
  radios.forEach(r => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      chrome.storage.sync.set({ copyMode: r.value }, () => {
        status.textContent = `Mode saved: ${r.value}`;
        setTimeout(()=>status.textContent="",1200);
      });
    });
  });

  // save target language
  saveBtn.addEventListener("click", () => {
    const v = (targetCustom.value || "").trim().toLowerCase();
    if (!v) {
      status.textContent = "Enter an ISO code first";
      setTimeout(()=>status.textContent="",1200);
      return;
    }
    chrome.storage.sync.set({ targetLang: v }, () => {
      status.textContent = `Target saved: ${v}`;
      renderLangGrid(v);
      setTimeout(()=>status.textContent="",1200);
    });
  });

  // render history
  function renderHistory(){
    chrome.storage.local.get({ history: [] }, (res) => {
      historyEl.innerHTML = "";
      const list = (res.history || []).slice(0,8);
      if (!list.length) {
        historyEl.innerHTML = `<div style="color:#666;font-size:13px;margin-top:6px">No history yet</div>`;
        return;
      }
      for (const h of list) {
        const btn = document.createElement("button");
        btn.textContent = `${h.mode.toUpperCase()}: ${h.text.slice(0,60)}`;
        btn.onclick = () => {
          navigator.clipboard.writeText(h.text);
          status.textContent = "Copied from history";
          setTimeout(()=>status.textContent="",900);
        };
        historyEl.appendChild(btn);
      }
    });
  }

  renderHistory();
  // refresh history if storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.history) renderHistory();
  });
});
