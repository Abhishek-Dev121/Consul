(async function () {
  await renderLayout("/projects", "Projects", { crumb: "Linked Bitrix24 projects", hideSearch: true });
  const DONE = ["done", "completed", "complete", "closed", "won", "5"];

  const isDone = (p) => DONE.includes((p.status || "").toLowerCase());

  function doneCount(p) {
    return p.tasks.filter((t) => DONE.includes((t.status || "").toLowerCase())).length;
  }
  function progressOf(p) {
    if (!p.tasks.length) return 0;
    return Math.round((doneCount(p) / p.tasks.length) * 100);
  }

  function statusPill(s) {
    const v = (s || "").toLowerCase();
    if (DONE.some((d) => v.includes(d))) return `<span class="st st-done"><span class="sd"></span>${esc(s || "Done")}</span>`;
    if (v.includes("hold") || v.includes("pause")) return `<span class="st st-hold"><span class="sd"></span>${esc(s)}</span>`;
    return `<span class="st st-active"><span class="sd"></span>${esc(s || "Active")}</span>`;
  }

  function ownerCell(p) {
    const owner = (p.members || []).find((m) => m.role === "owner") || (p.members || [])[0];
    if (!owner) return '<span class="muted">—</span>';
    return `<div class="pj-owner">
      ${avBox(owner.name)}
      <div class="who">
        <div class="nm" title="${esc(owner.name)}">${esc(owner.name)}</div>
        ${owner.work_position ? `<div class="pos" title="${esc(owner.work_position)}">${esc(owner.work_position)}</div>` : ""}
      </div>
    </div>`;
  }

  function clientCell(p) {
    if (p.client_id && clientNames[p.client_id]) {
      return `<div class="pj-client" title="${esc(clientNames[p.client_id])}">${esc(clientNames[p.client_id])}</div>`;
    }
    // A Bitrix group with no local client is *unlinked*, which is a real state —
    // not the same as "this project has no client", which "—" implied.
    return `<span class="pj-unlinked" title="This Bitrix workgroup is not linked to a client in Consul">${Icon("link", { size: 11 })} Not linked</span>`;
  }

  function tasksCell(p) {
    // `tasks: []` on an unsynced group means "never fetched", not "zero tasks".
    if (!p.synced) return `<span class="pj-nosync" title="Sync this project from the Bitrix24 page to load its tasks">Not synced</span>`;
    if (!p.tasks.length) return `<span class="pj-nosync">No tasks</span>`;
    const pct = progressOf(p);
    return `<div class="pj-tasks" title="${doneCount(p)} of ${p.tasks.length} tasks complete">
      <div class="pbar"><div class="${pct >= 100 ? "done" : ""}" style="width:${pct}%"></div></div>
      <span class="n">${doneCount(p)}/${p.tasks.length}</span>
    </div>`;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let page = 1;
  let pageSize = 15;
  let statusFilter = "active";       // active | inactive | all
  let syncFilter = "all";            // all | synced | unsynced
  let searchQ = "";
  let projectsList = [];
  let clientNames = {};

  function visible() {
    const q = searchQ.trim().toLowerCase();
    return projectsList.filter((p) => {
      if (statusFilter === "active" && isDone(p)) return false;
      if (statusFilter === "inactive" && !isDone(p)) return false;
      if (syncFilter === "synced" && !p.synced) return false;
      if (syncFilter === "unsynced" && p.synced) return false;
      if (!q) return true;
      const owner = (p.members || []).find((m) => m.role === "owner");
      // Ids are displayed as "#52" but stored as "52", so accept either form.
      const idQ = q.startsWith("#") ? q.slice(1) : q;
      return (p.title || "").toLowerCase().includes(q)
        || (!!idQ && (p.bitrix_project_id || "").toLowerCase().includes(idQ))
        || (owner && owner.name.toLowerCase().includes(q))
        || (clientNames[p.client_id] || "").toLowerCase().includes(q);
    });
  }

  function toolbar(list) {
    const seg = (v, label) => `<button type="button" class="pill ${statusFilter === v ? "active" : ""}" data-status="${v}">${label}</button>`;
    return `<div class="page-toolbar chan-toolbar">
      <div class="tb-field">
        <span class="fi">${Icon("search", { size: 15 })}</span>
        <input class="form-control" id="pj-search" type="search" autocomplete="off"
               placeholder="Search project, owner, client or #id…" value="${esc(searchQ)}" aria-label="Search projects" />
      </div>
      <div class="tb-divider"></div>
      <span class="tb-label">Status</span>
      <div class="seg" id="status-filter">${seg("all", "All")}${seg("active", "Active")}${seg("inactive", "Inactive")}</div>
      <div class="tb-divider"></div>
      <select class="form-select tb-select" id="sync-filter" style="flex:0 1 165px" aria-label="Filter by sync state">
        <option value="all"${syncFilter === "all" ? " selected" : ""}>All projects</option>
        <option value="synced"${syncFilter === "synced" ? " selected" : ""}>Synced only</option>
        <option value="unsynced"${syncFilter === "unsynced" ? " selected" : ""}>Not synced</option>
      </select>
      <span class="tb-count">${list.length} of ${projectsList.length} projects</span>
    </div>`;
  }

  function render() {
    const list = visible();
    const totalPages = Math.ceil(list.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    const rows = list.slice((page - 1) * pageSize, page * pageSize);

    const body = rows.length ? rows.map((p) => `<tr>
        <td>
          <div class="pj-title" title="${esc(p.title)}">${esc(p.title)}</div>
          <div class="pj-id">${p.bitrix_project_id ? "#" + esc(p.bitrix_project_id) : "—"}</div>
        </td>
        <td>${clientCell(p)}</td>
        <td>${statusPill(p.status)}</td>
        <td>${ownerCell(p)}</td>
        <td>${tasksCell(p)}</td>
      </tr>`).join("")
      : `<tr><td colspan="5"><div class="empty"><span class="em-ico">${Icon("folder", { size: 24 })}</span>
          ${searchQ.trim() ? `No project matches “${esc(searchQ)}”.` : "No projects match these filters."}</div></td></tr>`;

    const pager = list.length > pageSize ? `<div class="pager">
        <span class="pg-info">Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.length)} of ${list.length}</span>
        <div class="pg-nav">
          <button class="btn btn-sm btn-soft" id="prev-page" ${page <= 1 ? "disabled" : ""}>← Prev</button>
          <span class="pg-page">Page ${page} / ${totalPages}</span>
          <button class="btn btn-sm btn-soft" id="next-page" ${page >= totalPages ? "disabled" : ""}>Next →</button>
        </div>
      </div>` : "";

    document.getElementById("view").innerHTML = `
      ${toolbar(list)}
      <div class="card">
        <table class="table projects-table">
          <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Owner</th><th>Tasks</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
        ${pager}
      </div>`;

    wire();
  }

  function wire() {
    const s = document.getElementById("pj-search");
    if (s) s.addEventListener("input", (e) => {
      searchQ = e.target.value; page = 1; render();
      // Re-rendering replaces the input — restore focus and caret.
      const el = document.getElementById("pj-search");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });

    document.querySelectorAll("#status-filter .pill").forEach((el) =>
      el.addEventListener("click", () => { statusFilter = el.dataset.status; page = 1; render(); }));

    const sf = document.getElementById("sync-filter");
    if (sf) sf.addEventListener("change", (e) => { syncFilter = e.target.value; page = 1; render(); });

    const prev = document.getElementById("prev-page");
    const next = document.getElementById("next-page");
    if (prev) prev.addEventListener("click", () => { page--; render(); });
    if (next) next.addEventListener("click", () => { page++; render(); });
  }

  try {
    const [projects, clients] = await Promise.all([
      Api.get("/api/projects"),
      Api.get("/api/overview/clients").catch(() => []),
    ]);
    clientNames = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    projectsList = projects;
    render();
  } catch (e) {
    toast(e.message);
    document.getElementById("view").innerHTML =
      `<div class="empty"><span class="em-ico">${Icon("alert", { size: 26 })}</span>Couldn't load projects — ${esc(e.message || "unknown error")}</div>`;
  }
})();
