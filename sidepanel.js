// sidepanel.js

import { 
    PLACEHOLDER_URL,

    EP, 
    fetchWithAuth, 
    loadImageWithAuth, 
    
    getTrackingLinks,

    sanitizeLinkLabel, 
    resolveHandleToUrl 
} from "./shared.js";

// ---------------------- Helpers ----------------------

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
}

// ---------------------- Tier & Save Display ----------------------

const userTierEl = document.getElementById("userTier");
const saveCounterEl = document.getElementById("saveCounter");
const maxSavesEl = document.getElementById("maxSaves");

function updateTierDisplay(tier) {
    if (userTierEl) userTierEl.textContent = tier;
}

function updateSaveCounterDisplay(current, max) {
    if (saveCounterEl) saveCounterEl.textContent = current;
    if (maxSavesEl) maxSavesEl.textContent = max;
}

async function getTierInfoFromBackground() {
    try {
        const tierInfo = await chrome.runtime.sendMessage({ type: "GET_TIER_INFO" });
        if (tierInfo) {
            updateTierDisplay(tierInfo.tier);
            updateSaveCounterDisplay(tierInfo.currentSaves, tierInfo.maxSaves);
        }
    } catch (error) {
        console.warn("[SP] Failed to get tier info from background:", error);
    }
}

// ---------------------- Bar ----------------------

const refreshBtnEl = document.getElementById("refreshBtn");

refreshBtnEl?.addEventListener("click", () => {
    loadImages(true);
});

// ---------------------- Lightbox ----------------------

const gridEl = document.getElementById("grid");
const overlayEl = document.getElementById("overlay");
const fullImgEl = document.getElementById("fullImg");
const backBtnEl = document.getElementById("backBtn");
const deleteBtnEl = document.getElementById("deleteBtn");

let currentFileName = null; // track which file is open

function openLightbox(src, alt = "", fileName = null, tags = null) {
    if (!src) return;
    
    renderLinks(tags);

    fullImgEl.src = src;
    fullImgEl.alt = alt || "";
    
    currentFileName = fileName || null;
    
    overlayEl.classList.add("open");
    overlayEl.setAttribute("aria-hidden", "false");
    
    document.body.style.overflow = "hidden";
}

function closeLightbox() {
    overlayEl.classList.remove("open");
    overlayEl.setAttribute("aria-hidden", "true");
    
    fullImgEl.src = "";
    
    document.getElementById("linksBox").innerHTML = "";
    document.body.style.overflow = "";
}

deleteBtnEl?.addEventListener("click", async () => {
    if (!currentFileName) {
        alert("No file selected");
        return;
    }

    if (!confirm("Are you sure you want to delete this post?")) return;

    try {
        const form = new FormData();
        form.append("file_name", currentFileName);

        const resp = await fetchWithAuth(EP.DELETE, {
            method: "POST",
            body: form
        });
        if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
        
        const res = await resp.json();
        console.log("Deleted:", res);

        // Remove the card inline
        const card = gridEl.querySelector(`img.thumb[data-file-name="${CSS.escape(currentFileName)}"]`)?.closest('.card')
                || gridEl.querySelector(`img.thumb[data-fileName="${CSS.escape(currentFileName)}"]`)?.closest('.card');
        if (card) card.remove();

        closeLightbox();

        // If nothing left, show empty state
        if (!gridEl.children.length) {
            gridEl.innerHTML = `<div class="empty">No images found.</div>`;
        }
    } 
    catch (err) {
        console.error("Delete failed", err);
        alert("Failed to delete this post");
    }
});

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlayEl.classList.contains("open")) {
        closeLightbox();
    }
});

