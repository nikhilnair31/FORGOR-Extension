// background.js

import {
    CACHE_TTL_MS,
    FLUSH_MS,
    STABILITY_THRESHOLD,
    IDLE_THRESHOLD,

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

let actionBuffer = new Set();
let flushTimer = null;
let tabChangeTimer = null;
let lastQuery = null; // ✅ FIXED: declared

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url) return;
        console.log("[onActivated]", tab.title, tab.url);

        resetStabilityTimer(tab);
        queueUserAction(tab);
    } 
    catch (e) {
        console.warn("[BG] onActivated error", e);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    try {
        if (!(info.status === "complete" || "title" in info || "url" in info)) return;
        if (!tab?.url) return;
        if (info.url || info.title) {
            console.log("[onUpdated]", tab.title, tab.url);
            resetStabilityTimer(tab);
            queueUserAction(tab);
        }
    } catch (e) {
        console.warn("[BG] onUpdated error", e);
    }
});

// Push a user action into the buffer and (re)start the flush timer
function queueUserAction(tab) {
    let domain = "";
    try { domain = new URL(tab.url).hostname; } catch {}

    const title = (tab.title || "").trim();
    const key = `${title} ${domain}`.trim();
    if (!key) return;

    const beforeSize = actionBuffer.size;
    actionBuffer.add(key);
    const afterSize = actionBuffer.size;
    console.log("[queueUserAction] added:", key, "| buffer size:", afterSize, "(was", beforeSize, ")");

    // schedule flush
    if (flushTimer) {
        clearTimeout(flushTimer);
        console.log("[queueUserAction] cleared previous flush timer");
    }
    flushTimer = setTimeout(flushActions, FLUSH_MS);
    console.log("[queueUserAction] scheduled flush in", FLUSH_MS, "ms");
}

async function flushActions() {
    flushTimer = null;
    if (!actionBuffer.size) {
        console.log("[flushActions] buffer empty → skip");
        return;
    }

    const currentQuery = Array.from(actionBuffer).join(" || ");
    console.log("[flushActions] flushing buffer:", Array.from(actionBuffer));
    actionBuffer.clear();

    if (!currentQuery) {
        console.log("[flushActions] empty query → clearBadge");
        await clearBadge();
        return;
    }

    if (currentQuery === lastQuery) {
        console.log("[flushActions] same as last query → skip");
        return;
    }
    lastQuery = currentQuery;

    try {
        console.log("[flushActions] querying hasResultsFor:", currentQuery);
        const { has } = await hasResultsFor(currentQuery);
        if (has) {
            console.log("[flushActions] result found → setBadge");
            setBadge("●", "#3b82f6");
        } else {
            console.log("[flushActions] no result → clearBadge");
            await clearBadge();
        }
    } catch (err) {
        console.error("[flushActions error]", err);
        await clearBadge();
    }
}

function resetStabilityTimer(tab) {
    if (tabChangeTimer) {
        clearTimeout(tabChangeTimer);
        console.log("[resetStabilityTimer] cleared previous timer");
    }

    tabChangeTimer = setTimeout(() => {
        let domain = "";
        try { domain = new URL(tab.url).hostname; } catch {}
        const title = (tab.title || "").trim();
        const searchText = `${title} ${domain}`.trim();
        if (!searchText) {
            console.log("[resetStabilityTimer] empty searchText → skip");
            return;
        }

        console.log("[resetStabilityTimer] stable tab:", searchText);

        chrome.idle.queryState(IDLE_THRESHOLD / 1000, (state) => {
            console.log("[resetStabilityTimer] idle state:", state);
            if (state === "idle") {
                hasResultsFor(searchText).then(result => {
                    if (result.has) {
                        console.log("[resetStabilityTimer] idle+match → setBadge");
                        setBadge("●", "#3b82f6");
                    } else {
                        console.log("[resetStabilityTimer] idle+no match → clearBadge");
                        clearBadge();
                    }
                }).catch(err => {
                    console.error("[resetStabilityTimer] error", err);
                    clearBadge();
                });
            } else {
                console.log("[resetStabilityTimer] user active → skip badge update");
            }
        });
    }, STABILITY_THRESHOLD);

    console.log("[resetStabilityTimer] scheduled stability check in", STABILITY_THRESHOLD, "ms");
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
        if (!j) return { has: false, data: null };
        
        const arr = j?.images || j?.results || j?.items || [];
        console.log(arr);
        
        const threshold = 0.25;
        const filtered = arr.filter(item => 
            typeof item.hybrid_score === "number" && item.hybrid_score >= threshold
        );
        console.log(`[hasResultsFor] kept ${filtered.length} items ≥ ${threshold}`);
        
        const data = { ...j, results: filtered, items: filtered, images: filtered };
        
        putCache(searchText, data);
        
        const ret = { has: filtered.length > 0, data };
        console.log("[hasResultsFor] ret:", ret);

        return ret;
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
    }
}
async function uploadImageUrl({ imageUrl, pageUrl = "" }) {
    try {
        if (!imageUrl) throw new Error("No imageUrl provided");

        const form = new FormData();
        form.append("image_url", imageUrl);   // server expects this
        form.append("post_url", pageUrl || "-");

        const res = await fetchWithAuth(EP.UPLOAD_IMAGEURL, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Upload URL failed: ${res.status}`);

        return res.json().catch(() => ({}));
    } 
    catch (err) {
        console.error("[BG] uploadScreenshot error", err);
    }
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

            await setBadge("✔", "#b1ff7cff");
        } 
        catch (err) {
            console.error(err);
            await setBadge("❗", "#ff0000");
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
            await setBadge("✔", "#b1ff7cff");
        } 
        catch (err) {
            console.error(err);
            await setBadge("❗", "#ff0000");
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

            // ✅ reuse hasResultsFor so filtering applies
            const result = await hasResultsFor(key);
            sendResponse({ ok: true, body: JSON.stringify(result.data || {}), fromCache: false });
            return;
        }
    })();

    return true; // async
});
