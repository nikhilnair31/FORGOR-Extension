// background.js

import {
    CACHE_TTL_MS,
    FLUSH_MS,
    CLEAR_IN_TIME,

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
let lastQuery = null; // ✅ FIXED: declared

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url) return;

        // Auto-refresh sidepanel if toggle is enabled
        const { autoRefreshEnabled } = await chrome.storage.sync.get(["autoRefreshEnabled"]);
        if (autoRefreshEnabled) {
            try {
                chrome.runtime.sendMessage({ type: "REFRESH_IF_OPEN" }).catch(() => {});
            } catch (e) {
                console.warn("[BG] autoRefresh message failed", e);
            }
        }

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

    actionBuffer.add(key);

    // schedule flush
    if (flushTimer) {
        clearTimeout(flushTimer);
    }
    flushTimer = setTimeout(flushActions, FLUSH_MS);
}

async function flushActions() {
    flushTimer = null;
    if (!actionBuffer.size) {
        return;
    }

    const currentQuery = Array.from(actionBuffer).join(" || ");
    actionBuffer.clear();

    if (!currentQuery) {
        await clearBadge();
        return;
    }
    if (currentQuery === lastQuery) {
        return;
    }
    lastQuery = currentQuery;

    try {
        const { has } = await hasResultsFor(currentQuery);
        if (has) {
            setBadge("●", "#3b82f6");
            setTimeout(() => clearBadge(), CLEAR_IN_TIME);
        } else {
            await clearBadge();
        }
    } catch (err) {
        console.error("[flushActions error]", err);
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
        if (!j) return { has: false, data: null };
        
        const arr = j?.images || j?.results || j?.items || [];
        
        const threshold = 0.25;
        const topScore = arr.length > 0 && typeof arr[0].hybrid_score === "number"
            ? arr[0].hybrid_score
            : 0;
        
        // ✅ If topScore passes, return full list
        if (topScore >= threshold) {
            putCache(searchText, j);
            const ret = { has: true, data: j };
            return ret;
        } 
        else {
            console.log("[hasResultsFor] below threshold → no results");
            return { has: false, data: null };
        }
    } 
    catch { 
        return { has: false, data: null };
    }
}

// ---------------------- User Tier and Saves ----------------------

let userTierInfo = {
    tier: "Free",
    currentSaves: 0,
    maxSaves: 3,
    uploadsLeft: 3,
};

async function fetchUserTierInfo() {
    try {
        const { access_token } = await getTokens();
        if (!access_token) {
            console.log("[BG] No access token, skipping tier info fetch.");
            return;
        }

        const res = await fetchWithAuth(EP.USER_TIER_INFO);
        if (!res.ok) {
            console.warn(`[BG] Failed to fetch user tier info: ${res.status}`);
            // If 401, tokens might be bad, prompt login
            if (res.status === 401) {
                chrome.runtime.sendMessage({ type: "PROMPT_LOGIN" }).catch(() => {});
            }
            return;
        }

        const data = await res.json();
        userTierInfo = {
            tier: data.tier || "Free",
            currentSaves: data.current_saves ?? 0,
            maxSaves: data.max_saves ?? 3,
            uploadsLeft: data.uploads_left ?? 3
        };
        // console.log("[BG] fetchUserTierInfo userTierInfo:", userTierInfo);
        
        // Update side panel if it's open
        chrome.runtime.sendMessage({ type: "UPDATE_TIER_INFO", data: userTierInfo }).catch(() => {});

        // Update context menu state based on new limits
        updateContextMenuState();

    } catch (err) {
        console.error("[BG] Error fetching user tier info:", err);
    }
}

async function incrementSaveCounter() {
    userTierInfo.currentSaves++;
    console.log("[BG] Save counter incremented:", userTierInfo.currentSaves);
    // Update side panel if it's open
    chrome.runtime.sendMessage({ type: "UPDATE_TIER_INFO", data: userTierInfo }).catch(() => {});
    updateContextMenuState();
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

        // If upload is successful, increment the counter
        await incrementSaveCounter();
        
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
        
        // If upload is successful, increment the counter
        await incrementSaveCounter();

        return res.json().catch(() => ({}));
    } 
    catch (err) {
        console.error("[BG] uploadScreenshot error", err);
    }
}

// ---------------------- Login ----------------------

chrome.runtime.onInstalled.addListener(async (details) => {
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
                await fetchUserTierInfo(); // Fetch tier info after successful refresh
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
            await fetchUserTierInfo(); // Fetch tier info if tokens already exist
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
        
        // Also fetch user tier info when sidepanel is opened
        await fetchUserTierInfo();
    });
});

// ---------------------- Context Menu ----------------------

function updateContextMenuState() {
    const canSave = userTierInfo.uploadsLeft > 0;
    
    chrome.contextMenus.update("forgor-capture-upload", {
        enabled: canSave,
    });
    chrome.contextMenus.update("forgor-upload-image-url", {
        enabled: canSave,
    });

    // console.log(`[BG] Context menu enabled: ${canSave} (Saves: ${userTierInfo.currentSaves}/${userTierInfo.maxSaves})`);
}

chrome.runtime.onInstalled.addListener(() => {
    // Existing screenshot menu
    chrome.contextMenus.create({
        id: "forgor-capture-upload",
        title: "FORGOR: Save screenshot",
        contexts: ["page", "selection", "image", "link", "video", "audio"]
    });

    // Upload the specific image you right-clicked
    chrome.contextMenus.create({
        id: "forgor-upload-image-url",
        title: "FORGOR: Save image",
        contexts: ["image"]
    });
    
    // Initialize context menu state
    updateContextMenuState();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // Check save limits before attempting any action
    if (userTierInfo.currentSaves >= userTierInfo.maxSaves) {
        console.warn("[BG] Save limit reached, context menu action blocked.");
        await setBadge("🚫", "#ff0000");
        setTimeout(() => clearBadge(), CLEAR_IN_TIME);
        return; 
    }

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
        }
        setTimeout(() => clearBadge(), CLEAR_IN_TIME);
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
        }
        setTimeout(() => clearBadge(), CLEAR_IN_TIME);
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

        // Side panel requests tier info
        if (msg?.type === "GET_TIER_INFO") {
            sendResponse(userTierInfo);
            return;
        }
    })();

    return true; // async
});

// Initial fetch of user tier info when background script starts (e.g., browser start, extension reload)
// This ensures the context menu is correctly initialized even if the side panel isn't opened first.
getTokens().then(({ access_token }) => {
    if (access_token) {
        fetchUserTierInfo();
    }
});
