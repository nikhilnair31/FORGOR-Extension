import { SERVER_URL, USER_AGENT } from "./config.js";

const EP = {
    LOGIN:    `${SERVER_URL}/api/login`,
    REGISTER: `${SERVER_URL}/api/register`
};

const loginForm    = document.getElementById("loginForm");
const signupForm   = document.getElementById("signupForm");
const loginStatus  = document.getElementById("loginStatus");
const signupStatus = document.getElementById("signupStatus");

// ---- Login ----
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginStatus.textContent = ""; loginStatus.className = "";

    const username    = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
        const res = await fetch(EP.LOGIN, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-Timezone": tz
        },
        body: JSON.stringify({ username, password })
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(txt || `Login failed (${res.status})`);
        const data = JSON.parse(txt);

        const access  = data?.access_token;
        const refresh = data?.refresh_token;
        if (!access || !refresh) throw new Error("Tokens missing");

        await chrome.storage.sync.set({ access_token: access, refresh_token: refresh });

        loginStatus.textContent = "Logged in successfully!";
        loginStatus.className = "ok";
        setTimeout(() => window.close(), 700);
    } catch (err) {
        loginStatus.textContent = err?.message || "Login request failed";
        loginStatus.className = "error";
    }
});

// ---- Signup ----
signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    signupStatus.textContent = ""; signupStatus.className = "";

    const username = document.getElementById("signupUsername").value.trim();
    const email    = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
        const reg = await fetch(EP.REGISTER, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ username, email, password, timezone: tz })
        });
        if (!reg.ok) throw new Error(`Register failed (${reg.status})`);

        signupStatus.textContent = "Registered successfully! You can now log in.";
        signupStatus.className = "ok";
    } catch (err) {
        signupStatus.textContent = err?.message || "Register request failed";
        signupStatus.className = "error";
    }
});

// ---- Password toggles ----
document.querySelectorAll(".togglePw").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        if (input.type === "password") {
            input.type = "text";
            btn.textContent = "🙈";
        } else {
            input.type = "password";
            btn.textContent = "👁";
        }
    });
});

// ---- Tabs ----
const loginTab  = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");

loginTab.addEventListener("click", () => {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    loginForm.style.display = "grid";
    signupForm.style.display = "none";
});
signupTab.addEventListener("click", () => {
    signupTab.classList.add("active");
    loginTab.classList.remove("active");
    signupForm.style.display = "grid";
    loginForm.style.display = "none";
});
