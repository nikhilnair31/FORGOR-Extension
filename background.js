// background.js

import {
    CACHE_TTL_MS,
    FLUSH_MS,

    EP,
    fetchWithAuth,
    dataUrlToBlob,
    timestampName,
    refreshAccessToken,
    getTokens,
    setBadge,
    clearBadge,
    makeQueryKey
} from "./shared.js";

// ---------------------- Caching ----------------------

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
            setBadge("●", "#3b82f6")
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
        const { access_token, refresh_token } = await getTokens();
        if (!access_token && !refresh_token) {
            return { has: false, data: null };
        }

        const r = await fetchWithAuth(EP.RELEVANT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchText })
        });
        if (!r.ok) return { has: false, data: null };
        
        const j = await r.json().catch(() => null);
        putCache(searchText, j);
        
        const arr = j?.images || j?.results || j?.items || [];
        return { has: Array.isArray(arr) && arr.length > 0, data: j };
    } 
    catch { 
        return { has: false, data: null };
    }
}

// ---------------------- Server ----------------------

async function uploadScreenshot({ dataUrl, pageUrl = "", pageTitle = "", selectionText = "" }) {
    try {
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
    catch (err) {
        console.error("[BG] uploadScreenshot error", err);
        await setBadge("!", "#ff0000"); // Red for error
    }
}
async function uploadImageUrl({ imageUrl, pageUrl = "" }) {
    if (!imageUrl) throw new Error("No imageUrl provided");

    const form = new FormData();
    form.append("image_url", imageUrl);   // server expects this
    form.append("post_url", pageUrl || "-");

    const res = await fetchWithAuth(EP.UPLOAD_IMAGEURL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload URL failed: ${res.status}`);

    return res.json().catch(() => ({}));
}

// ---------------------- Login ----------------------

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("[BG] onInstalled", details);
    if (details.reason === "install") {
        console.log("[BG] Installed so opening login.html...");
        await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
    }
    if (details.reason === "update") {
        console.log("[BG] Updated so testing tokens...");
        
        // await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });

        const { access_token, refresh_token } = await getTokens();
        
        if (!access_token && refresh_token) {
            console.log(`[BG] no access token but has refresh token so refreshing the access token`);
            try {
                const newAccess = await refreshAccessToken();
                console.log("[BG] Refreshed access token OK:", newAccess ? "yes" : "no");
            } catch (err) {
                console.warn("[BG] Refresh failed, clearing tokens", err);
                await clearTokens();
                await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
            }
            
        }
        else if (!access_token || !refresh_token) {
            console.log(`[BG] No access token or refresh token so prompt re-login`);
            await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
        }
        else if (access_token && refresh_token) {
            console.log(`[BG] Got both tokens!`);
        }
    }
});

// ---------------------- Extension Icon ----------------------

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true }, async () => {
        await chrome.sidePanel.open({ windowId: tab.windowId });

        // Clear badge when panel is opened
        await clearBadge();

        // Ask the sidepanel to refresh itself if it's already open
        chrome.runtime.sendMessage({ type: "REFRESH_IF_OPEN" }).catch(() => {});
    });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url && !loginTabOpened) { queueUserAction({ title: "", domain: "", tabId }); return; }
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
    // Existing screenshot menu
    chrome.contextMenus.create({
        id: "forgor-capture-upload",
        title: "FORGOR: Take screenshot & upload",
        contexts: ["page", "selection", "image", "link", "video", "audio"]
    });

    // Upload the specific image you right-clicked
    chrome.contextMenus.create({
        id: "forgor-upload-image-url",
        title: "FORGOR: Upload this image",
        contexts: ["image"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // upload the image the user right-clicked
    if (info.menuItemId === "forgor-upload-image-url") {
        try {
            await setBadge("...", "#ffa500");

            const pageUrl = info.pageUrl || (tab && tab.url) || "";
            const srcUrl  = info.srcUrl || "";

            if (!srcUrl) throw new Error("No srcUrl on image context");

            if (srcUrl.startsWith("data:")) {
                // Fallback for inline/data images: upload the actual bytes
                await uploadScreenshot({
                    dataUrl: srcUrl,
                    pageUrl,
                    pageTitle: tab?.title || "",
                    selectionText: info.selectionText || ""
                });
            } else {
                // Normal web image: use the URL endpoint
                await uploadImageUrl({ imageUrl: srcUrl, pageUrl });
            }

            await setBadge("OK");
        } 
        catch (err) {
            console.error(err);
            await setBadge("ERR", "#ff0000");
            setTimeout(() => clearBadge(), 3000);
        }
        return; // Prevent falling through to the screenshot branch
    }
    // Existing screenshot menu
    if (info.menuItemId === "forgor-capture-upload") {
        try {
            await setBadge("...", "#ffa500");
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
            await setBadge("ERR", "#ff0000");
            setTimeout(() => clearBadge(), 3000);
        }
        return;
    };
});

// ---------------------- General ----------------------

let loginTabOpened = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg?.type === "PROMPT_LOGIN") {
            if (!loginTabOpened) {
                loginTabOpened = true;
                chrome.tabs.create({ url: chrome.runtime.getURL("login.html") })
                    .catch(e => console.warn("[AUTH] Failed to open login tab", e));
                setTimeout(() => { loginTabOpened = false; }, 10000);
            }
            sendResponse({ ok: true });
            return;
        }

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
            const res = await fetchWithAuth(EP.RELEVANT, {
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
            const res = await fetchWithAuth(EP.RELEVANT, {
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
