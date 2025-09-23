// shared.js

import { SERVER_URL, USER_AGENT } from "./config.js";

// ---------------------- Vars ----------------------

export const CACHE_TTL_MS           = 5 * 1000; // 15 sec to query results
export const FLUSH_MS               = 1000; // 5 seconds of no new actions -> flush
export const STABILITY_THRESHOLD    = 1000; // 5s tab stability
export const IDLE_THRESHOLD         = 15000; // 15s user idle
export const CLEAR_IN_TIME         = 5000; // 15s user idle

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
    ".com/resources",
    "more-info", 
    "brand-assets", 
    "ads-policies", 
    "...", 
];

// ---------------------- Endpoints ----------------------

export const EP = {
    UPLOAD_IMAGE:       `${SERVER_URL}/api/upload/image`,
    UPLOAD_IMAGEURL:    `${SERVER_URL}/api/upload/imageurl`,
    DELETE:             `${SERVER_URL}/api/delete/file`,
    RELEVANT:           `${SERVER_URL}/api/relevant`,
    FILE:               `${SERVER_URL}/api/get_file`,
    THUMBNAIL:          `${SERVER_URL}/api/get_thumbnail`,
    LOGIN:              `${SERVER_URL}/api/login`,
    REGISTER:           `${SERVER_URL}/api/register`,
    REFRESH:            `${SERVER_URL}/api/refresh_token`,
    GET_SAVES:          `${SERVER_URL}/api/get_saves_left`,
    GET_TRACKING_LINKS: `${SERVER_URL}/api/generate-tracking-links`,
    USER_TIER_INFO:     `${SERVER_URL}/api/user/tier_info`
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
        ...extra
    };
}

function tzHeader() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

// ---------------------- Auth Fetch ----------------------

let refreshInFlight = null;

export async function refreshAccessToken() {
    // If a refresh is already happening, join it
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        const { refresh_token } = await getTokens();
        if (!refresh_token) {
            await clearTokens();
            throw new Error("NO_REFRESH_TOKEN");
        }

        const res = await fetch(EP.REFRESH, {
            method: "POST",
            headers: baseHeaders({
                "Content-Type": "application/json",
                "X-Timezone": tzHeader(),
            }),
            body: JSON.stringify({ refresh_token }),
        });

        if (!res.ok) {
            await clearTokens();
            throw new Error(`REFRESH_FAILED_${res.status}`);
        }

        // Expect { access_token: "..." }
        let json = {};
        try {
            json = await res.json();
        } catch {
            /* noop */
        }

        const newAccess = json?.access_token;
        if (!newAccess) {
            await clearTokens();
            throw new Error("REFRESH_NO_ACCESS");
        }

        await setTokens(newAccess, refresh_token);
        return newAccess;
    })();

    try {
        const token = await refreshInFlight;
        return token;
    } 
    
    finally {
        // Ensure next refresh can start fresh
        refreshInFlight = null;
    }
}

export async function fetchWithAuth(url, init = {}) {
    const { access_token } = await getTokens();
    if (!access_token) throw new Error("NO_TOKEN");

    const doFetch = async (token) =>
        fetch(url, {
            ...init,
            headers: {
                ...baseHeaders(init.headers),
                Authorization: `Bearer ${token}`,
            },
        });

    // First attempt
    let res = await doFetch(access_token);
    if (res.status !== 401) return res; // covers 200.., 403, etc.

    // Attempt refresh (Android parity)
    try {
        const newAccess = await refreshAccessToken();
        res = await doFetch(newAccess);
        // If still 401 after refresh, purge tokens (session invalid)
        if (res.status === 401) {
            await clearTokens();
        }
        return res;
    } catch {
        // Refresh failed → clear tokens and return original 401
        await clearTokens();
        return res;
    }
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

export async function setBadge(text = "", color = null) {
    try { 
        await chrome.action.setBadgeText({ text }); 
        await chrome.action.setBadgeBackgroundColor({ color }); 
    } 
    catch {
    }
}

export async function clearBadge() {
    try { 
        await chrome.action.setBadgeText({ text: "" }); 
        await chrome.action.setBadgeBackgroundColor({ color: null }); 
    } 
    catch {}
}

// ---------------------- Small utils ----------------------

export function makeQueryKey(s) {
    return (s || "").trim().toLowerCase();
}

// ---------------------- Tracking ----------------------

export async function getTrackingLinks(urls) {
    try {
        const body = JSON.stringify({ urls });
        const resp = await fetchWithAuth(EP.GET_TRACKING_LINKS, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
        });
        if (!resp.ok) throw new Error(`Failed ${resp.status}`);
        const json = await resp.json();
        return Array.isArray(json.links) ? json.links : [];
    } catch (err) {
        console.error("getTrackingLinks error:", err);
        return [];
    }
}

