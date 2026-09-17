const API_URL = "http://localhost:5000/api";

/* =========================================================
   FOODSHARE
   Backend-connected frontend
   PostgreSQL + Node.js + Express + ESP32

   Only session/token is stored in localStorage.
   Food, requests, profiles and devices come from the API.
   ========================================================= */

const STORAGE = {
    session: "foodshare_v2_session"
};

let currentRole = "shopkeeper";
let currentUser = null;
let authToken = null;
let foods = [];
let requests = [];
let profile = null;
let devices = [];
let currentPage = "dashboard";


/* =========================================================
   HELPERS
   ========================================================= */

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function localDateTimeValue(date = new Date()) {
    const local = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000
    );

    return local.toISOString().slice(0, 16);
}

function showToast(message, type = "success") {
    const box = document.getElementById("toast");

    if (!box) return;

    box.className = `toast ${type}`;
    box.textContent = message;
    box.classList.remove("hidden");

    clearTimeout(window.foodShareToastTimer);

    window.foodShareToastTimer = setTimeout(() => {
        box.classList.add("hidden");
    }, 2800);
}

function saveSession() {
    if (!currentUser || !authToken) return;

    localStorage.setItem(
        STORAGE.session,
        JSON.stringify({
            token: authToken,
            user: currentUser
        })
    );
}

function clearSession() {
    localStorage.removeItem(STORAGE.session);
}

function loadSession() {
    try {
        const value = localStorage.getItem(STORAGE.session);
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}


/* =========================================================
   API HELPER
   ========================================================= */

async function apiRequest(endpoint, options = {}) {
    const headers = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
    };

    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    let response;

    try {
        response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
    } catch (error) {
        console.error("API connection error:", error);

        throw new Error(
            "Cannot connect to FoodShare server. Make sure the backend is running on port 5000."
        );
    }

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        if (response.status === 401) {
            clearSession();
        }

        throw new Error(
            data.message || `Request failed (${response.status})`
        );
    }

    return data;
}


/* =========================================================
   DATA NORMALIZATION
   ========================================================= */

function normalizeFood(row) {
    return {
        id: row.id,
        donorId: row.donor_id,
        donorEmail: row.donor_email || "",
        donorName: row.donor_name || "",
        donorOrganization: row.organization_name || "",
        donorLocation: row.donor_location || "",
        foodName: row.food_name || "",
        quantity: row.quantity,
        unit: row.unit || "",
        foodType: row.food_type || "",
        preparedAt: row.prepared_at,
        bestBefore: row.best_before,
        description: row.description || "",
        status: row.status || "available",
        createdAt: row.created_at
    };
}

function normalizeRequest(row) {
    return {
        id: row.id,
        foodId: row.food_id,
        ngoId: row.ngo_id,
        foodName: row.food_name || "",
        quantity: row.quantity,
        unit: row.unit || "",
        foodType: row.food_type || "",
        bestBefore: row.best_before,
        description: row.description || "",
        foodStatus: row.food_status || "",
        donorId: row.donor_id,
        donorEmail: row.donor_email || "",
        donorName: row.donor_name || "",
        donorOrganization: row.donor_organization || "",
        donorLocation: row.donor_location || "",
        ngoEmail: row.ngo_email || "",
        ngoName: row.ngo_name || "",
        ngoOrganization: row.ngo_organization || "",
        status: row.status || "pending",
        requestedAt: row.requested_at,
        respondedAt: row.responded_at
    };
}

function normalizeProfile(row) {
    return {
        id: row.id,
        name: row.full_name || "",
        email: row.email || "",
        role: row.role || currentRole,
        phone: row.phone || "",
        organization: row.organization_name || "",
        location: row.location || "",
        createdAt: row.created_at
    };
}

function normalizeDevice(row) {
    return {
        id: row.id,
        ownerId: row.owner_id,
        deviceCode: row.device_code || "",
        deviceType: row.device_type || "ESP32",
        status: row.status || "offline",
        rtcSynced: Boolean(row.rtc_synced),
        lastSeen: row.last_seen_at,
        createdAt: row.created_at
    };
}


/* =========================================================
   LOAD DATA FROM POSTGRESQL
   ========================================================= */

async function loadFood() {
    const data = await apiRequest("/food");

    foods = (data.food || []).map(normalizeFood);
}

async function loadRequests() {
    const data = await apiRequest("/requests");

    requests = (data.requests || []).map(normalizeRequest);
}

async function loadProfile() {
    const data = await apiRequest("/profile");

    profile = normalizeProfile(data.profile);

    currentUser = {
        ...currentUser,
        id: profile.id,
        email: profile.email,
        role: profile.role,
        name: profile.name
    };

    currentRole = profile.role;

    saveSession();
}

async function loadDevices() {
    const data = await apiRequest("/devices");

    devices = (data.devices || []).map(normalizeDevice);
}

