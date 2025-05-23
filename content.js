let debounceTimer;

document.addEventListener('input', handleInput, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'results-toast') {
        injectToastFromHtml();
    }
});

function injectToastFromHtml() {
    if (document.getElementById('forgor-result-toast')) return;

    fetch(chrome.runtime.getURL('toast.html'))
        .then(response => response.text())
        .then(html => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            console.log(`wrapper: ${wrapper}`);

            const toast = wrapper.firstElementChild;
            document.body.appendChild(toast);
            console.log(`toast: ${toast}`);
            

            setTimeout(() => {
                console.log('toast: ', toast);
                toast.style.opacity = '0';
                // setTimeout(() => toast.remove(), 500);
            }, 2500);
        })
        .catch(err => console.error('Failed to load toast HTML:', err));
}

function handleInput(event) {
    console.log(`handleInput`);
    
    const target = event.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.getAttribute('contenteditable') === 'true' || target.isContentEditable) {
        console.log(`target: ${JSON.stringify(target)}`);
        
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