// ---------------------- URLs ----------------------

export function sanitizeLinkLabel(url) {
    try {
        const u = new URL(url);
        const host = (u.host || "").replace(/^www\./, "");
        let path = u.pathname.replace(/^\/+|\/+$/g, ""); // trim leading/trailing /

        // Special handling for common social platforms
        if (host.includes("reddit.com")) {
            if (path.startsWith("user/") || path.startsWith("u/")) {
                path = path.replace(/^user\//, "").replace(/^u\//, "");
                return `u/${path}`;
            } else if (path.startsWith("r/")) {
                return `r/${path.slice(2)}`; // subreddit
            }
        } else if (host.includes("x.com") || host.includes("twitter.com")) {
            return `@${path.replace(/^@/, "")}`;
        } else if (host.includes("instagram.com")) {
            return `@${path.replace(/^@/, "")}`;
        } else if (host.includes("tiktok.com")) {
            return `@${path.replace(/^@/, "")}`;
        } else if (host.includes("linkedin.com")) {
            return path.replace(/^in\//, "");
        } else if (host.includes("github.com")) {
            return path;
        } else if (host.includes("medium.com")) {
            return `@${path.replace(/^@/, "")}`;
        }

        // Default: host + short path snippet (first 2 segments)
        const segments = path.split("/").filter(Boolean).slice(0, 2);
        const shortPath = segments.join("/");
        return shortPath ? `${host}/${shortPath}` : host;

    } catch {
        return url;
    }
}

export function resolveHandleToUrl(appName, handle) {
    if (!appName || !handle) return handle;

    const cleanHandle = handle.replace(/^@/, ""); // Remove leading @

    switch (appName.toLowerCase()) {
        case "twitter":
            return `https://twitter.com/${cleanHandle}`;
        case "x":
            return `https://x.com/${cleanHandle}`;
        case "reddit":
            if (cleanHandle.toLowerCase().startsWith("r/")) {
                // Subreddit
                return `https://www.reddit.com/${cleanHandle}`;
            } else if (cleanHandle.toLowerCase().startsWith("u/")) {
                // User
                return `https://www.reddit.com/${cleanHandle}`;
            } else {
                // Default to user if no prefix
                return `https://www.reddit.com/user/${cleanHandle}`;
            }
        case "instagram":
            return `https://instagram.com/${cleanHandle}`;
        case "tiktok":
            return `https://www.tiktok.com/@${cleanHandle}`;
        case "facebook":
            return `https://www.facebook.com/${cleanHandle}`;
        case "linkedin":
            return `https://www.linkedin.com/in/${cleanHandle}`;
        case "youtube":
            return `https://www.youtube.com/@${cleanHandle}`;
        case "github":
            return `https://github.com/${cleanHandle}`;
        case "medium":
            return `https://medium.com/@${cleanHandle}`;
        case "pinterest":
            return `https://www.pinterest.com/${cleanHandle}`;
        case "snapchat":
            return `https://www.snapchat.com/add/${cleanHandle}`;
        default:
            return handle; // fallback: return the handle as-is
    }
}