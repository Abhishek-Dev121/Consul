(async function () {
  await renderLayout("/activity", "Activity Log", { crumb: "Audit trail of every action" });
  let page = 1;
  const pageSize = 10;
  let actsList = [];
  let userNames = {};
  let clientNames = {};

  function renderLogs() {
    const totalPages = Math.ceil(actsList.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    const paginated = actsList.slice((page - 1) * pageSize, page * pageSize);

    const itemsHtml = paginated.length ? paginated.map((a) => {
      const who = a.actor_id ? (userNames[a.actor_id] || "User") : "System";
      return `<div class="log-item"><span class="ld" style="${a.actor_id ? "" : "background:#6366F1"}"></span>
        <div class="lt"><b>${esc(who)}</b> ${esc(humanizeActivity(a.action, a.detail))}${a.client_id ? ` · <b>${esc(clientNames[a.client_id] || "client")}</b>` : ""}</div>
        <div class="lm">${timeAgo(a.created_at)}</div></div>`;
    }).join("") : '<div class="empty"><span class="em-ico">📜</span>No activity recorded yet.</div>';

    let pagerHtml = "";
    if (actsList.length > pageSize) {
      pagerHtml = `
        <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
          <span class="muted small">Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, actsList.length)} of ${actsList.length} actions</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-soft" id="log-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
            <button class="btn btn-sm btn-soft" id="log-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
          </div>
        </div>`;
    }

    document.getElementById("view").innerHTML = `
      <div class="page-head"><div><h2>Activity Log</h2>
        <p>Immutable audit trail of every action taken across the workspace.</p></div></div>
      <div class="card card-pad">
        <div class="log" style="margin-bottom: 12px;">${itemsHtml}</div>
        ${pagerHtml}
      </div>`;

    const prevBtn = document.getElementById("log-prev");
    const nextBtn = document.getElementById("log-next");
    if (prevBtn) prevBtn.addEventListener("click", () => { page--; renderLogs(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { page++; renderLogs(); });
  }

  try {
    const [acts, usersResp, clients] = await Promise.all([
      Api.get("/api/activities?limit=200"),
      Api.get("/api/users?limit=200").catch(() => ({ items: [] })),
      Api.get("/api/overview/clients").catch(() => []),
    ]);
    actsList = acts;
    const users = usersResp.items || usersResp;
    userNames = Object.fromEntries(users.map((u) => [u.id, u.name]));
    clientNames = Object.fromEntries(clients.map((c) => [c.id, c.name]));
    renderLogs();
  } catch (e) { toast(e.message); }
})();
