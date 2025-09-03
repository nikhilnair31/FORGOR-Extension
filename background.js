// background.js

import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

const EP = {
    LOGIN:        `${SERVER_URL}/api/login`,
    REGISTER:     `${SERVER_URL}/api/register`,
    REFRESH:      `${SERVER_URL}/api/refresh_token`,
    QUERY:        `${SERVER_URL}/api/check`,           // accepts { "searchText": "..." }
    GET_SAVES:    `${SERVER_URL}/api/get_saves_left`   // optional usage
};


const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const queryCache = new Map(); // key -> { ts, data }

// Normalize a query key to reduce duplicates
function makeQueryKey(s) {
    return (s || "").trim().toLowerCase();
}
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

// ==================== Batch Buffer (5s quiet window) ====================
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

// ---- Storage helpers ----
const store = {
  async get(keys) { return new Promise(r => chrome.storage.sync.get(keys, r)); },
  async set(obj) { return new Promise(r => chrome.storage.sync.set(obj, r)); },
  async del(keys) { return new Promise(r => chrome.storage.sync.remove(keys, r)); }
};

async function getTokens() {
  const { access_token = "", refresh_token = "" } = await store.get(["access_token", "refresh_token"]);
  return { access_token, refresh_token };
}
async function setTokens(access_token, refresh_token) {
  await store.set({ access_token, refresh_token });
}
async function clearTokens() { await store.del(["access_token","refresh_token"]); }

// ---- Auth header builder ----
function baseHeaders(extra = {}) {
  return {
    "User-Agent": USER_AGENT,
    "X-App-Key": APP_KEY,
    ...extra
  };
}

// ---- Token-aware fetch with 401 retry via /api/refresh_token ----
async function fetchWithAuth(url, init = {}) {
  const { access_token, refresh_token } = await getTokens();
  if (!access_token) throw new Error("NO_TOKEN");

  const req1 = await fetch(url, {
    ...init,
    headers: {
      ...baseHeaders(init.headers),
      "Authorization": `Bearer ${access_token}`
    }
  });

  if (req1.status !== 401) return req1;

  // Try refresh
  if (!refresh_token) return req1;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const ref = await fetch(EP.REFRESH, {
    method: "POST",
    headers: baseHeaders({ "Content-Type": "application/json", "X-Timezone": tz }),
    body: JSON.stringify({ refresh_token })
  });

  if (!ref.ok) {
    await clearTokens();
    return req1;
  }

  const refJson = await ref.json().catch(() => ({}));
  const newAccess = refJson?.access_token;
  if (!newAccess) {
    await clearTokens();
    return req1;
  }

  await setTokens(newAccess, refresh_token);

  // Retry original
  return fetch(url, {
    ...init,
    headers: {
      ...baseHeaders(init.headers),
      "Authorization": `Bearer ${newAccess}`
    }
  });
}

// ---- Install: open login/signup page ----
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("[BG] onInstalled", details);
    if (details.reason === "install") {
        console.log("[BG] Opening login.html");
        await chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
    }
});

// ---- Click toolbar: open side panel ----
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

// ---- Event wiring: route into the buffer instead of direct fetch ----
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

async function clearBadge() { await chrome.action.setBadgeText({ text: "" }); }

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

// ---- Messages from sidepanel/login ----
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
