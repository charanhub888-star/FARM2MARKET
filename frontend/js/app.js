const state = {
  user: null,
  products: [],
  prices: [],
  lang: localStorage.getItem("f2m-lang") || "en",
  locale: {},
};
const isGithubPages = window.location.hostname.endsWith("github.io");
const assetUrl = (path) => new URL(path, document.baseURI).toString();
const demoProducts = [
  { id: 1, crop: "Tomato", quantity: 1200, unit: "kg", price: 24, location: "Guntur", available_date: new Date().toISOString().slice(0, 10), farmer_name: "Lakshmi Reddy", verified: true, description: "Fresh field tomatoes. Demo listing." },
  { id: 2, crop: "Rice", quantity: 30, unit: "quintal", price: 3200, location: "Warangal", available_date: new Date().toISOString().slice(0, 10), farmer_name: "Lakshmi Reddy", verified: true, description: "Sona masuri rice. Demo listing." },
];
const demoPrices = [
  { crop: "Tomato", location: "Guntur", low: 18, average: 24, high: 31, updated_at: "Demo data", source: "DEMO DATA" },
  { crop: "Rice", location: "Warangal", low: 2800, average: 3200, high: 3600, updated_at: "Demo data", source: "DEMO DATA" },
  { crop: "Chilli", location: "Guntur", low: 90, average: 110, high: 135, updated_at: "Demo data", source: "DEMO DATA" },
];
let csrfToken = "";
let lastFocusedElement = null;
const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (match) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[match]));

const DEMO_STORAGE_KEY = "f2m_demo_state_v1";

function getDemoStore() {
  let store = null;
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) store = JSON.parse(raw);
  } catch (_) {}

  if (!store || !Array.isArray(store.users)) {
    store = {
      users: [
        {
          id: 1,
          name: "Lakshmi Reddy",
          email: "farmer@demo.local",
          phone: "9000000001",
          password: "demo123",
          role: "FARMER",
          language: "te",
          location: "Guntur",
        },
        {
          id: 2,
          name: "FreshKart Buyer",
          email: "buyer@demo.local",
          phone: "9000000002",
          password: "demo123",
          role: "BUYER",
          language: "en",
          location: "Hyderabad",
        },
        {
          id: 3,
          name: "Demo Verifier",
          email: "admin@farm2market.local",
          phone: "9999999999",
          password: "demo-admin-change-me",
          role: "ADMIN",
          language: "en",
          location: "Hyderabad",
        },
      ],
      currentUser: null,
      products: [
        {
          id: 1,
          farmer_id: 1,
          crop: "Tomato",
          category: "Vegetables",
          quantity: 1200,
          unit: "kg",
          price: 24,
          location: "Guntur",
          available_date: new Date().toISOString().slice(0, 10),
          farmer_name: "Lakshmi Reddy",
          verified: true,
          status: "ACTIVE",
          description: "Fresh field tomatoes. Demo listing.",
        },
        {
          id: 2,
          farmer_id: 1,
          crop: "Rice",
          category: "Grains",
          quantity: 30,
          unit: "quintal",
          price: 3200,
          location: "Warangal",
          available_date: new Date().toISOString().slice(0, 10),
          farmer_name: "Lakshmi Reddy",
          verified: true,
          status: "ACTIVE",
          description: "Sona masuri rice. Demo listing.",
        },
      ],
      verifications: [
        {
          id: 1,
          farmer_id: 1,
          name: "Lakshmi Reddy",
          phone: "9000000001",
          location: "Guntur",
          products: "Tomato, Rice",
          status: "APPROVED",
          notes: "Verified demo farmer.",
        },
      ],
      requests: [
        {
          id: 1,
          product_id: 1,
          crop: "Tomato",
          quantity: 200,
          unit: "kg",
          location: "Guntur",
          farmer_id: 1,
          farmer_name: "Lakshmi Reddy",
          buyer_id: 2,
          buyer_name: "FreshKart Buyer",
          buyer_phone: "9000000002",
          status: "PENDING",
          message: "Looking for 200 kg bulk delivery.",
        },
      ],
      prices: [
        { crop: "Tomato", location: "Guntur", low: 18, average: 24, high: 31, updated_at: "Demo data", source: "DEMO DATA" },
        { crop: "Rice", location: "Warangal", low: 2800, average: 3200, high: 3600, updated_at: "Demo data", source: "DEMO DATA" },
        { crop: "Chilli", location: "Guntur", low: 90, average: 110, high: 135, updated_at: "Demo data", source: "DEMO DATA" },
        { crop: "Cotton", location: "Adilabad", low: 6500, average: 7200, high: 7900, updated_at: "Demo data", source: "DEMO DATA" },
      ],
    };
    saveDemoStore(store);
  }
  return store;
}

function saveDemoStore(store) {
  try {
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store));
  } catch (_) {}
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

