(async function () {
  await renderLayout("/activity", "Activity Log", { crumb: "Audit trail of every action" });
  try {
    const [acts, usersResp, clients] = await Promise.all([
      Api.get("/api/activities?limit=200"),
      Api.get("/api/users?limit=200").catch(() => ({ items: [] })),
      Api.get("/api/overview/clients").catch(() => []),
    ]);
    const users = usersResp.items || usersResp;
    const uname = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const cname = Object.fromEntries(clients.map((c) => [c.id, c.name]));

    const items = acts.length ? acts.map((a) => {
      const who = a.actor_id ? (uname[a.actor_id] || "User") : "System";
      return `<div class="log-item"><span class="ld" style="${a.actor_id ? "" : "background:#6366F1"}"></span>
        <div class="lt"><b>${esc(who)}</b> ${esc(humanizeActivity(a.action, a.detail))}${a.client_id ? ` · <b>${esc(cname[a.client_id] || "client")}</b>` : ""}</div>
        <div class="lm">${timeAgo(a.created_at)}</div></div>`;
    }).join("") : `<div class="empty"><span class="em-ico">${Icon("scroll", { size: 26 })}</span>No activity recorded yet.</div>`;

    document.getElementById("view").innerHTML = `
      <div class="page-head"><div><h2>Activity Log</h2>
        <p>Immutable audit trail of every action taken across the workspace.</p></div></div>
      <div class="card card-pad"><div class="log">${items}</div></div>`;
  } catch (e) { toast(e.message); }
})();
