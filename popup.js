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
  const dblEnable = document.getElementById("dblEnable");
  const dblAction = document.getElementById("dblAction");
  const darkCheckbox = document.getElementById("darkMode");

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
      info.innerHTML = `<div style="font-weight:600">${code}</div><div style="font-size:11px;color:var(--muted)">${name}</div>`;
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
  chrome.storage.sync.get(["copyMode","targetLang","doubleClickMode","doubleClickAction","darkMode"], (res) => {
    const mode = res.copyMode || "sentence";
    radios.forEach(r => r.checked = r.value === mode);
    const t = res.targetLang || "tr";
    targetCustom.value = t;
    renderLangGrid(t);
    try {
      if (typeof res.doubleClickMode === "boolean") dblEnable.checked = res.doubleClickMode;
      else dblEnable.checked = true;
      dblAction.value = res.doubleClickAction || "definition";
      if (typeof res.darkMode === "boolean") {
        darkCheckbox.checked = res.darkMode;
        document.body.dataset.theme = res.darkMode ? "dark" : "";
      }
    } catch (e) {
      // ignore if elements not present
    }
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

  // double-click controls
  if (dblEnable) {
    dblEnable.addEventListener("change", () => {
      chrome.storage.sync.set({ doubleClickMode: !!dblEnable.checked }, () => {
        status.textContent = `Double-click ${dblEnable.checked ? 'enabled' : 'disabled'}`;
        setTimeout(()=>status.textContent="",1200);
      });
    });
  }
  if (dblAction) {
    dblAction.addEventListener("change", () => {
      chrome.storage.sync.set({ doubleClickAction: dblAction.value }, () => {
        status.textContent = `Double-click action: ${dblAction.value}`;
        setTimeout(()=>status.textContent="",1200);
      });
    });
  }
  if (darkCheckbox) {
    darkCheckbox.addEventListener("change", () => {
      const enabled = !!darkCheckbox.checked;
      chrome.storage.sync.set({ darkMode: enabled }, () => {
        document.body.dataset.theme = enabled ? "dark" : "";
        status.textContent = `Dark mode ${enabled ? 'on' : 'off'}`;
        setTimeout(()=>status.textContent="",1200);
      });
    });
  }

  // render history
  function renderHistory(){
    chrome.storage.local.get({ history: [] }, (res) => {
      historyEl.innerHTML = "";
      const list = (res.history || []).slice(0,8);
      if (!list.length) {
        historyEl.innerHTML = `<div style="color:var(--muted);font-size:13px;margin-top:6px">No history yet</div>`;
        return;
      }
      for (const h of list) {
        const item = document.createElement("div");
        item.className = "history-item";
        item.style.borderBottom = "1px solid var(--card-border)";
        item.style.padding = "8px 6px";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.fontSize = "13px";
        title.textContent = `${h.mode.toUpperCase()}: ${h.text.slice(0,120)}`;

        const actions = document.createElement("div");
        actions.style.marginTop = "6px";

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";
        copyBtn.style.marginRight = "8px";
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(h.text);
          status.textContent = "Copied from history";
          setTimeout(()=>status.textContent="",900);
        };

        const goBtn = document.createElement("button");
        goBtn.textContent = "Go";
        goBtn.style.marginRight = "8px";
        goBtn.onclick = () => {
          // navigate to the page and highlight text
          goToEntry(h);
        };

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit note";
        editBtn.style.marginRight = "8px";
        editBtn.onclick = () => {
          const current = h.note || "";
          const v = prompt("Edit note for this entry:", current);
          if (v === null) return;
          chrome.storage.local.get({ history: [] }, (lres) => {
            const history = lres.history || [];
            const idx = history.findIndex(x => x.ts === h.ts);
            if (idx >= 0) {
              history[idx].note = v;
              chrome.storage.local.set({ history }, () => {
                status.textContent = "Note saved";
                setTimeout(()=>status.textContent="",900);
                renderHistory();
              });
            }
          });
        };

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete";
        delBtn.style.marginRight = "8px";
        delBtn.onclick = () => {
          if (!confirm("Delete this history entry?")) return;
          chrome.storage.local.get({ history: [] }, (lres) => {
            const history = (lres.history || []).filter(x => x.ts !== h.ts);
            chrome.storage.local.set({ history }, () => { renderHistory(); });
          });
        };

        const transBtn = document.createElement("button");
        transBtn.textContent = h.translated ? "Re-translate" : "Translate";
        transBtn.onclick = () => {
          status.textContent = "Translating…";
          // get current target lang then call background and update history
          chrome.storage.sync.get(["targetLang"], (sres) => {
            const target = (sres.targetLang || "tr").trim() || "tr";
            chrome.runtime.sendMessage({ type: "translate", text: h.text, mode: h.mode, source: "en", target }, (resp) => {
              if (chrome.runtime.lastError) {
                status.textContent = `Translate failed: ${chrome.runtime.lastError.message}`;
                setTimeout(()=>status.textContent="",2000);
                return;
              }
              if (!resp) {
                status.textContent = "No response from translator";
                setTimeout(()=>status.textContent="",2000);
                return;
              }
              // persist translation into local history by matching ts
              chrome.storage.local.get({ history: [] }, (lres) => {
                const history = lres.history || [];
                const idx = history.findIndex(x => x.ts === h.ts);
                if (idx >= 0) {
                  history[idx].translated = resp.translated || "";
                  history[idx].translatedAt = Date.now();
                  chrome.storage.local.set({ history }, () => {
                    status.textContent = "Translation saved";
                    setTimeout(()=>status.textContent="",900);
                    renderHistory();
                  });
                } else {
                  status.textContent = "Could not find history entry to save";
                  setTimeout(()=>status.textContent="",1200);
                }
              });
            });
          });
        };

        actions.appendChild(goBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        actions.appendChild(transBtn);

        item.appendChild(title);
        if (h.note) {
          const noteEl = document.createElement("div");
          noteEl.style.marginTop = "6px";
          noteEl.style.color = "var(--muted)";
          noteEl.style.fontSize = "12px";
          noteEl.textContent = `Note: ${h.note}`;
          item.appendChild(noteEl);
        }

        if (h.translated) {
          const tr = document.createElement("div");
          tr.style.marginTop = "6px";
          tr.style.color = "var(--text)";
          tr.style.fontSize = "13px";
          tr.textContent = h.translated;
          item.appendChild(tr);
        }
        item.appendChild(actions);
        historyEl.appendChild(item);
      }
    });
  }

  renderHistory();
  const openHistoryBtn = document.getElementById('openHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (openHistoryBtn) {
    openHistoryBtn.addEventListener('click', () => {
      const url = chrome.runtime.getURL('history.html');
      chrome.tabs.create({ url });
      window.close();
    });
  }
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (!confirm('Clear all history?')) return;
      chrome.storage.local.set({ history: [] }, () => { renderHistory(); });
    });
  }
  // helper: navigate to entry.url and highlight text in the page
  function normalizeUrl(u){
    try{ const o = new URL(u); return o.origin + o.pathname; }catch(e){ return u; }
  }
  function goToEntry(entry) {
    chrome.tabs.query({}, (tabs) => {
      const curTab = tabs.find(t => t.active && t.windowId !== undefined && t.highlighted) || null;
      const targetNorm = normalizeUrl(entry.url || "");
      // try to find an already-open tab matching the same origin+path
      const existing = tabs.find(t => {
        try { return t.url && normalizeUrl(t.url) === targetNorm; } catch(e){ return false; }
      });

      if (existing && existing.id) {
        // focus the tab and send highlight
        chrome.tabs.update(existing.id, { active: true }, () => {
          chrome.windows.update(existing.windowId, { focused: true }, () => {
            chrome.tabs.sendMessage(existing.id, { type: 'highlight-text', text: entry.text });
            window.close();
          });
        });
        return;
      }

      // otherwise navigate the current active tab to the URL (so we don't spawn a new tab)
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
        const activeTab = activeTabs && activeTabs[0];
        if (activeTab && activeTab.id) {
          // update current tab to the history URL
          chrome.tabs.update(activeTab.id, { url: entry.url }, (updated) => {
            if (!updated || !updated.id) return;
            const tabId = updated.id;
            const onUpdated = (tId, changeInfo) => {
              if (tId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                chrome.tabs.sendMessage(tabId, { type: 'highlight-text', text: entry.text });
                window.close();
              }
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
          });
        } else {
          // fallback: create a new tab
          chrome.tabs.create({ url: entry.url }, (tab) => {
            if (!tab || !tab.id) return;
            const tabId = tab.id;
            const onUpdated = (tId, changeInfo) => {
              if (tId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onUpdated);
                chrome.tabs.sendMessage(tabId, { type: 'highlight-text', text: entry.text });
                window.close();
              }
            };
            chrome.tabs.onUpdated.addListener(onUpdated);
          });
        }
      });
    });
  }
  // refresh history and update double-click controls if storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.history) renderHistory();
    if (area === "sync") {
      if (changes.doubleClickMode && dblEnable) dblEnable.checked = changes.doubleClickMode.newValue;
      if (changes.doubleClickAction && dblAction) dblAction.value = changes.doubleClickAction.newValue;
      if (changes.copyMode) copyMode = changes.copyMode.newValue;
      if (changes.darkMode && darkCheckbox) {
        darkCheckbox.checked = !!changes.darkMode.newValue;
        document.body.dataset.theme = changes.darkMode.newValue ? "dark" : "";
      }
    }
  });
});