gridEl.addEventListener("click", async (e) => {
const img = e.target.closest("img.thumb");
if (!img) return;

console.log(`img: ${JSON.stringify(img)}`);

const fileName = img.dataset.fileName || null;
const tags = img.dataset.tags || null;
openLightbox(img.src, img.alt, fileName, tags);

// now request the full file
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

overlayEl.addEventListener("click", (e) => {
    // Close if clicking outside the lightbox content
    if (e.target === overlayEl) closeLightbox();
});

// Zoom toggle
fullImgEl.addEventListener("click", () => {
    fullImgEl.classList.toggle("zoomed");
});

backBtnEl.addEventListener("click", closeLightbox);

// ---------------------- Rendering ----------------------

function setRealImage(img, objectUrl, alt = "") {
  img.src = objectUrl;
  img.dataset.placeholder = "0";
  if (alt) img.alt = alt;
}

function setPlaceholder(img, alt = "Image unavailable") {
    img.src = PLACEHOLDER_URL;
    img.dataset.placeholder = "1";
    img.alt = alt;
    img.removeAttribute("loading"); // not needed for data URL
}

async function renderLinks(tagsAny) {
    const box = document.getElementById("linksBox");
    box.innerHTML = "";
    if (!tagsAny) return;

    let tagsObj = {};
    try { tagsObj = typeof tagsAny === "string" ? JSON.parse(tagsAny) : tagsAny || {}; }
    catch { return; }

    const appName = tagsObj.app_name || "";
    const links   = Array.isArray(tagsObj.links) ? tagsObj.links : [];
    const handles = Array.isArray(tagsObj.account_identifiers) ? tagsObj.account_identifiers : [];
    console.log(`tagsObj: ${JSON.stringify(tagsObj)}`);

    // Collect raw + handle URLs
    const handleUrls = handles.map(h => resolveHandleToUrl(appName, h)).filter(Boolean);
    const allUrls = [...links, ...handleUrls];
    if (!allUrls.length) return;
    console.log(`allUrls: ${JSON.stringify(allUrls)}`);

    // Fetch tracking versions
    const trackingLinks = await getTrackingLinks(allUrls);
    for (const obj of trackingLinks) {
        const original = obj?.original;
        const tracking = obj?.tracking;
        if (!original || !tracking) continue;

        const a = document.createElement("a");
        a.href = tracking;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = sanitizeLinkLabel(original);
        box.appendChild(a);
        box.appendChild(document.createElement("br"));
    }
}

async function renderSequential(items) {
    gridEl.innerHTML = "";

    if (!items?.length) {
        gridEl.innerHTML = `<div class="empty">NO RESULTS FOUND</div>`;
        return;
    }

    for (const it of items) {
        console.log(`it: ${JSON.stringify(it)}`);
        
        const card = document.createElement("div");
        card.className = "card";

        const img = document.createElement("img");
        img.className = "thumb";
        img.decoding = "async";
        img.loading = "lazy";
        setPlaceholder(img, it.caption || it.alt || "Image");

        if (it.file_name) img.dataset.fileName = it.file_name;
        if (it.tags) img.dataset.tags = typeof it.tags === "string" ? it.tags : JSON.stringify(it.tags);

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
}

// ---------------------- Server ----------------------

async function getTokens() {
  return new Promise(r => chrome.runtime.sendMessage({ type: "GET_TOKENS" }, r));
}

// ---------------------- Loading ----------------------

chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "REFRESH_IF_OPEN") {
        // If our DOM exists, we assume we're open—do a light refresh
        if (document.visibilityState === "visible") {
            loadImages(true);
        }
    }
    // Listen for tier info updates from the background script
    if (msg?.type === "UPDATE_TIER_INFO" && msg.data) {
        updateTierDisplay(msg.data.tier);
        updateSaveCounterDisplay(msg.data.currentSaves, msg.data.maxSaves);
    }
});

async function loadImages(spin = false) {
    const tab = await getActiveTab();
    if (!tab?.url) { render([]); return; }

    const title = tab.title || "";
    let domain = ""; try { domain = new URL(tab.url).hostname || ""; } catch {}

    if (spin) gridEl.innerHTML = `<div class="empty">LOADING...</div>`;

    const { access_token } = await getTokens();
    if (!access_token) { render([]); return; }

    const searchText = `${title} ${domain}`.trim();

    try {
        // Ask background for cached-or-fetch
        const res = await chrome.runtime.sendMessage({
            type: "QUERY_CACHED_OR_FETCH",
            searchText
        });
        if (!res?.ok) throw new Error("Query failed");

        const data = JSON.parse(res.body || "{}");

        const list = (data.images || data.results || data.items || [])
        .map(x => {
            const file = x.file_name || x.filename || null;
            const thumb = x.thumbnail_name ? `${EP.THUMBNAIL}/${encodeURIComponent(x.thumbnail_name)}` : null;
            const tags  = x.tags ?? null;
            return file && thumb ? { file_name: file, thumbnailUrl: thumb, tags: tags } : null;
        })
        .filter(Boolean);

        // Sequential helps masonry feel nicer as URLs resolve
        await renderSequential(list);
    } catch (e) {
        console.warn("[SP] loadImages error", e);
        gridEl.innerHTML = `<div class="empty">Failed to load images.</div>`;
    }
}

loadImages();
getTierInfoFromBackground();