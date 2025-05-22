let debounceTimer;

chrome.storage.local.get(['excludedSites'], function(result) {
    const excludedSites = result.excludedSites || [];
    const url = new URL(window.location.href);
    const domain = url.hostname;

    if (excludedSites.includes(domain)) {
        console.log(`Extension disabled for ${domain}`);
        return;
    }

    document.addEventListener('input', handleInput, true);
});

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
                type: 'SEARCH_REQUEST',
                query: inputText,
                search: false
            });
        }, 1000);
    }
}