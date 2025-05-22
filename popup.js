document.addEventListener('DOMContentLoaded', function() {
    chrome.action.setBadgeText({text: ''});
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const url = new URL(tabs[0].url);
        const domain = url.hostname;

        chrome.storage.local.get(['excludedSites'], function(result) {
            const excludedSites = result.excludedSites || [];
            const isExcluded = excludedSites.includes(domain);

            const toggleButton = document.getElementById('toggleSite');
            toggleButton.textContent = isExcluded ? 'excluded' : 'enabled';

            toggleButton.addEventListener('click', function() {
                chrome.storage.local.get(['excludedSites'], function(result) {
                    let updatedSites = result.excludedSites || [];

                    if (updatedSites.includes(domain)) {
                        updatedSites = updatedSites.filter(site => site !== domain);
                    } else {
                        updatedSites.push(domain);
                    }

                    chrome.storage.local.set({ excludedSites: updatedSites }, function() {
                        toggleButton.textContent = updatedSites.includes(domain) ? 'excluded' : 'enabled';
                    });
                });
            });
        });
    });
    
    document.getElementById('searchData').addEventListener('click', function() {
        window.open('response.html', '_blank');
    });
});