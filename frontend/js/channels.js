(async function () {
  const actions = `<div class="d-flex gap-2">
    <button class="btn btn-soft" id="new-channel" data-bs-toggle="modal" data-bs-target="#channelModal">+ Channel</button>
    <button class="btn btn-primary" id="new-client" data-bs-toggle="modal" data-bs-target="#clientModal">+ Client</button>
  </div>`;
  await renderLayout("/channels", "Channel Management", { crumb: "Workspace", actions });
  const admin = isAdmin();
  if (!admin) { const b = document.getElementById("new-channel"); if (b) b.remove(); }
  if (!canWrite()) { const b = document.getElementById("new-client"); if (b) b.remove(); }

  const PLATFORMS = ["whatsapp", "upwork", "slack", "email", "telegram", "other"];
  let channels = [], allClients = [], users = [];
  let typeFilter = "all", userFilter = "", searchTerm = "";

  function contactsFor(id) { return allClients.filter((c) => c.channels.some((ch) => ch.id === id)); }

  async function loadData() {
    [channels, allClients, users] = await Promise.all([
      Api.get("/api/channels"),
      Api.get("/api/clients"),
      Api.get("/api/users").catch(() => []),
    ]);
  }

  // ---- Filters UI ----
  function renderFilters() {
    const types = ["all", ...PLATFORMS];
    document.getElementById("type-filter").innerHTML = types.map((t) =>
      `<span class="pill ${t === typeFilter ? "active" : ""}" data-t="${t}">${t}</span>`).join("");
    document.querySelectorAll("#type-filter .pill").forEach((el) =>
      el.addEventListener("click", () => { typeFilter = el.dataset.t; renderFilters(); renderGrid(); }));

    const uf = document.getElementById("user-filter");
    if (uf.options.length === 0) {
      uf.innerHTML = '<option value="">All users</option>' +
        users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
      uf.addEventListener("change", () => { userFilter = uf.value; renderGrid(); });
    }
  }

  // ---- Grid ----
  function renderGrid() {
    let list = channels.slice();
    if (typeFilter !== "all") list = list.filter((c) => c.platform === typeFilter);
    if (searchTerm) list = list.filter((c) => c.name.toLowerCase().includes(searchTerm));
    if (userFilter) {
      const uid = parseInt(userFilter);
      list = list.filter((c) => contactsFor(c.id).some((cl) => cl.assignees.some((a) => a.id === uid)));
    }
    const grid = document.getElementById("grid");
    if (!list.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="em-ico">📡</span>No channels match these filters.</div>';
      return;
    }
    grid.innerHTML = list.map((c) => {
      const m = platformMeta(c.platform);
      const count = contactsFor(c.id).length;
      return `<div class="chan-card" onclick="location.href='/channel?id=${c.id}'">
        <div class="chan-top">
          <div class="chan-ico ${m.tint}">${m.icon}</div>
          <span class="chip pf pf-${c.platform}">${esc(c.platform)}</span>
        </div>
        <div class="chan-name">${esc(c.name)}</div>
        <div class="chan-meta">${count} client${count === 1 ? "" : "s"}</div>
        <div class="chan-foot">
          <span class="muted small">Open channel →</span>
          ${admin ? `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation();delChannel(${c.id})">✕</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  document.getElementById("search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase(); renderGrid();
  });

  window.delChannel = async (id) => {
    if (!(await confirmDialog("Clients stay, but they'll lose this channel link.", { title: "Delete this channel?", confirmText: "Delete channel" }))) return;
    try { await Api.del(`/api/channels/${id}`); await loadData(); renderGrid(); } catch (e) { toast(e.message); }
  };

  // ---- Create channel ----
  document.getElementById("save-channel").addEventListener("click", async () => {
    const name = document.getElementById("ch-name").value.trim();
    if (!name) return toast("Channel name required");
    try {
      await Api.post("/api/channels", { name, platform: document.getElementById("ch-platform").value, config: {} });
      document.getElementById("ch-name").value = "";
      bootstrap.Modal.getOrCreateInstance(document.getElementById("channelModal")).hide();
      await loadData(); refreshClientChannelOptions(); renderGrid();
      toast("Channel created", "success");
    } catch (e) { toast(e.message); }
  });

  // ---- Create client (with channel assignment) ----
  function refreshClientChannelOptions() {
    document.getElementById("cl-channel").innerHTML =
      channels.map((c) => `<option value="${c.id}">${esc(c.name)} · ${c.platform}</option>`).join("");
    document.getElementById("cl-assignees").innerHTML =
      users.map((u) => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join("");
  }
  document.getElementById("save-client").addEventListener("click", async () => {
    const name = document.getElementById("cl-name").value.trim();
    const channelId = document.getElementById("cl-channel").value;
    if (!name) return toast("Client name required");
    if (!channelId) return toast("Please create a channel first, then assign the client");
    try {
      const created = await Api.post("/api/clients", {
        name,
        company: document.getElementById("cl-company").value.trim() || null,
        email: document.getElementById("cl-email").value.trim() || null,
        phone: document.getElementById("cl-phone").value.trim() || null,
        channel_ids: [parseInt(channelId)],
        assignee_ids: Array.from(document.getElementById("cl-assignees").selectedOptions).map((o) => parseInt(o.value)),
      });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("clientModal")).hide();
      toast("Client created — opening conversation…", "success");
      location.href = "/chat?id=" + created.id;
    } catch (e) { toast(e.message); }
  });

  // ---- Init ----
  await loadData();
  renderFilters();
  refreshClientChannelOptions();
  renderGrid();
})();
