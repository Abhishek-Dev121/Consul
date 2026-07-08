(async function () {
  const actions = `<button class="btn btn-primary" id="new-btn" data-bs-toggle="modal" data-bs-target="#clientModal">+ New client</button>`;
  await renderLayout("/clients", "Clients", { crumb: "Manually managed client directory", actions });
  if (!canWrite()) { const b = document.getElementById("new-btn"); if (b) b.remove(); }

  const FILTERS = ["all", "whatsapp", "upwork", "slack", "email", "telegram"];
  let clients = [], chanFilter = "all";

  // ---- filter bar ----
  function renderFilter() {
    document.getElementById("chan-filter").innerHTML = FILTERS.map((f) =>
      `<button class="chip ${f === chanFilter ? "info" : ""}" data-f="${f}" style="cursor:pointer">
        ${f === "all" ? "All channels" : `<span class="dot" style="background:${chanColor(f)}"></span>${platformName(f)}`}</button>`).join("");
    document.querySelectorAll("#chan-filter [data-f]").forEach((el) =>
      el.addEventListener("click", () => { chanFilter = el.dataset.f; renderFilter(); renderGrid(); }));
  }

  function card(c) {
    return `<div class="client-card" data-id="${c.id}">
      <div class="cc-top">${avBox(c.name)}
        <div style="min-width:0"><h4>${esc(c.name)}</h4><div class="co">${esc(c.company || "—")}</div></div>
        <div style="margin-left:auto">${sentPill(c.sentiment)}</div></div>
      <div class="cc-chans">${c.channels.map((ch) => chanChip(ch.platform)).join("") || '<span class="muted small">No channel</span>'}</div>
      <div class="cc-stats">
        <div><div class="n">${c.counts.chats}</div><div class="l">Chats</div></div>
        <div><div class="n">${c.counts.calls}</div><div class="l">Calls</div></div>
        <div><div class="n">${c.counts.projects}</div><div class="l">Projects</div></div>
        <div><div class="n">${c.counts.docs}</div><div class="l">Docs</div></div>
      </div>
      <div class="cc-foot">
        <div class="cc-owner">${c.owner ? avBox(c.owner) + esc(c.owner) : '<span class="muted">Unassigned</span>'}</div>
        <span class="mono" style="font-size:11px;color:var(--muted-2)">${c.status}</span></div>
    </div>`;
  }

  function renderGrid() {
    const list = clients.filter((c) => chanFilter === "all" || c.channels.some((ch) => ch.platform === chanFilter));
    const grid = document.getElementById("grid");
    grid.innerHTML = list.length ? list.map(card).join("")
      : '<div class="empty" style="grid-column:1/-1"><span class="em-ico">👥</span>No clients on this channel.</div>';
    document.querySelectorAll(".client-card").forEach((el) =>
      el.addEventListener("click", () => openDrawer(parseInt(el.dataset.id))));
  }

  async function load() { clients = await Api.get("/api/overview/clients"); renderGrid(); }

  // ---- drawer ----
  async function openDrawer(id) {
    const c = clients.find((x) => x.id === id);
    const dr = document.getElementById("drawer");
    dr.innerHTML = '<div class="dr-body"><div class="muted">Loading…</div></div>';
    document.getElementById("scrim").classList.add("show");
    dr.classList.add("show");
    let projects = [], acts = [];
    try { [projects, acts] = await Promise.all([
      Api.get(`/api/projects?client_id=${id}`).catch(() => []),
      Api.get(`/api/activities?client_id=${id}`).catch(() => []),
    ]); } catch (e) { /* best effort */ }

    dr.innerHTML = `
      <div class="dr-head">${avBox(c.name)}<div><h3>${esc(c.name)}</h3><div class="co">${esc(c.company || "—")}</div></div>
        <button class="dr-close" id="drClose">✕</button></div>
      <div class="dr-body">
        <div class="dr-sec"><div style="display:flex;gap:8px;flex-wrap:wrap">
          ${c.channels.map((ch) => chanChip(ch.platform)).join("")}${sentPill(c.sentiment)}</div></div>
        <div class="dr-sec"><div class="h">Client details</div>
          <div class="info-row"><span class="k">Email</span><span class="v">${esc(c.email || "—")}</span></div>
          <div class="info-row"><span class="k">Phone</span><span class="v">${esc(c.phone || "—")}</span></div>
          <div class="info-row"><span class="k">Status</span><span class="v">${esc(c.status)}</span></div>
          <div class="info-row"><span class="k">Assigned to</span><span class="v">${esc(c.owner || "Unassigned")}</span></div>
          <div class="info-row"><span class="k">Client since</span><span class="v">${fmtDay(c.since)}</span></div>
        </div>
        <div class="dr-sec"><div class="h">At a glance</div><div class="grid g-2" style="gap:10px">
          ${[["Conversations", c.counts.chats], ["Call recordings", c.counts.calls], ["Projects", c.counts.projects], ["Documents", c.counts.docs]]
            .map(([l, n]) => `<div class="card card-pad" style="padding:13px">
              <div style="font-family:var(--display);font-size:20px;font-weight:600">${n}</div>
              <div style="font-size:11px;color:var(--muted-2)">${l}</div></div>`).join("")}
        </div></div>
        <div class="dr-sec"><div class="h">Related projects</div>
          ${projects.length ? projects.map((p) => `<div class="card card-pad" style="padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
            <div style="flex:1"><div style="font-weight:600;font-size:12.5px">${esc(p.title)}</div>
              <div class="mono" style="font-size:10.5px;color:var(--muted-2)">${p.bitrix_project_id ? "#" + esc(p.bitrix_project_id) : ""}</div></div>
            <span class="chip">${esc(p.status || "—")}</span></div>`).join("")
            : '<div class="muted small">No linked projects.</div>'}
        </div>
        <div class="dr-sec"><div class="h">Activity timeline</div><div class="log">
          ${acts.length ? acts.slice(0, 6).map((a) => `<div class="log-item"><span class="ld"></span>
            <div class="lt">${esc(a.action.replace(/[._]/g, " "))}</div>
            <div class="lm">${fmtDate(a.created_at)}</div></div>`).join("")
            : '<div class="log-item"><span class="ld"></span><div class="lt muted">No activity yet.</div></div>'}
        </div></div>
        <div class="d-flex gap-2 mt-2">
          <a class="btn btn-primary flex-fill" href="/chat?id=${c.id}">💬 Conversations</a>
          <a class="btn btn-soft flex-fill" href="/client?id=${c.id}">👤 View profile</a>
        </div>
        <div class="d-flex gap-2 mt-2">
          ${canWrite() ? `<button class="btn btn-light flex-fill" id="dr-edit">✎ Edit client</button>` : ""}
          ${isAdmin() ? `<button class="btn btn-outline-danger flex-fill" id="dr-delete">🗑 Delete</button>` : ""}
        </div>
      </div>`;
    dr.querySelector("#drClose").onclick = closeDrawer;

    const editBtn = dr.querySelector("#dr-edit");
    if (editBtn) editBtn.onclick = async () => {
      try {
        const full = await Api.get(`/api/clients/${c.id}`);  // has assignees for the edit form
        ClientEditModal.open(full, async () => { closeDrawer(); await load(); });
      } catch (e) { toast(e.message); }
    };
    const delBtn = dr.querySelector("#dr-delete");
    if (delBtn) delBtn.onclick = async () => {
      if (!(await confirmDialog(
        `This permanently removes ${c.name} along with their conversations, files, audio and history. This can't be undone.`,
        { title: `Delete ${c.name}?`, confirmText: "Delete client" }))) return;
      try {
        await Api.del(`/api/clients/${c.id}`);
        closeDrawer(); await load();
        toast("Client deleted", "success");
      } catch (e) { toast(e.message); }
    };
  }
  function closeDrawer() {
    document.getElementById("scrim").classList.remove("show");
    document.getElementById("drawer").classList.remove("show");
  }
  document.getElementById("scrim").addEventListener("click", closeDrawer);

  // ---- create modal ----
  async function loadOptions() {
    try {
      const [users, channels] = await Promise.all([
        Api.get("/api/users").catch(() => ({ items: [] })),
        Api.get("/api/channels").catch(() => []),
      ]);
      const ulist = users.items || users;
      // Channel: single-select dropdown (required).
      document.getElementById("c-channel").innerHTML = '<option value="">Select a channel…</option>' +
        channels.map((ch) => `<option value="${ch.id}">${esc(ch.name)} · ${platformName(ch.platform)}</option>`).join("");
      // Assignees: matching checkbox dropdown, current user pre-checked + tagged "You".
      const menu = document.getElementById("c-assignees-menu");
      menu.innerHTML = ulist.length
        ? ulist.map((u) => {
            const me = u.id === CURRENT_USER.id;
            return `<label class="dropdown-item d-flex align-items-center gap-2" style="cursor:pointer">
              <input type="checkbox" class="form-check-input m-0" value="${u.id}" data-name="${esc(u.name)}" ${me ? "checked" : ""}>
              <span>${esc(u.name)}</span><span class="muted small">· ${u.role.replace("_", " ")}</span>
              ${me ? '<span class="me-tag ms-auto">You</span>' : ""}</label>`;
          }).join("")
        : '<div class="muted small px-2 py-1">No team members.</div>';
      menu.querySelectorAll("input").forEach((cb) => cb.addEventListener("change", updateAssigneeLabel));
      updateAssigneeLabel();

      // Inline Channel Creation Toggle
      const addChanBtn = document.getElementById("c-add-chan-btn");
      const chanWrap = document.getElementById("c-new-chan-wrap");
      const chanNameInput = document.getElementById("c-new-chan-name");
      const chanPlatSelect = document.getElementById("c-new-chan-platform");
      const cancelChanBtn = document.getElementById("c-new-chan-cancel");
      const saveChanBtn = document.getElementById("c-new-chan-save");

      if (addChanBtn) {
        addChanBtn.onclick = (e) => {
          e.preventDefault();
          chanWrap.classList.toggle("d-none");
          chanNameInput.focus();
        };
      }
      if (cancelChanBtn) {
        cancelChanBtn.onclick = () => {
          chanWrap.classList.add("d-none");
          chanNameInput.value = "";
        };
      }
      if (saveChanBtn) {
        saveChanBtn.onclick = async () => {
          const name = chanNameInput.value.trim();
          const platform = chanPlatSelect.value;
          if (!name) return toast("Channel Name is required");
          try {
            const ch = await Api.post("/api/channels", { name, platform, config: {} });
            const opt = document.createElement("option");
            opt.value = ch.id;
            opt.textContent = `${ch.name} · ${platformName(ch.platform)}`;
            opt.selected = true;
            document.getElementById("c-channel").appendChild(opt);
            chanWrap.classList.add("d-none");
            chanNameInput.value = "";
            toast("Channel created", "success");
          } catch (e) {
            toast(e.message);
          }
        };
      }

      // Reliable open/close (manual toggle — avoids Bootstrap dropdown quirks in modals).
      const aBtn = document.getElementById("c-assignees-btn");
      aBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("show"); };
      menu.onclick = (e) => e.stopPropagation();  // keep open while ticking boxes
      document.addEventListener("click", () => menu.classList.remove("show"));
    } catch (e) { /* optional */ }
  }
  function updateAssigneeLabel() {
    const sel = [...document.querySelectorAll("#c-assignees-menu input:checked")];
    const btn = document.getElementById("c-assignees-btn");
    btn.textContent = !sel.length ? "Select team members…"
      : sel.length === 1 ? sel[0].dataset.name
      : `${sel.length} assignees selected`;
    btn.classList.toggle("text-muted", sel.length === 0);
  }
  const checkedAssignees = () => [...document.querySelectorAll("#c-assignees-menu input:checked")].map((i) => parseInt(i.value));
  const pickedChannels = () => {
    const v = document.getElementById("c-channel").value;
    return v ? [parseInt(v)] : [];
  };

  document.getElementById("save-client").addEventListener("click", async () => {
    const name = document.getElementById("c-name").value.trim();
    const channelIds = pickedChannels();
    if (!name) return toast("Name is required");
    if (!channelIds.length) return toast("Select a channel");
    try {
      const created = await Api.post("/api/clients", {
        name, company: document.getElementById("c-company").value.trim() || null,
        email: document.getElementById("c-email").value.trim() || null,
        phone: document.getElementById("c-phone").value.trim() || null,
        notes: document.getElementById("c-notes").value.trim() || null,
        assignee_ids: checkedAssignees(), channel_ids: channelIds,
      });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("clientModal")).hide();
      toast("Client created — opening conversation…", "success");
      // Land straight in the conversation so there's no separate step to start chatting.
      location.href = "/chat?id=" + created.id;
    } catch (e) { toast(e.message); }
  });

  renderFilter();
  await loadOptions();
  await load();
})();