async function loadAllData() {
    if (!currentUser || !authToken) return;

    try {
        await Promise.all([
            loadFood(),
            loadRequests(),
            loadProfile(),
            loadDevices()
        ]);
    } catch (error) {
        console.error("Load data error:", error);

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   EXPIRY UPDATE
   ========================================================= */

async function updateExpiredFoods() {
    try {
        await apiRequest(
            "/food/update-expired",
            {
                method: "PATCH"
            }
        );
    } catch (error) {
        console.error(
            "Expiry update error:",
            error
        );
    }
}


/* =========================================================
   ROLE SELECTION
   ========================================================= */

function selectRole(role) {
    currentRole = role;

    const shopkeeperButton =
        document.getElementById(
            "shopkeeperRoleBtn"
        );

    const ngoButton =
        document.getElementById(
            "ngoRoleBtn"
        );

    if (shopkeeperButton) {
        shopkeeperButton.classList.toggle(
            "active",
            role === "shopkeeper"
        );
    }

    if (ngoButton) {
        ngoButton.classList.toggle(
            "active",
            role === "ngo"
        );
    }
}


/* =========================================================
   LOGIN
   ========================================================= */

const shopkeeperRoleButton =
    document.getElementById(
        "shopkeeperRoleBtn"
    );

if (shopkeeperRoleButton) {
    shopkeeperRoleButton.addEventListener(
        "click",
        () => {
            selectRole("shopkeeper");
        }
    );
}

const ngoRoleButton =
    document.getElementById(
        "ngoRoleBtn"
    );

if (ngoRoleButton) {
    ngoRoleButton.addEventListener(
        "click",
        () => {
            selectRole("ngo");
        }
    );
}

const loginForm =
    document.getElementById(
        "loginForm"
    );

if (loginForm) {
    loginForm.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            await login();
        }
    );
}

async function login() {
    const email =
        document
            .getElementById("email")
            ?.value
            .trim();

    const password =
        document
            .getElementById("password")
            ?.value;

    if (!email || !password) {
        showToast(
            "Enter your email and password.",
            "error"
        );

        return;
    }

    const button =
        loginForm?.querySelector(
            'button[type="submit"]'
        );

    if (button) {
        button.disabled = true;
        button.textContent = "Signing in...";
    }

    try {
        const data =
            await apiRequest(
                "/auth/login",
                {
                    method: "POST",

                    body: JSON.stringify({
                        email,
                        password,
                        role: currentRole
                    })
                }
            );

        authToken = data.token;

        currentUser = data.user;

        currentRole =
            data.user.role;

        saveSession();

        await updateExpiredFoods();

        await loadAllData();

        openApp();

        showToast(
            "Login successful."
        );

    } catch (error) {
        console.error(
            "Login error:",
            error
        );

        showToast(
            error.message,
            "error"
        );

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Sign In";
        }
    }
}


/* =========================================================
   OPEN APP
   ========================================================= */

function openApp() {
    const loginScreen =
        document.getElementById(
            "loginScreen"
        );

    const appScreen =
        document.getElementById(
            "appScreen"
        );

    if (loginScreen) {
        loginScreen.classList.add(
            "hidden"
        );
    }

    if (appScreen) {
        appScreen.classList.remove(
            "hidden"
        );
    }

    updateUserHeader();

    configureNavigation();

    showPage("dashboard");
}


/* =========================================================
   HEADER
   ========================================================= */

