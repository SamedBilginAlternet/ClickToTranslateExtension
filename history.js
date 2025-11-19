(function(){
  const listEl = document.getElementById('historyList');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');

  function render(){
    chrome.storage.local.get({ history: [] }, (res) => {
      const arr = (res.history || []).slice();
      listEl.innerHTML = '';
      if (!arr.length) {
        const el = document.createElement('div'); el.className='muted'; el.textContent='No history yet'; listEl.appendChild(el); return;
      }
      for (const h of arr) {
        const item = document.createElement('div'); item.className='item';
        const meta = document.createElement('div'); meta.className='meta';
        meta.innerHTML = `<div>${h.mode.toUpperCase()} • ${h.title ? escapeHtml(h.title) : ''}</div><div class="muted">${new Date(h.ts).toLocaleString()}</div>`;
        const text = document.createElement('div'); text.className='text'; text.textContent = h.text;
        const actions = document.createElement('div'); actions.className='actions';

        const openBtn = document.createElement('button'); openBtn.textContent='Open (reuse tab)';
        openBtn.title = 'Focus an already-open tab with this page, or navigate current tab if none';
        openBtn.onclick = () => {
          if (!h.url) return alert('No URL saved for this entry');
          const targetNorm = (u=>{try{return new URL(u).origin+new URL(u).pathname}catch(e){return u}})(h.url);
          // find existing tabs
          chrome.tabs.query({}, (tabs) => {
            const existing = tabs.find(t => { try { return t.url && ((new URL(t.url).origin+new URL(t.url).pathname) === targetNorm); } catch (e) { return false; } });
            if (existing && existing.id) {
              chrome.tabs.update(existing.id, { active: true }, () => {
                chrome.windows.update(existing.windowId, { focused: true }, () => {
                  chrome.tabs.sendMessage(existing.id, { type: 'highlight-text', text: h.text });
                });
              });
              return;
            }
            // no existing tab, navigate current active tab to the URL
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
              const cur = activeTabs && activeTabs[0];
              if (cur && cur.id) {
                chrome.tabs.update(cur.id, { url: h.url }, (updated) => {
                  if (!updated || !updated.id) return;
                  const tid = updated.id;
                  const onUpdated = (tId, changeInfo) => {
                    if (tId === tid && changeInfo.status === 'complete') {
                      chrome.tabs.onUpdated.removeListener(onUpdated);
                      chrome.tabs.sendMessage(tid, { type: 'highlight-text', text: h.text });
                    }
                  };
                  chrome.tabs.onUpdated.addListener(onUpdated);
                });
                return;
              }
              // fallback create new tab
              chrome.tabs.create({ url: h.url }, (tab) => {
                if (!tab || !tab.id) return;
                const tid = tab.id;
                const onUpdated = (tId, changeInfo) => {
                  if (tId === tid && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    chrome.tabs.sendMessage(tid, { type: 'highlight-text', text: h.text });
                  }
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
              });
            });
          });
        };

        const openCurBtn = document.createElement('button'); openCurBtn.textContent='Open In Current Tab';
        openCurBtn.onclick = () => {
          if (!h.url) return alert('No URL saved for this entry');
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const cur = tabs && tabs[0];
            if (!cur || !cur.id) return alert('No active tab available');
            chrome.tabs.update(cur.id, { url: h.url }, (updated) => {
              if (!updated || !updated.id) return;
              const tid = updated.id;
              const onUpdated = (tId, changeInfo) => {
                if (tId === tid && changeInfo.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(onUpdated);
                  chrome.tabs.sendMessage(tid, { type: 'highlight-text', text: h.text });
                }
              };
              chrome.tabs.onUpdated.addListener(onUpdated);
            });
          });
        };

        const copyBtn = document.createElement('button'); copyBtn.textContent='Copy';
        copyBtn.onclick = () => { navigator.clipboard.writeText(h.text).then(()=>alert('Copied')); };

        const editBtn = document.createElement('button'); editBtn.textContent='Edit Note';
        editBtn.onclick = () => {
          const cur = h.note || '';
          const v = prompt('Edit note for this entry:', cur);
          if (v === null) return;
          chrome.storage.local.get({ history: [] }, (res2) => {
            const hist = res2.history || [];
            const idx = hist.findIndex(x=>x.ts===h.ts);
            if (idx>=0) { hist[idx].note = v; chrome.storage.local.set({ history: hist }, render); }
          });
        };

        const delBtn = document.createElement('button'); delBtn.textContent='Delete';
        delBtn.onclick = () => {
          if (!confirm('Delete this entry?')) return;
          chrome.storage.local.get({ history: [] }, (res2) => {
            const hist = (res2.history || []).filter(x=>x.ts!==h.ts);
            chrome.storage.local.set({ history: hist }, render);
          });
        };

        const transBtn = document.createElement('button'); transBtn.textContent = h.translated ? 'Re-translate' : 'Translate';
        transBtn.onclick = () => {
          chrome.storage.sync.get(['targetLang'], (sres) => {
            const target = (sres.targetLang || 'tr').trim() || 'tr';
            chrome.runtime.sendMessage({ type: 'translate', text: h.text, mode: h.mode, source: 'en', target }, (resp) => {
              if (chrome.runtime.lastError) return alert('Translate failed: '+chrome.runtime.lastError.message);
              if (!resp) return alert('No response from translator');
              chrome.storage.local.get({ history: [] }, (res2) => {
                const hist = res2.history || [];
                const idx = hist.findIndex(x => x.ts === h.ts);
                if (idx >= 0) {
                  hist[idx].translated = resp.translated || '';
                  hist[idx].translatedAt = Date.now();
                  chrome.storage.local.set({ history: hist }, render);
                }
              });
            });
          });
        };

        actions.appendChild(openBtn);
        actions.appendChild(openCurBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        actions.appendChild(transBtn);

        item.appendChild(meta);
        if (h.note) { const n = document.createElement('div'); n.className='muted'; n.textContent = 'Note: ' + h.note; item.appendChild(n); }
        item.appendChild(text);
        if (h.translated) { const t = document.createElement('div'); t.style.marginTop='6px'; t.textContent = h.translated; item.appendChild(t); }
        item.appendChild(actions);
        listEl.appendChild(item);
      }
    });
  }

  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  refreshBtn.addEventListener('click', render);
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all history?')) return; chrome.storage.local.set({ history: [] }, render);
  });

  // listen for storage changes so page updates live
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.history) render();
    if (area === 'sync' && changes.darkMode) {
      document.body.dataset.theme = changes.darkMode.newValue ? 'dark' : '';
    }
  });

  // initial dark mode
  chrome.storage.sync.get(['darkMode'], (res) => { if (res.darkMode) document.body.dataset.theme = res.darkMode ? 'dark' : ''; });

  // initial render
  render();
})();