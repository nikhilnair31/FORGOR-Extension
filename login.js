import { SERVER_URL, APP_KEY, USER_AGENT } from "./config.js";

const EP = {
    LOGIN:    `${SERVER_URL}/api/login`,
    REGISTER: `${SERVER_URL}/api/register`
};

const form = document.getElementById("authForm");
const statusEl = document.getElementById("status");

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.textContent = ""; statusEl.className = "";

    const username = document.getElementById("username").value.trim();
    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const mode     = document.getElementById("mode").value;

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const url = mode === "login" ? EP.LOGIN : EP.REGISTER;

    try {
        // Sign up first, then log in (server does this in Android helper too)
        if (mode === "signup") {
            const reg = await fetch(url, {
                method: "POST",
                headers: {
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                "X-App-Key": APP_KEY
                },
                body: JSON.stringify({ username, email, password, timezone: tz })
            });
            if (!reg.ok) throw new Error(`Register failed (${reg.status})`);
        }

        const res = await fetch(EP.LOGIN, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                "X-App-Key": APP_KEY,
                "X-Timezone": tz
            },
            body: JSON.stringify({ username, email, password })
        });

        const txt = await res.text();
        if (!res.ok) throw new Error(txt || `Login failed (${res.status})`);
        const data = JSON.parse(txt);
        console.log(`data ${data}`);

        const access = data?.access_token;
        const refresh = data?.refresh_token;
        if (!access || !refresh) throw new Error("Tokens missing");
        console.log(`access ${access}`);
        console.log(`refresh ${refresh}`);

        await chrome.storage.sync.set({ access_token: access, refresh_token: refresh });

        statusEl.textContent = "Success! You can close this tab.";
        statusEl.className = "ok";
        setTimeout(() => window.close(), 700);
    } catch (err) {
        statusEl.textContent = err?.message || "Request failed";
        statusEl.className = "error";
    }
});
