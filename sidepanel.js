import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

const EP = { QUERY: `${SERVER_URL}/api/query` };

const metaEl = document.getElementById("meta");
const gridEl = document.getElementById("grid");
document.getElementById("refreshBtn").addEventListener("click", () => loadImages(true));

async function getTokens() {
  return new Promise(r => chrome.runtime.sendMessage({ type: "GET_TOKENS" }, r));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setMeta(title, domain) {
  metaEl.textContent = title && domain ? `${title} — ${domain}` : (title || domain || "");
}

async function renderSequential(items) {
    gridEl.innerHTML = "";
    for (const it of items) {
        const card = document.createElement("div");
        card.className = "card";
        const img = document.createElement("img");
        img.className = "thumb";
        img.alt = "Loading…";
        card.appendChild(img);
        gridEl.appendChild(card);

        try {
        const src = await loadImageWithAuth(it.url);
        img.src = src;
        } catch (e) {
        img.alt = "Failed to load";
        }
    }
}

function render(items) {
    gridEl.innerHTML = "";
    if (!items?.length) {
        gridEl.innerHTML = `<div class="empty">No images found.</div>`;
        return;
    }
    for (const it of items) {
        const card = document.createElement("div");
        card.className = "card";
        const img = document.createElement("img");
        img.className = "thumb";
        img.alt = it.caption || it.alt || "Image";

        // Images may require auth headers → fetch as blob then objectURL
        loadImageWithAuth(it.url).then(src => { img.src = src; }).catch(() => {
        img.alt = "Failed to load image";
        });

        card.appendChild(img);

        const caption = it.caption || it.source || it.title || "";
        if (caption) {
        const cap = document.createElement("div");
        cap.className = "caption";
        cap.textContent = caption;
        card.appendChild(cap);
        }
        gridEl.appendChild(card);
    }
}

async function loadImages(spin = false) {
    const tab = await getActiveTab();
    if (!tab?.url) { setMeta("", ""); render([]); return; }
    console.log(`[SP] tab.url: ${tab.url}`);

    const title = tab.title || "";
    let domain = ""; try { domain = new URL(tab.url).hostname || ""; } catch {}
    setMeta(title, domain);
    console.log(`[SP] title: ${title} - domain: ${domain}`);

    if (spin) gridEl.innerHTML = `<div class="empty">Loading…</div>`;

    const { access_token } = await getTokens();
    if (!access_token) { render([]); return; }

    try {
        const res = await chrome.runtime.sendMessage({
            type: "QUERY",
            searchText: `${title} ${domain}`.trim()
        });

        if (!res?.ok) throw new Error("Query failed");
        const data = JSON.parse(res.body);
        console.log(`[SP] data: ${data}`);

        // Accept multiple shapes:
        // 1) { images: [{url, caption}] }
        // 2) { results: [...] } with image_url/url fields
        // 3) { items: [...] }
        const list = (data.images || data.results || data.items || [])
        .map(x => {
            const file = x.file_name || x.filename || null;
            const directUrl = x.url || x.image_url || x.download_url || null;
            const url = directUrl || (file ? `${SERVER_URL}/api/get_file/${encodeURIComponent(file)}` : "");
            return {
                url,
            };
        })
        .filter(x => !!x.url);
        console.log(`[SP] list: ${list}`);

        renderSequential(list);
    } catch (e) {
        gridEl.innerHTML = `<div class="empty">Failed to load images.</div>`;
    }
}

// Fetch an image with Authorization headers and return an object URL
async function loadImageWithAuth(url) {
    const { access_token } = await getTokens();
    if (!access_token) throw new Error("NO_TOKEN");

    const resp = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "User-Agent": USER_AGENT,
            "X-App-Key": APP_KEY
        }
    });
    if (!resp.ok) throw new Error(`img ${resp.status}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
}

// Initial
loadImages();