async function demoMockApi(url, options = {}) {
  await new Promise((r) => setTimeout(r, 60));
  const method = (options.method || "GET").toUpperCase();
  const urlObj = new URL(url, "https://demo.local");
  const pathname = urlObj.pathname;
  const store = getDemoStore();

  let body = {};
  if (options.body instanceof FormData) {
    for (const [k, v] of options.body.entries()) body[k] = v;
  } else if (typeof options.body === "string") {
    try { body = JSON.parse(options.body); } catch (_) {}
  } else if (options.body) {
    body = options.body;
  }

  if (pathname === "/api/csrf") {
    return { csrf_token: "demo-csrf-token" };
  }

  if (pathname === "/api/auth/register" && method === "POST") {
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = (body.role || "FARMER").toUpperCase() === "BUYER" ? "BUYER" : "FARMER";
    const language = body.language || "en";

    if (name.length < 2) throw new Error("Please provide your name (at least 2 characters).");
    if (phone.length < 8) throw new Error("Please provide a valid mobile number.");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");

    const existing = store.users.find(
      (u) => u.phone === phone || (email && u.email && u.email.toLowerCase() === email)
    );
    if (existing) throw new Error("This mobile number or email is already registered.");

    const newUser = {
      id: Date.now(),
      name,
      phone,
      email: email || `${phone}@demo.local`,
      password,
      role,
      language,
      location: body.location || "Demo Region",
    };
    store.users.push(newUser);
    if (newUser.role === "FARMER") {
      store.verifications.push({
        id: Date.now(),
        farmer_id: newUser.id,
        name: newUser.name,
        phone: newUser.phone,
        location: newUser.location,
        products: "No listings yet",
        status: "PENDING",
        notes: "",
      });
    }
    store.currentUser = sanitizeUser(newUser);
    saveDemoStore(store);
    return {
      user: sanitizeUser(newUser),
      message: newUser.role === "FARMER" ? "Account created. Verification is pending." : "Account created. Welcome to Farm2Market.",
    };
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const identifier = String(body.identifier || body.phone || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!identifier) throw new Error("Please enter your mobile number or email.");
    if (!password) throw new Error("Please enter your password.");

    const user = store.users.find((u) => {
      const uEmail = (u.email || "").toLowerCase();
      const uPhone = (u.phone || "").toLowerCase();
      const uName = (u.name || "").toLowerCase();
      return (
        uEmail === identifier ||
        uPhone === identifier ||
        uName === identifier ||
        (identifier === "farmer" && u.role === "FARMER") ||
        (identifier === "buyer" && u.role === "BUYER") ||
        (identifier === "admin" && u.role === "ADMIN")
      );
    });

    if (!user) {
      throw new Error("We could not sign you in. Check your details and try again.");
    }
    if (user.password && user.password !== password && password !== "demo123" && password !== "demo-admin-change-me") {
      throw new Error("Incorrect password. Please check your credentials and try again.");
    }

    store.currentUser = sanitizeUser(user);
    saveDemoStore(store);
    return { user: sanitizeUser(user), message: `Welcome back, ${user.name}.` };
  }

  if (pathname === "/api/auth/me" && method === "GET") {
    return { user: store.currentUser ? sanitizeUser(store.currentUser) : null };
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    store.currentUser = null;
    saveDemoStore(store);
    return { message: "Signed out" };
  }

  if (pathname === "/api/products" && method === "GET") {
    const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const crop = (urlObj.searchParams.get("crop") || "").trim().toLowerCase();
    const verified = urlObj.searchParams.get("verified") === "1";

    const filtered = store.products.filter((p) => {
      const matchQ = !q || `${p.crop} ${p.location} ${p.farmer_name || ""}`.toLowerCase().includes(q);
      const matchCrop = !crop || p.crop.toLowerCase() === crop;
      const matchVerified = !verified || p.verified;
      const matchStatus = p.status !== "PAUSED";
      return matchQ && matchCrop && matchVerified && matchStatus;
    });
    return { products: filtered, demo: true };
  }

  if (pathname === "/api/products" && method === "POST") {
    if (!store.currentUser) throw new Error("Please sign in as a farmer to list produce.");
    const crop = String(body.crop || "").trim();
    const quantity = parseFloat(body.quantity);
    const unit = String(body.unit || "").trim();
    const price = parseFloat(body.price);
    const location = String(body.location || "").trim();
    const available_date = String(body.available_date || "").trim();

    if (!crop || !location || !unit || isNaN(quantity) || isNaN(price)) {
      throw new Error("Please complete all required crop details.");
    }

    let image_url = null;
    if (body.image && body.image instanceof File && body.image.size > 0) {
      try { image_url = URL.createObjectURL(body.image); } catch (_) {}
    }

    const verification = store.verifications.find((v) => v.farmer_id === store.currentUser.id);
    const isVerified = verification ? verification.status === "APPROVED" : false;

    const newProduct = {
      id: Date.now(),
      farmer_id: store.currentUser.id,
      farmer_name: store.currentUser.name,
      farmer_location: location,
      crop,
      category: body.category || "Produce",
      quantity,
      unit,
      price,
      location,
      available_date: available_date || new Date().toISOString().slice(0, 10),
      image_url,
      description: String(body.description || "").trim(),
      status: "ACTIVE",
      verified: isVerified,
    };

    store.products.unshift(newProduct);
    saveDemoStore(store);
    return { product: newProduct, message: "Your crop is now listed." };
  }

  if (pathname === "/api/my/products" && method === "GET") {
    if (!store.currentUser) throw new Error("Sign in required.");
    const myProds = store.products.filter(
      (p) => p.farmer_id === store.currentUser.id || (store.currentUser.id === 1 && !p.farmer_id)
    );
    return { products: myProds };
  }

  if (pathname.startsWith("/api/products/") && method === "PUT") {
    const id = Number(pathname.split("/").pop());
    const prod = store.products.find((p) => p.id === id);
    if (!prod) throw new Error("Product not found.");
    if (body.crop !== undefined) prod.crop = String(body.crop).trim();
    if (body.quantity !== undefined) prod.quantity = parseFloat(body.quantity);
    if (body.unit !== undefined) prod.unit = String(body.unit).trim();
    if (body.price !== undefined) prod.price = parseFloat(body.price);
    if (body.location !== undefined) prod.location = String(body.location).trim();
    if (body.available_date !== undefined) prod.available_date = String(body.available_date).trim();
    if (body.description !== undefined) prod.description = String(body.description).trim();
    if (body.status !== undefined) prod.status = String(body.status).toUpperCase();
    saveDemoStore(store);
    return { message: "Product updated", product: prod };
  }

  if (pathname.startsWith("/api/products/") && method === "DELETE") {
    const id = Number(pathname.split("/").pop());
    store.products = store.products.filter((p) => p.id !== id);
    saveDemoStore(store);
    return { message: "Product removed" };
  }

  if (pathname === "/api/prices" && method === "GET") {
    return { prices: store.prices, demo: true };
  }

  if (pathname === "/api/dashboard" && method === "GET") {
    if (!store.currentUser) throw new Error("Sign in required.");
    if (["ADMIN", "SUPER_ADMIN", "VERIFIER"].includes(store.currentUser.role)) {
      return {
        stats: {
          farmers: store.users.filter((u) => u.role === "FARMER").length,
          verified: store.verifications.filter((v) => v.status === "APPROVED").length,
          pending: store.verifications.filter((v) => ["PENDING", "UNDER_REVIEW"].includes(v.status)).length,
          buyers: store.users.filter((u) => u.role === "BUYER").length,
          listings: store.products.filter((p) => p.status === "ACTIVE").length,
          requests: store.requests.length,
        },
      };
    }
    const verification = store.verifications.find((v) => v.farmer_id === store.currentUser.id);
    const count = store.products.filter(
      (p) => (p.farmer_id === store.currentUser.id || (store.currentUser.id === 1 && !p.farmer_id)) && p.status === "ACTIVE"
    ).length;
    return {
      stats: {
        listings: count,
        verification: verification ? verification.status : "PENDING",
      },
    };
  }

  if (pathname === "/api/verification/request" && method === "POST") {
    if (!store.currentUser) throw new Error("Sign in required.");
    let v = store.verifications.find((item) => item.farmer_id === store.currentUser.id);
    if (v) {
      v.status = "UNDER_REVIEW";
    } else {
      v = {
        id: Date.now(),
        farmer_id: store.currentUser.id,
        name: store.currentUser.name,
        phone: store.currentUser.phone,
        location: store.currentUser.location,
        products: store.products.filter((p) => p.farmer_id === store.currentUser.id).map((p) => p.crop).join(", ") || "No listings yet",
        status: "UNDER_REVIEW",
        notes: "",
      };
      store.verifications.push(v);
    }
    saveDemoStore(store);
    return { message: "Your seller verification request has been submitted.", status: v.status };
  }

  if (pathname.startsWith("/api/admin/verifications")) {
    if (method === "PUT") {
      const id = Number(pathname.split("/").pop());
      const v = store.verifications.find((item) => item.id === id);
      if (!v) throw new Error("Verification record not found.");
      v.status = body.status || v.status;
      if (body.notes) v.notes = body.notes;
      if (v.status === "APPROVED") {
        store.products.forEach((p) => {
          if (p.farmer_id === v.farmer_id) p.verified = true;
        });
      }
      saveDemoStore(store);
      return { message: "Verification status updated.", status: v.status };
    }
    return { verifications: store.verifications };
  }

  if (pathname === "/api/buyer/requests") {
    if (method === "POST") {
      if (!store.currentUser) throw new Error("Please sign in as a buyer to send a request.");
      const prod = store.products.find((p) => p.id === Number(body.product_id));
      if (!prod) throw new Error("Product not found.");
      const newReq = {
        id: Date.now(),
        product_id: prod.id,
        crop: prod.crop,
        quantity: prod.quantity,
        unit: prod.unit,
        farmer_id: prod.farmer_id || 1,
        farmer_name: prod.farmer_name || "Lakshmi Reddy",
        buyer_id: store.currentUser.id,
        buyer_name: store.currentUser.name,
        buyer_phone: store.currentUser.phone,
        status: "PENDING",
        message: body.message || "",
        created_at: new Date().toISOString().slice(0, 10),
      };
      store.requests.unshift(newReq);
      saveDemoStore(store);
      return { message: "Request sent to the farmer." };
    }
    if (!store.currentUser) throw new Error("Sign in required.");
    const myReqs = store.requests.filter((r) => r.buyer_id === store.currentUser.id);
    return { requests: myReqs };
  }

  if (pathname === "/api/farmer/requests" && method === "GET") {
    if (!store.currentUser) throw new Error("Sign in required.");
    const reqs = store.requests.filter(
      (r) => r.farmer_id === store.currentUser.id || (store.currentUser.id === 1 && !r.farmer_id)
    );
    return { requests: reqs };
  }

  throw new Error(`Endpoint not found: ${pathname}`);
}

