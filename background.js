importScripts('config.js');

let notificationTimer;

chrome.runtime.onInstalled.addListener((details) => {
    // Show login page if the extension is installed for the first time
    if (details.reason === "update") { // install
        chrome.tabs.create({
            url: "login.html"
        });
    }

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

    if (message.type !== 'query') return;

    chrome.storage.local.get('excludedSites', ({ excludedSites = [] }) => {
        const domain = new URL(message.url || sender.url).hostname;

        if (excludedSites.includes(domain)) {
            console.log(`Extension disabled for ${domain}`);
            return;
        }

        searchToServer(message.query);
    });
});
async function searchToServer(content) {
    const tokens = await new Promise((resolve) =>
        chrome.storage.local.get(['access_token'], resolve)
    );

    const accessToken = tokens.access_token;

    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/check`, {
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
            console.log(`responseText: ${responseText}`);

            var responseJson = JSON.parse(responseText);
            useful_content = responseJson.useful_content;
            query_text = responseJson.query_text;
            var saveDict = {useful: useful_content, query: query_text}
            
            chrome.storage.local.set({useful: useful_content, query: query_text});

            showIconAlert()
            showToast('FORGOR FOUND SOMETHING YOU\'VE SAVED');
        } 
        else {
            const errorText = await response.text();
            console.error(`API request failed with status ${response.status}: ${errorText}`);
        }
    }
    catch (error) {
        console.error('Error sending data to API:', error);
    }
}

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'complete' || !tab.active || !tab.url) return;

    const url = new URL(tab.url);
    const hostname = url.hostname;
    const pathname = url.pathname;
    const inputText = new URLSearchParams(url.search).get('q');

    const isSearchPage = (
        (hostname.includes('google.') && pathname === '/search') ||
        (hostname.includes('bing.com') && pathname === '/search') ||
        hostname.includes('duckduckgo.com')
    );

    if (isSearchPage && inputText) {
        console.log(`inputText: ${inputText}`);
        chrome.runtime.sendMessage({
            type: 'query',
            query: inputText
        });
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === "save_to_app") {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs && tabs[0]) {
                const tabUrl = tabs[0].url;
                sendToForgor_Url({
                    type: "page",
                    url: tabUrl
                });
            } else {
                console.warn("No active tab found.");
            }
        });
    }
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    const tabUrl = info.pageUrl;

    if (info.menuItemId === "save-page-url") {
        sendToForgor_Url({
            type: "page", 
            url: tabUrl 
        });

    } else if (info.menuItemId === "save-selection") {
        sendToForgor_Txt({
            type: "selection",
            text: info.selectionText,
            url: tabUrl
        });

    } else if (info.menuItemId === "save-image") {
        sendToForgor_ImgUrl({
            type: "image",
            imageUrl: info.srcUrl,
            url: tabUrl
        });
    }
});
async function sendToForgor_Url(data) {
    console.log(`sendToForgor_Url: ${JSON.stringify(data)}`);

    const tokens = await new Promise((resolve) =>
        chrome.storage.local.get(['access_token'], resolve)
    );
    const accessToken = tokens.access_token;

    try {
        const formData = new FormData();
        formData.append("url", data.url);

        const response = await fetch(`${CONFIG.API_BASE}/api/upload/url`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': CONFIG.USER_AGENT,
                'X-App-Key': CONFIG.APP_KEY,
            },
            body: formData,
        });

        if (response.status === 200) {
            const responseText = await response.text();
            console.log(`API response: ${responseText}`);
            showToast('SAVED');
        } 
        else {
            const errorText = await response.text();
            console.error(`API request failed with status ${response.status}: ${errorText}`);
        }
    }
    catch (error) {
        console.error('Error sending data to API:', error);
    }
}
async function sendToForgor_ImgUrl(data) {
    console.log(`sendToForgor_Img: ${JSON.stringify(data)}`);

    const tokens = await new Promise((resolve) =>
        chrome.storage.local.get(['access_token'], resolve)
    );
    const accessToken = tokens.access_token;

    try {
        const formData = new FormData();
        formData.append("image_url", data.imageUrl);
        formData.append("post_url", data.url);  // page the image came from

        const response = await fetch(`${CONFIG.API_BASE}/api/upload/imageurl`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': CONFIG.USER_AGENT,
                'X-App-Key': CONFIG.APP_KEY,
            },
            body: formData,
        });

        if (response.ok) {
            const responseText = await response.text();
            console.log(`API response: ${responseText}`);
            showToast('IMAGE SAVED');
        } else {
            const errorText = await response.text();
            console.error(`API request failed with status ${response.status}: ${errorText}`);
            showToast('FAILED TO SAVE');
        }
    }
    catch (error) {
        console.error('Error sending image to API:', error);
        showToast('ERROR');
    }
}
async function sendToForgor_Txt(data) {
    console.log(`sendToForgor_Txt: ${JSON.stringify(data)}`);
}

function showToast(content) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'flash-toast',
                text: content
            });
        }
    });
}
function showBadge() {
    chrome.action.setBadgeText({text: '!'});
    chrome.action.setBadgeBackgroundColor({color: '#FF0000'});
    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => chrome.action.setBadgeText({text: ''}), 15000);
}
function showIconAlert() {
    chrome.action.setIcon({
        path: {
        "16": "images/icon16_1.png",
        "32": "images/icon32_1.png",
        "48": "images/icon48_1.png",
        "128": "images/icon128_1.png"
        }
    });

    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        chrome.action.setIcon({
        path: {
            "16": "images/icon16.png",
            "32": "images/icon32.png",
            "48": "images/icon48.png",
            "128": "images/icon128.png"
        }
        });
    }, 15000);
}