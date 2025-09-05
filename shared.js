// shared.js

import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

// ---------------------- Vars ----------------------

export const CACHE_TTL_MS = 5 * 1000; // 15 sec to query results
export const FLUSH_MS = 1000; // 5 seconds of no new actions -> flush

export const PLACEHOLDER_SVG = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2424">
        <rect width="100%" height="100%" fill="#ccc"/>
    </svg>
`);
export const PLACEHOLDER_URL = `data:image/svg+xml;charset=utf-8,${PLACEHOLDER_SVG}`;
export const SKIP_PATTERNS = [
    ".com/privacy", 
    ".com/terms", 
    ".com/about", 
    ".com/legal", 
    ".com/policy", 
    ".com/tos", 
    ".com/cookie-use", 
    ".com/accessibility", 
    ".com/settings",
    "brand-assets", 
    "ads-policies", 
];

// ---------------------- Endpoints ----------------------

export const EP = {
  UPLOAD_IMAGE:     `${SERVER_URL}/api/upload/image`,
  UPLOAD_IMAGEURL:  `${SERVER_URL}/api/upload/imageurl`,
  DELETE:           `${SERVER_URL}/api/delete/file`,
  QUERY:            `${SERVER_URL}/api/check/text`,
  FILE:             `${SERVER_URL}/api/get_file`,
  THUMBNAIL:        `${SERVER_URL}/api/get_thumbnail`,
  LOGIN:            `${SERVER_URL}/api/login`,
  REGISTER:         `${SERVER_URL}/api/register`,
  REFRESH:          `${SERVER_URL}/api/refresh_token`,
  GET_SAVES:        `${SERVER_URL}/api/get_saves_left`
};

// ---------------------- Storage ----------------------

export const store = {
    async get(keys) { return new Promise(r => chrome.storage.sync.get(keys, r)); },
    async set(obj)  { return new Promise(r => chrome.storage.sync.set(obj, r)); },
    async del(keys) { return new Promise(r => chrome.storage.sync.remove(keys, r)); }
};

// ---------------------- Tokens ----------------------

export async function getTokens() {
    const { access_token = "", refresh_token = "" } = await store.get(["access_token", "refresh_token"]);
    return { access_token, refresh_token };
}

export async function setTokens(access_token, refresh_token) {
    await store.set({ access_token, refresh_token });
}

export async function clearTokens() {
  await store.del(["access_token", "refresh_token"]);
}

// ---------------------- Headers ----------------------

export function baseHeaders(extra = {}) {
    return {
        "User-Agent": USER_AGENT,
        "X-App-Key": APP_KEY,
        ...extra
    };
}

// ---------------------- Auth Fetch ----------------------

export async function fetchWithAuth(url, init = {}) {
    const { access_token, refresh_token } = await getTokens();
    if (!access_token) throw new Error("NO_TOKEN");

    const first = await fetch(url, {
        ...init,
        headers: {
        ...baseHeaders(init.headers),
        "Authorization": `Bearer ${access_token}`
        }
    });

    if (first.status !== 401) return first;

    // Try refresh
    if (!refresh_token) return first;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const ref = await fetch(EP.REFRESH, {
        method: "POST",
        headers: baseHeaders({ "Content-Type": "application/json", "X-Timezone": tz }),
        body: JSON.stringify({ refresh_token })
    });

    if (!ref.ok) {
        await clearTokens();
        return first;
    }

    const refJson = await ref.json().catch(() => ({}));
    const newAccess = refJson?.access_token;
    if (!newAccess) {
        await clearTokens();
        return first;
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

// ---------------------- Blobs & Names ----------------------

export function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

export function timestampName(prefix = "screenshot", ext = "png") {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

// ---------------------- Images ----------------------

export async function loadImageWithAuth(url) {
    const r = await fetchWithAuth(url);
    if (!r.ok) throw new Error(`img ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
}

// ---------------------- Badges (used by background) ----------------------

export async function setBadge(text) {
    try { await chrome.action.setBadgeText({ text }); } catch {}
}

export async function clearBadge() {
    try { await chrome.action.setBadgeText({ text: "" }); } catch {}
}

// ---------------------- Small utils ----------------------

export function makeQueryKey(s) {
    return (s || "").trim().toLowerCase();
}

// ---------------------- URLs ----------------------

export function sanitizeLinkLabel(url) {
    try {
        const u = new URL(url);

        // filter out obvious boilerplate/legal URLs
        const badPatterns = [
            "/privacy", "/privacy-policy",
            "/terms", "/tos", "/terms-of-service",
            "/cookies", "/cookie-policy"
        ];
        if (badPatterns.some(p => u.pathname.toLowerCase().includes(p))) {
            return null; // signal to skip this link
        }

        return u.hostname.replace(/^www\./, '');
    } 
    catch {
        return url;
    }
}

export function resolveHandleToUrl(appName, handle) {
    if (!appName || !handle) return handle;
    switch (appName.toLowerCase()) {
        case "twitter":
        case "x":
            return `https://x.com/${handle.replace(/^@/, "")}`;
        case "instagram":
            return `https://instagram.com/${handle.replace(/^@/, "")}`;
        case "tiktok":
            return `https://tiktok.com/@${handle.replace(/^@/, "")}`;
        default:
            return handle;
    }
}