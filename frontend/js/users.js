(async function () {
  const actions = `<button class="btn btn-primary" id="new-btn" data-bs-toggle="modal" data-bs-target="#userModal">+ New user</button>`;
  await renderLayout("/users", "Team Members", { crumb: "Workspace", actions });
  const admin = isAdmin();
  if (!admin) { const b = document.getElementById("new-btn"); if (b) b.remove(); }

  const ROLES = ["employee", "team_lead", "admin", "super_admin"];
  const roleChip = { super_admin: "violet", admin: "info", team_lead: "amber", employee: "" };
  const roleLabel = (r) => r.replace("_", " ");

  // ---- state ----
  const limit = 10;
  let offset = 0, total = 0;
  let q = "", roleFilter = "", statusFilter = "";
  let sort = "created_at", order = "desc";
  const selection = new Set();
  let editingId = null;

  // ================= Summary =================
  async function loadStats() {
    const s = await Api.get("/api/users/stats");
    const card = (label, val, icon, tint) => `<div class="col-md-3 col-6"><div class="card"><div class="stat">
      <div class="stat-ico ${tint}">${icon}</div>
      <div><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div></div></div></div>`;
    document.getElementById("stats").innerHTML =
      card("Total", s.total, Icon("users", { size: 20 }), "tint-blue") +
      card("Active", s.active, Icon("check", { size: 20 }), "tint-green") +
      card("Pending invites", s.pending, Icon("mail", { size: 20 }), "tint-amber") +
      card("Disabled", s.disabled, Icon("ban", { size: 20 }), "tint-sky");
  }

  // ================= Filters =================
  function renderRoleFilter() {
    const opts = ["", ...ROLES];
    document.getElementById("role-filter").innerHTML = opts.map((r) =>
      `<span class="pill ${r === roleFilter ? "active" : ""}" data-r="${r}">${r ? roleLabel(r) : "all"}</span>`).join("");
    document.querySelectorAll("#role-filter .pill").forEach((el) =>
      el.addEventListener("click", () => { roleFilter = el.dataset.r; offset = 0; renderRoleFilter(); load(); }));
  }
  document.getElementById("status-filter").addEventListener("change", (e) => {
    statusFilter = e.target.value; offset = 0; load();
  });
  let t;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(t); q = e.target.value.trim(); offset = 0; t = setTimeout(load, 300);
  });

  // Sortable headers
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sort === col) order = order === "asc" ? "desc" : "asc";
      else { sort = col; order = "asc"; }
      load();
    });
  });
  function paintSortCarets() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const active = th.dataset.sort === sort;
      th.classList.toggle("active", active);
      th.querySelector(".caret").textContent = active ? (order === "asc" ? "▲" : "▼") : "↕";
    });
  }

  // ================= Table =================
  function statusChip(u) {
    if (u.is_pending) return '<span class="chip amber"><span class="dot"></span>Pending</span>';
    return u.is_active
      ? '<span class="chip ok"><span class="dot"></span>Active</span>'
      : '<span class="chip bad"><span class="dot"></span>Disabled</span>';
  }

  function rowActions(u) {
    if (!admin) return "";
    const isSelf = u.id === CURRENT_USER.id;
    const items = [`<li><a class="dropdown-item" href="#" onclick="openEdit(${u.id});return false">${Icon("edit", { size: 14 })} Edit</a></li>`];
    if (u.is_pending)
      items.push(`<li><a class="dropdown-item" href="#" onclick="resendInvite(${u.id});return false">${Icon("mail", { size: 14 })} Resend invite</a></li>`);
    if (!isSelf) {
      items.push(`<li><a class="dropdown-item" href="#" onclick="toggleActive(${u.id},${!u.is_active});return false">${u.is_active ? `${Icon("ban", { size: 14 })} Disable` : `${Icon("check", { size: 14 })} Enable`}</a></li>`);
      items.push(`<li><hr class="dropdown-divider"></li>`);
      items.push(`<li><a class="dropdown-item text-danger" href="#" onclick="delUser(${u.id});return false">${Icon("trash", { size: 14 })} Delete</a></li>`);
    }
    return `<div class="dropdown"><button class="btn btn-sm btn-soft" data-bs-toggle="dropdown">⋯</button>
      <ul class="dropdown-menu dropdown-menu-end">${items.join("")}</ul></div>`;
  }

  function render(users) {
    const rows = document.getElementById("rows");
    if (!users.length) {
      rows.innerHTML = `<tr><td colspan="8"><div class="empty"><span class="em-ico">${Icon("users", { size: 26 })}</span>No users match these filters.</div></td></tr>`;
      return;
    }
    rows.innerHTML = users.map((u) => {
      const isSelf = u.id === CURRENT_USER.id;
      return `<tr>
        <td>${admin && !isSelf ? `<input type="checkbox" class="form-check-input row-check" data-id="${u.id}" ${selection.has(u.id) ? "checked" : ""}>` : ""}</td>
        <td><div class="d-flex align-items-center gap-2 cursor-pointer" onclick="openDrawer(${u.id})">
          <span class="avatar-sm role-${u.role}" style="color:#fff">${initials(u.name)}</span>
          <strong>${esc(u.name)}</strong>${isSelf ? '<span class="you-badge">You</span>' : ""}</div></td>
        <td class="muted">${esc(u.email)}</td>
        <td><span class="chip ${roleChip[u.role] || ""}">${roleLabel(u.role)}</span></td>
        <td>${statusChip(u)}</td>
        <td class="small muted">${u.created_at ? fmtDate(u.created_at) : "—"}</td>
        <td class="small muted">${u.last_login_at ? fmtDate(u.last_login_at) : "Never"}</td>
        <td class="text-end">${rowActions(u)}</td></tr>`;
    }).join("");

    document.querySelectorAll(".row-check").forEach((cb) =>
      cb.addEventListener("change", () => {
        const id = parseInt(cb.dataset.id);
        cb.checked ? selection.add(id) : selection.delete(id);
        renderBulkbar();
      }));
  }

  async function load() {
    paintSortCarets();
    const params = new URLSearchParams({ sort, order, limit, offset });
    if (q) params.set("q", q);
    if (roleFilter) params.set("role", roleFilter);
    if (statusFilter) params.set("status", statusFilter);
    try {
      const data = await Api.get(`/api/users?${params}`);
      total = data.total;
      render(data.items);
      const from = total ? offset + 1 : 0;
      document.getElementById("pager-info").textContent = `${from}–${Math.min(offset + limit, total)} of ${total}`;
      document.getElementById("prev-page").disabled = offset === 0;
      document.getElementById("next-page").disabled = offset + limit >= total;
    } catch (e) { toast(e.message); }
  }

  document.getElementById("prev-page").addEventListener("click", () => { if (offset > 0) { offset -= limit; load(); } });
  document.getElementById("next-page").addEventListener("click", () => { if (offset + limit < total) { offset += limit; load(); } });

  // ================= Selection / bulk =================
  function renderBulkbar() {
    const bar = document.getElementById("bulkbar");
    bar.classList.toggle("d-none", selection.size === 0);
    document.getElementById("bulk-count").textContent = `${selection.size} selected`;
  }
  window.clearSelection = () => { selection.clear(); renderBulkbar(); load(); };
  document.getElementById("check-all").addEventListener("change", (e) => {
    document.querySelectorAll(".row-check").forEach((cb) => {
      cb.checked = e.target.checked;
      const id = parseInt(cb.dataset.id);
      e.target.checked ? selection.add(id) : selection.delete(id);
    });
    renderBulkbar();
  });
  window.bulkAct = async (action) => {
    if (!selection.size) return;
    const body = { user_ids: [...selection], action };
    if (action === "set_role") body.role = document.getElementById("bulk-role").value;
    if (action === "delete" && !(await confirmDialog(`This permanently deletes ${selection.size} selected user account(s).`, { title: `Delete ${selection.size} user(s)?`, confirmText: "Delete users" }))) return;
    try {
      const r = await Api.post("/api/users/bulk", body);
      toast(`${r.affected} updated${r.skipped ? `, ${r.skipped} skipped` : ""}`, "success");
      selection.clear(); renderBulkbar();
      await Promise.all([load(), loadStats()]);
    } catch (e) { toast(e.message); }
  };
  document.getElementById("bulk-role").addEventListener("change", (e) => {
    if (e.target.value) bulkAct("set_role");
  });

  // ================= Row actions =================
  window.toggleActive = async (id, active) => {
    try { await Api.patch(`/api/users/${id}`, { is_active: active }); await Promise.all([load(), loadStats()]); }
    catch (e) { toast(e.message); }
  };
  window.delUser = async (id) => {
    if (!(await confirmDialog("This permanently removes the user account. This can't be undone.", { title: "Delete this user?", confirmText: "Delete user" }))) return;
    try { await Api.del(`/api/users/${id}`); await Promise.all([load(), loadStats()]); toast("User deleted", "success"); }
    catch (e) { toast(e.message); }
  };
  window.resendInvite = async (id) => {
    try {
      const r = await Api.post(`/api/users/${id}/resend-invite`);
      showInviteResult(r);
      toast(r.invite_emailed ? "Invite re-sent by email" : "Invite link refreshed — copy it below", "success");
      new bootstrap.Modal(document.getElementById("userModal")).show();
    } catch (e) { toast(e.message); }
  };

  // ================= Password helpers =================
  function genPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
    return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }
  function scorePw(p) {
    let s = 0;
    if (p.length >= 8) s++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
    return s; // 0..3
  }
  function paintMeter(meter, p) {
    meter.className = "pw-meter " + (!p ? "" : ["pw-weak", "pw-weak", "pw-medium", "pw-strong"][scorePw(p)]);
  }

  // ================= Create user =================
  const inviteToggle = document.getElementById("u-invite");
  inviteToggle.addEventListener("change", () => {
    document.getElementById("u-password-wrap").classList.toggle("d-none", inviteToggle.checked);
  });
  document.getElementById("u-toggle-pw").addEventListener("click", () => {
    const f = document.getElementById("u-password"); f.type = f.type === "password" ? "text" : "password";
  });
  document.getElementById("u-gen-pw").addEventListener("click", () => {
    const f = document.getElementById("u-password"); f.type = "text"; f.value = genPassword();
    paintMeter(document.querySelector("#u-password-wrap .pw-meter"), f.value);
  });
  document.getElementById("u-password").addEventListener("input", (e) =>
    paintMeter(document.querySelector("#u-password-wrap .pw-meter"), e.target.value));

  function showInviteResult(r) {
    const wrap = document.getElementById("u-invite-result");
    if (!r.invite_url) { wrap.classList.add("d-none"); return; }
    wrap.classList.remove("d-none");
    document.getElementById("u-invite-link").textContent = r.invite_url;
    document.getElementById("u-invite-emailed").innerHTML = r.invite_emailed ? `${Icon("check", { size: 13 })} emailed` : "(email not configured — share manually)";
  }
  document.getElementById("u-copy-invite").addEventListener("click", () => {
    navigator.clipboard.writeText(document.getElementById("u-invite-link").textContent);
    toast("Invite link copied", "success");
  });

  document.getElementById("save-user").addEventListener("click", async () => {
    const name = document.getElementById("u-name").value.trim();
    const email = document.getElementById("u-email").value.trim();
    if (!name || !email) return toast("Name and email are required");
    const sendInvite = inviteToggle.checked;
    const body = { name, email, role: document.getElementById("u-role").value, send_invite: sendInvite };
    if (!sendInvite) body.password = document.getElementById("u-password").value;
    try {
      const r = await Api.post("/api/users", body);
      if (sendInvite) {
        showInviteResult(r); // keep modal open to copy the link
      } else {
        bootstrap.Modal.getOrCreateInstance(document.getElementById("userModal")).hide();
      }
      ["u-name", "u-email", "u-password"].forEach((i) => (document.getElementById(i).value = ""));
      await Promise.all([load(), loadStats()]);
      toast(sendInvite ? "Invite created" : "User created", "success");
    } catch (e) { toast(e.message); }
  });

  // ================= Edit user =================
  window.openEdit = async (id) => {
    const u = await Api.get(`/api/users/${id}`);
    editingId = id;
    document.getElementById("e-name").value = u.name;
    document.getElementById("e-email").value = u.email;
    document.getElementById("e-role").value = u.role;
    document.getElementById("e-status").value = String(u.is_active);
    document.getElementById("e-password").value = "";
    new bootstrap.Modal(document.getElementById("editModal")).show();
  };
  document.getElementById("e-gen-pw").addEventListener("click", () => {
    const f = document.getElementById("e-password"); f.type = "text"; f.value = genPassword();
  });
  document.getElementById("save-edit").addEventListener("click", async () => {
    const body = {
      name: document.getElementById("e-name").value.trim(),
      email: document.getElementById("e-email").value.trim(),
      role: document.getElementById("e-role").value,
      is_active: document.getElementById("e-status").value === "true",
    };
    const pw = document.getElementById("e-password").value;
    if (pw) body.password = pw;
    try {
      await Api.patch(`/api/users/${editingId}`, body);
      bootstrap.Modal.getOrCreateInstance(document.getElementById("editModal")).hide();
      await Promise.all([load(), loadStats()]);
      toast("User updated", "success");
    } catch (e) { toast(e.message); }
  });

  // ================= Detail drawer =================
  window.openDrawer = async (id) => {
    const body = document.getElementById("drawer-body");
    body.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Loading…';
    new bootstrap.Offcanvas(document.getElementById("userDrawer")).show();
    try {
      const u = await Api.get(`/api/users/${id}`);
      const clients = u.assigned_clients || [];
      const acts = u.recent_activity || [];
      body.innerHTML = `
        <div class="text-center mb-3">
          <span class="avatar-sm role-${u.role}" style="width:64px;height:64px;font-size:22px;color:#fff">${initials(u.name)}</span>
          <h5 class="mt-2 mb-0">${esc(u.name)}</h5>
          <div class="muted">${esc(u.email)}</div>
          <span class="chip ${roleChip[u.role] || ""} mt-2 d-inline-block">${roleLabel(u.role)}</span>
          ${statusChip(u)}
        </div>
        <div class="card mb-3"><div class="card-body">
          <div class="d-flex justify-content-between"><span class="muted">Created</span><span>${u.created_at ? fmtDate(u.created_at) : "—"}</span></div>
          <div class="d-flex justify-content-between"><span class="muted">Created by</span><span>${esc(u.created_by_name || "—")}</span></div>
          <div class="d-flex justify-content-between"><span class="muted">Last login</span><span>${u.last_login_at ? fmtDate(u.last_login_at) : "Never"}</span></div>
        </div></div>
        <h6>Assigned clients (${clients.length})</h6>
        ${clients.length ? `<ul class="list-group mb-3">${clients.map((c) =>
          `<li class="list-group-item py-2"><a href="/client?id=${c.id}">${esc(c.name)}</a></li>`).join("")}</ul>`
          : '<p class="muted small">None assigned.</p>'}
        <h6>Recent activity</h6>
        ${acts.length ? `<ul class="list-group">${acts.map((a) =>
          `<li class="list-group-item py-2 small"><code>${esc(a.action)}</code>
            <span class="muted d-block">${fmtDate(a.created_at)}</span></li>`).join("")}</ul>`
          : '<p class="muted small">No activity yet.</p>'}`;
    } catch (e) { body.innerHTML = `<p class="text-danger">${esc(e.message)}</p>`; }
  };

  // ================= Init =================
  function renderRolesBlock() {
    const ROLE_DESC = {
      super_admin: { label: "Super Admin", desc: "Full access to channels, clients, projects, documents, reports, users and settings." },
      admin: { label: "Admin", desc: "Manages clients, projects, chats, documents and team. Can reply to any conversation." },
      team_lead: { label: "Team Lead", desc: "Views assigned clients, chats, projects and reports. Replies only after an Admin/Super Admin." },
      employee: { label: "Employee", desc: "Read-only access to assigned chats, clients, projects and documents." },
    };
    const me = CURRENT_USER.role;
    const cards = Object.entries(ROLE_DESC).map(([k, r]) => `
      <div class="card card-pad" style="${k === me ? "border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)" : ""}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:30px;height:30px;border-radius:8px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center">${Icon("shield", { size: 16 })}</span>
          <div style="font-family:var(--display);font-weight:600;font-size:14px">${r.label}</div></div>
        <p style="font-size:11.5px;color:var(--muted);line-height:1.5">${r.desc}</p>
        ${k === me ? '<div style="margin-top:9px"><span class="spill s-pos"><span class="pdot"></span>Your role</span></div>' : ""}
      </div>`).join("");

    const caps = [
      ["View assigned chats", 1, 1, 1, 1], ["View clients & projects", 1, 1, 1, 1],
      ["View documents", 1, 1, 1, 1], ["Reply when last msg from Admin", 1, 1, 1, 0],
      ["Reply to any conversation", 1, 1, 0, 0], ["Upload chats / calls / docs", 1, 1, 1, 0],
      ["Manage clients & projects", 1, 1, 0, 0], ["Manage channels", 1, 1, 0, 0],
      ["Manage users & roles", 1, 1, 0, 0], ["Create Super Admins", 1, 0, 0, 0],
      ["System settings", 1, 0, 0, 0],
    ];
    const yn = (v) => v ? `<span class="yes">${Icon("check", { size: 13 })}</span>` : `<span class="no">${Icon("x", { size: 13 })}</span>`;
    const matrix = `<div class="card" style="margin:16px 0"><div class="card-h"><h3>Permission matrix</h3></div>
      <table class="table matrix"><thead><tr><th>Capability</th><th>Super Admin</th><th>Admin</th><th>Team Lead</th><th>Employee</th></tr></thead>
      <tbody>${caps.map((c) => `<tr><td>${c[0]}</td><td>${yn(c[1])}</td><td>${yn(c[2])}</td><td>${yn(c[3])}</td><td>${yn(c[4])}</td></tr>`).join("")}</tbody></table></div>`;

    document.getElementById("roles-block").innerHTML =
      `<div class="page-head"><div><h2>Users & Roles</h2><p>Role-based access control across the workspace.</p></div></div>
       <div class="grid g-4" style="margin-bottom:16px">${cards}</div>${matrix}
       <h3 style="font-family:var(--display);font-size:15px;margin-bottom:12px">Team members</h3>`;
  }

  renderRolesBlock();
  renderRoleFilter();
  await Promise.all([loadStats(), load()]);
})();
