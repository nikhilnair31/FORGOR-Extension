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
