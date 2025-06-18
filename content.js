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

            const cleanHtml = getSanitizedHtml();
            chrome.runtime.sendMessage({
                type: 'html-dump',
                html: cleanHtml,
                url: window.location.href,
                timestamp: Date.now(),
            });
        }
    }, 100);
}
function getSanitizedHtml() {
    const clone = document.documentElement.cloneNode(true);

    // Remove <script>, <style>, <iframe>, <object> tags
    const tagsToRemove = ['script', 'style', 'iframe', 'object'];
    tagsToRemove.forEach(tag => {
        clone.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Optional: remove comments
    const treeWalker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    let comment;
    while (comment = treeWalker.nextNode()) {
        comment.parentNode.removeChild(comment);
    }

    return clone.outerHTML;
}