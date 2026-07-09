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

  try {
    const [projects, clients] = await Promise.all([
      Api.get("/api/projects"),
      Api.get("/api/overview/clients").catch(() => []),
    ]);
    const cname = Object.fromEntries(clients.map((c) => [c.id, c.name]));

    const rows = projects.length ? projects.map((p) => {
      const prog = progressOf(p);
      const done = p.tasks.filter((t) => DONE.includes((t.status || "").toLowerCase())).length;
      return `<tr>
        <td><div class="nm" style="font-weight:600">${esc(p.title)}</div>
          <div class="sm mono" style="font-size:11px;color:var(--muted-2)">${p.bitrix_project_id ? "#" + esc(p.bitrix_project_id) : "—"}</div></td>
        <td style="color:var(--muted)">${esc(cname[p.client_id] || "—")}</td>
        <td>${statusPill(p.status)}</td>
        <td>${ownerCell(p)}</td>
        <td class="mono" style="font-size:12px;color:var(--muted)">${done} / ${p.tasks.length}</td>
        <td class="mono" style="font-size:12px">${p.due_date ? fmtDate(p.due_date).split(",")[0] : "TBD"}</td>
        <td><div style="display:flex;align-items:center;gap:8px"><div class="pbar" style="min-width:60px">
          <div style="width:${prog}%;background:${prog === 100 ? "var(--pos)" : "var(--brand)"}"></div></div>
          <span class="mono" style="font-size:11px;color:var(--muted)">${prog}%</span></div></td></tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty"><span class="em-ico">${Icon('folder', { size: 24 })}</span>No projects yet. Connect Bitrix24 and sync from a client.</div></td></tr>`;

    document.getElementById("view").innerHTML = `
      <div class="page-head"><div><h2>Projects</h2>
        <p>Bitrix24 projects linked to clients. Tasks, deadlines and progress surface here.</p></div></div>
      <div class="card"><table class="table">
        <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Owner</th><th>Tasks</th><th>Due</th><th>Progress</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  } catch (e) { toast(e.message); }
})();