function updateUserHeader() {
    if (!currentUser) return;

    const name =
        profile?.name ||
        currentUser.name ||
        "User";

    const roleText =
        currentUser.role ===
        "shopkeeper"
            ? "Food Donor"
            : "NGO";

    const userName =
        document.getElementById(
            "userName"
        );

    const userRole =
        document.getElementById(
            "userRole"
        );

    const userAvatar =
        document.getElementById(
            "userAvatar"
        );

    if (userName) {
        userName.textContent =
            name;
    }

    if (userRole) {
        userRole.textContent =
            roleText;
    }

    if (userAvatar) {
        userAvatar.textContent =
            name
                .charAt(0)
                .toUpperCase();
    }
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function configureNavigation() {
    document
        .querySelectorAll(
            ".shopkeeper-only"
        )
        .forEach(
            (element) => {
                element.classList.toggle(
                    "hidden",
                    currentUser?.role !==
                        "shopkeeper"
                );
            }
        );
}

document
    .querySelectorAll(".nav-item")
    .forEach(
        (button) => {
            button.addEventListener(
                "click",
                async () => {
                    const page =
                        button.dataset.page;

                    if (
                        currentUser?.role !==
                            "shopkeeper" &&
                        [
                            "addFood",
                            "device"
                        ].includes(page)
                    ) {
                        return;
                    }

                    await refreshDataSilently();

                    showPage(page);
                }
            );
        }
    );

async function refreshDataSilently() {
    if (
        !currentUser ||
        !authToken
    ) {
        return;
    }

    try {
        await updateExpiredFoods();

        await loadAllData();

    } catch (error) {
        console.error(error);
    }
}


/* =========================================================
   PAGE RENDERING
   ========================================================= */

function showPage(page) {
    if (!currentUser) return;

    currentPage = page;

    document
        .querySelectorAll(
            ".nav-item"
        )
        .forEach(
            (element) => {
                element.classList.toggle(
                    "active",
                    element.dataset.page ===
                        page
                );
            }
        );

    const titles = {
        dashboard:
            "Dashboard",

        addFood:
            "Add Food",

        donations:
            currentUser.role ===
            "shopkeeper"
                ? "My Food Listings"
                : "Available Food",

        requests:
            "Donation Requests",

        device:
            "ESP32 Device",

        profile:
            "Profile"
    };

    const pageTitle =
        document.getElementById(
            "pageTitle"
        );

    if (pageTitle) {
        pageTitle.textContent =
            titles[page] ||
            "Dashboard";
    }

    const pages = {
        dashboard:
            currentUser.role ===
            "shopkeeper"
                ? shopkeeperDashboard()
                : ngoDashboard(),

        addFood:
            addFoodPage(),

        donations:
            donationsPage(),

        requests:
            requestsPage(),

        device:
            devicePage(),

        profile:
            profilePage()
    };

    const pageContent =
        document.getElementById(
            "pageContent"
        );

    if (pageContent) {
        pageContent.innerHTML =
            pages[page] ||
            pages.dashboard;
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


/* =========================================================
   PAGE BUTTONS
   ========================================================= */

document
    .getElementById(
        "pageContent"
    )
    ?.addEventListener(
        "click",
        async (event) => {
            const button =
                event.target.closest(
                    "[data-action]"
                );

            if (!button) return;

            const action =
                button.dataset.action;

            const id =
                button.dataset.id;

            const page =
                button.dataset.page;

            if (action === "page") {
                showPage(page);

                return;
            }

            if (
                action ===
                "request-food"
            ) {
                await requestFood(id);

                return;
            }

            if (
                action ===
                "cancel-food"
            ) {
                await cancelFood(id);

                return;
            }

            if (
                action ===
                "accept-request"
            ) {
                await acceptRequest(id);

                return;
            }

            if (
                action ===
                "reject-request"
            ) {
                await rejectRequest(id);

                return;
            }

            if (
                action ===
                "collect-request"
            ) {
                await collectRequest(id);

                return;
            }

            if (
                action ===
                "cancel-request"
            ) {
                await cancelRequest(id);
            }
        }
    );


/* =========================================================
   FORM HANDLING
   ========================================================= */

document
    .getElementById(
        "pageContent"
    )
    ?.addEventListener(
        "submit",
        async (event) => {
            if (
                event.target.id ===
                "foodForm"
            ) {
                event.preventDefault();

                await addFood();
            }

            if (
                event.target.id ===
                "profileForm"
            ) {
                event.preventDefault();

                await saveProfile();
            }
        }
    );


/* =========================================================
   SHOPKEEPER DASHBOARD
   ========================================================= */

function shopkeeperDashboard() {
    const myFoods =
        foods.filter(
            (food) =>
                food.donorId ===
                currentUser.id
        );

    const pending =
        requests.filter(
            (request) =>
                request.donorId ===
                    currentUser.id &&
                request.status ===
                    "pending"
        );

    const completed =
        requests.filter(
            (request) =>
                request.donorId ===
                    currentUser.id &&
                request.status ===
                    "collected"
        );

    const alertCount =
        devices.length
            ? devices.reduce(
                  (sum, device) =>
                      sum +
                      (device.alerts || 0),
                  0
              )
            : 0;

    return `
        <section class="hero">
            <div>
                <span class="eyebrow">
                    SMART FOOD DONATION
                </span>

                <h2>
                    Turn surplus food into meaningful help.
                </h2>

                <p>
                    Add surplus food, monitor its freshness
                    and coordinate collection with NGOs
                    through one platform.
                </p>

                <div class="hero-actions">
                    <button
                        class="btn btn-light"
                        data-action="page"
                        data-page="addFood">
                        + Add Food
                    </button>

                    <button
                        class="btn btn-outline-light"
                        data-action="page"
                        data-page="requests">
                        View Requests
                    </button>
                </div>
            </div>

            <div class="hero-illustration">
                🍲
            </div>
        </section>

        <section class="stats-grid">
            ${statCard(
                "🍱",
                "My Food Listings",
                myFoods.length
            )}

            ${statCard(
                "📩",
                "Pending Requests",
                pending.length
            )}

            ${statCard(
                "❤️",
                "Completed Donations",
                completed.length
            )}

            ${statCard(
                "📡",
                "ESP32 Alerts",
                alertCount
            )}
        </section>

        <div class="two-column">
            <section class="card">
                <div class="section-head">
                    <div>
                        <h3>
                            Recent Food Listings
                        </h3>

                        <p>
                            Your latest entries.
                        </p>
                    </div>

                    <button
                        class="text-btn"
                        data-action="page"
                        data-page="donations">
                        View all
                    </button>
                </div>

                ${renderFoodRows(
                    myFoods
                        .slice()
                        .reverse()
                        .slice(0, 4),
                    true
                )}
            </section>

            <section class="card">
                <div class="section-head">
                    <div>
                        <h3>
                            ESP32 Device
                        </h3>

                        <p>
                            Smart monitoring status.
                        </p>
                    </div>

                    <button
                        class="text-btn"
                        data-action="page"
                        data-page="device">
                        Open
                    </button>
                </div>

                ${deviceSummary()}
            </section>
        </div>
    `;
}


/* =========================================================
   NGO DASHBOARD
   ========================================================= */

function ngoDashboard() {
    const available =
        foods.filter(
            (food) =>
                food.status ===
                "available"
        );

    const myRequests =
        requests.filter(
            (request) =>
                request.ngoId ===
                currentUser.id
        );

    const collected =
        myRequests.filter(
            (request) =>
                request.status ===
                "collected"
        );

    return `
        <section class="hero">
            <div>
                <span class="eyebrow">
                    NGO COORDINATION
                </span>

                <h2>
                    Find surplus food and help it reach people in need.
                </h2>

                <p>
                    Browse available food from donors,
                    send a collection request and track
                    the request until completion.
                </p>

                <div class="hero-actions">
                    <button
                        class="btn btn-light"
                        data-action="page"
                        data-page="donations">
                        Browse Food
                    </button>

                    <button
                        class="btn btn-outline-light"
                        data-action="page"
                        data-page="requests">
                        My Requests
                    </button>
                </div>
            </div>

            <div class="hero-illustration">
                🤝
            </div>
        </section>

        <section class="stats-grid">
            ${statCard(
                "🍱",
                "Available Food",
                available.length
            )}

            ${statCard(
                "📩",
                "My Requests",
                myRequests.length
            )}

            ${statCard(
                "❤️",
                "Completed Collections",
                collected.length
            )}

            ${statCard(
                "📦",
                "Food Entries",
                foods.length
            )}
        </section>

        <section class="card">
            <div class="section-head">
                <div>
                    <h3>
                        Available Food
                    </h3>

                    <p>
                        Food currently open for donation requests.
                    </p>
                </div>

                <button
                    class="text-btn"
                    data-action="page"
                    data-page="donations">
                    View all
                </button>
            </div>

            ${renderFoodRows(
                available
                    .slice()
                    .reverse()
                    .slice(0, 5),
                false
            )}
        </section>
    `;
}


/* =========================================================
   STAT CARD
   ========================================================= */

function statCard(
    icon,
    label,
    value
) {
    return `
        <div class="stat-card">
            <div class="stat-icon">
                ${icon}
            </div>

            <div class="stat-label">
                ${escapeHtml(label)}
            </div>

            <div class="stat-value">
                ${escapeHtml(value)}
            </div>
        </div>
    `;
}


/* =========================================================
   FOOD ROWS
   ========================================================= */

function renderFoodRows(
    list,
    ownerView
) {
    if (!list.length) {
        return emptyState(
            "🍃",

            ownerView
                ? "No food listings yet"
                : "No food available",

            ownerView
                ? "Add your first surplus food listing to get started."
                : "Available food will appear here when a shopkeeper adds it."
        );
    }

    return `
        <div class="food-list">
            ${list
                .map(
                    (food) => `
                <article class="food-row">

                    <div class="food-icon">
                        🍱
                    </div>

                    <div class="food-main">

                        <strong>
                            ${escapeHtml(
                                food.foodName
                            )}
                        </strong>

                        <span>
                            ${escapeHtml(
                                food.foodType ||
                                    "Food"
                            )}

                            •

                            ${escapeHtml(
                                food.quantity
                            )}

                            ${escapeHtml(
                                food.unit
                            )}

                            ${
                                !ownerView
                                    ? ` • Donor: ${escapeHtml(
                                          food.donorName
                                      )}`
                                    : ""
                            }
                        </span>

                        <small>
                            Best before:
                            ${formatDate(
                                food.bestBefore
                            )}
                        </small>

                    </div>

                    <div class="food-side">

                        ${statusBadge(
                            food.status
                        )}

                        ${
                            ownerView
                                ? `
                                    <button
                                        class="small-btn danger"
                                        data-action="cancel-food"
                                        data-id="${food.id}"

                                        ${
                                            [
                                                "cancelled",
                                                "collected",
                                                "expired"
                                            ].includes(
                                                food.status
                                            )
                                                ? "disabled"
                                                : ""
                                        }>

                                        Cancel

                                    </button>
                                `
                                : `
                                    <button
                                        class="small-btn primary"
                                        data-action="request-food"
                                        data-id="${food.id}"

                                        ${
                                            food.status !==
                                            "available"
                                                ? "disabled"
                                                : ""
                                        }>

                                        Request

                                    </button>
                                `
                        }

                    </div>

                </article>
            `
                )
                .join("")}
        </div>
    `;
}


/* =========================================================
   ADD FOOD PAGE
   ========================================================= */

function addFoodPage() {
    if (
        currentUser.role !==
        "shopkeeper"
    ) {
        return accessDenied();
    }

    return `
        <section class="card form-card">

            <div class="section-head">

                <div>

                    <h3>
                        Add Surplus Food
                    </h3>

                    <p>
                        Enter the real food information.
                        Nothing is pre-filled.
                    </p>

                </div>

            </div>

            <form id="foodForm">

                <div class="form-grid">

                    ${field(
                        "foodName",
                        "Food Name",
                        "text",
                        "",
                        "Example: Rice"
                    )}

                    ${field(
                        "quantity",
                        "Quantity",
                        "number",
                        "",
                        "Example: 10",
                        'min="0.1" step="0.1"'
                    )}

                    <div class="field">

                        <label for="unit">
                            Unit
                        </label>

                        <select
                            id="unit"
                            required>

                            <option value="">
                                Select unit
                            </option>

                            <option value="kg">
                                Kilograms (kg)
                            </option>

                            <option value="litre">
                                Litres
                            </option>

                            <option value="plates">
                                Plates
                            </option>

                            <option value="packets">
                                Packets
                            </option>

                            <option value="items">
                                Items
                            </option>

                        </select>

                    </div>

                    <div class="field">

                        <label for="foodType">
                            Food Type
                        </label>

                        <select id="foodType">

                            <option value="">
                                Select type
                            </option>

                            <option value="Vegetarian">
                                Vegetarian
                            </option>

                            <option value="Non-Vegetarian">
                                Non-Vegetarian
                            </option>

                            <option value="Vegan">
                                Vegan
                            </option>

                            <option value="Bakery">
                                Bakery
                            </option>

                            <option value="Packaged Food">
                                Packaged Food
                            </option>

                            <option value="Other">
                                Other
                            </option>

                        </select>

                    </div>

                    ${field(
                        "preparedAt",
                        "Prepared Date & Time",
                        "datetime-local",
                        localDateTimeValue()
                    )}

                    ${field(
                        "bestBefore",
                        "Best Before",
                        "datetime-local",
                        ""
                    )}

                    <div class="field full">

                        <label for="description">
                            Description
                        </label>

                        <textarea
                            id="description"
                            placeholder="Add useful information about the food, packaging or collection instructions."></textarea>

                    </div>

                </div>

                <div class="form-actions">

                    <button
                        type="button"
                        class="btn btn-secondary"
                        data-action="page"
                        data-page="dashboard">

                        Cancel

                    </button>

                    <button
                        type="submit"
                        class="btn btn-primary">

                        Add Food Listing

                    </button>

                </div>

            </form>

        </section>
    `;
}


/* =========================================================
   FORM FIELD
   ========================================================= */

function field(
    id,
    label,
    type,
    value = "",
    placeholder = "",
    extra = ""
) {
    return `
        <div class="field">

            <label for="${escapeHtml(id)}">
                ${escapeHtml(label)}
            </label>

            <input
                id="${escapeHtml(id)}"
                type="${escapeHtml(type)}"
                value="${escapeHtml(value)}"
                placeholder="${escapeHtml(placeholder)}"
                ${extra}
                required>

        </div>
    `;
}


/* =========================================================
   ADD FOOD
   ========================================================= */

async function addFood() {
    if (
        !currentUser ||
        currentUser.role !==
            "shopkeeper"
    ) {
        showToast(
            "Only shopkeepers can add food.",
            "error"
        );

        return;
    }

    const foodName =
        document
            .getElementById(
                "foodName"
            )
            ?.value
            .trim();

    const quantity =
        Number(
            document
                .getElementById(
                    "quantity"
                )
                ?.value
        );

    const unit =
        document
            .getElementById(
                "unit"
            )
            ?.value;

    const foodType =
        document
            .getElementById(
                "foodType"
            )
            ?.value;

    const preparedAt =
        document
            .getElementById(
                "preparedAt"
            )
            ?.value;

    const bestBefore =
        document
            .getElementById(
                "bestBefore"
            )
            ?.value;

    const description =
        document
            .getElementById(
                "description"
            )
            ?.value
            .trim();

    if (
        !foodName ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !unit ||
        !bestBefore
    ) {
        showToast(
            "Please complete the required food details.",
            "error"
        );

        return;
    }

    if (
        new Date(bestBefore) <=
        new Date(preparedAt)
    ) {
        showToast(
            "Best-before time must be after the prepared time.",
            "error"
        );

        return;
    }

    if (
        new Date(bestBefore) <=
        new Date()
    ) {
        showToast(
            "Best-before time must be in the future.",
            "error"
        );

        return;
    }

    try {
        await apiRequest(
            "/food",
            {
                method: "POST",

                body: JSON.stringify({
                    donor_id:
                        currentUser.id,

                    food_name:
                        foodName,

                    quantity,

                    unit,

                    food_type:
                        foodType ||
                        null,

                    prepared_at:
                        new Date(
                            preparedAt
                        ).toISOString(),

                    best_before:
                        new Date(
                            bestBefore
                        ).toISOString(),

                    description:
                        description ||
                        null
                })
            }
        );

        await loadFood();

        showToast(
            "Food listing added successfully."
        );

        showPage(
            "donations"
        );

    } catch (error) {
        console.error(
            "Add food error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DONATIONS PAGE
   ========================================================= */

function donationsPage() {
    if (
        currentUser.role ===
        "shopkeeper"
    ) {
        const mine =
            foods.filter(
                (food) =>
                    food.donorId ===
                    currentUser.id
            );

        return `
            <section class="card">

                <div class="section-head">

                    <div>

                        <h3>
                            My Food Listings
                        </h3>

                        <p>
                            Track food you have added to FoodShare.
                        </p>

                    </div>

                    <button
                        class="btn btn-primary"
                        data-action="page"
                        data-page="addFood">

                        + Add Food

                    </button>

                </div>

                ${renderFoodRows(
                    mine
                        .slice()
                        .reverse(),
                    true
                )}

            </section>
        `;
    }

    const available =
        foods.filter(
            (food) =>
                food.status ===
                "available"
        );

    return `
        <section class="card">

            <div class="section-head">

                <div>

                    <h3>
                        Available Food
                    </h3>

                    <p>
                        Request food that your NGO can collect.
                    </p>

                </div>

                <span class="pill">
                    ${available.length}
                    available
                </span>

            </div>

            ${renderFoodRows(
                available
                    .slice()
                    .reverse(),
                false
            )}

        </section>
    `;
}


/* =========================================================
   REQUEST FOOD
   ========================================================= */

async function requestFood(
    foodId
) {
    if (
        currentUser.role !==
        "ngo"
    ) {
        showToast(
            "Only NGOs can request food.",
            "error"
        );

        return;
    }

    const food =
        foods.find(
            (item) =>
                String(item.id) ===
                String(foodId)
        );

    if (
        !food ||
        food.status !==
            "available"
    ) {
        showToast(
            "This food is no longer available.",
            "error"
        );

        return;
    }

    if (
        new Date(
            food.bestBefore
        ) <= new Date()
    ) {
        showToast(
            "This food has expired.",
            "error"
        );

        await refreshDataSilently();

        showPage(
            "donations"
        );

        return;
    }

    try {
        await apiRequest(
            "/requests",
            {
                method: "POST",

                body: JSON.stringify({
                    food_id:
                        Number(foodId)
                })
            }
        );

        await loadAllData();

        showToast(
            "Donation request sent."
        );

        showPage(
            "requests"
        );

    } catch (error) {
        console.error(
            "Request food error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   CANCEL FOOD
   ========================================================= */

async function cancelFood(
    foodId
) {
    const food =
        foods.find(
            (item) =>
                String(item.id) ===
                String(foodId)
        );

    if (!food) return;

    if (
        [
            "collected",
            "cancelled",
            "expired"
        ].includes(
            food.status
        )
    ) {
        return;
    }

    if (
        !confirm(
            "Cancel this food listing?"
        )
    ) {
        return;
    }

    try {
        await apiRequest(
            `/food/${Number(
                foodId
            )}/cancel`,
            {
                method: "PATCH"
            }
        );

        await loadAllData();

        showToast(
            "Food listing cancelled."
        );

        showPage(
            "donations"
        );

    } catch (error) {
        console.error(
            "Cancel food error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   REQUESTS PAGE
   ========================================================= */

function requestsPage() {
    if (
        currentUser.role ===
        "shopkeeper"
    ) {
        const incoming =
            requests
                .filter(
                    (request) =>
                        request.donorId ===
                        currentUser.id
                )
                .slice()
                .reverse();

        const pending =
            incoming.filter(
                (request) =>
                    request.status ===
                    "pending"
            );

        return `
            <section class="card">

                <div class="section-head">

                    <div>

                        <h3>
                            Incoming Donation Requests
                        </h3>

                        <p>
                            Review requests from NGOs.
                        </p>

                    </div>

                    <span class="pill">
                        ${pending.length}
                        pending
                    </span>

                </div>

                ${
                    incoming.length
                        ? incoming
                              .map(
                                  requestCardForShopkeeper
                              )
                              .join("")
                        : emptyState(
                              "📩",
                              "No requests yet",
                              "NGO requests will appear here when someone requests your food."
                          )
                }

            </section>
        `;
    }

    const mine =
        requests
            .filter(
                (request) =>
                    request.ngoId ===
                    currentUser.id
            )
            .slice()
            .reverse();

    return `
        <section class="card">

            <div class="section-head">

                <div>

                    <h3>
                        My Donation Requests
                    </h3>

                    <p>
                        Track your food collection requests.
                    </p>

                </div>

            </div>

            ${
                mine.length
                    ? mine
                          .map(
                              requestCardForNgo
                          )
                          .join("")
                    : emptyState(
                          "📩",
                          "No requests yet",
                          "Browse available food and send your first request."
                      )
            }

        </section>
    `;
}


/* =========================================================
   SHOPKEEPER REQUEST CARD
   ========================================================= */

function requestCardForShopkeeper(
    request
) {
    return `
        <article class="request-card">

            <div>

                <div class="request-title">

                    <strong>
                        ${escapeHtml(
                            request.foodName
                        )}
                    </strong>

                    ${statusBadge(
                        request.status
                    )}

                </div>

                <p>
                    ${escapeHtml(
                        request.ngoName ||
                            "NGO"
                    )}

                    requested

                    ${escapeHtml(
                        request.quantity
                    )}

                    ${escapeHtml(
                        request.unit
                    )}.
                </p>

                <small>
                    Requested:
                    ${formatDate(
                        request.requestedAt
                    )}
                </small>

                ${
                    request.ngoOrganization
                        ? `
                            <small>
                                Organization:
                                ${escapeHtml(
                                    request.ngoOrganization
                                )}
                            </small>
                        `
                        : ""
                }

                ${
                    request.donorLocation
                        ? `
                            <small>
                                Donor location:
                                ${escapeHtml(
                                    request.donorLocation
                                )}
                            </small>
                        `
                        : ""
                }

            </div>

            <div class="request-actions">

                ${
                    request.status ===
                    "pending"
                        ? `
                            <button
                                class="small-btn primary"
                                data-action="accept-request"
                                data-id="${request.id}">

                                Accept

                            </button>

                            <button
                                class="small-btn danger"
                                data-action="reject-request"
                                data-id="${request.id}">

                                Reject

                            </button>
                        `
                        : ""
                }

                ${
                    request.status ===
                    "accepted"
                        ? `
                            <button
                                class="small-btn primary"
                                data-action="collect-request"
                                data-id="${request.id}">

                                Mark Collected

                            </button>
                        `
                        : ""
                }

            </div>

        </article>
    `;
}


/* =========================================================
   NGO REQUEST CARD
   ========================================================= */

function requestCardForNgo(
    request
) {
    return `
        <article class="request-card">

            <div>

                <div class="request-title">

                    <strong>
                        ${escapeHtml(
                            request.foodName
                        )}
                    </strong>

                    ${statusBadge(
                        request.status
                    )}

                </div>

                <p>

                    Quantity:

                    ${escapeHtml(
                        request.quantity
                    )}

                    ${escapeHtml(
                        request.unit
                    )}

                    • Donor:

                    ${escapeHtml(
                        request.donorName
                    )}

                </p>

                <small>
                    Requested:
                    ${formatDate(
                        request.requestedAt
                    )}
                </small>

                <small>
                    Best before:
                    ${formatDate(
                        request.bestBefore
                    )}
                </small>

                ${
                    request.donorOrganization
                        ? `
                            <small>
                                Donor organization:
                                ${escapeHtml(
                                    request.donorOrganization
                                )}
                            </small>
                        `
                        : ""
                }

                ${
                    request.donorLocation
                        ? `
                            <small>
                                Location:
                                ${escapeHtml(
                                    request.donorLocation
                                )}
                            </small>
                        `
                        : ""
                }

            </div>

            <div class="request-actions">

                ${
                    request.status ===
                    "pending"
                        ? `
                            <button
                                class="small-btn danger"
                                data-action="cancel-request"
                                data-id="${request.id}">

                                Cancel

                            </button>
                        `
                        : ""
                }

            </div>

        </article>
    `;
}


/* =========================================================
   ACCEPT REQUEST
   ========================================================= */

async function acceptRequest(
    requestId
) {
    try {
        await apiRequest(
            `/requests/${Number(
                requestId
            )}/accept`,
            {
                method: "PATCH"
            }
        );

        await loadAllData();

        showToast(
            "Donation request accepted."
        );

        showPage(
            "requests"
        );

    } catch (error) {
        console.error(
            "Accept request error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   REJECT REQUEST
   ========================================================= */

async function rejectRequest(
    requestId
) {
    if (
        !confirm(
            "Reject this donation request?"
        )
    ) {
        return;
    }

    try {
        await apiRequest(
            `/requests/${Number(
                requestId
            )}/reject`,
            {
                method: "PATCH"
            }
        );

        await loadAllData();

        showToast(
            "Donation request rejected."
        );

        showPage(
            "requests"
        );

    } catch (error) {
        console.error(
            "Reject request error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   COLLECT REQUEST
   ========================================================= */

async function collectRequest(
    requestId
) {
    if (
        !confirm(
            "Confirm that this donation has been collected?"
        )
    ) {
        return;
    }

    try {
        await apiRequest(
            `/requests/${Number(
                requestId
            )}/collect`,
            {
                method: "PATCH"
            }
        );

        await loadAllData();

        showToast(
            "Donation marked as collected."
        );

        showPage(
            "requests"
        );

    } catch (error) {
        console.error(
            "Collect request error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   CANCEL NGO REQUEST
   ========================================================= */

async function cancelRequest(
    requestId
) {
    if (
        !confirm(
            "Cancel this request?"
        )
    ) {
        return;
    }

    try {
        await apiRequest(
            `/requests/${Number(
                requestId
            )}/cancel`,
            {
                method: "PATCH"
            }
        );

        await loadAllData();

        showToast(
            "Request cancelled."
        );

        showPage(
            "requests"
        );

    } catch (error) {
        console.error(
            "Cancel request error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   DEVICE PAGE
   ========================================================= */

function devicePage() {
    if (
        currentUser.role !==
        "shopkeeper"
    ) {
        return accessDenied();
    }

    if (!devices.length) {
        return `
            <div class="two-column">

                <section class="card">

                    <div class="section-head">

                        <div>

                            <h3>
                                ESP32 Smart Device
                            </h3>

                            <p>
                                FoodShare physical monitoring unit.
                            </p>

                        </div>

                        ${statusBadge(
                            "offline"
                        )}

                    </div>

                    <div class="device-panel">

                        <div class="device-icon">
                            📡
                        </div>

                        <div>

                            <strong>
                                ESP32
                            </strong>

                            <p>
                                No device registered yet.
                            </p>

                        </div>

                    </div>

                    <div class="detail-grid">

                        <div>

                            <span>
                                Connection
                            </span>

                            <strong>
                                offline
                            </strong>

                        </div>

                        <div>

                            <span>
                                RTC
                            </span>

                            <strong>
                                Not synchronized
                            </strong>

                        </div>

                        <div>

                            <span>
                                Last Seen
                            </span>

                            <strong>
                                —
                            </strong>

                        </div>

                        <div>

                            <span>
                                Alerts
                            </span>

                            <strong>
                                0
                            </strong>

                        </div>

                    </div>

                    <div class="info-box">

                        <strong>
                            Hardware
                        </strong>

                        <p>
                            ESP32 + DS3231 RTC +
                            16×2 I2C LCD + Buzzer + LED.
                        </p>

                    </div>

                </section>

                <section class="card">

                    <h3>
                        Device Status
                    </h3>

                    <p class="muted">
                        No ESP32 device has been registered
                        for this account yet.
                        The device will appear here after
                        real device integration.
                    </p>

                    <div class="zero-state">

                        <div>
                            0
                        </div>

                        <span>
                            Device alerts initially
                        </span>

                    </div>

                </section>

            </div>
        `;
    }

    const device =
        devices[0];

    return `
        <div class="two-column">

            <section class="card">

                <div class="section-head">

                    <div>

                        <h3>
                            ESP32 Smart Device
                        </h3>

                        <p>
                            FoodShare physical monitoring unit.
                        </p>

                    </div>

                    ${statusBadge(
                        device.status
                    )}

                </div>

                <div class="device-panel">

                    <div class="device-icon">
                        📡
                    </div>

                    <div>

                        <strong>
                            ESP32
                        </strong>

                        <p>
                            Device code:
                            ${escapeHtml(
                                device.deviceCode
                            )}
                        </p>

                    </div>

                </div>

                <div class="detail-grid">

                    <div>

                        <span>
                            Connection
                        </span>

                        <strong>
                            ${escapeHtml(
                                device.status
                            )}
                        </strong>

                    </div>

                    <div>

                        <span>
                            RTC
                        </span>

                        <strong>
                            ${
                                device.rtcSynced
                                    ? "Synchronized"
                                    : "Not synchronized"
                            }
                        </strong>

                    </div>

                    <div>

                        <span>
                            Last Seen
                        </span>

                        <strong>
                            ${formatDate(
                                device.lastSeen
                            )}
                        </strong>

                    </div>

                    <div>

                        <span>
                            Alerts
                        </span>

                        <strong>
                            0
                        </strong>

                    </div>

                </div>

                <div class="info-box">

                    <strong>
                        Hardware
                    </strong>

                    <p>
                        ESP32 + DS3231 RTC +
                        16×2 I2C LCD + Buzzer + LED.
                    </p>

                </div>

            </section>

            <section class="card">

                <h3>
                    Device Status
                </h3>

                <p class="muted">
                    The ESP32 sends heartbeat information
                    to the FoodShare backend.
                    The DS3231 RTC provides the local
                    monitoring time.
                </p>

                <div class="zero-state">

                    <div>
                        0
                    </div>

                    <span>
                        Device alerts
                    </span>

                </div>

            </section>

        </div>
    `;
}


/* =========================================================
   DEVICE SUMMARY
   ========================================================= */

function deviceSummary() {
    if (!devices.length) {
        return `
            <div class="device-summary">

                <span class="status-dot"></span>

                <div>

                    <strong>
                        ESP32 Offline
                    </strong>

                    <span>
                        No device registered yet.
                    </span>

                </div>

            </div>
        `;
    }

    const device =
        devices[0];

    return `
        <div class="device-summary">

            <span class="status-dot"></span>

            <div>

                <strong>
                    ESP32
                    ${escapeHtml(
                        device.status
                    )}
                </strong>

                <span>

                    ${escapeHtml(
                        device.deviceCode
                    )}

                    • Last seen:

                    ${formatDate(
                        device.lastSeen
                    )}

                </span>

            </div>

        </div>
    `;
}


/* =========================================================
   PROFILE PAGE
   ========================================================= */

function profilePage() {
    const currentProfile =
        profile || {
            name:
                currentUser.name ||
                "",

            email:
                currentUser.email ||
                "",

            phone: "",

            organization: "",

            location: ""
        };

    return `
        <section class="card form-card">

            <div class="section-head">

                <div>

                    <h3>
                        Profile
                    </h3>

                    <p>
                        Update your FoodShare account information.
                    </p>

                </div>

            </div>

            <form id="profileForm">

                <div class="form-grid">

                    <div class="field">

                        <label for="profileName">
                            Name
                        </label>

                        <input
                            id="profileName"
                            type="text"
                            value="${escapeHtml(
                                currentProfile.name
                            )}"
                            placeholder="Your name"
                            required>

                    </div>

                    <div class="field">

                        <label for="profileEmail">
                            Email
                        </label>

                        <input
                            id="profileEmail"
                            type="email"
                            value="${escapeHtml(
                                currentProfile.email
                            )}"
                            readonly>

                    </div>

                    <div class="field">

                        <label for="profilePhone">
                            Phone
                        </label>

                        <input
                            id="profilePhone"
                            type="tel"
                            value="${escapeHtml(
                                currentProfile.phone
                            )}"
                            placeholder="Phone number">

                    </div>

                    <div class="field">

                        <label for="profileOrganization">

                            ${
                                currentUser.role ===
                                "ngo"
                                    ? "NGO Name"
                                    : "Shop / Business Name"
                            }

                        </label>

                        <input
                            id="profileOrganization"
                            type="text"
                            value="${escapeHtml(
                                currentProfile.organization
                            )}"
                            placeholder="Organization name">

                    </div>

                    <div class="field full">

                        <label for="profileLocation">
                            Location
                        </label>

                        <input
                            id="profileLocation"
                            value="${escapeHtml(
                                currentProfile.location
                            )}"
                            placeholder="Village / Town / City">

                    </div>

                </div>

                <div class="form-actions">

                    <button
                        type="submit"
                        class="btn btn-primary">

                        Save Profile

                    </button>

                </div>

            </form>

        </section>
    `;
}


/* =========================================================
   SAVE PROFILE
   ========================================================= */

async function saveProfile() {
    const name =
        document
            .getElementById(
                "profileName"
            )
            ?.value
            .trim();

    const phone =
        document
            .getElementById(
                "profilePhone"
            )
            ?.value
            .trim();

    const organization =
        document
            .getElementById(
                "profileOrganization"
            )
            ?.value
            .trim();

    const location =
        document
            .getElementById(
                "profileLocation"
            )
            ?.value
            .trim();

    if (!name) {
        showToast(
            "Full name is required.",
            "error"
        );

        return;
    }

    try {
        const data =
            await apiRequest(
                "/profile",
                {
                    method: "PUT",

                    body: JSON.stringify({
                        full_name:
                            name,

                        phone:
                            phone ||
                            null,

                        organization_name:
                            organization ||
                            null,

                        location:
                            location ||
                            null
                    })
                }
            );

        profile =
            normalizeProfile(
                data.profile
            );

        currentUser = {
            ...currentUser,

            name:
                profile.name
        };

        saveSession();

        updateUserHeader();

        showToast(
            "Profile saved."
        );

        showPage(
            "profile"
        );

    } catch (error) {
        console.error(
            "Profile error:",
            error
        );

        showToast(
            error.message,
            "error"
        );
    }
}


/* =========================================================
   STATUS BADGE
   ========================================================= */

function statusBadge(
    status = "offline"
) {
    const label =
        status
            .charAt(0)
            .toUpperCase() +
        status.slice(1);

    return `
        <span
            class="status-badge ${escapeHtml(
                status
            )}">

            ${escapeHtml(
                label
            )}

        </span>
    `;
}


/* =========================================================
   EMPTY STATE
   ========================================================= */

function emptyState(
    icon,
    title,
    text
) {
    return `
        <div class="empty-state">

            <div class="empty-icon">
                ${icon}
            </div>

            <h3>
                ${escapeHtml(
                    title
                )}
            </h3>

            <p>
                ${escapeHtml(
                    text
                )}
            </p>

        </div>
    `;
}


/* =========================================================
   ACCESS DENIED
   ========================================================= */

function accessDenied() {
    return `
        <section class="card">

            ${emptyState(
                "🔒",
                "Page not available",
                "This section is available only to shopkeepers."
            )}

        </section>
    `;
}


/* =========================================================
   LOGOUT
   ========================================================= */

document
    .getElementById(
        "logoutBtn"
    )
    ?.addEventListener(
        "click",
        logout
    );

async function logout() {
    clearSession();

    currentUser = null;

    authToken = null;

    foods = [];

    requests = [];

    profile = null;

    devices = [];

    document
        .getElementById(
            "appScreen"
        )
        ?.classList.add(
            "hidden"
        );

    document
        .getElementById(
            "loginScreen"
        )
        ?.classList.remove(
            "hidden"
        );

    document
        .getElementById(
            "loginForm"
        )
        ?.reset();

    selectRole(
        "shopkeeper"
    );
}


/* =========================================================
   SESSION RESTORE
   ========================================================= */

async function restoreSession() {
    const session =
        loadSession();

    if (
        !session ||
        !session.token ||
        !session.user
    ) {
        return;
    }

    authToken =
        session.token;

    currentUser =
        session.user;

    currentRole =
        session.user.role ||
        "shopkeeper";

    try {
        await loadAllData();

        openApp();

    } catch (error) {
        console.error(
            "Session restore error:",
            error
        );

        clearSession();

        currentUser = null;

        authToken = null;
    }
}


/* =========================================================
   START
   ========================================================= */

selectRole(
    "shopkeeper"
);

restoreSession();