const { API_BASE, USER_AGENT, APP_KEY } = CONFIG;

document.getElementById('login-button').addEventListener('click', () => {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    console.log(`Logging in with username: ${username} and password: ${password}`);

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

async function loginUser(username, password) {
    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
                'X-App-Key': APP_KEY,
            },
            body: JSON.stringify({ username, password }),
        });

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
async function registerUser(username, password) {
    try {
        const res = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
                'X-App-Key': APP_KEY,
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
async function refreshAccessToken(refresh_token) {
    try {
        const res = await fetch(`${API_BASE}/refresh_token`, {
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