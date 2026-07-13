(async function () {
  await renderLayout("/dashboard", "Dashboard", {
    // crumb: "Overview of everything across clients",
    hideSearch: true,
    hideActions: true,
  });

  function kpi(icon, label, val, sub, dir, href, step = 0) {
    // Direction reads as an icon rather than a ▲/▼ glyph: it inherits the delta
    // colour and renders identically across platforms.
    const arrow = dir === "up" ? Icon("chevronDown", { size: 12, style: "transform:rotate(180deg)" })
      : dir === "down" ? Icon("chevronDown", { size: 12 }) : "";
    return `<a class="kpi reveal${step ? ` reveal-${step}` : ""}" href="${href}">
      <div class="top"><span>${label}</span><span class="ic">${icon}</span></div>
      <div class="val">${val}</div>
      ${sub ? `<span class="delta ${dir || ""}">${arrow}${sub}</span>` : ""}</a>`;
  }

  // One reading of the sentiment split: colour, share and the raw count behind it.
  // The tile is a button — clicking it reveals the conversations it counts.
  function sentStat(key, label, color, count, pct) {
    return `<button type="button" class="sent-stat" data-sent="${key}"
        aria-expanded="false" aria-controls="sent-drill"
        aria-label="${label}: ${pct} percent, ${count} conversation${count === 1 ? "" : "s"}. Show them.">
      <span class="caret" aria-hidden="true">${Icon("chevronDown", { size: 14 })}</span>
      <div class="lab"><span class="ld" style="background:${color}"></span>${label}</div>
      <div class="fig">
        <span class="pct" style="color:${color}">${pct}%</span>
        <span class="cnt">${count} conversation${count === 1 ? "" : "s"}</span>
      </div>
    </button>`;
  }

  const SENT_META = {
    pos: { label: "Positive", color: "var(--pos)" },
    neu: { label: "Neutral", color: "var(--neu)" },
    neg: { label: "Negative", color: "var(--neg)" },
  };

  // Render the conversations behind one sentiment reading.
  function sentDrill(key, rows) {
    const m = SENT_META[key];
    const head = `<div class="sd-head">
      <span class="dot" style="background:${m.color}"></span>
      <span><b>${rows.length}</b> ${m.label.toLowerCase()} conversation${rows.length === 1 ? "" : "s"}</span>
    </div>`;
    if (!rows.length) {
      return head + `<div class="sd-empty">No ${m.label.toLowerCase()} conversations yet.</div>`;
    }
    return head + `<div class="sd-list">${rows.map((c) => `
      <a class="sd-row" href="/conversations?client=${c.client_id}">
        ${avBox(c.client)}
        <div class="sd-body">
          <div class="sd-name">${esc(c.client)}</div>
          <div class="sd-title" title="${esc(c.title)}">${esc(c.title)}</div>
        </div>
        <div class="sd-meta">
          ${chanChip(c.platform)}
          <span class="sd-time">${timeAgo(c.time)}</span>
          <span class="go" aria-hidden="true">${Icon("chevronDown", { size: 14, style: "transform:rotate(-90deg)" })}</span>
        </div>
      </a>`).join("")}</div>`;
  }

  try {
    const d = await Api.get("/api/dashboard/overview");
    const k = d.kpis;
    const analyzed = d.sentiment.pos + d.sentiment.neu + d.sentiment.neg;
    // Guard the divisor only — `analyzed` itself must stay truthful (it can be 0).
    const pc = (n) => Math.round((n / (analyzed || 1)) * 100);
    const maxVol = Math.max(1, ...d.channel_volume.map((v) => v.count));

    const view = `
      <section class="dash-hero reveal">
        <div class="dh-copy">
          <span class="dh-eyebrow">${Icon("sparkles", { size: 12 })} Workspace overview</span>
          <h2>Dashboard overview</h2>
          <p>See client health, activity, and performance in one place.${k.at_risk ? ` <strong>${k.at_risk}</strong> account${k.at_risk === 1 ? "" : "s"} need attention.` : " Everything looks healthy."}</p>
          <div class="dh-cta">
            <a class="btn btn-primary" href="/conversations">${Icon("message", { size: 14 })} Open conversations</a>
            <a class="btn btn-light" href="/clients">${Icon("plus", { size: 14 })} New client</a>
          </div>
        </div>
        <div class="dh-orb float-slow" aria-hidden="true">${Icon("sparkles", { size: 42 })}</div>
      </section>

      <div class="grid g-4" style="margin-bottom:16px">
        ${kpi(Icon("users", { size: 18 }), "Active clients", k.clients, "View clients", "", "/clients")}
        ${kpi(Icon("message", { size: 18 }), "Conversations", k.conversations, "View inbox", "", "/conversations", 1)}
        ${kpi(Icon("phone", { size: 18 }), "Calls analyzed", k.calls, "Call recordings", "", "/calls", 2)}
        ${kpi(Icon("ban", { size: 18 }), "At-risk accounts", k.at_risk, k.at_risk ? "Needs attention" : "All healthy", k.at_risk ? "down" : "", "/conversations", 3)}
      </div>

      <section class="card sent-panel sect reveal">
        <div class="sent-head">
          <div>
            <h3>Sentiment overview</h3>
            <div class="sub"></div>
          </div>
          <div class="sent-total"><b>${analyzed}</b> conversation${analyzed === 1 ? "" : "s"} analyzed</div>
        </div>
        <div class="sent-bar">
          <span style="width:${pc(d.sentiment.pos)}%;background:var(--pos)"></span>
          <span style="width:${pc(d.sentiment.neu)}%;background:var(--neu)"></span>
          <span style="width:${pc(d.sentiment.neg)}%;background:var(--neg)"></span>
        </div>
        <div class="sent-stats">
          ${sentStat("pos", "Positive", "var(--pos)", d.sentiment.pos, pc(d.sentiment.pos))}
          ${sentStat("neu", "Neutral", "var(--neu)", d.sentiment.neu, pc(d.sentiment.neu))}
          ${sentStat("neg", "Negative", "var(--neg)", d.sentiment.neg, pc(d.sentiment.neg))}
        </div>
        <div class="sent-drill" id="sent-drill" hidden></div>
      </section>

      <section class="card card-pad sect reveal">
        <div class="sent-head" style="margin-bottom:14px">
          <div>
            <h3>Channel volume</h3>
            <div class="sub"></div>
          </div>
        </div>
        ${d.channel_volume.length ? `<div class="vol-grid">${d.channel_volume.map((v) => `<div class="vol-row">
          <span class="vn">${platformName(v.platform)}</span>
          <div class="vt"><div style="width:${Math.round((v.count / maxVol) * 100)}%;background:${chanColor(v.platform)}"></div></div>
          <span class="vp">${v.count}</span></div>`).join("")}</div>` : '<p class="muted small mb-0">No channel data yet.</p>'}
      </section>

      <section class="card sect reveal">
        <div class="card-h">
          <div class="h-left">
            <h3>Conversations needing attention</h3>
            ${d.attention.length
              ? `<span class="count-pill">${d.attention.length}</span>`
              : `<span class="count-pill calm">0</span>`}
          </div>
          <a class="link" href="/conversations">View all ${Icon("chevronDown", { size: 13, style: "transform:rotate(-90deg)" })}</a>
        </div>
        ${d.attention.length ? `<table class="table attn-table">
          <thead><tr>
            <th>Client</th><th>Channel</th><th>Sentiment</th><th class="col-time">Last activity</th>
          </tr></thead>
          <tbody>
          ${d.attention.map((c) => `<tr tabindex="0" role="link"
              aria-label="Open conversation with ${esc(c.client)}"
              data-href="/conversations?client=${c.client_id}">
            <td>
              <div class="t-name">
                ${avBox(c.client)}
                <div class="who">
                  <div class="nm" title="${esc(c.client)}">${esc(c.client)}</div>
                  <div class="sm" title="${esc(c.title)}">${esc(c.title)}</div>
                </div>
              </div>
            </td>
            <td>${chanChip(c.platform)}</td>
            <td>${sentPill(c.sentiment)}</td>
            <td class="col-time">
              <span class="time-cell">
                <span class="small muted" title="${esc(new Date(c.time).toLocaleString())}">${timeAgo(c.time)}</span>
                <span class="go" aria-hidden="true">${Icon("chevronDown", { size: 14, style: "transform:rotate(-90deg)" })}</span>
              </span>
            </td>
          </tr>`).join("")}
          </tbody></table>` : `<div class="empty"><span class="em-ico">${Icon("checkCircle", { size: 24 })}</span>All caught up — no conversations need attention.</div>`}
      </section>

      <div class="dash-split wide-right">
        <div class="card reveal">
          <div class="card-h">
            <div class="h-left">
              <h3>Recent activity</h3>
              ${d.recent_activity.length ? `<span class="count-pill calm">${d.recent_activity.length}</span>` : ""}
            </div>
            <a class="link" href="/activity">Full log ${Icon("chevronDown", { size: 13, style: "transform:rotate(-90deg)" })}</a>
          </div>
          <div class="card-pad">
            ${d.recent_activity.length ? `<div class="act-feed">${d.recent_activity.map((a) => {
              const m = activityMeta(a.action);
              return `<div class="act-item">
                <span class="act-ic ${m.tone}">${Icon(m.icon, { size: 15 })}</span>
                <div class="act-body">
                  <div class="act-text"><b>${esc(a.actor)}</b> ${esc(humanizeActivity(a.action, a.detail))}${a.client ? ` · <span class="act-client">${esc(a.client)}</span>` : ""}</div>
                  <div class="act-time" title="${a.time ? esc(new Date(a.time).toLocaleString()) : ""}">${timeAgo(a.time)}</div>
                </div>
              </div>`;
            }).join("")}</div>` : `<div class="empty"><span class="em-ico">${Icon("clock", { size: 24 })}</span>No activity yet.</div>`}
          </div>
        </div>

        <div class="card reveal reveal-1">
          <div class="card-h">
            <div class="h-left">
              <h3>Projects in flight</h3>
              ${d.projects_in_flight.length ? `<span class="count-pill calm">${d.projects_in_flight.length}</span>` : ""}
            </div>
            <a class="link" href="/projects">All projects ${Icon("chevronDown", { size: 13, style: "transform:rotate(-90deg)" })}</a>
          </div>
          ${d.projects_in_flight.length ? `<table class="table proj-table">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Progress</th></tr></thead>
            <tbody>
            ${d.projects_in_flight.map((p) => `<tr tabindex="0" role="link"
                aria-label="Open project ${esc(p.title)}" data-href="/projects">
              <td>
                <div class="proj-name" title="${esc(p.title)}">${esc(p.title)}</div>
                ${p.bitrix_id ? `<div class="proj-id">#${esc(p.bitrix_id)}</div>` : ""}
              </td>
              <td class="proj-client">${esc(p.client)}</td>
              <td>${statusPill(p.status)}</td>
              <td>
                <div class="proj-progress" title="${p.tasks} tasks complete">
                  <div class="pbar"><div class="${p.progress >= 100 ? "done" : ""}" style="width:${p.progress}%"></div></div>
                  <span class="ppct">${p.progress}%</span>
                </div>
              </td>
            </tr>`).join("")}
            </tbody></table>` : `<div class="empty"><span class="em-ico">${Icon("folder", { size: 24 })}</span>No projects yet — sync from Bitrix24.</div>`}
        </div>
      </div>`;
    const root = document.getElementById("view");
    root.innerHTML = view;

    // Rows navigate on click and on Enter/Space. Delegated off `data-href`
    // rather than an inline onclick, so the row is reachable by keyboard and
    // no markup is built from interpolated JS.
    const go = (row) => { if (row && row.dataset.href) location.href = row.dataset.href; };
    root.addEventListener("click", (e) => go(e.target.closest("tr[data-href]")));
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest("tr[data-href]");
      if (!row) return;
      e.preventDefault();   // stop Space from scrolling the page
      go(row);
    });

    // Sentiment tiles: click one to reveal the conversations it counts. Clicking
    // the open tile again closes it. `<button>` gives keyboard support for free.
    const drill = root.querySelector("#sent-drill");
    const tiles = [...root.querySelectorAll(".sent-stat")];
    const buckets = d.sentiment_conversations || { pos: [], neu: [], neg: [] };
    tiles.forEach((tile) => {
      tile.addEventListener("click", () => {
        const key = tile.dataset.sent;
        const wasOpen = tile.getAttribute("aria-expanded") === "true";
        tiles.forEach((t) => t.setAttribute("aria-expanded", "false"));
        if (wasOpen) { drill.hidden = true; drill.innerHTML = ""; return; }
        tile.setAttribute("aria-expanded", "true");
        drill.innerHTML = sentDrill(key, buckets[key] || []);
        drill.hidden = false;
      });
    });

    // The view is rendered after wireChrome() ran, so its `.reveal` elements
    // were never observed. Re-arm the observer or they stay at opacity:0.
    wireScrollReveal(root);
  } catch (e) { toast(e.message); document.getElementById("view").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
})();