async function getCsrfToken() {
  if (isGithubPages) return "demo-csrf-token";
  if (!csrfToken) {
    try {
      const response = await fetch("/api/csrf", { credentials: "same-origin" });
      if (!response.ok) throw new Error("CSRF failed");
      csrfToken = (await response.json()).csrf_token;
    } catch {
      csrfToken = "demo-csrf-token";
    }
  }
  return csrfToken;
}

async function api(url, options = {}) {
  if (isGithubPages) {
    return demoMockApi(url, options);
  }
  try {
    const opts = { credentials: "same-origin", ...options };
    const headers = { ...(opts.headers || {}) };
    if (!(opts.body instanceof FormData) && opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (opts.method && opts.method !== "GET" && !url.includes("/api/auth/")) {
      headers["X-CSRF-Token"] = await getCsrfToken();
    }
    opts.headers = headers;
    const response = await fetch(url, opts);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Request failed with status " + response.status);
    }
    return await response.json();
  } catch (error) {
    if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError") ||
      error.message.includes("404") ||
      error.message.includes("Load failed")
    ) {
      return demoMockApi(url, options);
    }
    throw error;
  }
}

function showModal(html, focusSelector = null) {
  lastFocusedElement = document.activeElement;
  $("#modalContent").innerHTML = html;
  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";
  const focusTarget = focusSelector ? $(focusSelector) : $("#modalContent button, #modalContent input, #modalContent select, #modalContent textarea");
  if (focusTarget) setTimeout(() => focusTarget.focus(), 0);
}

function closeModal() {
  $("#modal").hidden = true;
  document.body.style.overflow = "";
  if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
  lastFocusedElement = null;
}

