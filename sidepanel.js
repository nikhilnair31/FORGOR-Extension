// sidepanel.js

import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

const EP = { 
    QUERY: `${SERVER_URL}/api/check`,
    FILE: `${SERVER_URL}/api/get_file`,
    THUMBNAIL: `${SERVER_URL}/api/get_thumbnail`,
};

const gridEl = document.getElementById("grid");

// ----- Lightbox helpers -----
const overlayEl = document.getElementById("overlay");
const fullImgEl = document.getElementById("fullImg");
const closeBtnEl = document.getElementById("closeBtn");

function openLightbox(src, alt = "") {
  if (!src) return;
  fullImgEl.src = src;
  fullImgEl.alt = alt || "";
  overlayEl.classList.add("open");
  overlayEl.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden"; // prevent background scroll
  closeBtnEl.focus();
}

function closeLightbox() {
  overlayEl.classList.remove("open");
  overlayEl.setAttribute("aria-hidden", "true");
  fullImgEl.src = "";
  document.body.style.overflow = "";
}

// Close interactions
closeBtnEl.addEventListener("click", closeLightbox);

overlayEl.addEventListener("click", (e) => {
  // Close if clicking outside the lightbox content
  if (e.target === overlayEl) closeLightbox();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && overlayEl.classList.contains("open")) {
    closeLightbox();
  }
});

// Delegate clicks on thumbnails to open the lightbox
gridEl.addEventListener("click", async (e) => {
    const img = e.target.closest("img.thumb");
    if (!img) return;

    // Reuse the already-created object URL; no re-fetch
    openLightbox(img.src, img.alt);

    // now request the full file
    const fileName = img.dataset.fileName;
    if (fileName) {
        try {
            const fullUrl = `${EP.FILE}/${encodeURIComponent(fileName)}`;
            const realSrc = await loadImageWithAuth(fullUrl);
            fullImgEl.src = realSrc; // replace once fetched
        } 
        catch (err) {
            console.warn("Failed to load full file", err);
        }
    }
});

async function getTokens() {
  return new Promise(r => chrome.runtime.sendMessage({ type: "GET_TOKENS" }, r));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

// ---- Placeholder utils ----
const PLACEHOLDER_SVG = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2424">
    <rect width="100%" height="100%" fill="#ccc"/>
  </svg>
`);
const PLACEHOLDER_URL = `data:image/svg+xml;charset=utf-8,${PLACEHOLDER_SVG}`;

function setPlaceholder(img, alt = "Image unavailable") {
  img.src = PLACEHOLDER_URL;
  img.dataset.placeholder = "1";
  img.alt = alt;
  img.removeAttribute("loading"); // not needed for data URL
}

function setRealImage(img, objectUrl, alt = "") {
  img.src = objectUrl;
  img.dataset.placeholder = "0";
  if (alt) img.alt = alt;
}

async function renderSequential(items) {
    gridEl.innerHTML = "";
    for (const it of items) {
        console.log(`it: ${it}`);
        
        const card = document.createElement("div");
        card.className = "card";

        const img = document.createElement("img");
        img.className = "thumb";
        img.decoding = "async";
        img.loading = "lazy";
        setPlaceholder(img, it.caption || it.alt || "Image");

        if (it.file_name) img.dataset.fileName = it.file_name;

        card.appendChild(img);
        gridEl.appendChild(card);

        try {
            const src = await loadImageWithAuth(it.thumbnailUrl);
            setRealImage(img, src, it.caption || it.alt || "Image");
        } 
        catch (e) {
            // keep placeholder; optionally set a more specific alt
            img.alt = "Could not load image";
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
        img.decoding = "async";
        img.loading = "lazy";
        setPlaceholder(img, it.caption || it.alt || "Image");

        // store original filename so we can fetch full file later
        if (it.file_name) img.dataset.fileName = it.file_name;

        loadImageWithAuth(it.thumbnailUrl)
        .then(src => setRealImage(img, src, it.caption || it.alt || "Image"))
        .catch(() => { img.alt = "Could not load image"; });

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
    if (!tab?.url) { 
        render([]); 
        return; 
    }
    console.log(`[SP] tab.url: ${tab.url}`);

    const title = tab.title || "";
    let domain = ""; try { domain = new URL(tab.url).hostname || ""; } catch {}
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
        console.log(`[SP] data: ${JSON.stringify(data)}`);

        // Accept multiple shapes:
        // 1) { images: [{url, caption}] }
        // 2) { results: [...] } with image_url/url fields
        // 3) { items: [...] }
        const list = (data.images || data.results || data.items || [])
        .map(x => {
            const file = x.file_name || x.filename || null;
            console.log(`[SP] file: ${file}`);
            const thumb = x.thumbnail_name ? `${EP.THUMBNAIL}/${encodeURIComponent(x.thumbnail_name)}` : null;
            console.log(`[SP] thumb: ${thumb}`);
            return file && thumb ? { file_name: file, thumbnailUrl: thumb } : null;
        })
        .filter(Boolean);
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
