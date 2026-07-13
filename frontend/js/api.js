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
  // Drop every cached GET whose path starts with `prefix` (all of them if omitted).
  clear(prefix = "") {
    const head = this._key(prefix);
    try {
      Object.keys(sessionStorage).filter((k) => k.startsWith(head)).forEach((k) => sessionStorage.removeItem(k));
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

  // Drop cached GETs after a mutation that invalidates paths other than its own
  // (e.g. clearing every chat invalidates every client's message list).
  invalidateCache(prefix = "") { _apiCache.clear(prefix); },

  // Open/download an authenticated file. A plain <a href> or window.open can't
  // send the bearer token, so the endpoint 401s ("Could not validate
  // credentials"). We fetch the bytes with the token, then hand the browser a
  // blob URL — opening it in a new tab (inline preview) or forcing a download.
  async openFile(path, { download = false, filename = "" } = {}) {
    _progressStart();
    try {
      const headers = {};
      const token = this.token();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(path.startsWith("http") ? path : BASE_URL + path, { headers });
      if (res.status === 401) {
        Api.clearToken();
        if (!location.pathname.endsWith("/login")) location.href = "/login";
        throw new Error("Unauthorized");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        window.open(url, "_blank", "noopener");
      }
      // Give the new tab / download a moment to grab the blob before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      _progressEnd();
    }
  },

  async postForm(p, formData) {
    return this.request("POST", p, formData, true);
  },

  // Multipart upload with progress. fetch() can't report upload progress, so this
  // uses XMLHttpRequest. `onProgress(fraction 0..1)` fires as bytes are sent.
  uploadForm(p, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = p.startsWith("http") ? p : BASE_URL + p;
      xhr.open("POST", url);
      const token = this.token();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      }
      xhr.onload = () => {
        if (xhr.status === 401) {
          Api.clearToken(); _apiCache.clear();
          if (!location.pathname.endsWith("/login")) location.href = "/login";
          return reject(new Error("Unauthorized"));
        }
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const detail = typeof data.detail === "string" ? data.detail
          : Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join("; ")
          : `Upload failed (${xhr.status})`;
        reject(new Error(detail));
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(formData);
    });
  },

  async login(email, password, remember = true) {
    _progressStart();
    try {
      const form = new URLSearchParams();
      form.set("username", email);
      form.set("password", password);
      // The server issues a longer-lived token when this is set. Storing it in
      // localStorage alone is not enough — the JWT would still expire in 12h.
      form.set("remember", remember ? "true" : "false");
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

// Global safety net: any link to an authenticated file/audio download route (e.g.
// /api/files/23/download) can't carry the bearer token as a plain navigation, so
// it would 401 with "Could not validate credentials". Intercept those clicks and
// stream the bytes through an authenticated fetch instead. Covers every page's
// download links without each having to opt in.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  const href = a.getAttribute("href") || "";
  if (!/\/api\/(?:files|audio)\/\d+\/download(?:$|[?#])/.test(href)) return;
  e.preventDefault();
  Api.openFile(href).catch((err) => { if (window.toast) toast(err.message); });
}, true);

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
