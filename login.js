// login.js

import CONFIG from './config.js';

// === Form Tab Switching ===
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Update active tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding form
        const target = tab.getAttribute('data-target');
        document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
        document.getElementById(target).classList.add('active');
    });
});

// === Login ===
document.getElementById('login-button').addEventListener('click', () => {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    loginUser(username, password).then(response => {
        if (response.status === 'success') {
            console.log("Logged in successfully!");
            window.close();
        } 
        else {
            console.log(response.message);
        }
    });
});
async function loginUser(username, password) {
    try {
        console.log(`Logging in with username: ${username} and password: ${password}`);
        
        const res = await fetch(`${CONFIG.SERVER_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.USER_AGENT,
                'X-App-Key': CONFIG.APP_KEY,
            },
            body: JSON.stringify({ username, password }),
        });

        console.log(`Response status: ${JSON.stringify(res)}`);

        const data = await res.json();
        if (res.ok) {
            await chrome.storage.local.set({
                username: username,
                access_token: data.access_token,
                refresh_token: data.refresh_token,
            });
            return { status: 'success' };
        } 
        else {
            return { status: 'error', message: data.message };
        }
    } 
    catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}

// === Register ===
document.getElementById('register-button').addEventListener('click', () => {
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    console.log(`Registering with username: ${username} and password: ${password}`);

    registerUser(username, password).then(response => {
        if (response.status === 'success') {
            console.log("Registered successfully!");
            
            loginUser(username, password).then(response => {
                if (response.status === 'success') {
                    console.log("Logged in successfully!");
                    window.close();
                } 
                else {
                    console.log(response.message);
                }
            });
        } 
        else {
            console.log(response.message);
        }
    });
});
async function registerUser(username, password) {
    try {
        const res = await fetch(`${CONFIG.SERVER_URL}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.USER_AGENT,
                'X-App-Key': CONFIG.APP_KEY,
            },
            body: JSON.stringify({ username, password }),
        });

        const data = await res.json();
        if (res.ok) {
            await chrome.storage.local.set({
                username: username,
            });
            return { status: 'success' };
        } 
        else {
            return { status: 'error', message: data.message };
        }
    } 
    catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}

// === Other ===
async function refreshAccessToken(refresh_token) {
    try {
        const res = await fetch(`${SERVER_URL}/api/refresh_token`, {
            method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': USER_AGENT,
                    'X-App-Key': APP_KEY,
                },
            body: JSON.stringify({ refresh_token }),
        });

        const data = await res.json();
        if (res.ok) {
            await chrome.storage.local.set({ 
                access_token: data.access_token 
            });
            return { status: 'success', access_token: data.access_token };
        } 
        else {
            return { status: 'error', message: data.message };
        }
    } 
    catch (err) {
        return { status: 'error', message: 'Network error' };
    }
}