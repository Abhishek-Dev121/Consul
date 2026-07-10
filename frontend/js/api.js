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

// ─── Frontend API response cache (stale-while-revalidate) ──────────────────
// GET responses are cached in sessionStorage for 30 s.
// On the next request: if cached data exists, return it INSTANTLY and then
// refresh it in the background — so the UI never waits for the network.
const _apiCache = {
  TTL_MS: 30_000,
  _key(path) { return "apicache:" + path; },
  get(path) {
    try {
      const raw = sessionStorage.getItem(this._key(path));
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > this.TTL_MS) { sessionStorage.removeItem(this._key(path)); return null; }
      return data;
    } catch { return null; }
  },
  set(path, data) {
    try { sessionStorage.setItem(this._key(path), JSON.stringify({ ts: Date.now(), data })); } catch { /* quota full */ }
  },
  del(path) { try { sessionStorage.removeItem(this._key(path)); } catch {} },
  clear() {
    try {
      Object.keys(sessionStorage).filter(k => k.startsWith("apicache:")).forEach(k => sessionStorage.removeItem(k));
    } catch {}
  },
};

// Global top-of-page progress bar: gives instant visual feedback on every API
// call so the app feels responsive even while a request is in flight. A short
// show-delay avoids flashing it for near-instant requests.
const _progress = { count: 0, showTimer: null, el: null };
function _progressEl() {
  if (_progress.el) return _progress.el;
  const el = document.createElement("div");
  el.id = "api-progress";
  document.body.appendChild(el);
  return (_progress.el = el);
}
function _progressStart() {
  _progress.count++;
  if (_progress.count === 1) {
    clearTimeout(_progress.showTimer);
    _progress.showTimer = setTimeout(() => _progressEl().classList.add("show"), 120);
  }
}
function _progressEnd() {
  _progress.count = Math.max(0, _progress.count - 1);
  if (_progress.count === 0) {
    clearTimeout(_progress.showTimer);
    if (_progress.el) _progress.el.classList.remove("show");
  }
}

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
    _progressStart();
    try {
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
        _apiCache.clear();
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
    } finally {
      _progressEnd();
    }
  },

  // Stale-while-revalidate GET: returns cached data immediately if available,
  // fires a background fetch to refresh the cache for next time.
  async get(p, { stale = true } = {}) {
    if (stale) {
      const cached = _apiCache.get(p);
      if (cached !== null) {
        // Background refresh — don't await
        this.request("GET", p).then(fresh => _apiCache.set(p, fresh)).catch(() => {});
        return cached;
      }
    }
    const data = await this.request("GET", p);
    _apiCache.set(p, data);
    return data;
  },
  // Mutating requests invalidate the relevant cache path
  async post(p, b) { const r = await this.request("POST", p, b); _apiCache.del(p); return r; },
  async patch(p, b) { const r = await this.request("PATCH", p, b); _apiCache.del(p); return r; },
  async del(p) { const r = await this.request("DELETE", p); _apiCache.del(p); return r; },

  async postForm(p, formData) {
    return this.request("POST", p, formData, true);
  },

  async login(email, password, remember = true) {
    _progressStart();
    try {
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
      _apiCache.clear();
      this.setToken(data.access_token, remember);
      return data;
    } finally {
      _progressEnd();
    }
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
