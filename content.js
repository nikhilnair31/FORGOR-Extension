// content.js

let debounceTimer;

document.addEventListener('input', handleInput, true);
function handleInput(event) {
    console.log(`handleInput`);
    
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('contenteditable') === 'true' || target.isContentEditable) {
        clearTimeout(debounceTimer);
        
        debounceTimer = setTimeout(() => {
            let inputText = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') ? target.value : target.textContent;
            console.log(`inputText: ${inputText}`);
            
            chrome.runtime.sendMessage({
                type: 'query',
                query: inputText
            });
        }, 1000);
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'flash-toast' && message.text) {
        showForgorToast(message.text);
    }
    if (message.type === 'index-posts') {
        indexPosts();
    }
});
function showForgorToast(message) {
    // Avoid duplicate toasts
    if (document.getElementById('forgor-result-toast')) return;

    fetch(chrome.runtime.getURL('toast.html'))
        .then(res => res.text())
        .then(html => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;

            const toast = wrapper.querySelector('#forgor-result-toast');
            const textSpan = toast.querySelector('#forgor-toast-message');
            textSpan.textContent = message;

            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 500);
            }, 2500);
        })
        .catch(err => console.error('Failed to load toast HTML:', err));
}
function indexPosts() {
    let lastHeight = 0;
    let stableCounter = 0;
    let intervalId = setInterval(function () {
        window.scrollBy(0, 200);
        let currentHeight = document.body.scrollHeight;

        if (currentHeight === lastHeight) {
            stableCounter += 1;
        } else {
            stableCounter = 0;
            lastHeight = currentHeight;
        }

        // If height hasn't changed for 20 checks (e.g. 100ms * 20 = 2 seconds), stop
        if (stableCounter >= 20) {
            clearInterval(intervalId);
            extractPostLinks();
        }
    }, 100);
}
function extractPostLinks() {
    const container = document.querySelector('.vbI.XiG');
    if (!container) {
        console.log("Post container not found");
        return;
    }

    const allAnchors = container.querySelectorAll('a[href]');

    const allLinks = new Set();
    const relevantLinks = new Set();
    const excludedLinks = new Set();

    const includePatterns = [
        /\/pin\/\d+/,        // Pinterest post
        /\/post\/\d+/,       // Generic blog post
        /\/p\/[^\/]+/,       // Instagram style
    ];

    const excludePatterns = [
        /\/login/,
        /\/signup/,
        /\/explore/,
        /\/ads/,
        /\/notifications/,
        /\/search/,
        /\/help/,
    ];

    allAnchors.forEach(anchor => {
        const url = anchor.href.trim();
        if (!url || allLinks.has(url)) return;

        allLinks.add(url);

        const isExcluded = excludePatterns.some(re => re.test(url));
        const isIncluded = includePatterns.some(re => re.test(url));

        if (isExcluded) {
            excludedLinks.add(url);
        } else if (isIncluded) {
            relevantLinks.add(url);
        }
    });

    // Comparison logs
    console.log(`🔎 All links found: ${allLinks.size}`);
    console.log(`✅ Relevant post links: ${relevantLinks.size}`);
    console.log(`❌ Excluded links: ${excludedLinks.size}`);
    console.log(`🤔 Unmatched leftovers: ${[...allLinks].filter(x => !relevantLinks.has(x) && !excludedLinks.has(x)).length}`);

    // Optional detailed logs
    console.log("🧺 All:", [...allLinks]);
    console.log("✅ Relevant:", [...relevantLinks]);
    console.log("❌ Excluded:", [...excludedLinks]);
    console.log("🤔 Missed:", [...allLinks].filter(x => !relevantLinks.has(x) && !excludedLinks.has(x)));
}
