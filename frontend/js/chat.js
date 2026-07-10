(async function () {
  let clientId = parseInt(qs("id"));
  if (!clientId) { location.href = "/clients"; return; }
  await renderLayout("/channels", "Messages", { crumb: "Channels" });
  const writable = canWrite();

  let client = null, threads = [];

  function setTitle(t) { const h = document.querySelector("#app-topbar .page-h"); if (h) h.textContent = t; }
  function dayLabel(d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  function timeLabel(s) { return s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; }

  // ---- Thread switcher: other clients on the same channel (fallback: all) ----
  async function loadThreads() {
    // Every accessible client is a chat thread, so newly-created clients appear here automatically.
    let list = await Api.get("/api/clients").catch(() => []);
    if (!list.some((c) => c.id === clientId)) list.unshift(client);
    threads = list;
    renderThreads(threads);
  }

  function renderThreads(list) {
    document.getElementById("thread-list").innerHTML = list.map((c) => {
      const ch = c.channels && c.channels[0];
      return `<div class="thread ${c.id === clientId ? "active" : ""}" onclick="switchThread(${c.id})">
        <span class="avatar-sm">${initials(c.name)}${ch ? `<span class="ch-dot" style="background:${chanColor(ch.platform)}"></span>` : ""}</span>
        <div style="min-width:0">
          <div class="t-name">${esc(c.name)}</div>
          <div class="t-sub">${esc(c.company || c.email || "—")}</div>
        </div>
      </div>`;
    }).join("");
  }

  window.switchThread = (id) => {
    if (id === clientId) return;
    location.href = `/chat?id=${id}`;
  };

  document.getElementById("thread-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderThreads(threads.filter((c) => (c.name + " " + (c.company || "")).toLowerCase().includes(q)));
  });

  // ---- Header ----
  async function showTeamRoster() {
    try {
      const projects = await Api.get(`/api/projects?client_id=${clientId}`);
      const memberMap = new Map();
      for (const p of projects) {
        for (const m of (p.members || [])) {
          memberMap.set(m.bitrix_user_id, m);
        }
      }
      const members = Array.from(memberMap.values());
      const tbody = document.getElementById("roster-table-body");
      if (!members.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center muted py-4">No team members synced yet for this client.</td></tr>';
      } else {
        tbody.innerHTML = members.map((m) => {
          return `<tr>
            <td>${avBox(m.name, "av-sm")}</td>
            <td><div style="font-weight:600">${esc(m.name)}</div>
              <div class="small muted" style="font-size:10px">ID: ${esc(m.bitrix_user_id)}</div></td>
            <td class="mono" style="font-size:12px;color:var(--muted)">${esc(m.email || "—")}</td>
            <td><span class="badge bg-light text-dark border">${esc(m.work_position || "Member")}</span></td>
            <td><span class="badge bg-secondary-subtle text-secondary-emphasis" style="font-size:11px">${esc(m.department || "—")}</span></td>
          </tr>`;
        }).join("");
      }
      const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("rosterModal"));
      modal.show();
    } catch (e) {
      toast(e.message);
    }
  }

  function renderHead() {
    const ch = client.channels && client.channels[0];
    document.getElementById("chat-head").innerHTML = `
      <span class="av" style="width:42px;height:42px;border-radius:12px;position:relative;
        background:linear-gradient(135deg,var(--brand),var(--brand-2))">${initials(client.name)}${ch ? `<span class="ch-dot" style="background:${chanColor(ch.platform)}"></span>` : ""}</span>
      <div class="flex-grow-1" style="min-width:0">
        <div style="font-family:var(--display);font-weight:600;font-size:15px">${esc(client.name)}</div>
        <div class="small" style="display:flex;align-items:center;gap:7px;margin-top:2px">
          ${ch ? chanChip(ch.platform) : `<span class="muted">${esc(client.company || "")}</span>`}
          ${client.company && ch ? `<span class="muted">· ${esc(client.company)}</span>` : ""}</div>
      </div>
      <button class="btn btn-sm btn-soft me-2" id="team-roster-btn">${Icon("users", { size: 14 })} Project Team</button>
      <a class="btn btn-sm btn-soft" href="/client?id=${client.id}">Full profile</a>`;
    document.getElementById("team-roster-btn").onclick = showTeamRoster;
  }

  // ---- Messages ----
  async function loadMessages() {
    const msgs = await Api.get(`/api/clients/${clientId}/messages`);
    const body = document.getElementById("chat-body");
    if (!msgs.length) {
      body.innerHTML = `<div class="chat-empty">
        <div class="ce-ic">${Icon("message", { size: 28 })}</div>
        <div class="ce-title">No messages yet</div>
        <div class="ce-sub">Start the conversation using the box below, or upload a chat log from the client profile.</div>
      </div>`;
      return;
    }
    let html = "", lastDay = "";
    for (const m of msgs) {
      const dt = new Date(m.sent_at || m.created_at);
      const day = dayLabel(dt);
      if (day !== lastDay) { html += `<div class="day-sep"><span>${day}</span></div>`; lastDay = day; }
      const side = m.is_client ? "in" : "out";
      let inner;
      if (m.attachment_type === "audio") {
        inner = `<audio controls preload="none" src="${esc(m.attachment_url)}" style="max-width:240px;height:38px"></audio>`;
      } else if (m.attachment_type === "file") {
        inner = `<a class="file-att" href="${esc(m.attachment_url)}" target="_blank" rel="noopener">
          <span class="fa-ic">${Icon("file", { size: 16 })}</span><span class="fa-name">${esc(m.attachment_name || "Download")}</span><span class="fa-dl">${Icon("download", { size: 14 })}</span></a>`;
      } else {
        inner = esc(m.body);
      }
      const bubbleCls = m.attachment_type ? "bubble bubble-att" : "bubble";
      html += `<div class="msg ${side}"><div>
        <div class="${bubbleCls}">${inner}</div>
        <div class="meta">${esc(m.sender_name)} · ${timeLabel(m.sent_at || m.created_at)}</div>
      </div></div>`;
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  // ---- Composer ----
  function setupComposer() {
    const input = document.getElementById("composer-input");
    const btn = document.getElementById("send-btn");
    if (!writable) { document.getElementById("composer").style.display = "none"; return; }
    input.addEventListener("input", () => {
      input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    btn.addEventListener("click", send);

    // Attach file / audio
    const fileInput = document.getElementById("composer-file");
    document.getElementById("attach-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const fd = new FormData(); fd.append("upload", file);
      try {
        await Api.postForm(`/api/clients/${clientId}/messages/upload`, fd);
        fileInput.value = "";
        await loadMessages();
        toast("Attachment sent", "success");
      } catch (e) { toast(e.message); fileInput.value = ""; }
    });
  }

  async function send() {
    const input = document.getElementById("composer-input");
    const body = input.value.trim();
    if (!body) return;
    try {
      await Api.post(`/api/clients/${clientId}/messages`, { body });
      input.value = ""; input.style.height = "auto";
      await loadMessages();
    } catch (e) { toast(e.message); }
  }

  // ---- Right summary panel ----
  async function renderSummary() {
    const ch = client.channels || [];
    document.getElementById("chat-summary").innerHTML = `
      <div class="summary-sec text-center">
        <span class="avatar" style="width:60px;height:60px;border-radius:50%;display:inline-grid;place-items:center;
          background:linear-gradient(135deg,var(--brand),#60a5fa);color:#fff;font-weight:700;font-size:20px">${initials(client.name)}</span>
        <div style="font-weight:700;margin-top:8px">${esc(client.name)}</div>
        <div class="muted small">${esc(client.company || "—")}</div>
        <span class="chip ${client.status === "active" ? "ok" : ""} mt-2"><span class="dot"></span>${esc(client.status)}</span>
      </div>
      <div class="summary-sec">
        <h6>Contact</h6>
        <div class="kv"><span class="k">Email</span><span>${esc(client.email || "—")}</span></div>
        <div class="kv"><span class="k">Phone</span><span>${esc(client.phone || "—")}</span></div>
        <div class="kv"><span class="k">Channels</span><span>${ch.map((c) => esc(c.name)).join(", ") || "—"}</span></div>
        <div class="kv"><span class="k">Assignees</span><span>${(client.assignees || []).map((a) => esc(a.name)).join(", ") || "—"}</span></div>
      </div>
      <div class="summary-sec">
        <h6>AI insight</h6>
        <div id="ai-insight" class="muted small">Loading…</div>
      </div>
      <div class="summary-sec">
        <a class="btn btn-soft w-100" href="/client?id=${client.id}">Open full profile</a>
      </div>`;
    loadAiInsight();
  }

  // Pull the latest conversation's AI analysis (if any) for a quick insight.
  async function loadAiInsight() {
    const box = document.getElementById("ai-insight");
    try {
      const convos = await Api.get(`/api/conversations?client_id=${clientId}`);
      if (!convos.length) { box.textContent = "No conversations analyzed yet."; return; }
      const a = await Api.get(`/api/ai/conversations/${convos[0].id}/analysis`);
      if (!a) { box.innerHTML = 'Not analyzed yet. <a href="/client?id=' + clientId + '">Run analysis →</a>'; return; }
      box.innerHTML = `${a.sentiment ? `<div class="mb-1">Sentiment: <span class="sentiment-${a.sentiment}">${esc(a.sentiment)}</span></div>` : ""}
        <div>${esc(a.summary || "—")}</div>`;
    } catch (e) { box.textContent = "—"; }
  }

  // ---- Init ----
  async function init() {
    client = await Api.get(`/api/clients/${clientId}`);
    setTitle(client.name);
    renderHead();
    await Promise.all([loadThreads(), loadMessages(), renderSummary()]);
    setupComposer();
  }
  await init();
})();
