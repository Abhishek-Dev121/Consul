(async function () {
  await renderLayout("/reports", "Reports & Analytics", { crumb: "Communication & sentiment trends" });

  function kpi(icon, label, val, sub) {
    return `<div class="kpi"><div class="top"><span>${label}</span><span class="ic">${icon}</span></div>
      <div class="val">${val}</div><span class="delta up">${sub}</span></div>`;
  }
  const fmtResp = (s) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

  function exportReport(format, data) {
    let content = "";
    let mimeType = "text/csv;charset=utf-8;";
    let filename = "client_hub_report.csv";

    if (format === "csv" || format === "excel") {
      const sep = format === "csv" ? "," : "\t";
      filename = format === "csv" ? "client_hub_report.csv" : "client_hub_report.xls";
      mimeType = format === "csv" ? "text/csv;charset=utf-8;" : "application/vnd.ms-excel;charset=utf-8;";

      content += `CLIENT HUB - REPORT & ANALYTICS\n`;
      content += `Generated: ${new Date().toLocaleString()}\n\n`;
      content += `KPIs:\n`;
      content += `Chats this week: ${data.kpis.chats_week}\n`;
      content += `Calls this week: ${data.kpis.calls_week}\n`;
      content += `Avg Response: ${fmtResp(data.kpis.avg_response_seconds)}\n`;
      content += `Total Analyzed: ${data.kpis.analyzed}\n\n`;

      content += `CLIENT ENGAGEMENT:\n`;
      content += `Client Name${sep}Company${sep}Chats Count${sep}Calls Count${sep}Sentiment\n`;
      
      for (const c of (data.engagement || [])) {
        const name = `"${(c.client || "").replace(/"/g, '""')}"`;
        const company = `"${(c.company || "").replace(/"/g, '""')}"`;
        content += `${name}${sep}${company}${sep}${c.chats}${sep}${c.calls}${sep}${c.sentiment || "neutral"}\n`;
      }
    }

    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  try {
    const d = await Api.get("/api/reports/overview");
    const maxW = Math.max(1, ...d.weeks.map((w) => w.pos + w.neu + w.neg));
    const maxT = Math.max(1, ...d.team.map((t) => t.actions));

    document.getElementById("view").innerHTML = `
      <div class="page-head d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2>Reports & Analytics</h2>
          <p class="mb-0 text-muted" style="font-size:13px">Weekly communication volume, sentiment trends, team productivity and client engagement.</p>
        </div>
        <div class="dropdown no-print">
          <button class="btn btn-primary btn-sm dropdown-toggle" data-bs-toggle="dropdown">📥 Export Report</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" id="export-csv-btn">Export CSV</button></li>
            <li><button class="dropdown-item" id="export-excel-btn">Export Excel</button></li>
            <li><button class="dropdown-item" id="export-pdf-btn">Export PDF (Print)</button></li>
          </ul>
        </div>
      </div>

      <div class="grid g-4" style="margin-bottom:16px">
        ${kpi("💬", "Chats this week", d.kpis.chats_week, "rolling 7 days")}
        ${kpi("📞", "Calls this week", d.kpis.calls_week, "rolling 7 days")}
        ${kpi("⏱", "Avg response", fmtResp(d.kpis.avg_response_seconds), "from AI metrics")}
        ${kpi("✨", "Analyzed chats", d.kpis.analyzed, "total")}
      </div>

      <div class="grid" style="grid-template-columns:1.5fr 1fr;align-items:start">
        <div class="card card-pad">
          <h3 style="font-family:var(--display);font-size:14.5px;font-weight:600">Weekly volume by sentiment</h3>
          <p style="font-size:11.5px;color:var(--muted-2);margin:2px 0 8px">Last 5 weeks</p>
          <div class="bars">${d.weeks.map((w) => {
            const t = w.pos + w.neu + w.neg || 1;
            const h = ((w.pos + w.neu + w.neg) / maxW) * 100;
            return `<div class="bar-col"><div class="bar-stack" style="height:${h}%">
              <span style="height:${(w.neg / t) * 100}%;background:var(--neg)"></span>
              <span style="height:${(w.neu / t) * 100}%;background:var(--neu)"></span>
              <span style="height:${(w.pos / t) * 100}%;background:var(--pos)"></span>
            </div><span class="bl">${esc(w.label)}</span></div>`;
          }).join("")}</div>
          <div class="legend"><div><span class="ld" style="background:var(--pos)"></span>Positive</div>
            <div><span class="ld" style="background:var(--neu)"></span>Neutral</div>
            <div><span class="ld" style="background:var(--neg)"></span>Negative</div></div>
        </div>
        <div class="card"><div class="card-h"><h3>Team productivity</h3><span class="muted small mono">all time</span></div>
          <div class="card-pad">${d.team.length ? d.team.map((t) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">
            ${avBox(t.name)}<span style="font-size:12.5px;flex:none;width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name.split(" ")[0])}</span>
            <div class="vt" style="flex:1;height:7px;background:var(--line);border-radius:4px;overflow:hidden"><div style="height:100%;width:${(t.actions / maxT) * 100}%;background:var(--brand);border-radius:4px"></div></div>
            <span class="mono" style="font-size:11.5px;color:var(--muted);width:26px;text-align:right">${t.actions}</span></div>`).join("")
            : '<p class="muted small">No activity logged yet.</p>'}
          <div style="font-size:11px;color:var(--muted-2);margin-top:4px">Actions logged per team member</div></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Client engagement</h3></div>
        <table class="table"><thead><tr><th>Client</th><th>Chats</th><th>Calls</th><th>Sentiment</th><th>Engagement</th></tr></thead><tbody>
        ${d.engagement.length ? d.engagement.map((c) => `<tr>
          <td><div class="t-name">${avBox(c.client)}<div><div class="nm">${esc(c.client)}</div><div class="sm">${esc(c.company || "")}</div></div></div></td>
          <td class="mono">${c.chats}</td><td class="mono">${c.calls}</td><td>${sentPill(c.sentiment)}</td>
          <td><div class="pbar" style="max-width:160px"><div style="width:${Math.min(100, c.chats * 12)}%"></div></div></td></tr>`).join("")
          : '<tr><td colspan="5"><div class="empty muted">No engagement data yet.</div></td></tr>'}
        </tbody></table></div>`;

    document.getElementById("export-csv-btn").onclick = () => exportReport("csv", d);
    document.getElementById("export-excel-btn").onclick = () => exportReport("excel", d);
    document.getElementById("export-pdf-btn").onclick = () => window.print();
  } catch (e) { toast(e.message); }
})();
