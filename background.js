importScripts('config.js');

let notificationTimer;

chrome.runtime.onInstalled.addListener(() => {
    // Page URL
    chrome.contextMenus.create({
        id: "save-page-url",
        title: "Save Page URL to FORGOR",
        contexts: ["page"]
    });

    // Selected Text
    chrome.contextMenus.create({
        id: "save-selection",
        title: "Save Selection + URL to FORGOR",
        contexts: ["selection"]
    });

    // Hovered Image
    chrome.contextMenus.create({
        id: "save-image",
        title: "Save Image + URL to FORGOR",
        contexts: ["image"]
    });
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log(`Message received in background: ${JSON.stringify(message)}`);

    if (message.type === 'query') {
        searchToServer(message.query);
    }
});
async function searchToServer(content) {
    const tokens = await new Promise((resolve) =>
        chrome.storage.local.get(['access_token'], resolve)
    );

    const accessToken = tokens.access_token;

    try {
        const response = await fetch(`${CONFIG.API_BASE}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': CONFIG.USER_AGENT,
                'X-App-Key': CONFIG.APP_KEY,
            },
            body: JSON.stringify({searchText: content}),
        });

        if (response.status === 200) {
            const responseText = await response.text();
            console.log(`Lambda response: ${responseText}`);

            const formattedResponse = parseResponseText(responseText);
            console.log(`Formatted Lambda response: ${JSON.stringify(formattedResponse)}`);
            
            if (isSearch) {
                chrome.runtime.sendMessage({
                    type: 'SEARCH_RESULTS',
                    results: formattedResponse
                });
            } 
            else if (formattedResponse.length > 0) {
                chrome.storage.local.set({notification: formattedResponse, searchText: content});
                
                // Set the badge
                chrome.action.setBadgeText({text: '!'});
                chrome.action.setBadgeBackgroundColor({color: '#FF0000'});

                // Clear the previous timer if it exists
                if (notificationTimer) {
                    clearTimeout(notificationTimer);
                }

                // Set a new timer to clear the badge after X seconds
                notificationTimer = setTimeout(() => {
                    chrome.action.setBadgeText({text: ''});
                }, 15000);
            }
        } 
        else {
            const errorText = await response.text();
            console.error(`Lambda request failed with status ${response.status}: ${errorText}`);
            if (isSearch) {
                chrome.runtime.sendMessage({
                    type: 'SEARCH_ERROR',
                    error: `Lambda request failed: ${errorText}`
                });
            }
        }
    }
    catch (error) {
        console.error('Error sending data to Lambda:', error);
        if (isSearch) {
            chrome.runtime.sendMessage({
                type: 'SEARCH_ERROR',
                error: `Error during search: ${error.message}`
            });
        }
    }
}
function parseResponseText(responseText) {
    try {
        const responseObj = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;

        if (responseObj.results && responseObj.results.length > 0) {
            const formattedResults = responseObj.results.map(result => ({
                image_presigned_url: `${CONFIG.API_BASE}${result.image_presigned_url}`,
                post_url: result.post_url,
                image_text: result.image_text,
                timestamp_str: result.timestamp_str
            }));
            console.log(`formattedResults\n${JSON.stringify(formattedResults)}`);
            // console.log(`Found ${formattedResults.length} results`);
            return formattedResults;
        } 
        else {
            console.log('No results found in response');
            return [];
        }
    } 
    catch (error) {
        console.error(`Error parsing response: ${error.message}`);
        return [];
    }
}

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete' || !tab.active || !tab.url) return;

    const url = new URL(tab.url);
    const hostname = url.hostname;
    const pathname = url.pathname;
    const query = new URLSearchParams(url.search).get('q');

    const isSearchPage = (
        (hostname.includes('google.') && pathname === '/search') ||
        (hostname.includes('bing.com') && pathname === '/search') ||
        hostname.includes('duckduckgo.com')
    );

    if (isSearchPage && query) {
        console.log(`Captured search: ${query}`);
        chrome.runtime.sendMessage({
            type: 'SEARCH_REQUEST',
            query,
            search: false
        });
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === "save_to_app") {
        console.log("Save to app triggered via shortcut!");

        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                function: () => {
                    tabUrl = window.location.href;
                    sendToForgor({
                        type: "page", 
                        url: tabUrl 
                    });
                }
            });
        });
    }
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const tabUrl = info.pageUrl;

    if (info.menuItemId === "save-page-url") {
        sendToForgor({
            type: "page", 
            url: tabUrl 
        });

    } else if (info.menuItemId === "save-selection") {
        sendToForgor({
            type: "selection",
            text: info.selectionText,
            url: tabUrl
        });

    } else if (info.menuItemId === "save-image") {
        sendToForgor({
            type: "image",
            imageUrl: info.srcUrl,
            url: tabUrl
        });
    }
});
async function sendToForgor(data) {
    const tokens = await new Promise((resolve) =>
        chrome.storage.local.get(['access_token'], resolve)
    );
    const accessToken = tokens.access_token;
    console.log(`Sending data to FORGOR: ${JSON.stringify(data)}`);
    console.log(`Access Token: ${accessToken}`);
    
    // Call the API to send the data
}
