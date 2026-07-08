(async function () {
  const channelId = parseInt(qs("id"));
  if (!channelId) { location.href = "/channels"; return; }
  await renderLayout("/channels", "Channel", { crumb: "Channels" });
  const writable = canWrite();

  let channel = null, clients = [];

  function setTitle(t) { const h = document.querySelector("#app-topbar .page-h"); if (h) h.textContent = t; }

  async function load() {
    const [channels, list] = await Promise.all([
      Api.get("/api/channels"),
      Api.get(`/api/clients?channel_id=${channelId}`),
    ]);
    channel = channels.find((c) => c.id === channelId);
    clients = list;
    if (!channel) { toast("Channel not found"); return; }
    setTitle(channel.name);
    renderSummary();
    render(clients);
  }

  function renderSummary() {
    const m = platformMeta(channel.platform);
    const assignees = new Set();
    clients.forEach((c) => c.assignees.forEach((a) => assignees.add(a.id)));
    document.getElementById("summary").innerHTML = `
      <div class="col-md-4"><div class="card"><div class="stat">
        <div class="stat-ico ${m.tint}">${m.icon}</div>
        <div><div class="stat-val" style="font-size:1.1rem">${esc(channel.name)}</div>
          <div class="stat-label text-capitalize">${esc(channel.platform)} channel</div></div></div></div></div>
      <div class="col-md-4"><div class="card"><div class="stat">
        <div class="stat-ico tint-blue">👥</div>
        <div><div class="stat-val">${clients.length}</div><div class="stat-label">Clients</div></div></div></div></div>
      <div class="col-md-4"><div class="card"><div class="stat">
        <div class="stat-ico tint-violet">🧑‍💼</div>
        <div><div class="stat-val">${assignees.size}</div><div class="stat-label">Team members involved</div></div></div></div></div>`;
  }

  function render(list) {
    const rows = document.getElementById("rows");
    if (!list.length) {
      rows.innerHTML = '<tr><td colspan="5"><div class="empty"><span class="em-ico">👥</span>No clients on this channel yet.</div></td></tr>';
      return;
    }
    rows.innerHTML = list.map((c) => `<tr>
      <td onclick="location.href='/conversations?client=${c.id}'"><div class="d-flex align-items-center gap-2">
        <span class="avatar-sm">${initials(c.name)}</span><strong>${esc(c.name)}</strong></div></td>
      <td onclick="location.href='/conversations?client=${c.id}'">${esc(c.company || "—")}</td>
      <td class="muted" onclick="location.href='/conversations?client=${c.id}'">${esc(c.email || "—")}</td>
      <td class="small muted" onclick="location.href='/conversations?client=${c.id}'">${c.assignees.map((a) => esc(a.name)).join(", ") || "—"}</td>
      <td class="text-end"><a class="btn btn-sm btn-primary" href="/conversations?client=${c.id}">💬 View conversations</a></td>
    </tr>`).join("");
  }

  document.getElementById("search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    render(clients.filter((c) => (c.name + " " + (c.company || "") + " " + (c.email || "")).toLowerCase().includes(q)));
  });

  // Add client to this channel
  const addBtn = document.getElementById("add-client");
  if (writable) {
    addBtn.style.display = "";
    addBtn.addEventListener("click", () => new bootstrap.Modal(document.getElementById("clientModal")).show());
  }
  document.getElementById("save-client").addEventListener("click", async () => {
    const name = document.getElementById("cl-name").value.trim();
    if (!name) return toast("Name is required");
    try {
      await Api.post("/api/clients", {
        name,
        company: document.getElementById("cl-company").value.trim() || null,
        email: document.getElementById("cl-email").value.trim() || null,
        phone: document.getElementById("cl-phone").value.trim() || null,
        channel_ids: [channelId],
      });
      ["cl-name", "cl-company", "cl-email", "cl-phone"].forEach((i) => (document.getElementById(i).value = ""));
      bootstrap.Modal.getOrCreateInstance(document.getElementById("clientModal")).hide();
      await load();
      toast("Client added", "success");
    } catch (e) { toast(e.message); }
  });

  await load();
})();
