const { API_BASE, USER_AGENT, APP_KEY } = CONFIG;

function updateButtonState(button, isExcluded) {
    button.textContent = isExcluded ? 'excluded' : 'enabled';
    button.classList.toggle('excluded', isExcluded);
    button.classList.toggle('enabled', !isExcluded);
}

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

                    chrome.storage.local.set({ excludedSites: updatedSites }, function () {
                        const nowExcluded = updatedSites.includes(domain);
                        updateButtonState(toggleButton, nowExcluded);
                    });
                });
            });
        });
    });
});
    
document.getElementById('searchData').addEventListener('click', function() {
    window.open(API_BASE, '_blank');
});