function toast(message, kind = "success") {
  const element = document.createElement("div");
  element.className = `toast ${kind}`;
  element.setAttribute("role", kind === "error" ? "alert" : "status");
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 3500);
}

function setBusy(button, busy, label = "Working…") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHTML) button.dataset.originalHTML = button.innerHTML;
    button.textContent = label;
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
  } else {
    if (button.dataset.originalHTML) {
      button.innerHTML = button.dataset.originalHTML;
      delete button.dataset.originalHTML;
    }
    button.disabled = false;
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
  }
}

function setSuccess(button, label = "Done") {
  if (!button) return;
  const originalHTML = button.dataset.originalHTML || button.innerHTML;
  button.innerHTML = `<span aria-hidden="true">✓</span> ${label}`;
  button.disabled = true;
  button.classList.remove("is-loading");
  button.classList.add("is-success");
  button.setAttribute("aria-busy", "false");
  window.setTimeout(() => {
    button.innerHTML = originalHTML;
    button.disabled = false;
    button.classList.remove("is-success");
    button.removeAttribute("aria-busy");
    delete button.dataset.originalHTML;
  }, 1500);
}

let revealObserver;
function observeReveals() {
  const elements = document.querySelectorAll("[data-reveal]:not([data-reveal-bound])");
  if (!elements.length) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  }
  elements.forEach((element) => {
    element.dataset.revealBound = "true";
    revealObserver.observe(element);
  });
}

function prepareReveals() {
  document.querySelectorAll(".feature-grid article, .journey > div, .price-item, .learn-pill").forEach((element, index) => {
    if (!element.hasAttribute("data-reveal")) {
      element.dataset.reveal = "";
      element.style.setProperty("--reveal-delay", `${Math.min(index % 6, 5) * 70}ms`);
    }
  });
  document.body.classList.add("has-reveal");
  observeReveals();
}

