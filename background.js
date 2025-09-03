import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

// ---- Endpoints from your Android Helpers ----
const EP = {
  LOGIN:        `${SERVER_URL}/api/login`,
  REGISTER:     `${SERVER_URL}/api/register`,
  REFRESH:      `${SERVER_URL}/api/refresh_token`,
  QUERY:        `${SERVER_URL}/api/check`,           // accepts { "searchText": "..." }
  GET_SAVES:    `${SERVER_URL}/api/get_saves_left`   // optional usage
};

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
    });
});

// ---- Badge updates from active tab ----
chrome.tabs.onActivated.addListener(({ tabId }) => refreshBadgeForActive());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete" || info.title || info.url) refreshBadgeForActive();
});

async function refreshBadgeForActive() {
  console.log("[BG] refreshBadgeForActive called");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log("[BG] Active tab", tab);
    if (!tab?.url) return clearBadge();

    const title = tab.title || "";
    let domain = "";
    try { domain = new URL(tab.url).hostname; } catch {}
    console.log(`[BG] Querying API with title="${title}" domain="${domain}"`);

    const has = await hasResultsFor(`${title} ${domain}`.trim());
    console.log("[BG] API returned hasResults =", has);
    if (has) {
      await chrome.action.setBadgeText({ text: "●" });
      await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
    } else {
      await clearBadge();
    }
  } catch (err) {
    console.error("[BG] refreshBadgeForActive error", err);
    await clearBadge();
  }
}
async function clearBadge() { await chrome.action.setBadgeText({ text: "" }); }

async function hasResultsFor(searchText) {
  try {
    const r = await fetchWithAuth(EP.QUERY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchText })
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    console.log("[BG] j =", j);
    // Be tolerant to shapes: results[], images[], items[]
    const arr = j?.images || j?.results || j?.items || [];
    return Array.isArray(arr) && arr.length > 0;
  } catch { return false; }
}

// ---- Messages from sidepanel/login ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GET_TOKENS") {
      sendResponse(await getTokens()); return;
    }
    if (msg?.type === "QUERY") {
      const res = await fetchWithAuth(EP.QUERY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchText: msg.searchText || "" })
      });
      const text = await res.text();
      sendResponse({ ok: res.ok, body: text });
      return;
    }
  })();
  return true; // async
});
