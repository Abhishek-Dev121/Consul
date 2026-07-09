// Shared chrome: ClientHub dark sidebar (grouped, role-aware) + crumbs topbar.
// Each page calls renderLayout(active, title, { crumb, actions }).
const ROLE_RANK = { employee: 1, team_lead: 2, admin: 3, super_admin: 4 };

const NAV = [
  { section: "Workspace", items: [
    { href: "/dashboard", label: "Dashboard", icon: "home", min: "employee" },
    { href: "/clients", label: "Clients", icon: "users", min: "employee" },
    { href: "/conversations", label: "Conversations", icon: "message", min: "employee" },
    { href: "/team-chat", label: "Team Chat", icon: "message", min: "employee" },
    { href: "/projects", label: "Projects", icon: "folder", min: "employee" },
  ]},
  { section: "Records", items: [
    { href: "/calls", label: "Call Recordings", icon: "phone", min: "employee" },
    { href: "/documents", label: "Documents", icon: "file", min: "employee" },
  ]},
  { section: "Intelligence", items: [
    { href: "/reports", label: "Reports & Analytics", icon: "chart", min: "team_lead" },
  ]},
  { section: "Administration", items: [
    { href: "/channels", label: "Channels", icon: "rss", min: "team_lead" },
    { href: "/users", label: "Users & Roles", icon: "shield", min: "team_lead" },
    { href: "/activity", label: "Activity Log", icon: "scroll", min: "team_lead" },
    { href: "/bitrix", label: "Bitrix24", icon: "link", min: "admin" },
  ]},
];

let CURRENT_USER = null;

// Collapse/expand the desktop sidebar. Sets the inline flex-basis/width directly
// (in addition to toggling the class used for the rest of the collapsed styling).
// max-width/min-width are set explicitly too: some descendant's min-content size
// otherwise creates an implicit floor that keeps the flex item from actually
// shrinking below it even with flex-shrink/flex-basis set.
function setNavCollapsed(shell, collapsed) {
  shell.classList.toggle("nav-collapsed", collapsed);
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    sidebar.style.flex = collapsed ? "0 0 74px" : "";
    sidebar.style.width = collapsed ? "74px" : "";
    sidebar.style.maxWidth = collapsed ? "74px" : "";
    sidebar.style.minWidth = collapsed ? "0" : "";
  }
}

function ensureFonts() {
  if (document.getElementById("ch-fonts")) return;
  const l = document.createElement("link");
  l.id = "ch-fonts";
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";
  document.head.appendChild(l);
}

async function requireAuth() {
  if (!Api.token()) { location.href = "/login"; throw new Error("no token"); }
  try {
    CURRENT_USER = await Api.get("/api/auth/me");
    return CURRENT_USER;
  } catch (e) {
    location.href = "/login";
    throw e;
  }
}

function canWrite() { return CURRENT_USER && ROLE_RANK[CURRENT_USER.role] >= ROLE_RANK.team_lead; }
function isAdmin() { return CURRENT_USER && ROLE_RANK[CURRENT_USER.role] >= ROLE_RANK.admin; }