function authForm(mode = "login") {
  const login = mode === "login";
  showModal(`<h2 id="modalTitle">${login ? "Welcome back" : "Create your account"}</h2>
    <p>${login ? "Sign in to list crops and contact farmers." : "Start with a simple profile. Farmers remain pending until an authorised person reviews them."}</p>
    ${login ? "" : `<div class="form-grid">
      <label>Your name<input id="authName" autocomplete="name" required maxlength="120" placeholder="e.g. Ramesh Kumar"></label>
      <label>Mobile number<input id="authPhone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="9000000001"></label>
      <label>Email (optional)<input id="authEmail" type="email" autocomplete="email" maxlength="254" placeholder="farmer@example.com"></label>
    </div>`}
    <div class="form-grid">
      ${login ? '<label>Mobile or email<input id="authIdentifier" autocomplete="username" required placeholder="farmer@demo.local or 9000000001"></label>' : ""}
      ${login ? '<label>Password<input id="authPassword" type="password" autocomplete="current-password" required placeholder="demo123">' : '<label>Password<input id="authPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters">'}
      ${login ? "" : '<label>I am a <select id="authRole"><option value="FARMER">Farmer</option><option value="BUYER">Buyer</option></select></label>'}
      <button class="btn btn-primary" id="authSubmit" type="button">${login ? "Sign in" : "Create account"}</button>
    </div>
    <p class="modal-switch">${login ? "New here?" : "Already have an account?"} <button class="text-btn" id="switchAuth" type="button">${login ? "Create account" : "Sign in"}</button></p>
    <div class="modal-note">
      <div style="font-weight:bold;margin-bottom:6px">Quick demo accounts (tap to fill & sign in):</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline quick-fill" type="button" data-id="farmer@demo.local" data-pw="demo123" style="min-height:34px;padding:6px 12px;font-size:12px">🌾 Farmer</button>
        <button class="btn btn-outline quick-fill" type="button" data-id="buyer@demo.local" data-pw="demo123" style="min-height:34px;padding:6px 12px;font-size:12px">🛒 Buyer</button>
        <button class="btn btn-outline quick-fill" type="button" data-id="admin@farm2market.local" data-pw="demo-admin-change-me" style="min-height:34px;padding:6px 12px;font-size:12px">🛡️ Admin</button>
      </div>
    </div>`, login ? "#authIdentifier" : "#authName");

  document.querySelectorAll(".quick-fill").forEach((btn) => {
    btn.onclick = () => {
      if (!login) {
        authForm("login");
        setTimeout(() => {
          if ($("#authIdentifier")) $("#authIdentifier").value = btn.dataset.id;
          if ($("#authPassword")) $("#authPassword").value = btn.dataset.pw;
          if ($("#authSubmit")) $("#authSubmit").click();
        }, 50);
      } else {
        if ($("#authIdentifier")) $("#authIdentifier").value = btn.dataset.id;
        if ($("#authPassword")) $("#authPassword").value = btn.dataset.pw;
        if ($("#authSubmit")) $("#authSubmit").click();
      }
    };
  });

  $("#switchAuth").onclick = () => authForm(login ? "register" : "login");
  $("#authSubmit").onclick = async () => {
    const button = $("#authSubmit");
    const password = $("#authPassword") ? $("#authPassword").value : "";
    const payload = login
      ? { identifier: $("#authIdentifier") ? $("#authIdentifier").value.trim() : "", password }
      : {
        name: $("#authName") ? $("#authName").value.trim() : "",
        phone: $("#authPhone") ? $("#authPhone").value.trim() : "",
        email: $("#authEmail") ? $("#authEmail").value.trim() : "",
        password,
        role: $("#authRole") ? $("#authRole").value : "FARMER",
        language: state.lang,
      };

    if (login) {
      if (!payload.identifier) {
        toast("Please enter your mobile number or email.", "error");
        return;
      }
      if (!payload.password) {
        toast("Please enter your password.", "error");
        return;
      }
    } else {
      if (!payload.name || payload.name.length < 2) {
        toast("Please provide your name (at least 2 characters).", "error");
        return;
      }
      if (!payload.phone || payload.phone.length < 8) {
        toast("Please provide a valid mobile number.", "error");
        return;
      }
      if (!payload.password || payload.password.length < 6) {
        toast("Password must be at least 6 characters.", "error");
        return;
      }
    }

    setBusy(button, true, login ? "Signing in…" : "Creating account…");
    try {
      const data = await api(`/api/auth/${login ? "login" : "register"}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.user = data.user;
      csrfToken = "";
      closeModal();
      toast(data.message);
      renderAccount();
      await loadProducts();
    } catch (error) {
      toast(error.message, "error");
      setBusy(button, false);
    }
  };
}

function productIcon(crop) {
  return { Tomato: "🍅", Rice: "🌾", Chilli: "🌶️", Cotton: "🪻", Maize: "🌽", Groundnut: "🥜" }[crop] || "🥬";
}

function renderProducts() {
  const grid = $("#productGrid");
  if (!state.products.length) {
    grid.innerHTML = '<div class="notice">No listings match this search. Try another crop or location.</div>';
    return;
  }
  const canRequest = state.user?.role === "BUYER";
  grid.innerHTML = state.products.map((product, index) => {
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.crop)}" loading="lazy">`
      : productIcon(product.crop);
    return `<article class="product-card" data-reveal style="--reveal-delay:${Math.min(index, 5) * 70}ms">
      <div class="product-photo">${image}<span class="tag">${product.verified ? "✓ VERIFIED" : "⏳ PENDING"}</span></div>
      <div class="product-body"><h3>${escapeHtml(product.crop)} <span>${product.verified ? "Verified" : "Review pending"}</span></h3>
      <div class="product-meta"><span>📦 ${escapeHtml(product.quantity)} ${escapeHtml(product.unit)}</span><span>📍 ${escapeHtml(product.location)}</span>
        <span>📅 ${escapeHtml(product.available_date)}</span><span>👨‍🌾 ${escapeHtml(product.farmer_name)}</span></div>
      <div class="product-price">₹${Number(product.price).toLocaleString("en-IN")} <small>/ ${escapeHtml(product.unit)}</small></div>
      <div class="card-actions"><button class="btn btn-outline view-product" data-id="${product.id}">View</button>
        ${canRequest ? `<button class="btn btn-primary request-product" data-id="${product.id}">Request</button>` : ""}</div></div></article>`;
  }).join("");
  grid.querySelectorAll(".request-product").forEach((button) => {
    button.onclick = () => requestProduct(button.dataset.id);
  });
  grid.querySelectorAll(".view-product").forEach((button) => {
    button.onclick = () => viewProduct(button.dataset.id);
  });
  observeReveals();
}

async function loadProducts() {
  const grid = $("#productGrid");
  grid.setAttribute("aria-busy", "true");
  try {
    const query = $("#search").value;
    const crop = $("#cropFilter").value;
    const verified = $("#verifiedFilter").checked;
    const data = await api(`/api/products?q=${encodeURIComponent(query)}&crop=${encodeURIComponent(crop)}&verified=${verified ? 1 : 0}`);
    state.products = data.products || [];
    renderProducts();
  } catch (error) {
    grid.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

function renderPrices() {
  $("#priceList").innerHTML = state.prices.map((price, index) => `<div class="price-item" data-reveal style="--reveal-delay:${Math.min(index, 5) * 70}ms">
    <header><span>${escapeHtml(price.location)}</span><b>${productIcon(price.crop)} ${escapeHtml(price.crop)}</b></header>
    <div class="price-values"><div><strong>₹${escapeHtml(price.low)}</strong><small>low</small></div>
      <div><strong>₹${escapeHtml(price.average)}</strong><small>average</small></div><div><strong>₹${escapeHtml(price.high)}</strong><small>high</small></div></div>
    <small class="price-updated">Last updated: ${escapeHtml(price.updated_at)} · ${escapeHtml(price.source || "Demo")}</small></div>`).join("");
}

async function loadPrices() {
  try {
    const data = await api("/api/prices");
    state.prices = data.prices || [];
    renderPrices();
  } catch (error) {
    $("#priceList").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
}

async function requestProduct(id) {
  if (!state.user) {
    authForm("login");
    toast("Sign in as a buyer to send a request.", "error");
    return;
  }
  if (state.user.role !== "BUYER") {
    toast("Buyer accounts can send purchase requests.", "error");
    return;
  }
  showModal(`<h2 id="modalTitle">Request this crop</h2><p>Send a message to the farmer. Your phone number stays private.</p>
    <div class="form-grid"><label>Message<textarea id="requestMessage" maxlength="500" placeholder="I am interested in this listing..."></textarea></label>
    <button class="btn btn-primary" id="sendRequest" type="button">Send request</button></div>`, "#requestMessage");
  $("#sendRequest").onclick = async () => {
    const button = $("#sendRequest");
    setBusy(button, true, "Sending…");
    try {
      const data = await api("/api/buyer/requests", {
        method: "POST",
        body: JSON.stringify({ product_id: Number(id), message: $("#requestMessage").value.trim() }),
      });
      closeModal();
      toast(data.message);
    } catch (error) {
      toast(error.message, "error");
      setBusy(button, false);
    }
  };
}

function viewProduct(id) {
  const product = state.products.find((item) => String(item.id) === String(id));
  if (!product) return;
  showModal(`<div class="product-photo modal-product-photo">${productIcon(product.crop)}</div><h2 id="modalTitle">${escapeHtml(product.crop)}</h2>
    <p>${escapeHtml(product.description || "Fresh produce listing.")}</p><div class="product-meta"><span>📦 ${escapeHtml(product.quantity)} ${escapeHtml(product.unit)}</span>
    <span>📍 ${escapeHtml(product.location)}</span><span>👨‍🌾 ${escapeHtml(product.farmer_name)}</span><span>${product.verified ? "✓ Verified seller" : "⏳ Under verification"}</span></div>
    <div class="product-price">₹${Number(product.price).toLocaleString("en-IN")} <small>/ ${escapeHtml(product.unit)}</small></div>
    ${state.user?.role === "BUYER" ? '<button class="btn btn-primary modal-wide-action" id="viewRequest">Request purchase</button>' : ""}`);
  if ($("#viewRequest")) $("#viewRequest").onclick = () => requestProduct(product.id);
}

async function reviewAdmin(id, status, button = null) {
  const notes = status === "REJECTED" || status === "MORE_INFORMATION_REQUIRED"
    ? (window.prompt("Add a note for the farmer (optional):", "") || "") : "";
  setBusy(button, true, status === "APPROVED" ? "Approving…" : "Updating…");
  try {
    await api(`/api/admin/verifications/${id}`, { method: "PUT", body: JSON.stringify({ status, notes }) });
    toast("Verification status updated.");
    await adminDashboard();
  } catch (error) {
    toast(error.message, "error");
    setBusy(button, false);
  }
}

async function adminDashboard() {
  showModal(`<h2 id="modalTitle">Verification desk</h2><p>Manual review only. Submitted information never becomes approved automatically.</p>
    <div id="adminStats" class="dashboard-cards"><div class="skeleton" style="height:80px"></div></div><div id="adminReviews"><div class="skeleton" style="height:100px"></div></div>`);
  try {
    const [stats, reviews] = await Promise.all([api("/api/dashboard"), api("/api/admin/verifications")]);
    $("#adminStats").innerHTML = Object.entries(stats.stats).map(([key, value]) =>
      `<div class="dash-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(key.replaceAll("_", " "))}</span></div>`).join("");
    $("#adminReviews").innerHTML = reviews.verifications.map((verification) => `<div class="dash-card review-card">
      <b>${escapeHtml(verification.name)}</b><span>${escapeHtml(verification.phone)} · ${escapeHtml(verification.location || "Location not provided")}</span>
      <span>${escapeHtml(verification.products || "No listings")} · ${escapeHtml(verification.status)}</span>
      ${verification.notes ? `<p class="review-note">${escapeHtml(verification.notes)}</p>` : ""}
      ${verification.status !== "APPROVED" ? `<div class="card-actions"><button class="btn btn-primary review-action" data-id="${verification.id}" data-status="APPROVED">Approve</button>
      <button class="btn btn-outline review-action" data-id="${verification.id}" data-status="MORE_INFORMATION_REQUIRED">Request information</button>
      <button class="btn btn-outline review-action" data-id="${verification.id}" data-status="REJECTED">Reject</button></div>` : "<span class=\"status approved\">✓ Approved</span>"}</div>`).join("")
      || '<div class="notice">No verification requests.</div>';
    document.querySelectorAll(".review-action").forEach((button) => {
      button.onclick = () => reviewAdmin(button.dataset.id, button.dataset.status, button);
    });
  } catch (error) {
    $("#adminReviews").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
}

async function farmerDashboard() {
  showModal(`<h2 id="modalTitle">Sell your crop</h2><p>List a harvest in a few simple steps. You can edit or pause it later.</p>
    <div id="verificationBox" class="notice verification-box" role="status" aria-live="polite">Loading verification status…</div>
    <div class="wizard-progress" aria-label="Listing progress"><i></i></div><div class="form-grid">
    <label>What are you selling?<select id="pCrop"><option>Tomato</option><option>Rice</option><option>Chilli</option><option>Cotton</option><option>Maize</option><option>Vegetables</option><option>Fruits</option></select></label>
    <label>Quantity<input id="pQuantity" type="number" min="0.01" step="0.01" required placeholder="e.g. 500"></label>
    <label>Unit<select id="pUnit"><option>kg</option><option>quintal</option><option>tonne</option></select></label>
    <label>Expected price (₹ per unit)<input id="pPrice" type="number" min="0" step="0.01" required placeholder="e.g. 24"></label>
    <label>Available date<input id="pDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
    <label>Where is it located?<input id="pLocation" value="${escapeHtml(state.user.location || "")}" maxlength="120" required placeholder="District or market"></label>
    <label>Description (optional)<textarea id="pDescription" maxlength="1000" placeholder="Quality, harvest notes or delivery details"></textarea></label>
    <label>Photo (optional)<input id="pImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment"></label>
    <button class="btn btn-primary" id="listProduct" type="button">List my product →</button></div>
    <div id="myListings" class="my-listings"><h3>Your listings</h3><div class="skeleton" style="height:60px"></div></div>`, "#pCrop");
  loadVerificationStatus();
  loadMyListings();
  loadFarmerRequests();
  $("#listProduct").onclick = createProduct;
}

async function loadVerificationStatus() {
  try {
    const data = await api("/api/dashboard");
    const status = data.stats.verification || "PENDING";
    const labels = {
      PENDING: "Your seller profile is waiting for review.",
      UNDER_REVIEW: "Your seller profile is being reviewed.",
      APPROVED: "Your seller profile is approved.",
      REJECTED: "Your seller profile needs changes before approval.",
      MORE_INFORMATION_REQUIRED: "The reviewer needs more information.",
    };
    const box = $("#verificationBox");
    if (!box) return;
    box.classList.remove("status-changed");
    void box.offsetWidth;
    box.classList.add("status-changed");
    box.innerHTML = `<span class="status ${status.toLowerCase().replaceAll("_", "-")}">${escapeHtml(status.replaceAll("_", " "))}</span>
      <br><strong>Seller verification</strong><br>${escapeHtml(labels[status] || "Submit your profile for review.")}
      ${status !== "APPROVED" ? '<button class="btn btn-outline" id="requestVerification" type="button" style="margin-top:10px">Submit for review</button>' : ""}`;
    if ($("#requestVerification")) {
      $("#requestVerification").onclick = async () => {
        const button = $("#requestVerification");
        setBusy(button, true, "Submitting…");
        try {
          const result = await api("/api/verification/request", { method: "POST", body: JSON.stringify({}) });
          toast(result.message);
          await loadVerificationStatus();
        } catch (error) { toast(error.message, "error"); setBusy(button, false); }
      };
    }
  } catch (error) {
    const box = $("#verificationBox");
    if (box) box.textContent = error.message;
  }
}

async function loadMyListings() {
  try {
    const data = await api("/api/my/products");
    const container = $("#myListings");
    if (!container) return;
    container.innerHTML = `<h3>Your listings</h3>${data.products.length ? data.products.map((product) => `<div class="listing-row">
      <span>${productIcon(product.crop)} <b>${escapeHtml(product.crop)}</b><small>${escapeHtml(product.quantity)} ${escapeHtml(product.unit)} · ${escapeHtml(product.status)}</small></span>
      <button class="btn btn-outline edit-listing" data-id="${product.id}" type="button">Edit</button><button class="btn btn-outline delete-listing" data-id="${product.id}" type="button">Remove</button></div>`).join("") : '<div class="notice">No listings yet.</div>'}`;
    container.querySelectorAll(".edit-listing").forEach((button) => { button.onclick = () => editProduct(button.dataset.id, data.products); });
    container.querySelectorAll(".delete-listing").forEach((button) => { button.onclick = () => deleteProduct(button.dataset.id); });
  } catch (error) {
    const container = $("#myListings");
    if (container) container.innerHTML = `<h3>Your listings</h3><div class="notice">${escapeHtml(error.message)}</div>`;
  }
}

async function loadFarmerRequests() {
  try {
    const data = await api("/api/farmer/requests");
    const container = $("#myListings");
    if (!container || !data.requests.length) return;
    const requests = document.createElement("div");
    requests.className = "my-listings";
    requests.innerHTML = `<h3>Buyer requests</h3>${data.requests.map((request) => `<div class="listing-row">
      <span>🤝 <b>${escapeHtml(request.crop)}</b><small>${escapeHtml(request.buyer_name)} · ${escapeHtml(request.status)}${request.message ? ` · ${escapeHtml(request.message)}` : ""}</small></span>
    </div>`).join("")}`;
    container.parentElement.append(requests);
  } catch (_) { /* Requests are optional for the listing flow. */ }
}

async function createProduct() {
  const button = $("#listProduct");
  const formData = new FormData();
  [["crop", "pCrop"], ["quantity", "pQuantity"], ["unit", "pUnit"], ["price", "pPrice"], ["available_date", "pDate"], ["location", "pLocation"], ["description", "pDescription"]]
    .forEach(([key, id]) => formData.append(key, $(`#${id}`).value));
  formData.append("category", "Produce");
  if ($("#pImage").files[0]) formData.append("image", $("#pImage").files[0]);
  setBusy(button, true, "Listing…");
  try {
    const data = await api("/api/products", { method: "POST", body: formData });
    toast(`✓ ${data.message}`);
    await loadProducts();
    await loadMyListings();
    setSuccess(button, "Listed successfully");
  } catch (error) {
    toast(error.message, "error");
    setBusy(button, false);
  }
}

function editProduct(id, products) {
  const product = products.find((item) => String(item.id) === String(id));
  if (!product) return;
  showModal(`<h2 id="modalTitle">Edit ${escapeHtml(product.crop)}</h2><div class="form-grid">
    <label>Crop<input id="editCrop" value="${escapeHtml(product.crop)}" maxlength="80"></label>
    <label>Quantity<input id="editQuantity" type="number" min="0.01" step="0.01" value="${escapeHtml(product.quantity)}"></label>
    <label>Unit<input id="editUnit" value="${escapeHtml(product.unit)}" maxlength="20"></label>
    <label>Price<input id="editPrice" type="number" min="0" step="0.01" value="${escapeHtml(product.price)}"></label>
    <label>Location<input id="editLocation" value="${escapeHtml(product.location)}" maxlength="120"></label>
    <label>Available date<input id="editDate" type="date" value="${escapeHtml(product.available_date)}"></label>
    <label>Description<textarea id="editDescription" maxlength="1000">${escapeHtml(product.description || "")}</textarea></label>
    <label>Status<select id="editStatus"><option value="ACTIVE" ${product.status === "ACTIVE" ? "selected" : ""}>Active</option><option value="PAUSED" ${product.status === "PAUSED" ? "selected" : ""}>Paused</option></select></label>
    <button class="btn btn-primary" id="saveProduct" type="button">Save changes</button></div>`, "#editCrop");
  $("#saveProduct").onclick = async () => {
    const button = $("#saveProduct");
    setBusy(button, true, "Saving…");
    try {
      const data = await api(`/api/products/${id}`, { method: "PUT", body: JSON.stringify({
        crop: $("#editCrop").value, quantity: $("#editQuantity").value, unit: $("#editUnit").value,
        price: $("#editPrice").value, location: $("#editLocation").value, available_date: $("#editDate").value,
        description: $("#editDescription").value, status: $("#editStatus").value,
      }) });
      toast(data.message);
      closeModal();
      await loadProducts();
    } catch (error) { toast(error.message, "error"); setBusy(button, false); }
  };
}

async function deleteProduct(id) {
  if (!window.confirm("Remove this listing? Buyers will no longer see it.")) return;
  try {
    const data = await api(`/api/products/${id}`, { method: "DELETE" });
    toast(data.message);
    await loadProducts();
    await loadMyListings();
  } catch (error) { toast(error.message, "error"); }
}

async function dashboard() {
  if (!state.user) return authForm("login");
  if (["ADMIN", "SUPER_ADMIN", "VERIFIER"].includes(state.user.role)) return adminDashboard();
  if (state.user.role === "FARMER") return farmerDashboard();
  showModal(`<h2 id="modalTitle">Buyer workspace</h2><p>Find a listing and send a request directly to its farmer.</p>
    <div class="notice">Use the marketplace filters to find a listing. Demo buyer: buyer@demo.local / demo123</div>
    <button class="btn btn-primary" id="exploreMarketplace" type="button">Explore marketplace</button>
    <div id="buyerRequests" class="my-listings"><h3>Your requests</h3><div class="skeleton" style="height:60px"></div></div>`);
  $("#exploreMarketplace").onclick = () => { closeModal(); location.hash = "marketplace"; };
  try {
    const data = await api("/api/buyer/requests");
    $("#buyerRequests").innerHTML = `<h3>Your requests</h3>${data.requests.length
      ? data.requests.map((request) => `<div class="listing-row"><span>📦 <b>${escapeHtml(request.crop)}</b><small>${escapeHtml(request.farmer_name)} · ${escapeHtml(request.status)}</small></span></div>`).join("")
      : '<div class="notice">No requests yet.</div>'}`;
  } catch (error) {
    if ($("#buyerRequests")) $("#buyerRequests").innerHTML = `<h3>Your requests</h3><div class="notice">${escapeHtml(error.message)}</div>`;
  }
}

function renderAccount() {
  if (!state.user) return;
  $("#startBtn").textContent = state.user.name.split(" ")[0];
  $("#startBtn").onclick = dashboard;
  $("#loginBtn").textContent = "Sign out";
  $("#loginBtn").onclick = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (error) { toast(error.message, "error"); return; }
    state.user = null; csrfToken = ""; renderProducts();
    $("#loginBtn").textContent = "Log in"; $("#loginBtn").onclick = () => authForm("login");
    $("#startBtn").textContent = "Get started"; $("#startBtn").onclick = () => authForm("register");
    toast("Signed out");
  };
  renderProducts();
}

function speak(text) {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = { en: "en-IN", te: "te-IN", hi: "hi-IN" }[state.lang];
    speechSynthesis.speak(utterance);
  } else toast("Voice playback is not available in this browser.", "error");
}

function help() {
  showModal(`<h2 id="modalTitle">What do you need help with?</h2><p>Choose a topic. We’ll keep the guidance short.</p>
    <div class="crop-options">${["Selling my crop", "Checking price", "Finding a buyer", "Verification", "Payment", "Something else"]
      .map((topic) => `<button class="crop-option help-topic" type="button">${topic}</button>`).join("")}</div>
    <button class="text-btn" id="listenHelp" type="button">◖ Listen to guidance</button>`);
  document.querySelectorAll(".help-topic").forEach((button) => {
    button.onclick = () => toast(`${button.textContent}: guidance will be added to your workspace.`);
  });
  $("#listenHelp").onclick = () => speak("Tap Sell my crop to add your harvest. Tap Checking price to see today's demo market range.");
}

async function applyLocale() {
  try {
    const response = await fetch(assetUrl(`./locales/${state.lang}.json`));
    state.locale = await response.json();
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const value = node.dataset.i18n.split(".").reduce((object, key) => object && object[key], state.locale);
      if (value) node.textContent = value;
    });
    document.documentElement.lang = state.lang;
  } catch (_) { /* English markup remains a safe fallback. */ }
}

async function init() {
  document.documentElement.lang = state.lang;
  $("#language").value = state.lang;
  prepareReveals();
  await applyLocale();
  loadProducts();
  loadPrices();
  $("#search").oninput = loadProducts;
  $("#cropFilter").onchange = loadProducts;
  $("#verifiedFilter").onchange = loadProducts;
  $("#refreshProducts").onclick = async () => {
    const button = $("#refreshProducts");
    setBusy(button, true, "Refreshing…");
    await loadProducts();
    setSuccess(button, "Listings refreshed");
  };
  $("#loginBtn").onclick = () => authForm("login");
  $("#startBtn").onclick = () => authForm("register");
  $("#farmerCta").onclick = () => state.user ? dashboard() : authForm("register");
  $("#buyerCta").onclick = () => { location.hash = "marketplace"; };
  $("#ctaStart").onclick = () => authForm("register");
  $("#helpBtn").onclick = help;
  $("#modalClose").onclick = closeModal;
  $("#modal").onclick = (event) => { if (event.target.id === "modal") closeModal(); };
  $("#voiceBtn").onclick = () => speak(`${$("h1").innerText} ${$(".hero-copy>p").innerText}`);
  $("#speakPrice").onclick = () => speak("Today's demo tomato price ranges from 18 rupees low, to 24 rupees average, and 31 rupees high.");
  $("#language").onchange = async (event) => {
    state.lang = event.target.value; localStorage.setItem("f2m-lang", state.lang); await applyLocale();
    toast({ en: "English selected", te: "తెలుగు ఎంచుకున్నారు", hi: "हिन्दी चुनी गई" }[state.lang]);
  };
  $("#menuBtn").onclick = () => {
    const nav = $(".desktop-nav");
    nav.classList.toggle("mobile-open");
    $("#menuBtn").setAttribute("aria-expanded", nav.classList.contains("mobile-open"));
  };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal").hidden) closeModal();
  });
  document.querySelectorAll(".learn-pill").forEach((button) => {
    button.onclick = () => toast(`${button.textContent.trim()} lesson selected.`);
  });
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".btn, .learn-pill");
    if (!button || button.disabled) return;
    button.classList.add("is-pressed");
    window.setTimeout(() => button.classList.remove("is-pressed"), 180);
  });
  if (!isGithubPages && "serviceWorker" in navigator) navigator.serviceWorker.register(assetUrl("./sw.js")).catch(() => {});
  api("/api/auth/me").then((data) => {
    state.user = data.user;
    if (state.user) {
      renderAccount();
      if (location.pathname.endsWith("/dashboard")) dashboard();
    } else if (location.pathname.endsWith("/dashboard")) {
      authForm("login");
    }
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
