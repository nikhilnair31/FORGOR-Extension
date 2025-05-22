importScripts('config.js');

let notificationTimer;

chrome.action.onClicked.addListener(() => {
    clearNotificationBadge();

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const currentTab = tabs[0];
        chrome.tabs.create({
            url: 'response.html',
            index: currentTab.index + 1
        });
    });
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log(`Message received in background: ${JSON.stringify(message)}`);

    if (message.type === 'query') {
        searchToServer(message.query);
    }
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab.active) {
        const url = new URL(tab.url);
        const hostname = url.hostname;

        // Handle common search engines
        if (hostname.includes('google.') && url.pathname === '/search') {
            const query = new URLSearchParams(url.search).get('q');
            if (query) {
                console.log(`Captured Google search: ${query}`);
                handleCapturedSearch(query);
            }
        }
        else if (hostname.includes('bing.com') && url.pathname === '/search') {
            const query = new URLSearchParams(url.search).get('q');
            if (query) {
                console.log(`Captured Bing search: ${query}`);
                handleCapturedSearch(query);
            }
        }
        else if (hostname.includes('duckduckgo.com')) {
            const query = new URLSearchParams(url.search).get('q');
            if (query) {
                console.log(`Captured DuckDuckGo search: ${query}`);
                handleCapturedSearch(query);
            }
        }
    }
});

async function getUsername() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['username'], function(result) {
            if (result.username) {
                resolve(result.username);
            } else {
                resolve(null);
            }
        });
    });
}

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
            
            // if (isSearch) {
            //     chrome.runtime.sendMessage({
            //         type: 'SEARCH_RESULTS',
            //         results: formattedResponse
            //     });
            // } 
            // else if (formattedResponse.length > 0) {
            //     chrome.storage.local.set({notification: formattedResponse, searchText: content});
            //     showNotificationBadge();
            // }
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

function showNotificationBadge() {
    // Set the badge
    chrome.action.setBadgeText({text: '!'});
    chrome.action.setBadgeBackgroundColor({color: '#FF0000'});

    // Clear the previous timer if it exists
    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }

    // Set a new timer to clear the badge after X seconds
    notificationTimer = setTimeout(clearNotificationBadge, 15000);
}
function clearNotificationBadge() {
    chrome.action.setBadgeText({text: ''});
}

function handleCapturedSearch(query) {
    chrome.runtime.sendMessage({
        type: 'SEARCH_REQUEST',
        query: query,
        search: false
    });
}