(async function () {
  await renderLayout("/projects", "Projects", { crumb: "Linked Bitrix24 projects" });
  const DONE = ["done", "completed", "complete", "closed", "won", "5"];

  function progressOf(p) {
    if (!p.tasks.length) return 0;
    const done = p.tasks.filter((t) => DONE.includes((t.status || "").toLowerCase())).length;
    return Math.round((done / p.tasks.length) * 100);
  }
  function statusPill(s) {
    const v = (s || "").toLowerCase();
    if (DONE.some((d) => v.includes(d))) return `<span class="st st-done">${esc(s || "Done")}</span>`;
    if (v.includes("hold") || v.includes("pause")) return `<span class="st st-hold">${esc(s)}</span>`;
    if (v.includes("progress") || v.includes("active")) return `<span class="st st-progress">${esc(s)}</span>`;
    return `<span class="st st-active">${esc(s || "Active")}</span>`;
  }
  function ownerCell(p) {
    const owner = (p.members || []).find((m) => m.role === "owner");
    if (owner) {
      return `<div style="display:flex;align-items:center;gap:6px">${avBox(owner.name)} <span>${esc(owner.name)}</span></div>`;
    }
    return p.responsible ? `<span class="mono small muted">ID: ${esc(p.responsible)}</span>` : '<span class="muted">—</span>';
  }

  let page = 1;
  const pageSize = 10;
  let statusFilter = "active";
  let projectsList = [];
  let clientNames = {};

  function renderTable() {
    const filteredProjects = projectsList.filter((p) => {
      const s = (p.status || "").toLowerCase();
      const isDone = DONE.includes(s);
      if (statusFilter === "active") return !isDone;
      if (statusFilter === "inactive") return isDone;
      return true;
    });

    const totalPages = Math.ceil(filteredProjects.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    const paginated = filteredProjects.slice((page - 1) * pageSize, page * pageSize);

    const rowsHtml = paginated.length ? paginated.map((p) => {
      const done = p.tasks.filter((t) => DONE.includes((t.status || "").toLowerCase())).length;
      return `<tr>
        <td><div class="nm" style="font-weight:600">${esc(p.title)}</div>
          <div class="sm mono" style="font-size:11px;color:var(--muted-2)">${p.bitrix_project_id ? "#" + esc(p.bitrix_project_id) : "—"}</div></td>
        <td style="color:var(--muted)">${esc(clientNames[p.client_id] || "—")}</td>
        <td>${statusPill(p.status)}</td>
        <td>${ownerCell(p)}</td>
        <td class="mono" style="font-size:12px;color:var(--muted)">${done} / ${p.tasks.length}</td></tr>`;
    }).join("") : `<tr><td colspan="5"><div class="empty"><span class="em-ico">${Icon('folder', { size: 24 })}</span>No ${statusFilter === "all" ? "" : statusFilter + " "}projects found.</div></td></tr>`;

    let pagerHtml = "";
    if (filteredProjects.length > pageSize) {
      pagerHtml = `
        <div class="d-flex justify-content-between align-items-center mt-3 p-3 border-top">
          <span class="muted small">Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, filteredProjects.length)} of ${filteredProjects.length} projects</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-soft" id="prev-page" ${page <= 1 ? "disabled" : ""}>← Prev</button>
            <button class="btn btn-sm btn-soft" id="next-page" ${page >= totalPages ? "disabled" : ""}>Next →</button>
          </div>
        </div>`;
    }

    const filterbarHtml = `
      <div class="filterbar" style="margin-bottom: 16px; display: flex; align-items: center;">
        <span class="muted small fw-bold me-2">Status</span>
        <div class="seg" id="status-filter">
          <span class="pill ${statusFilter === "active" ? "active" : ""}" data-status="active" style="cursor: pointer;">Active</span>
          <span class="pill ${statusFilter === "inactive" ? "active" : ""}" data-status="inactive" style="cursor: pointer;">Inactive</span>
          <span class="pill ${statusFilter === "all" ? "active" : ""}" data-status="all" style="cursor: pointer;">All</span>
        </div>
      </div>`;

    document.getElementById("view").innerHTML = `
      <div class="page-head"><div><h2>Projects</h2>
        <p>Bitrix24 projects linked to clients. Tasks and status surface here.</p></div></div>
      ${filterbarHtml}
      <div class="card">
        <table class="table" style="margin-bottom: 0;">
          <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Owner</th><th>Tasks</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${pagerHtml}
      </div>`;

    document.querySelectorAll("#status-filter .pill").forEach((el) => {
      el.addEventListener("click", () => {
        statusFilter = el.dataset.status;
        page = 1;
        renderTable();
      });
    });

    const prevBtn = document.getElementById("prev-page");
    const nextBtn = document.getElementById("next-page");
    if (prevBtn) prevBtn.addEventListener("click", () => { page--; renderTable(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { page++; renderTable(); });
  }

  try {
    const [projects, clients] = await Promise.all([
      Api.get("/api/projects"),
      Api.get("/api/overview/clients").catch(() => []),
    ]);
    clientNames = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    projectsList = projects;
    renderTable();
  } catch (e) { toast(e.message); }
})();