function initials(name) {
  return (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function getCachedUser() {
  try {
    const cached = localStorage.getItem("ch_user") || sessionStorage.getItem("ch_user");
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
}

function cacheUser(user, remember = true) {
  try {
    (remember ? localStorage : sessionStorage).setItem("ch_user", JSON.stringify(user));
  } catch (e) {}
}

function doRenderLayout(active, pageTitle, user, opts) {
  // Restore collapsed-sidebar preference (desktop).
  const shell = document.querySelector(".app-shell");
  if (shell && localStorage.getItem("ch_nav") === "collapsed") setNavCollapsed(shell, true);

  // ---- Sidebar ----
  const sections = NAV.map((sec) => {
    const links = sec.items
      .filter((n) => user && ROLE_RANK[user.role] >= ROLE_RANK[n.min])
      .map((n) => `<a class="nav-link ${n.href === active ? "active" : ""}" href="${n.href}" title="${n.label}">
        <span class="ico">${Icon(n.icon, { size: 17 })}</span><span>${n.label}</span></a>`).join("");
    if (!links) return "";
    return `<div class="nav-section">${sec.section}</div>${links}`;
  }).join("");

  const sidebarEl = document.getElementById("app-sidebar");
  if (sidebarEl) {
    sidebarEl.innerHTML = `
      <div class="brand">
        <div class="logo">${Icon("message", { size: 20, inline: false })}</div>
        <div><h1>ClientHub</h1><div class="tag">Bitrix24 Local App</div></div>
      </div>
      <nav class="nav">${sections}</nav>
      <div class="rail-foot">
        <div class="dropdown dropup profile-dd">
          <button class="profile-trigger" data-bs-toggle="dropdown" aria-expanded="false">
            <span class="av">${initials(user.name)}</span>
            <span class="role-txt">${user.role.replace("_", " ")}</span>
            <span class="chev">${Icon("chevronDown", { size: 14 })}</span>
          </button>
          <div class="dropdown-menu profile-menu">
            <div class="profile-menu-head">
              <span class="av">${initials(user.name)}</span>
              <div class="pm-info">
                <div class="nm">${esc(user.name)}</div>
                <div class="em">${esc(user.email)}</div>
                <span class="chip info mt-1" style="text-transform:capitalize">${user.role.replace("_", " ")}</span>
              </div>
            </div>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" onclick="openAccount()">${Icon("edit", { size: 14 })} My account</button>
            <button class="dropdown-item text-danger" onclick="logout()">${Icon("logout", { size: 14 })} Sign out</button>
          </div>
        </div>
      </div>`;
  }

  ensureAccountModal();

  // ---- Topbar ----
  const actions = opts.actions || "";
  const topbarEl = document.getElementById("app-topbar");
  if (topbarEl) {
    topbarEl.innerHTML = `
      <div class="d-flex align-items-center gap-2" style="min-width:0">
        <button class="icon-btn tb-nav-toggle" id="nav-toggle" title="Collapse sidebar" aria-label="Collapse sidebar">${Icon("menu")}</button>
        <button class="icon-btn tb-hamburger" id="nav-hamburger" title="Menu" aria-label="Open menu">${Icon("menu")}</button>
        <div class="crumbs">
          <span class="page-h">${esc(pageTitle || "")}</span>
          ${opts.crumb ? `<span class="sub">${esc(opts.crumb)}</span>` : ""}
        </div>
      </div>
      <div class="tb-right">
        <div class="tb-search">
          <span class="s-ico">${Icon("search", { size: 15 })}</span>
          <input id="tb-search-input" placeholder="Search clients, chats…" autocomplete="off" />
          <div class="tb-results d-none" id="tb-results"></div>
        </div>
        ${actions}
        <button class="icon-btn" id="theme-toggle" title="Toggle light / dark">${Icon("moon")}</button>
        <div class="dropdown">
          <button class="icon-btn" id="tb-bell" data-bs-toggle="dropdown" title="Notifications">${Icon("bell")}</button>
          <div class="dropdown-menu dropdown-menu-end p-0" style="width:320px" id="tb-notif"></div>
        </div>
        <div class="dropdown">
          <button class="icon-btn" data-bs-toggle="dropdown" title="Help">${Icon("help")}</button>
          <div class="dropdown-menu dropdown-menu-end p-3" style="width:260px">
            <h6 class="mb-1" style="font-family:var(--display)">ClientHub</h6>
            <p class="muted small mb-2">Bitrix24 Local App</p>
            <div class="small">Use the sidebar to navigate, click a KPI to drill in, and manage your password under <b>My account</b>.</div>
            <hr class="my-2"><div class="small muted">Support · info@devexhub.com</div>
          </div>
        </div>
      </div>`;
  }

  wireTopbar();
  wireChrome();
}

async function renderLayout(active, pageTitle, opts = {}) {
  ensureFonts();
  
  // 1. Try rendering immediately from cache to avoid flashing
  const cachedUser = getCachedUser();
  if (cachedUser) {
    CURRENT_USER = cachedUser;
    doRenderLayout(active, pageTitle, cachedUser, opts);
  } else {
    // If no cache, render a basic skeleton sidebar so we don't have empty layout shift
    const sb = document.getElementById("app-sidebar");
    if (sb) {
      sb.innerHTML = `<div class="brand"><div class="logo">📨</div><div><h1>ClientHub</h1></div></div>
        <div style="padding: 20px;"><div class="skeleton" style="height:30px;margin-bottom:15px;"></div><div class="skeleton" style="height:30px;margin-bottom:15px;"></div><div class="skeleton" style="height:30px;"></div></div>`;
    }
  }

  // 2. Authenticate and get fresh user details
  const user = await requireAuth();
  cacheUser(user, !!localStorage.getItem("comm_agent_token"));

  // 3. Re-render if the user details changed or if we didn't have cache
  if (!cachedUser || cachedUser.name !== user.name || cachedUser.role !== user.role) {
    doRenderLayout(active, pageTitle, user, opts);
  }
}

// Theme, collapse, and mobile-nav controls.
function wireChrome() {
  updateThemeIcon();
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.onclick = toggleTheme;

  const shell = document.querySelector(".app-shell");
  const navToggle = document.getElementById("nav-toggle");
  if (navToggle && shell) navToggle.onclick = () => {
    setNavCollapsed(shell, !shell.classList.contains("nav-collapsed"));
    localStorage.setItem("ch_nav", shell.classList.contains("nav-collapsed") ? "collapsed" : "expanded");
  };

  // Mobile off-canvas
  const sb = document.getElementById("app-sidebar");
  let scrim = document.getElementById("nav-scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.id = "nav-scrim"; scrim.className = "scrim-nav";
    document.body.appendChild(scrim);
  }
  const closeNav = () => { sb.classList.remove("open"); scrim.classList.remove("show"); };
  scrim.onclick = closeNav;
  const ham = document.getElementById("nav-hamburger");
  if (ham) ham.onclick = () => { sb.classList.add("open"); scrim.classList.add("show"); };
  sb.querySelectorAll(".nav-link").forEach((l) => l.addEventListener("click", closeNav));
}

function toggleTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  if (dark) { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("ch_theme", "light"); }
  else { document.documentElement.setAttribute("data-theme", "dark"); localStorage.setItem("ch_theme", "dark"); }
  updateThemeIcon();
}
function updateThemeIcon() {
  const b = document.getElementById("theme-toggle");
  if (b) b.innerHTML = Icon(document.documentElement.getAttribute("data-theme") === "dark" ? "sun" : "moon");
}

// Search, notifications topbar wiring
function wireTopbar() {
  const input = document.getElementById("tb-search-input");
  const results = document.getElementById("tb-results");
  let cache = null, t;

  async function ensure() {
    if (cache) return cache;
    const [cl, cv] = await Promise.all([
      Api.get("/api/overview/clients").catch(() => []),
      Api.get("/api/conversations").catch(() => []),
    ]);
    cache = { clients: cl, convos: cv, cmap: Object.fromEntries(cl.map((c) => [c.id, c.name])) };
    return cache;
  }
  const hide = () => results.classList.add("d-none");

  async function run() {
    const q = input.value.trim().toLowerCase();
    if (!q) return hide();
    const d = await ensure();
    const cls = d.clients.filter((c) => (c.name + " " + (c.company || "") + " " + (c.email || "")).toLowerCase().includes(q)).slice(0, 6);
    const cvs = d.convos.filter((c) => ((c.title || "") + " " + (d.cmap[c.client_id] || "")).toLowerCase().includes(q)).slice(0, 5);
    if (!cls.length && !cvs.length) { results.innerHTML = '<div class="res-cat">No matches</div>'; results.classList.remove("d-none"); return; }
    let h = "";
    if (cls.length) h += '<div class="res-cat">Clients</div>' + cls.map((c) =>
      `<a class="res" href="/client?id=${c.id}">${avBox(c.name)}<div><div style="font-weight:600;font-size:13px">${esc(c.name)}</div><div class="muted" style="font-size:11px">${esc(c.company || "")}</div></div></a>`).join("");
    if (cvs.length) h += '<div class="res-cat">Conversations</div>' + cvs.map((c) =>
      `<a class="res" href="/conversations?client=${c.client_id}"><span class="av" style="background:var(--brand-soft);color:var(--brand)">${Icon("message", { size: 15 })}</span><div><div style="font-weight:600;font-size:13px">${esc(c.title || "Conversation")}</div><div class="muted" style="font-size:11px">${esc(d.cmap[c.client_id] || "")}</div></div></a>`).join("");
    results.innerHTML = h;
    results.classList.remove("d-none");
  }
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 180); });
  input.addEventListener("focus", () => { if (input.value.trim()) run(); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".tb-search")) hide(); });

  const bell = document.getElementById("tb-bell");
  if (bell) bell.addEventListener("click", async () => {
    const panel = document.getElementById("tb-notif");
    panel.innerHTML = '<div class="res-cat" style="padding:11px 13px">Recent activity</div><div class="p-3 muted small">Loading…</div>';
    try {
      const acts = await Api.get("/api/activities?limit=8");
      panel.innerHTML = '<div class="res-cat" style="padding:11px 13px">Recent activity</div>' + (acts.length
        ? acts.map((a) => `<div style="padding:9px 13px;border-top:1px solid var(--line-2)">
            <div style="font-size:12.5px">${esc(humanizeActivity(a.action, a.detail))}</div>
            <div class="muted" style="font-size:10.5px">${timeAgo(a.created_at)}</div></div>`).join("")
        : '<div class="p-3 muted small">Nothing yet.</div>');
    } catch (e) { panel.innerHTML = '<div class="p-3 muted small">Could not load.</div>'; }
  });
}

