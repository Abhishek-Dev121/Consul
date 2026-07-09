// Apply the saved color theme as early as possible to minimise flash-of-light.
(function () {
  try {
    const t = localStorage.getItem("ch_theme");
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) { /* ignore */ }
})();

// Thin fetch wrapper that attaches the JWT and centralises error handling.
const TOKEN_KEY = "comm_agent_token";

const BASE_URL = (location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port !== "8000" && location.port !== "80"
  ? "http://127.0.0.1:8000"
  : "";

const Api = {
  // Token lives in localStorage when "remember me" is on (survives restart),
  // otherwise in sessionStorage (cleared when the tab/browser closes).
  token() { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); },
  setToken(t, remember = true) {
    this.clearToken();
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  },
  clearToken() { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); },

  async request(method, path, body, isForm = false) {
    const headers = {};
    const token = this.token();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let payload = body;
    if (body && !isForm) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const targetPath = path.startsWith("http") ? path : (BASE_URL + path);
    const res = await fetch(targetPath, { method, headers, body: payload });
    if (res.status === 401) {
      Api.clearToken();
      if (!location.pathname.endsWith("/login")) location.href = "/login";
      throw new Error("Unauthorized");
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      let fieldErrors = null;
      if (Array.isArray(data.detail)) {
        // FastAPI/Pydantic validation errors: [{loc: ["body", "email"], msg: "...", ...}]
        fieldErrors = data.detail.map((d) => ({
          field: Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null,
          message: d.msg || "Invalid value",
        }));
        message = fieldErrors.map((f) => (f.field ? `${f.field}: ${f.message}` : f.message)).join("; ");
      } else if (typeof data.detail === "string") {
        message = data.detail;
      }
      const err = new Error(message);
      err.fieldErrors = fieldErrors;
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(p) { return this.request("GET", p); },
  post(p, b) { return this.request("POST", p, b); },
  patch(p, b) { return this.request("PATCH", p, b); },
  del(p) { return this.request("DELETE", p); },

  async postForm(p, formData) {
    return this.request("POST", p, formData, true);
  },

  async login(email, password, remember = true) {
    const form = new URLSearchParams();
    form.set("username", email);
    form.set("password", password);
    const res = await fetch(BASE_URL + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Login failed");
    this.setToken(data.access_token, remember);
    return data;
  },
};

// Small helpers
function qs(name) { return new URLSearchParams(location.search).get(name); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function fmtDate(s) { return s ? new Date(s).toLocaleString() : "—"; }
function fmtDay(s) { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"; }
function toast(msg, kind = "danger") {
  const el = document.getElementById("toast");
  if (!el) { alert(msg); return; }
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.classList.remove("d-none");
  setTimeout(() => el.classList.add("d-none"), 4000);
}
