const { API_BASE, WEBSITE_URL, USER_AGENT, APP_KEY } = CONFIG;
    
document.getElementById('searchButton').addEventListener('click', function() {
    window.open(WEBSITE_URL, '_blank');
});

document.getElementById("edit-shortcut").addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

document.addEventListener('DOMContentLoaded', function() {
    chrome.action.setBadgeText({text: ''});
    
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const url = new URL(tabs[0].url);
        const domain = url.hostname;

        chrome.storage.local.get(['excludedSites'], function(result) {
            const excludedSites = result.excludedSites || [];
            const isExcluded = excludedSites.includes(domain);

            const toggleButton = document.getElementById('siteToggleButton');
            updateButtonState(toggleButton, isExcluded);

            toggleButton.addEventListener('click', function() {
                chrome.storage.local.get(['excludedSites'], function(result) {
                    let updatedSites = result.excludedSites || [];

                    if (updatedSites.includes(domain)) {
                        updatedSites = updatedSites.filter(site => site !== domain);
                    } 
                    else {
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

function updateButtonState(button, isExcluded) {
    button.textContent = isExcluded ? 'SITE EXCLUDED' : 'SITE INCLUDED';
    button.classList.toggle('excluded', isExcluded);
    button.classList.toggle('enabled', !isExcluded);
}