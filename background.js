// Replace existing background.js with this MyMemory-focused implementation.

const MYMEMORY_HOST = "https://api.mymemory.translated.net";
const DE_PARAM = encodeURIComponent("your-email-or-app@example.com"); // replace to improve quota
const CHUNK_MAX = 450; // safe chunk size (characters)

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function splitToChunks(text, maxLen = CHUNK_MAX) {
  if (!text || text.length <= maxLen) return [text];
  const parts = text.match(/[^.!?]+[.!?]*/g) || []; // split by sentences
  if (!parts.length) {
    const out = [];
    for (let i = 0; i < text.length; i += maxLen) out.push(text.slice(i, i + maxLen));
    return out;
  }
  const chunks = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length <= maxLen) {
      cur += p;
    } else {
      if (cur) chunks.push(cur);
      cur = p;
      if (cur.length > maxLen) {
        for (let i = 0; i < cur.length; i += maxLen) {
          chunks.push(cur.slice(i, i + maxLen));
        }
        cur = "";
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function translateChunk(chunk, src = "en", target = "tr") {
  const langpair = `${encodeURIComponent(src)}|${encodeURIComponent(target)}`;
  const url = `${MYMEMORY_HOST}/get?q=${encodeURIComponent(chunk)}&langpair=${langpair}&de=${DE_PARAM}`;
  const res = await fetchWithTimeout(url, { method: "GET", headers: { Accept: "application/json" } }, 10000);
  if (!res) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  let translated = data?.responseData?.translatedText || "";
  if (!translated && Array.isArray(data?.matches) && data.matches.length) {
    translated = data.matches[0].translation || data.matches[0].translatedText || "";
  }
  return translated || "";
}

async function myMemoryTranslate(text, src = "en", target = "tr") {
  const chunks = splitToChunks(text);
  if (chunks.length === 1) {
    return await translateChunk(chunks[0], src, target);
  }
  const results = [];
  for (const c of chunks) {
    try {
      const t = await translateChunk(c, src, target);
      results.push(t);
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn("[background] chunk translate failed:", err);
      results.push("");
    }
  }
  return results.filter(Boolean).join(" ");
}

// Single translation message handler. Supports both content-script callers (sender.tab)
// and popup callers (no sender.tab). When caller is popup we reply using sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "translate" || !msg.text) return false;

  (async () => {
    try {
      const src = msg.source || "en";
      const target = msg.target || "tr";
      console.debug("[background] translate request (MyMemory)", { len: msg.text.length, source: src, target });
      const translated = await myMemoryTranslate(msg.text, src, target);

      const payload = { type: "translation-result", original: msg.text, translated, mode: msg.mode || "sentence" };

      if (sender?.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, payload);
      } else {
        try { sendResponse(payload); } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error("[background] translation error:", err);
      const payload = { type: "translation-result", original: msg.text, translated: "", error: `Translation failed: ${String(err)}` };
      if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, payload);
      else try { sendResponse(payload); } catch (e) { /* ignore */ }
    }
  })();

  // indicate we'll call sendResponse asynchronously
  return true;
});