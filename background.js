// background.js

import {
    EP,
    store,
    fetchWithAuth,
    dataUrlToBlob,
    timestampName,
    getTokens,
    setBadge,
    clearBadge,
    makeQueryKey
} from "./shared.js";

// ---------------------- Caching ----------------------

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const queryCache = new Map(); // key -> { ts, data }

function putCache(searchText, data) {
    queryCache.set(makeQueryKey(searchText), { ts: Date.now(), data });
}

function getCache(searchText) {
    const k = makeQueryKey(searchText);
    const entry = queryCache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) { queryCache.delete(k); return null; }
    return entry.data;
}

// ---------------------- Batching ----------------------

const FLUSH_MS = 1000; // 5 seconds of no new actions -> flush
let actionBuffer = []; // [{title, domain, tabId, ts}]
let flushTimer = null;

// Push a user action into the buffer and (re)start the flush timer
function queueUserAction(entry) {
    actionBuffer.push({
        title: (entry?.title || "").trim(),
        domain: (entry?.domain || "").trim(),
        tabId: entry?.tabId ?? null,
        ts: Date.now()
    });
    scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushActions, FLUSH_MS);
}

async function flushActions() {
    flushTimer = null;
    const batch = actionBuffer.splice(0);
    if (!batch.length) return;

    const parts = Array.from(
        new Set(batch.map(it => `${it.title} ${it.domain}`.trim()).filter(Boolean))
    );
    if (!parts.length) { await clearBadge(); return; }

    const batchedSearchText = parts.join(" || ");

    try {
        const { has } = await hasResultsFor(batchedSearchText);
        if (has) {
            await chrome.action.setBadgeText({ text: "●" });
            await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
        } 
        else {
            await clearBadge();
        }
    } 
    catch (err) {
        console.error("[BG] flushActions error", err);
        await clearBadge();
    }
}

async function hasResultsFor(searchText) {
    try {
        const r = await fetchWithAuth(EP.QUERY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchText })
        });
        if (!r.ok) return { has: false, data: null };
        
        const j = await r.json().catch(() => null);
        putCache(searchText, j);
        console.log("[BG] j =", j);
        
        const arr = j?.images || j?.results || j?.items || [];
        return { has: Array.isArray(arr) && arr.length > 0, data: j };
    } 
    catch { 
        return { has: false, data: null };
    }
}

// ---------------------- Server ----------------------

async function uploadScreenshot({ dataUrl, pageUrl = "", pageTitle = "", selectionText = "" }) {
    if (!dataUrl) throw new Error("No dataUrl provided");
    
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], timestampName(), { type: blob.type });

    const form = new FormData();
    form.append("image", file);             // field name expected by backend
    // form.append("source", "chrome_screenshot");
    form.append("page_url", pageUrl);
    form.append("page_title", pageTitle);
    form.append("selection", selectionText);

    const res = await fetchWithAuth(EP.UPLOAD_IMAGE, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    
    return res.json().catch(() => ({}));
}

// ---------------------- Login ----------------------

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("[BG] onInstalled", details);
    if (details.reason === "install") {
        console.log("[BG] Opening login.html");
        await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
    }
});

// ---------------------- Extension Icon ----------------------

chrome.action.onClicked.addListener((tab) => {
    console.log("[BG] Toolbar icon clicked");
    chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }, async () => {
        console.log("[BG] sidePanel.setOptions done");
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log("[BG] sidePanel.open called");

        // Clear badge when panel is opened
        await clearBadge();

        // Ask the sidepanel to refresh itself if it's already open
        chrome.runtime.sendMessage({ type: "REFRESH_IF_OPEN" });
    });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url) { queueUserAction({ title: "", domain: "", tabId }); return; }
        let domain = ""; try { domain = new URL(tab.url).hostname; } catch {}
        queueUserAction({ title: tab.title || "", domain, tabId });
    } catch (e) {
        console.warn("[BG] onActivated get error", e);
        queueUserAction({ title: "", domain: "", tabId });
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    // We’ll buffer on common “content is ready or changed” signals:
    if (!(info.status === "complete" || "title" in info || "url" in info)) return;

    let domain = "";
    try { if (tab?.url) domain = new URL(tab.url).hostname; } catch {}

    queueUserAction({
        title: (tab?.title || ""),
        domain,
        tabId
    });
});

// ---------------------- Context Menu ----------------------

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "forgor-capture-upload",
        title: "FORGOR: Take screenshot & upload",
        contexts: ["page", "selection", "image", "link", "video", "audio"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "forgor-capture-upload") return;
    
    try {
        await setBadge("…");

        // Capture visible area of the current window's active tab
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });

        const payload = {
            dataUrl,
            pageUrl: info.pageUrl || (tab && tab.url) || "",
            pageTitle: tab && tab.title ? tab.title : "",
            selectionText: info.selectionText || ""
        };

        await uploadScreenshot(payload);
        await setBadge("OK");
    } 
    catch (err) {
        console.error(err);
        await setBadge("ERR");
    } 
    finally {
        clearBadge();
    }
});

// ---------------------- General ----------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_TOKENS") {
        sendResponse(await getTokens()); 
        return;
    }

    // Sidebar asks for cached-or-fetch
    if (msg?.type === "QUERY_CACHED_OR_FETCH") {
        const key = msg.searchText || "";
        const cached = getCache(key);
        if (cached) { 
            sendResponse({ ok: true, body: JSON.stringify(cached), fromCache: true }); 
            return; 
        }
        
        // Fallback: do a live fetch, cache, and return
        const res = await fetchWithAuth(EP.QUERY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchText: key })
        });
        const text = await res.text();
        
        try { 
            putCache(key, JSON.parse(text)); 
        } 
        catch {}
        
        sendResponse({ ok: res.ok, body: text, fromCache: false });
        return;
    }

    // Old direct fetch path (kept for compatibility)
    if (msg?.type === "QUERY") {
        const res = await fetchWithAuth(EP.QUERY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchText: msg.searchText || "" })
        });
        const text = await res.text();
        try { putCache(msg.searchText || "", JSON.parse(text)); } catch {}
        sendResponse({ ok: res.ok, body: text });
        return;
    }
  })();

  return true; // async
});
