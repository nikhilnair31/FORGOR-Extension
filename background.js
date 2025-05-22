const API_BASE = 'https://mia2.xyz/';

let notificationTimer;

chrome.runtime.onInstalled.addListener(() => {
    chrome.tabs.create({
        url: chrome.runtime.getURL("login.html")
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOGIN') {
        loginUser(message.username, message.password).then(sendResponse);
        return true; // ✅ Keep message channel open
    }

    if (message.type === 'REGISTER') {
        registerUser(message.username, message.password).then(sendResponse);
        return true;
    }

    if (message.type === 'REFRESH_TOKEN') {
        refreshAccessToken(message.refresh_token).then(sendResponse);
        return true;
    }
});

async function loginUser(username, password) {
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();
        if (res.ok) {
        await chrome.storage.local.set({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
        });
        return { status: 'success' };
        } else {
        return { status: 'error', message: data.message };
        }
    } catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}

async function registerUser(username, password) {
    try {
        const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        });

        const data = await res.json();
        return res.ok
        ? { status: 'success' }
        : { status: 'error', message: data.message };
    } catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}

async function refreshAccessToken(refresh_token) {
    try {
        const res = await fetch(`${API_BASE}/refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token }),
        });

        const data = await res.json();
        if (res.ok) {
        await chrome.storage.local.set({ access_token: data.access_token });
        return { status: 'success', access_token: data.access_token };
        } else {
        return { status: 'error', message: data.message };
        }
    } catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}

// OLDER CODE

// chrome.action.onClicked.addListener(() => {
//     clearNotificationBadge();

//     chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
//         const currentTab = tabs[0];
//         chrome.tabs.create({
//             url: 'response.html',
//             index: currentTab.index + 1
//         });
//     });
// });

// chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
//     console.log(`Message received in background: ${JSON.stringify(message)}`);

//     if (message.type === 'SEARCH_REQUEST') {
//         sendToEnpoint(message.query, message.search); // Call Lambda with the search query and indicate it's a search
//     }
// });

// chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
//     if (changeInfo.status === 'complete' && tab.active) {
//         const url = new URL(tab.url);
//         const hostname = url.hostname;

//         // Handle common search engines
//         if (hostname.includes('google.') && url.pathname === '/search') {
//             const query = new URLSearchParams(url.search).get('q');
//             if (query) {
//                 console.log(`Captured Google search: ${query}`);
//                 handleCapturedSearch(query);
//             }
//         }
//         else if (hostname.includes('bing.com') && url.pathname === '/search') {
//             const query = new URLSearchParams(url.search).get('q');
//             if (query) {
//                 console.log(`Captured Bing search: ${query}`);
//                 handleCapturedSearch(query);
//             }
//         }
//         else if (hostname.includes('duckduckgo.com')) {
//             const query = new URLSearchParams(url.search).get('q');
//             if (query) {
//                 console.log(`Captured DuckDuckGo search: ${query}`);
//                 handleCapturedSearch(query);
//             }
//         }
//     }
// });

// async function getUsername() {
//     return new Promise((resolve) => {
//         chrome.storage.local.get(['username'], function(result) {
//             if (result.username) {
//                 resolve(result.username);
//             } else {
//                 resolve(null);
//             }
//         });
//     });
// }

// async function sendToEnpoint(content = '', isSearch = false) {
//     try {
//         // Create the endpoint URL
//         const endpoint = `${API_BASE}/query`;

//         // Get username from storage using a Promise wrapper
//         const username = await getUsername();

//         // Prepare the data to send to Lambda
//         const data = {
//             username: username,
//             searchText: content
//         };
//         console.log(`Sending data to Lambda: ${JSON.stringify(data)}`);

//         // Send the data to Lambda
//         const response = await fetch(endpoint, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json'
//             },
//             body: JSON.stringify(data)
//         });

//         // Check if response is 200
//         if (response.status === 200) {
//             // Get the response content
//             const responseText = await response.text();
//             // console.log(`Lambda response: ${responseText}`);

//             // Parse the response
//             const formattedResponse = parseResponseText(responseText);
//             // console.log(`Formatted Lambda response: ${formattedResponse}`);

//             // If it's a search request, send the results back to response.js
//             console.log(`isSearch: ${isSearch} | formattedResponse.length: ${formattedResponse.length}`);
//             if (isSearch) {
//                 chrome.runtime.sendMessage({
//                     type: 'SEARCH_RESULTS',
//                     results: formattedResponse
//                 });
//             } 
//             else if (formattedResponse.length > 0) {
//                 chrome.storage.local.set({notification: formattedResponse, searchText: content});
//                 showNotificationBadge();
//             }
//         } 
//         else {
//             const errorText = await response.text();
//             console.error(`Lambda request failed with status ${response.status}: ${errorText}`);
//             if (isSearch) {
//                 chrome.runtime.sendMessage({
//                     type: 'SEARCH_ERROR',
//                     error: `Lambda request failed: ${errorText}`
//                 });
//             }
//         }
//     }
//     catch (error) {
//         console.error('Error sending data to Lambda:', error);
//         if (isSearch) {
//             chrome.runtime.sendMessage({
//                 type: 'SEARCH_ERROR',
//                 error: `Error during search: ${error.message}`
//             });
//         }
//     }
// }
// function parseResponseText(responseText) {
//     try {
//         const responseObj = typeof responseText === 'string' ? JSON.parse(responseText) : responseText;

//         if (responseObj.results && responseObj.results.length > 0) {
//             const formattedResults = responseObj.results.map(result => ({
//                 image_presigned_url: `${API_BASE}${result.image_presigned_url}`,
//                 post_url: result.post_url,
//                 image_text: result.image_text,
//                 timestamp_str: result.timestamp_str
//             }));
//             console.log(`formattedResults\n${JSON.stringify(formattedResults)}`);
//             // console.log(`Found ${formattedResults.length} results`);
//             return formattedResults;
//         } else {
//             console.log('No results found in response');
//             return [];
//         }
//     } catch (error) {
//         console.error(`Error parsing response: ${error.message}`);
//         return [];
//     }
// }

// function showNotificationBadge() {
//     // Set the badge
//     chrome.action.setBadgeText({text: '!'});
//     chrome.action.setBadgeBackgroundColor({color: '#FF0000'});

//     // Clear the previous timer if it exists
//     if (notificationTimer) {
//         clearTimeout(notificationTimer);
//     }

//     // Set a new timer to clear the badge after X seconds
//     notificationTimer = setTimeout(clearNotificationBadge, 15000);
// }
// function clearNotificationBadge() {
//     chrome.action.setBadgeText({text: ''});
// }

// function handleCapturedSearch(query) {
//     chrome.runtime.sendMessage({
//         type: 'SEARCH_REQUEST',
//         query: query,
//         search: false
//     });
// }