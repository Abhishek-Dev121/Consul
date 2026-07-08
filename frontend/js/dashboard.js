(async function () {
  const actions = `<a class="btn btn-light" href="/clients">+ New client</a>
    <a class="btn btn-primary" href="/conversations">⬆ Upload conversation</a>`;
  await renderLayout("/dashboard", "Dashboard", { crumb: "Overview of everything across clients", actions });

  function kpi(icon, label, val, sub, dir, href) {
    return `<a class="kpi" href="${href}"><div class="top"><span>${label}</span><span class="ic">${icon}</span></div>
      <div class="val">${val}</div>
      ${sub ? `<span class="delta ${dir || ""}">${dir === "up" ? "▲ " : dir === "down" ? "▼ " : ""}${sub}</span>` : ""}</a>`;
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  try {
    const d = await Api.get("/api/dashboard/overview");
    const k = d.kpis;
    const tot = d.sentiment.pos + d.sentiment.neu + d.sentiment.neg || 1;
    const pc = (n) => Math.round((n / tot) * 100);
    const maxVol = Math.max(1, ...d.channel_volume.map((v) => v.count));

    const view = `
      <div class="page-head"><div><h2>${greeting()}, ${esc(CURRENT_USER.name)} 👋</h2>
        <p>Here's what's happening across your clients.${k.at_risk ? ` <strong>${k.at_risk}</strong> account${k.at_risk === 1 ? "" : "s"} need attention.` : " Everything looks healthy."}</p></div></div>

      <div class="grid g-4" style="margin-bottom:16px">
        ${kpi("👥", "Active clients", k.clients, "View clients", "", "/clients")}
        ${kpi("💬", "Conversations", k.conversations, "View inbox", "", "/conversations")}
        ${kpi("📞", "Calls analyzed", k.calls, "Call recordings", "", "/calls")}
        ${kpi("⚑", "At-risk accounts", k.at_risk, k.at_risk ? "Needs attention" : "All healthy", k.at_risk ? "down" : "", "/conversations")}
      </div>

      <div class="grid" style="grid-template-columns:1.6fr 1fr;align-items:start">
        <div class="card">
          <div class="card-h"><h3>Conversations needing attention</h3><a class="link" href="/conversations">View all</a></div>
          ${d.attention.length ? `<table class="table"><thead><tr><th>Client</th><th>Channel</th><th>Sentiment</th><th>Last activity</th></tr></thead><tbody>
          ${d.attention.map((c) => `<tr class="row-link" onclick="location.href='/conversations?client=${c.client_id}'">
            <td><div class="t-name">${avBox(c.client)}<div><div class="nm">${esc(c.client)}</div><div class="sm">${esc(c.title)}</div></div></div></td>
            <td>${chanChip(c.platform)}</td><td>${sentPill(c.sentiment)}</td>
            <td class="small muted">${timeAgo(c.time)}</td></tr>`).join("")}
          </tbody></table>` : '<div class="empty"><span class="em-ico">🎉</span>All caught up — no conversations need attention.</div>'}
        </div>

        <div class="card card-pad">
          <h3 style="font-family:var(--display);font-size:14.5px;font-weight:600;margin-bottom:4px">Sentiment overview</h3>
          <p style="font-size:11.5px;color:var(--muted-2);margin-bottom:14px">Across all analyzed conversations</p>
          <div class="sent-bar">
            <span style="width:${pc(d.sentiment.pos)}%;background:var(--pos)"></span>
            <span style="width:${pc(d.sentiment.neu)}%;background:var(--neu)"></span>
            <span style="width:${pc(d.sentiment.neg)}%;background:var(--neg)"></span>
          </div>
          <div class="legend">
            <div><span class="ld" style="background:var(--pos)"></span>Positive · ${pc(d.sentiment.pos)}%</div>
            <div><span class="ld" style="background:var(--neu)"></span>Neutral · ${pc(d.sentiment.neu)}%</div>
            <div><span class="ld" style="background:var(--neg)"></span>Negative · ${pc(d.sentiment.neg)}%</div>
          </div>
          <div style="height:1px;background:var(--line-2);margin:18px 0"></div>
          <h3 style="font-family:var(--display);font-size:14.5px;font-weight:600;margin-bottom:12px">Channel volume</h3>
          ${d.channel_volume.length ? d.channel_volume.map((v) => `<div class="vol-row">
            <span class="vn">${platformName(v.platform)}</span>
            <div class="vt"><div style="width:${Math.round((v.count / maxVol) * 100)}%;background:${chanColor(v.platform)}"></div></div>
            <span class="vp">${v.count}</span></div>`).join("") : '<p class="muted small">No channel data yet.</p>'}
        </div>
      </div>

      <div class="grid" style="grid-template-columns:1fr 1.4fr;margin-top:16px;align-items:start">
        <div class="card">
          <div class="card-h"><h3>Recent activity</h3><a class="link" href="/activity">Full log</a></div>
          <div class="card-pad"><div class="log">
            ${d.recent_activity.length ? d.recent_activity.map((a) => `<div class="log-item">
              <span class="ld" style="${a.actor === "System" ? "background:#6366F1" : ""}"></span>
              <div class="lt"><b>${esc(a.actor)}</b> ${esc(humanizeActivity(a.action, a.detail))}${a.client ? ` · <b>${esc(a.client)}</b>` : ""}</div>
              <div class="lm">${timeAgo(a.time)}</div></div>`).join("")
              : '<p class="muted small">No activity yet.</p>'}
          </div></div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Projects in flight</h3><a class="link" href="/projects">All projects</a></div>
          ${d.projects_in_flight.length ? `<table class="table"><thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Progress</th></tr></thead><tbody>
          ${d.projects_in_flight.map((p) => `<tr>
            <td><div class="nm" style="font-weight:550">${esc(p.title)}</div><div class="sm mono" style="font-size:11px;color:var(--muted-2)">${p.bitrix_id ? "#" + esc(p.bitrix_id) : ""}</div></td>
            <td style="color:var(--muted)">${esc(p.client)}</td><td><span class="chip">${esc(p.status)}</span></td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="pbar"><div style="width:${p.progress}%"></div></div>
              <span class="mono" style="font-size:11px;color:var(--muted)">${p.progress}%</span></div></td></tr>`).join("")}
          </tbody></table>` : '<div class="empty"><span class="em-ico">📁</span>No projects yet — sync from Bitrix24.</div>'}
        </div>
      </div>`;
    document.getElementById("view").innerHTML = view;
  } catch (e) { toast(e.message); document.getElementById("view").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
})();