function logout() { 
  Api.clearToken(); 
  localStorage.removeItem("ch_user");
  sessionStorage.removeItem("ch_user");
  location.href = "/login"; 
}

// Styled confirmation dialog → Promise<boolean>. Replaces native confirm().
function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    let el = document.getElementById("confirmModal");
    if (!el) {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="modal fade" id="confirmModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered" style="max-width:430px">
          <div class="modal-content"><div class="modal-body text-center p-4">
            <div class="confirm-icon" id="confirm-icon"></div>
            <h5 class="mt-3 mb-2" id="confirm-title" style="font-family:var(--display);font-weight:600"></h5>
            <p class="muted mb-0" id="confirm-msg" style="font-size:13.5px;line-height:1.5"></p>
          </div>
          <div class="modal-footer border-0 justify-content-center pb-4 pt-0">
            <button class="btn btn-light px-4" id="confirm-cancel">Cancel</button>
            <button class="btn px-4" id="confirm-ok"></button>
          </div></div></div></div>`);
      el = document.getElementById("confirmModal");
    }
    const danger = opts.danger !== false;
    document.getElementById("confirm-icon").innerHTML = Icon(danger ? "trash" : "help", { size: 24 });
    document.getElementById("confirm-icon").className = "confirm-icon" + (danger ? " danger" : "");
    document.getElementById("confirm-title").textContent = opts.title || "Are you sure?";
    document.getElementById("confirm-msg").textContent = message || "";
    const ok = document.getElementById("confirm-ok");
    ok.textContent = opts.confirmText || (danger ? "Delete" : "Confirm");
    ok.className = "btn px-4 " + (danger ? "btn-danger" : "btn-primary");

    const modal = bootstrap.Modal.getOrCreateInstance(el);
    let done = false;
    const finish = (v) => { if (done) return; done = true; modal.hide(); resolve(v); };
    ok.onclick = () => finish(true);
    document.getElementById("confirm-cancel").onclick = () => finish(false);
    el.addEventListener("hidden.bs.modal", () => finish(false), { once: true });
    modal.show();
  });
}

// ---- My Account modal (self-service profile + password change) ----
function ensureAccountModal() {
  if (document.getElementById("accountModal")) return;
  const u = CURRENT_USER;
  const html = `
  <div class="modal fade" id="accountModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">My account</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="av role-${u.role}" style="width:52px;height:52px;font-size:18px;color:#fff">${initials(u.name)}</span>
        <div><div style="font-family:var(--display);font-weight:600;font-size:16px">${esc(u.name)}</div>
          <div class="muted">${esc(u.email)}</div>
          <span class="chip info mt-1 d-inline-block" style="text-transform:capitalize">${u.role.replace("_", " ")}</span></div>
      </div>
      <hr>
      <h6 style="font-family:var(--display)">Change password</h6>
      <div class="mb-2"><label class="form-label">Current password</label>
        <input type="password" class="form-control" id="acc-current" /></div>
      <div class="mb-1"><label class="form-label">New password</label>
        <div class="input-group"><input type="password" class="form-control" id="acc-new" />
          <button class="btn btn-soft" type="button" id="acc-toggle">${Icon("eye", { size: 14 })}</button></div>
        <div class="pw-meter"><span></span></div></div>
      <div class="mb-2"><label class="form-label">Confirm new password</label>
        <input type="password" class="form-control" id="acc-confirm" /></div>
    </div>
    <div class="modal-footer"><button class="btn btn-light" data-bs-dismiss="modal">Close</button>
      <button class="btn btn-primary" id="acc-save">Update password</button></div>
  </div></div></div>`;
  document.body.insertAdjacentHTML("beforeend", html);

  const score = (p) => { let s = 0; if (p.length >= 8) s++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++; if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++; return s; };
  document.getElementById("acc-new").addEventListener("input", (e) => {
    const m = document.querySelector("#accountModal .pw-meter"); const p = e.target.value;
    m.className = "pw-meter " + (!p ? "" : ["pw-weak", "pw-weak", "pw-medium", "pw-strong"][score(p)]);
  });
  document.getElementById("acc-toggle").addEventListener("click", () => {
    const f = document.getElementById("acc-new"); f.type = f.type === "password" ? "text" : "password";
  });
  document.getElementById("acc-save").addEventListener("click", async () => {
    const cur = document.getElementById("acc-current").value;
    const nw = document.getElementById("acc-new").value;
    const cf = document.getElementById("acc-confirm").value;
    if (nw.length < 8) return toast("New password must be at least 8 characters");
    if (nw !== cf) return toast("Passwords do not match");
    try {
      await Api.post("/api/auth/change-password", { current_password: cur, new_password: nw });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("accountModal")).hide();
      ["acc-current", "acc-new", "acc-confirm"].forEach((i) => (document.getElementById(i).value = ""));
      toast("Password updated", "success");
    } catch (e) { toast(e.message); }
  });
}

function openAccount() {
  ensureAccountModal();
  new bootstrap.Modal(document.getElementById("accountModal")).show();
}
