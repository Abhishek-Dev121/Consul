(async function () {
  const clientId = parseInt(qs("id"));
  if (!clientId) { location.href = "/clients"; return; }

  const actions = `<a class="btn btn-soft" href="/chat?id=${clientId}">${Icon("message", { size: 14 })} Chat</a>
    <button class="btn btn-soft" id="team-roster-btn">${Icon("users", { size: 14 })} Project Team</button>
    <button class="btn btn-soft" id="edit-btn">${Icon("edit", { size: 14 })} Edit</button>
    <button class="btn btn-primary" id="sync-btn">⟳ Sync Bitrix24</button>`;
  await renderLayout("/clients", "Client profile", { crumb: "Clients", actions });
  const writable = canWrite();

  // The back link returns to wherever the profile was opened from. Callers pass
  // ?from=conversations|clients; if absent (e.g. an old bookmark), fall back to
  // the referrer, then default to Clients.
  (function setBackLink() {
    const link = document.getElementById("back-link");
    if (!link) return;
    let from = (qs("from") || "").toLowerCase();
    if (!from && document.referrer) {
      try {
        const p = new URL(document.referrer, location.origin).pathname;
        if (p.startsWith("/conversations")) from = "conversations";
        else if (p.startsWith("/clients")) from = "clients";
      } catch (_) { /* opaque referrer — ignore */ }
    }
    if (from === "conversations") {
      // Reopen the same client's thread, not just the inbox.
      link.href = `/conversations?client=${clientId}`;
      link.textContent = "← Back to conversations";
    } else {
      link.href = "/clients";
      link.textContent = "← Back to clients";
    }
  })();

  function setTitle(name) {
    const h = document.querySelector("#app-topbar .page-h");
    if (h) h.textContent = name;
  }

  let client = null;

  async function loadClient() {
    client = await Api.get(`/api/clients/${clientId}`);
    setTitle(client.name);
    renderHero();
    renderInfo();
  }

  function statusPill(s) {
    const v = (s || "").toLowerCase();
    if (v === "active") return `<span class="st st-active"><span class="sd"></span>Active</span>`;
    if (v.includes("hold") || v.includes("pause")) return `<span class="st st-hold"><span class="sd"></span>${esc(s)}</span>`;
    if (v.includes("archiv") || v.includes("inactive") || v.includes("closed")) return `<span class="st st-done"><span class="sd"></span>${esc(s)}</span>`;
    return `<span class="st st-active"><span class="sd"></span>${esc(s || "Active")}</span>`;
  }

  // Client status is one of Active / Inactive / Lead, each with its own tint.
  const STATUS_OPTIONS = [
    { key: "active", label: "Active", cls: "st-active" },
    { key: "inactive", label: "Inactive", cls: "st-done" },
    { key: "lead", label: "Lead", cls: "st-hold" },
  ];
  function statusMeta(s) {
    const v = (s || "").toLowerCase();
    return STATUS_OPTIONS.find((o) => o.key === v)
      || (v.includes("inactive") || v.includes("closed") || v.includes("archiv") ? STATUS_OPTIONS[1] : STATUS_OPTIONS[0]);
  }

  // A pill that doubles as a dropdown to change the client's status (writable roles).
  function statusControl(s) {
    const m = statusMeta(s);
    const items = STATUS_OPTIONS.map((o) =>
      `<button type="button" class="cd-status-item ${o.key === m.key ? "on" : ""}" data-status="${o.key}">
         <span class="st ${o.cls}" style="pointer-events:none"><span class="sd"></span>${o.label}</span>
         ${o.key === m.key ? Icon("check", { size: 14, style: "margin-left:auto;color:var(--brand)" }) : ""}
       </button>`).join("");
    return `<div class="cd-status" id="cd-status">
      <button type="button" class="st ${m.cls} cd-status-btn" id="cd-status-btn" aria-haspopup="true" title="Change client status">
        <span class="sd"></span>${m.label} ${Icon("chevronDown", { size: 13, style: "margin-left:2px" })}
      </button>
      <div class="cd-status-menu" id="cd-status-menu" hidden>${items}</div>
    </div>`;
  }

  async function setClientStatus(newStatus) {
    if ((client.status || "").toLowerCase() === newStatus) return;
    const prev = client.status;
    try {
      const updated = await Api.patch(`/api/clients/${clientId}`, { status: newStatus });
      client.status = updated.status || newStatus;
      Api.invalidateCache("/api/overview/clients");   // dashboards show status too
      renderHero();
      toast("Client status updated", "success");
    } catch (e) { client.status = prev; toast(e.message); }
  }
  const chanChips = (list) => (list || []).map((c) =>
    `<span class="chip">${channelIcon(c.platform, 13)} ${esc(c.name)}</span>`).join("") || `<span class="muted small">None</span>`;

  function renderHero() {
    const primaryChannel = client.channels && client.channels[0];
    document.getElementById("cd-hero").innerHTML = `
      <span class="cd-av" style="background:${avHash(client.name)}">${initialsOf(client.name)}</span>
      <div class="cd-id">
        <h2 title="${esc(client.name)}">${esc(client.name)}</h2>
        <div class="cd-sub">
          ${writable ? statusControl(client.status) : statusPill(client.status)}
          ${primaryChannel ? `<span class="chip">${channelIcon(primaryChannel.platform, 13)} ${esc(primaryChannel.name)}</span>` : ""}
        </div>
        <div class="cd-quick">
          <span>${Icon("users", { size: 13 })} ${(client.assignees || []).length} assignee${(client.assignees || []).length === 1 ? "" : "s"}</span>
        </div>
      </div>`;

    // Wire the status dropdown (writable roles only).
    const stBtn = document.getElementById("cd-status-btn");
    if (stBtn) {
      const menu = document.getElementById("cd-status-menu");
      stBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
      menu.querySelectorAll("[data-status]").forEach((b) =>
        b.onclick = (e) => { e.stopPropagation(); menu.hidden = true; setClientStatus(b.dataset.status); });
      document.addEventListener("click", () => { if (menu) menu.hidden = true; });
    }
  }

  function renderInfo() {
    const assignees = (client.assignees || []).map((a) =>
      `<span class="chip">${avBox(a.name)} ${esc(a.name)}</span>`).join("") || `<span class="muted small">Unassigned</span>`;
    document.getElementById("info-body").innerHTML = `
      <div class="cd-info-grid">
        <div class="card"><div class="card-header">Details</div><div class="card-body">
          <div class="cd-kv"><span class="k">Status</span><span class="v">${statusPill(client.status)}</span></div>
          <div class="cd-kv"><span class="k">Notes</span><span class="v ${client.notes ? "" : "muted"}">${esc(client.notes || "No notes yet.")}</span></div>
        </div></div>
        <div class="card"><div class="card-header">Team &amp; channels</div><div class="card-body">
          <div class="cd-kv"><span class="k">Assignees</span><span class="v"><span class="cd-chips">${assignees}</span></span></div>
          <div class="cd-kv"><span class="k">Channels</span><span class="v"><span class="cd-chips">${chanChips(client.channels)}</span></span></div>
        </div></div>
      </div>`;
  }

  // ---- Conversations tab ----
  async function loadConversations() {
    const convos = await Api.get(`/api/conversations?client_id=${clientId}`);
    const body = document.getElementById("conv-body");
    const head = `<div class="cd-sec-head"><h3>Conversations <span class="muted small">(${convos.length})</span></h3>
      ${writable ? `<button class="btn btn-soft btn-sm" onclick="addConversation()">${Icon("plus", { size: 13 })} Log conversation</button>` : ""}</div>`;
    if (!convos.length) {
      body.innerHTML = head + `<div class="empty"><span class="em-ico">${Icon("message", { size: 26 })}</span>No conversations logged yet.</div>`;
      return;
    }
    body.innerHTML = head + `<div class="cd-list">` + convos.map((c) => `
      <button class="cd-row" onclick="openConversation(${c.id})">
        <span class="r-ic">${Icon("message", { size: 16 })}</span>
        <span class="r-body">
          <span class="r-title">${esc(c.title || "Untitled conversation")}</span>
          <span class="r-sub">${c.channel_id ? "Channel thread" : "Logged conversation"}</span>
        </span>
        <span class="r-time">${c.created_at ? timeAgo(c.created_at) : ""}</span>
        ${Icon("chevronDown", { size: 15, style: "transform:rotate(-90deg);color:var(--muted-2)" })}
      </button>`).join("") + `</div>`;
  }

  window.openConversation = async (id) => {
    const [c, messages, analysis] = await Promise.all([
      Api.get(`/api/conversations/${id}`),
      Api.get(`/api/conversations/${id}/messages`).catch(() => []),
      Api.get(`/api/ai/conversations/${id}/analysis`).catch(() => null)
    ]);
    document.getElementById("cd-title").textContent = c.title || "Conversation";
    
    let chatHtml = "";
    if (messages.length) {
      chatHtml = `<div class="p-3 bg-light border rounded-3 mb-3" style="max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">` + 
        messages.map(m => {
          const isMe = !m.is_client;
          const align = isMe ? "align-items-end" : "align-items-start";
          const bubbleBg = isMe ? "bg-primary text-white" : "bg-white text-dark border";
          const sender = m.sender_name ? `<span class="fw-semibold small d-block mb-1 text-muted" style="font-size:11px">${esc(m.sender_name)}</span>` : "";
          const time = m.sent_at ? `<span class="d-block small text-muted mt-1" style="font-size:9.5px">${fmtDate(m.sent_at)}</span>` : "";
          
          let inner = "";
          if (m.attachment_type === "audio") {
            inner = `<audio controls preload="none" src="${esc(m.attachment_url)}" style="max-width:240px;height:38px"></audio>`;
          } else if (m.attachment_type === "file") {
            inner = `<a class="btn btn-sm btn-outline-secondary" href="${esc(m.attachment_url)}" target="_blank">${Icon("file", { size: 14 })} ${esc(m.attachment_name || "Download")}</a>`;
          } else {
            inner = esc(m.body);
          }
          
          return `<div class="d-flex flex-column ${align}" style="width: 100%">
            ${sender}
            <div class="p-2 rounded-3 shadow-sm ${bubbleBg}" style="max-width: 80%; white-space: pre-wrap; font-size:13px">${inner}</div>
            ${time}
          </div>`;
        }).join("") + `</div>`;
    } else {
      chatHtml = `<div class="chat-log mb-3">${esc(c.raw_content)}</div>`;
    }

    const notesHtml = c.notes.map((n) => `<li class="small">${esc(n.body)} <span class="muted">— ${fmtDate(n.created_at)}</span></li>`).join("");
    document.getElementById("cd-body").innerHTML = `
      ${chatHtml}
      ${writable ? `<button class="btn btn-sm btn-success mb-3" onclick="analyzeConversation(${id})">${Icon("bot", { size: 14 })} Run AI analysis</button>` : ""}
      <div class="card mb-3"><div class="card-header">AI Analysis</div>
        <div class="card-body" id="analysis-box">${renderAnalysis(analysis)}</div></div>
      <div class="card"><div class="card-header">Internal notes</div><div class="card-body">
        <ul id="notes-list">${notesHtml || '<li class="muted">No notes.</li>'}</ul>
        ${writable ? `<div class="input-group"><input class="form-control" id="note-input" placeholder="Add internal note…" />
          <button class="btn btn-outline-primary" onclick="addNote(${id})">Add</button></div>` : ""}
      </div></div>`;
    new bootstrap.Modal(document.getElementById("convDetail")).show();
  };

  window.analyzeConversation = async (id) => {
    const box = document.getElementById("analysis-box");
    box.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Analyzing…';
    try {
      const a = await Api.post(`/api/ai/conversations/${id}/analyze`);
      box.innerHTML = renderAnalysis(a);
      toast("Analysis complete", "success");
      loadActivity();
    } catch (e) { box.innerHTML = renderAnalysis(null); toast(e.message); }
  };

  window.addNote = async (id) => {
    const input = document.getElementById("note-input");
    if (!input.value.trim()) return;
    try {
      await Api.post(`/api/conversations/${id}/notes`, { body: input.value.trim() });
      openConversation(id);
    } catch (e) { toast(e.message); }
  };

  window.addConversation = async () => {
    const content = prompt("Paste the conversation log:");
    if (!content) return;
    const title = prompt("Title (optional):") || null;
    try {
      await Api.post("/api/conversations", { client_id: clientId, raw_content: content, title });
      await loadConversations();
      toast("Logged", "success");
    } catch (e) { toast(e.message); }
  };

  // ---- Projects tab ----
  async function loadProjects() {
    const projects = await Api.get(`/api/projects?client_id=${clientId}`);
    const body = document.getElementById("proj-body");
    
    // A client can be linked to at most one project, so only offer the link
    // button while none is linked yet.
    const head = `<div class="cd-sec-head"><h3>Linked projects <span class="muted small">(${projects.length})</span></h3>
      ${writable && !projects.length ? `<button class="btn btn-soft btn-sm" onclick="openLinkProjectModal()">${Icon("plus", { size: 13 })} Link Bitrix24 project</button>` : ""}</div>`;

    if (!projects.length) {
      body.innerHTML = head + `<div class="empty"><span class="em-ico">${Icon("folder", { size: 26 })}</span>No projects linked yet.${writable ? ' Use “Link Bitrix24 project” above.' : ""}</div>`;
      return;
    }

    const doneStatuses = ["done", "completed", "complete", "closed", "won", "5"];
    // Bitrix returns numeric task-status codes (e.g. "5"); map them to readable
    // labels so the pill never shows a bare digit.
    const STATUS_LABELS = {
      "1": "Pending", "2": "Pending", "3": "In progress",
      "4": "In review", "5": "Complete", "6": "Deferred", "7": "Declined",
    };
    const taskStatusLabel = (s) => {
      const raw = (s == null ? "" : String(s)).trim();
      if (!raw) return "Pending";
      if (STATUS_LABELS[raw]) return STATUS_LABELS[raw];
      return raw.charAt(0).toUpperCase() + raw.slice(1);   // already text — tidy the case
    };
    const taskPill = (s) => {
      const v = (s == null ? "" : String(s)).toLowerCase().trim();
      const label = taskStatusLabel(s);
      const isDone = doneStatuses.includes(v) || label.toLowerCase() === "complete";
      const isProgress = !isDone && (v === "3" || v === "4" || v.includes("progress") || v.includes("review"));
      const cls = isDone ? "st-done" : isProgress ? "st-progress" : "st-active";
      return `<span class="st ${cls}"><span class="sd"></span>${esc(label)}</span>`;
    };
    const prioChip = (p) => p === "2"
      ? `<span class="chip bad">Urgent</span>`
      : p === "1" ? `<span class="chip" style="background:var(--neu-soft);color:var(--neu)">High</span>` : `<span class="chip">Normal</span>`;

    const cards = projects.map((p, pi) => {
      const total = p.tasks.length;
      const done = p.tasks.filter((t) => doneStatuses.includes((t.status || "").toLowerCase())).length;
      const prog = total > 0 ? Math.round((done / total) * 100) : 0;

      const members = p.members.map((m) =>
        `<span class="chip" title="${esc(m.work_position || "Member")}">${avBox(m.name)} ${esc(m.name)}</span>`
      ).join("") || `<span class="muted small">No members synced</span>`;

      const rows = p.tasks.map((t, ti) => {
        const est = t.time_estimate ? `${Math.round(t.time_estimate / 3600)}h` : "—";
        return `<tr class="cd-task-row" data-pi="${pi}" data-ti="${ti}" title="View full task details">
          <td><div style="font-weight:600">${esc(t.title)}</div>
            ${t.description ? `<div class="cd-task-desc">${esc(t.description)}</div>` : ""}</td>
          <td>${esc(t.responsible_name || "Unassigned")}</td>
          <td>${taskPill(t.status)}</td>
          <td>${prioChip(t.priority)}</td>
          <td class="mono">${est}</td>
          <td class="mono" style="color:var(--muted)">${t.due_date ? fmtDate(t.due_date).split(",")[0] : "—"}</td>
        </tr>`;
      }).join("");

      const tasksTable = total > 0
        ? `<table class="cd-task-table"><thead><tr>
            <th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Est</th><th>Deadline</th>
          </tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="muted small" style="margin:14px 0 0">No tasks in this project group.</p>`;

      return `<div class="cd-proj">
        <div class="cd-proj-head">
          <div style="min-width:0">
            <h4>${esc(p.title)}</h4>
            <span class="p-id">#${esc(p.bitrix_project_id)}</span>
          </div>
          ${statusPill(p.status)}
        </div>
        <div class="cd-proj-body">
          ${p.description ? `<p class="muted" style="font-size:13px;margin:0 0 16px">${esc(p.description)}</p>` : ""}
          <div class="lab">Team members</div>
          <div class="cd-members cd-chips">${members}</div>
          <div class="cd-prog-row"><div class="lab" style="margin:0">Task progress</div><span class="n">${done} / ${total} · ${prog}%</span></div>
          <div class="pbar"><div class="${prog >= 100 ? "done" : ""}" style="width:${prog}%"></div></div>
          ${tasksTable}
          ${writable ? `<div class="d-flex gap-2" style="margin-top:16px">
            <button class="btn btn-soft btn-sm" onclick="syncProject(${p.id})">${Icon("restore", { size: 13 })} Re-sync</button>
            <button class="btn btn-soft btn-sm text-danger" onclick="unlinkProject(${p.id})">${Icon("trash", { size: 13 })} Unlink</button>
          </div>` : ""}
        </div>
      </div>`;
    }).join("");

    body.innerHTML = head + cards;

    // Clicking a task row opens a popup with that task's full details — the table
    // truncates long descriptions, so this is where you read the whole thing.
    function openTaskModal(t, projectTitle) {
      const old = document.getElementById("taskDetailModal");
      if (old) old.remove();
      const est = t.time_estimate ? `${Math.round(t.time_estimate / 3600)}h` : "—";
      const deadline = t.due_date ? fmtDate(t.due_date) : "—";
      document.body.insertAdjacentHTML("beforeend", `
        <div class="modal fade" id="taskDetailModal" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" style="font-size:1.05rem">${esc(t.title)}</h5>
                <button class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <div class="task-meta-grid">
                  <div><div class="tm-lab">Assignee</div><div>${esc(t.responsible_name || "Unassigned")}</div></div>
                  <div><div class="tm-lab">Status</div><div>${taskPill(t.status)}</div></div>
                  <div><div class="tm-lab">Priority</div><div>${prioChip(t.priority)}</div></div>
                  <div><div class="tm-lab">Estimate</div><div>${esc(est)}</div></div>
                  <div><div class="tm-lab">Deadline</div><div>${esc(deadline)}</div></div>
                  ${projectTitle ? `<div><div class="tm-lab">Project</div><div>${esc(projectTitle)}</div></div>` : ""}
                </div>
                <div class="tm-lab" style="margin-top:18px">Description</div>
                <div class="task-desc-full">${t.description ? esc(t.description) : `<span class="muted">No description provided.</span>`}</div>
              </div>
              <div class="modal-footer">
                <button class="btn btn-light" data-bs-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        </div>`);
      const el = document.getElementById("taskDetailModal");
      el.addEventListener("hidden.bs.modal", () => el.remove());
      bootstrap.Modal.getOrCreateInstance(el).show();
    }

    body.querySelectorAll(".cd-task-row").forEach((tr) =>
      tr.addEventListener("click", () => {
        const p = projects[+tr.dataset.pi];
        const t = p && p.tasks[+tr.dataset.ti];
        if (t) openTaskModal(t, p.title);
      }));
  }

  window.openLinkProjectModal = async () => {
    try {
      const select = document.getElementById("lp-group-select");
      select.innerHTML = '<option value="">Loading project groups...</option>';
      const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("linkProjectModal"));
      modal.show();
      
      const groups = await Api.get("/api/bitrix/groups");
      select.innerHTML = '<option value="">Select a project group...</option>' +
        groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    } catch (e) {
      toast(e.message);
    }
  };

  window.syncProject = async (id) => {
    try {
      toast("Syncing with Bitrix24...", "info");
      await Api.post(`/api/bitrix/sync-project/${id}`);
      invalidateProjectsCache();
      toast("Project synced successfully", "success");
      await loadProjects();
      await loadConversations();
    } catch (e) {
      toast(e.message);
    }
  };

  window.unlinkProject = async (id) => {
    const ok = await confirmDialog(
      "This removes the project link from this client. You can link a project again afterwards.",
      {
        title: "Unlink this project?",
        confirmText: "Unlink project",
        icon: "trash",
        note: "This does not delete the group in Bitrix24.",
      }
    );
    if (!ok) return;
    try {
      await Api.del(`/api/bitrix/link-project/${id}`);
      invalidateProjectsCache();
      toast("Project unlinked", "success");
      await loadProjects();
    } catch (e) { toast(e.message); }
  };

  // ---- Client Projects Caching Helper ----
  let clientProjects = null;
  async function getClientProjects() {
    if (clientProjects === null) {
      clientProjects = await Api.get(`/api/projects?client_id=${clientId}`).catch(() => []);
    }
    return clientProjects;
  }

  // Drop the cached project list after a link/unlink/sync so the reload reflects
  // reality. `Api.del`/`post` only invalidate their own exact path (e.g.
  // "/api/bitrix/link-project/12"), never the "/api/projects?client_id=…" GET —
  // and that GET is cached in sessionStorage, so the unlinked project keeps
  // showing until a manual refresh. Also reset the in-memory `clientProjects`.
  function invalidateProjectsCache() {
    Api.invalidateCache("/api/projects");
    clientProjects = null;
  }

  // ---- Files tab ----
  let filesArchived = false;   // false = active view, true = Archive view
  async function loadFiles() {
    const [files, projects] = await Promise.all([
      // Fresh, not stale-cached — archive/restore must reflect immediately.
      Api.get(`/api/files?client_id=${clientId}&archived=${filesArchived}`, { stale: false }),
      getClientProjects()
    ]);
    const body = document.getElementById("files-body");

    const head = `<div class="cd-sec-head">
      <h3>${filesArchived ? "Archived files" : "Files &amp; links"} <span class="muted small">(${files.length})</span></h3>
      <button class="btn btn-soft btn-sm" onclick="toggleFilesArchive()">
        ${filesArchived ? Icon("restore", { size: 13 }) + " Back to files" : Icon("archive", { size: 13 }) + " View archive"}
      </button>
    </div>`;

    let uploader = "";
    if (writable && !filesArchived) {
      const projOpts = projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
      const projSelect = projects.length > 1
        ? `<select class="form-select form-select-sm" id="f-project-select" style="width:auto"><option value="">Project (optional)</option>${projOpts}</select>`
        : "";
      uploader = `<div class="cd-upload">
          <input type="file" class="form-control form-control-sm" id="f-upload" style="max-width:240px">
          <button class="btn btn-primary btn-sm" onclick="uploadFile()">${Icon("upload", { size: 13 })} Upload</button>
          <span class="tb-divider" style="height:24px"></span>
          <input type="text" class="form-control form-control-sm" id="f-link-title" placeholder="Link title" style="max-width:170px">
          <input type="text" class="form-control form-control-sm" id="f-link-url" placeholder="https://…" style="max-width:200px">
          <button class="btn btn-soft btn-sm" onclick="addFileLink()">${Icon("link", { size: 13 })} Add link</button>
          ${projSelect}
        </div>`;
    }

    const iconColor = (ext) => ({ PDF: "#D2473D", DOC: "#2C5AB8", DOCX: "#2C5AB8", XLS: "#1F9D6B", XLSX: "#1F9D6B", CSV: "#1F9D6B", PPT: "#E2574C", PPTX: "#E2574C", PNG: "#7C3AED", JPG: "#7C3AED", JPEG: "#7C3AED", LINK: "#2E6BFF" }[ext] || "#8A94A6");

    const rows = files.map((f) => {
      const isLink = f.content_type === "url";
      const href = isLink ? f.storage_key : `/api/files/${f.id}/download`;
      const ext = isLink ? "LINK" : (f.filename.split(".").pop() || "FILE").toUpperCase().slice(0, 4);
      const projBadge = f.project_title ? `<span class="chip" style="font-size:10px;padding:2px 7px">${Icon("folder", { size: 10 })} ${esc(f.project_title)}</span>` : "";

      let acts = `<a class="btn btn-soft btn-sm" href="${esc(href)}" target="_blank" rel="noopener" title="${isLink ? "Open link" : "Download"}">${Icon(isLink ? "external" : "download", { size: 14 })}</a>`;
      if (f.analysis) acts += `<button class="btn btn-soft btn-sm" onclick="toggleDocAI(${f.id})" title="View AI analysis">${Icon("sparkles", { size: 14 })}</button>`;
      if (filesArchived) {
        // Archive view: Restore + Delete permanently.
        if (writable) acts += `<button class="btn btn-soft btn-sm" onclick="restoreFile(${f.id})" title="Restore">${Icon("restore", { size: 14 })} Restore</button>`;
        if (writable) acts += `<button class="btn btn-soft btn-sm text-danger" onclick="deleteFilePermanent(${f.id})" title="Delete permanently">${Icon("trash", { size: 14 })}</button>`;
      } else {
        if (!f.analysis && writable) acts += `<button class="btn btn-soft btn-sm" onclick="analyzeDocument(${f.id}, this)">${Icon("bot", { size: 14 })} Analyze</button>`;
        if (writable) acts += `<button class="btn btn-soft btn-sm" onclick="archiveFile(${f.id})" title="Archive">${Icon("archive", { size: 14 })}</button>`;
      }

      let aiPanel = "";
      if (f.analysis) {
        const a = f.analysis;
        const list = (arr) => (arr || []).map((p) => `<li>${esc(p)}</li>`).join("") || "<li class='muted'>—</li>";
        aiPanel = `<div class="cd-file-ai" id="doc-analysis-${f.id}" hidden>
            <div class="d-flex align-items-center justify-content-between" style="gap:10px">
              <strong style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px">${Icon("sparkles", { size: 13 })} Document analysis</strong>
              ${sentPill((a.sentiment || "neu").slice(0, 3))}
            </div>
            <p class="muted" style="font-size:12.5px;line-height:1.5;margin:8px 0 0">${esc(a.summary || "No summary available.")}</p>
            <div class="cd-ai-cols">
              <div><div class="lab">Key points</div><ul class="ai-list">${list(a.key_points)}</ul></div>
              <div><div class="lab">Pending actions</div><ul class="ai-list todo">${list(a.pending_actions)}</ul></div>
              ${(a.follow_ups && a.follow_ups.length) ? `<div><div class="lab">Follow-ups</div><ul class="ai-list">${list(a.follow_ups)}</ul></div>` : ""}
            </div>
          </div>`;
      }

      return `<div class="cd-file-row">
          <span class="cd-file-ic" style="background:${iconColor(ext)}">${ext}</span>
          <div class="cd-file-body">
            <div class="cd-file-name" title="${esc(f.filename)}">${esc(f.filename)}</div>
            <div class="cd-file-sub">${isLink ? "External link" : (f.content_type || "file")}${projBadge ? " · " + projBadge : ""}</div>
          </div>
          <div class="cd-file-acts">${acts}</div>
        </div>${aiPanel}`;
    }).join("");

    const empty = filesArchived
      ? `<div class="empty"><span class="em-ico">${Icon("archive", { size: 26 })}</span>No archived files.</div>`
      : `<div class="empty"><span class="em-ico">${Icon("file", { size: 26 })}</span>No files or links yet.</div>`;
    body.innerHTML = head + uploader + (files.length ? rows : empty);
  }

  window.toggleFilesArchive = () => { filesArchived = !filesArchived; loadFiles(); };

  window.archiveFile = async (id) => {
    try { await Api.post(`/api/files/${id}/archive`); await loadFiles(); toast("Moved to archive", "success"); }
    catch (e) { toast(e.message); }
  };
  window.restoreFile = async (id) => {
    try { await Api.post(`/api/files/${id}/restore`); await loadFiles(); toast("Restored", "success"); }
    catch (e) { toast(e.message); }
  };
  window.deleteFilePermanent = async (id) => {
    const ok = await confirmDialog(
      "This permanently removes the file and its bytes from the server. This cannot be undone.",
      { title: "Delete permanently?", confirmText: "Delete forever" });
    if (!ok) return;
    try { await Api.del(`/api/files/${id}`); await loadFiles(); toast("Permanently deleted", "success"); }
    catch (e) { toast(e.message); }
  };

  window.toggleDocAI = (id) => {
    const box = document.getElementById(`doc-analysis-${id}`);
    if (box) box.hidden = !box.hidden;
  };

  window.uploadFile = async () => {
    const input = document.getElementById("f-upload");
    if (!input.files.length) return;
    const pSelect = document.getElementById("f-project-select");
    const pid = pSelect ? pSelect.value : "";
    const fd = new FormData();
    fd.append("client_id", clientId);
    fd.append("upload", input.files[0]);
    if (pid) fd.append("project_id", pid);
    try {
      await Api.postForm("/api/files", fd);
      await loadFiles();
      toast("File uploaded", "success");
    } catch (e) {
      toast(e.message);
    }
  };

  window.addFileLink = async () => {
    const titleInput = document.getElementById("f-link-title");
    const urlInput = document.getElementById("f-link-url");
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    if (!title || !url) return toast("Both Title and URL are required");
    const pSelect = document.getElementById("f-project-select");
    const pid = pSelect ? pSelect.value : "";
    const fd = new FormData();
    fd.append("client_id", clientId);
    fd.append("title", title);
    fd.append("url", url);
    if (pid) fd.append("project_id", pid);
    
    try {
      await Api.postForm("/api/files/link", fd);
      titleInput.value = "";
      urlInput.value = "";
      await loadFiles();
      toast("Link added", "success");
    } catch (e) {
      toast(e.message);
    }
  };

  window.analyzeDocument = async (id, btn) => {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Analyzing…';
    try {
      await Api.post(`/api/files/${id}/analyze`);
      toast("Document analysis complete!", "success");
      await loadFiles();
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  };

  window.deleteDocument = async (id) => {
    const ok = await confirmDialog(
      "This permanently removes the file from the server. This can't be undone.",
      { title: "Delete this file?", confirmText: "Delete file", icon: "trash" }
    );
    if (!ok) return;
    try {
      await Api.del(`/api/files/${id}`);
      toast("File deleted", "success");
      await loadFiles();
    } catch (e) {
      toast(e.message);
    }
  };

  // ---- Audio tab ----
  let audioArchived = false;
  async function loadAudio() {
    const [items, projects] = await Promise.all([
      Api.get(`/api/audio?client_id=${clientId}&archived=${audioArchived}`, { stale: false }),
      getClientProjects()
    ]);
    const body = document.getElementById("audio-body");

    const head = `<div class="cd-sec-head">
      <h3>${audioArchived ? "Archived recordings" : "Call recordings"} <span class="muted small">(${items.length})</span></h3>
      <button class="btn btn-soft btn-sm" onclick="toggleAudioArchive()">
        ${audioArchived ? Icon("restore", { size: 13 }) + " Back to recordings" : Icon("archive", { size: 13 }) + " View archive"}
      </button>
    </div>`;

    let uploader = "";
    if (writable && !audioArchived) {
      const projOpts = projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
      const projSelect = projects.length > 1
        ? `<select class="form-select form-select-sm" id="a-project-select" style="width:auto"><option value="">Project (optional)</option>${projOpts}</select>`
        : "";
      uploader = `<div class="cd-upload">
        <input type="file" accept="audio/*,video/*" class="form-control form-control-sm" id="audio-input" style="max-width:280px" />
        ${projSelect}
        <button class="btn btn-primary btn-sm" onclick="uploadAudio()">${Icon("upload", { size: 13 })} Upload</button></div>`;
    }

    const cards = items.map((a) => {
      const projBadge = a.project_title ? `<span class="chip" style="font-size:10px;padding:2px 7px">${Icon("folder", { size: 10 })} ${esc(a.project_title)}</span>` : "";
      const dur = a.duration ? `${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, "0")}` : "—";
      return `<div class="cd-audio">
        <div class="cd-audio-top">
          <div class="cd-audio-name">
            <span class="cd-audio-ic">${Icon("phone", { size: 15 })}</span>
            <div style="min-width:0">
              <div class="cd-file-name" title="${esc(a.filename)}">${esc(a.filename)}</div>
              <div class="cd-file-sub">Duration ${dur} ${projBadge ? "· " + projBadge : ""}</div>
            </div>
          </div>
          <div class="cd-file-acts">
            ${audioArchived
              ? (writable ? `<button class="btn btn-soft btn-sm" onclick="restoreAudio(${a.id})">${Icon("restore", { size: 14 })} Restore</button>
                   <button class="btn btn-soft btn-sm text-danger" onclick="deleteAudioPermanent(${a.id})" title="Delete permanently">${Icon("trash", { size: 14 })}</button>` : "")
              : (writable ? `<button class="btn btn-soft btn-sm" onclick="analyzeAudio(${a.id})">${Icon("bot", { size: 14 })} Transcribe &amp; analyze</button>
                   <button class="btn btn-soft btn-sm" onclick="archiveAudio(${a.id})" title="Archive">${Icon("archive", { size: 14 })}</button>` : "")}
          </div>
        </div>
        <div id="audio-analysis-${a.id}" style="margin-top:10px"></div></div>`;
    }).join("");

    const empty = audioArchived
      ? `<div class="empty"><span class="em-ico">${Icon("archive", { size: 26 })}</span>No archived recordings.</div>`
      : `<div class="empty"><span class="em-ico">${Icon("phone", { size: 26 })}</span>No call recordings yet.</div>`;
    body.innerHTML = head + uploader + (items.length ? cards : empty);
    // Lazy-load any existing analysis.
    for (const a of items) {
      Api.get(`/api/audio/${a.id}/analysis`).then((an) => {
        if (an) document.getElementById(`audio-analysis-${a.id}`).innerHTML =
          `<div class="card"><div class="card-body">${renderAnalysis(an)}</div></div>`;
      }).catch(() => {});
    }
  }

  window.toggleAudioArchive = () => { audioArchived = !audioArchived; loadAudio(); };
  window.archiveAudio = async (id) => {
    try { await Api.post(`/api/audio/${id}/archive`); await loadAudio(); toast("Moved to archive", "success"); }
    catch (e) { toast(e.message); }
  };
  window.restoreAudio = async (id) => {
    try { await Api.post(`/api/audio/${id}/restore`); await loadAudio(); toast("Restored", "success"); }
    catch (e) { toast(e.message); }
  };
  window.deleteAudioPermanent = async (id) => {
    const ok = await confirmDialog(
      "This permanently removes the recording and its file from the server. This cannot be undone.",
      { title: "Delete permanently?", confirmText: "Delete forever" });
    if (!ok) return;
    try { await Api.del(`/api/audio/${id}`); await loadAudio(); toast("Permanently deleted", "success"); }
    catch (e) { toast(e.message); }
  };

  window.uploadAudio = async () => {
    const input = document.getElementById("audio-input");
    if (!input.files.length) return;
    const pSelect = document.getElementById("a-project-select");
    const pid = pSelect ? pSelect.value : "";
    const fd = new FormData();
    fd.append("client_id", clientId);
    fd.append("upload", input.files[0]);
    if (pid) fd.append("project_id", pid);
    try { await Api.postForm("/api/audio", fd); await loadAudio(); toast("Uploaded", "success"); }
    catch (e) { toast(e.message); }
  };

  window.analyzeAudio = async (id) => {
    const box = document.getElementById(`audio-analysis-${id}`);
    box.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Transcribing & analyzing…';
    try {
      const a = await Api.post(`/api/audio/${id}/analyze`);
      box.innerHTML = `<div class="card"><div class="card-body">${renderAnalysis(a)}</div></div>`;
      toast("Audio analyzed", "success");
      loadActivity();
    } catch (e) { box.innerHTML = ""; toast(e.message); }
  };

  // ---- Activity tab ----
  async function loadActivity() {
    const acts = await Api.get(`/api/activities?client_id=${clientId}`);
    const body = document.getElementById("activity-body");
    const head = `<div class="cd-sec-head"><h3>Activity <span class="muted small">(${acts.length})</span></h3></div>`;
    if (!acts.length) {
      body.innerHTML = head + `<div class="empty"><span class="em-ico">${Icon("clock", { size: 26 })}</span>No activity recorded yet.</div>`;
      return;
    }
    // Humanised, icon-coded timeline — replaces the raw action code + JSON dump.
    body.innerHTML = head + `<div class="cd-activity">${acts.map((a) => {
      const meta = (typeof activityMeta === "function") ? activityMeta(a.action) : { icon: "clock", tone: "" };
      const who = a.actor_name || a.actor || "System";
      const text = (typeof humanizeActivity === "function") ? humanizeActivity(a.action, a.detail) : esc(a.action);
      return `<div class="cd-act-item">
        <span class="cd-act-dot ${meta.tone}">${Icon(meta.icon, { size: 13 })}</span>
        <div class="cd-act-text"><b>${esc(who)}</b> ${esc(text)}</div>
        <div class="cd-act-time" title="${a.created_at ? esc(new Date(a.created_at).toLocaleString()) : ""}">${a.created_at ? timeAgo(a.created_at) : ""}</div>
      </div>`;
    }).join("")}</div>`;
  }

  // Topbar actions: Sync Bitrix + Edit contact + View Team
  const syncBtn = document.getElementById("sync-btn");
  const editBtn = document.getElementById("edit-btn");
  const rosterBtn = document.getElementById("team-roster-btn");
  if (!writable) {
    if (syncBtn) syncBtn.remove();
    if (editBtn) editBtn.remove();
  }
  if (rosterBtn) {
    rosterBtn.onclick = async () => {
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
    };
  }
  if (syncBtn) syncBtn.addEventListener("click", async () => {
    try {
      const r = await Api.post(`/api/bitrix/sync?client_id=${clientId}`);
      toast(`Synced ${r.synced_projects} project(s)`, "success");
      loaded["tab-proj"] = true;
      await loadProjects();
    } catch (e) { toast(e.message); }
  });
  if (editBtn) editBtn.addEventListener("click", () => {
    ClientEditModal.open(client, async () => { await loadClient(); });
  });

  const lpSaveBtn = document.getElementById("lp-save-btn");
  if (lpSaveBtn) {
    lpSaveBtn.onclick = async () => {
      const groupId = document.getElementById("lp-group-select").value;
      if (!groupId) return toast("Select a project group");
      lpSaveBtn.disabled = true;
      lpSaveBtn.textContent = "Linking...";
      try {
        await Api.post("/api/bitrix/link-project", { client_id: clientId, bitrix_group_id: groupId });
        invalidateProjectsCache();
        toast("Project group linked successfully", "success");
        bootstrap.Modal.getOrCreateInstance(document.getElementById("linkProjectModal")).hide();
        loaded["tab-proj"] = true;
        await loadProjects();
        await loadConversations();
      } catch (e) {
        toast(e.message);
      } finally {
        lpSaveBtn.disabled = false;
        lpSaveBtn.textContent = "Link Project";
      }
    };
  }

  // ── Media gallery (WhatsApp-style: all shared photos/videos/audio/docs) ──
  const _tok = (u) => u.startsWith("http") ? u : u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(Api.token());
  const _isImg = (n) => /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(n || "");
  const _isVid = (n) => /\.(mp4|mov|m4v|webm|avi|mkv|3gp|ogv)$/i.test(n || "");

  function openMediaLightbox(url, isVideo) {
    let el = document.getElementById("media-lightbox");
    if (!el) {
      el = document.createElement("div");
      el.id = "media-lightbox";
      el.innerHTML = `<button class="ml-close" aria-label="Close">${Icon("x", { size: 22 })}</button><div class="ml-content"></div>`;
      document.body.appendChild(el);
      const close = () => { el.classList.remove("show"); el.querySelector(".ml-content").innerHTML = ""; };
      el.addEventListener("click", (e) => { if (e.target === el) close(); });
      el.querySelector(".ml-close").addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    }
    const content = el.querySelector(".ml-content");
    content.innerHTML = isVideo
      ? `<video src="${url}" controls autoplay></video>`
      : `<img src="${url}" alt="" />`;
    const media = content.querySelector(isVideo ? "video" : "img");
    media.addEventListener("error", () => {
      el.classList.remove("show"); content.innerHTML = "";
      toast("This file is no longer available on the server.");
    }, { once: true });
    el.classList.add("show");
  }

  async function loadMedia() {
    const body = document.getElementById("media-body");
    try {
      const [files, audios] = await Promise.all([
        Api.get(`/api/files?client_id=${clientId}`).catch(() => []),
        Api.get(`/api/audio?client_id=${clientId}`).catch(() => []),
      ]);
      const images = [], videos = [], audioList = [], docs = [];
      files.forEach((f) => {
        if (f.content_type === "url") { docs.push({ name: f.filename, href: f.storage_key, isLink: true }); return; }
        const url = `/api/files/${f.id}/download`;
        if ((f.content_type || "").startsWith("image/") || _isImg(f.filename)) images.push({ name: f.filename, url });
        else if ((f.content_type || "").startsWith("video/") || _isVid(f.filename)) videos.push({ name: f.filename, url });
        else docs.push({ name: f.filename, url });
      });
      audios.forEach((a) => {
        const url = `/api/audio/${a.id}/download`;
        if ((a.content_type || "").startsWith("video/") || _isVid(a.filename)) videos.push({ name: a.filename, url });
        else audioList.push({ name: a.filename, url });
      });

      if (!(images.length + videos.length + audioList.length + docs.length)) {
        body.innerHTML = `<div class="empty"><span class="em-ico">${Icon("folderOpen", { size: 26 })}</span>No media has been shared in this conversation yet.</div>`;
        return;
      }

      let html = "";
      if (images.length || videos.length) {
        html += `<div class="media-section"><h6>Photos &amp; Videos <span class="muted">(${images.length + videos.length})</span></h6><div class="media-grid">`;
        images.forEach((m) => { html += `<button class="media-cell" data-img="${_tok(m.url)}" title="${esc(m.name)}"><img loading="lazy" src="${_tok(m.url)}" alt="" /></button>`; });
        videos.forEach((m) => { html += `<button class="media-cell video" data-vid="${_tok(m.url)}" title="${esc(m.name)}"><video preload="metadata" src="${_tok(m.url)}#t=0.1"></video><span class="media-play"><svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></span></button>`; });
        html += `</div></div>`;
      }
      if (audioList.length) {
        html += `<div class="media-section"><h6>Audio <span class="muted">(${audioList.length})</span></h6><div class="media-list">`;
        audioList.forEach((m) => { html += `<div class="media-row"><div class="mr-info"><div class="mr-name">${esc(m.name)}</div><audio controls preload="none" src="${_tok(m.url)}" style="width:100%;max-width:320px;height:34px;margin-top:6px"></audio></div></div>`; });
        html += `</div></div>`;
      }
      if (docs.length) {
        html += `<div class="media-section"><h6>Documents <span class="muted">(${docs.length})</span></h6><div class="media-list">`;
        docs.forEach((m) => {
          const href = m.isLink ? m.href : _tok(m.url);
          const ext = m.isLink ? "LINK" : (m.name || "file").split(".").pop().toUpperCase().slice(0, 4);
          html += `<a class="media-row doc" href="${esc(href)}" target="_blank" rel="noopener"><span class="doc-ic">${esc(ext)}</span><div class="mr-info"><div class="mr-name">${esc(m.name)}</div><div class="mr-sub">${m.isLink ? "Open link" : "Download"}</div></div>${Icon("download", { size: 15 })}</a>`;
        });
        html += `</div></div>`;
      }
      body.innerHTML = html;

      // Some files are DB rows whose bytes are missing on disk (e.g. after a
      // server/region move) and return 404. Mark those cells as unavailable
      // instead of showing a silent grey box, and block their click.
      body.querySelectorAll(".media-cell img, .media-cell video").forEach((el) => {
        el.addEventListener("error", () => {
          const cell = el.closest(".media-cell");
          if (cell && !cell.classList.contains("unavailable")) {
            cell.classList.add("unavailable");
            cell.insertAdjacentHTML("beforeend",
              `<span class="media-missing">${Icon("alert", { size: 16 })}<span>Unavailable</span></span>`);
          }
        }, { once: true });
      });

      const openCell = (c, isVideo) => {
        if (c.classList.contains("unavailable")) { toast("This file is no longer available on the server."); return; }
        openMediaLightbox(c.dataset.img || c.dataset.vid, isVideo);
      };
      body.querySelectorAll(".media-cell[data-img]").forEach((c) => c.addEventListener("click", () => openCell(c, false)));
      body.querySelectorAll(".media-cell[data-vid]").forEach((c) => c.addEventListener("click", () => openCell(c, true)));
    } catch (e) {
      body.innerHTML = `<div class="text-danger p-3">Could not load media: ${esc(e.message)}</div>`;
    }
  }

  // Lazy-load tabs on first show.
  const loaders = {
    "tab-conv": loadConversations, "tab-media": loadMedia, "tab-proj": loadProjects,
    "tab-files": loadFiles, "tab-audio": loadAudio, "tab-activity": loadActivity,
  };
  const loaded = {};
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach((btn) => {
    btn.addEventListener("shown.bs.tab", (e) => {
      const id = e.target.getAttribute("data-bs-target").slice(1);
      if (loaders[id] && !loaded[id]) { loaded[id] = true; loaders[id](); }
    });
  });

  await loadClient();

  // If arriving via ?tab=, open that tab (e.g. the Documents page "open location"
  // button links here with ?tab=files).
  const wantTab = (qs("tab") || "").toLowerCase();
  const TAB_TARGETS = { conv: "#tab-conv", media: "#tab-media", proj: "#tab-proj", files: "#tab-files", audio: "#tab-audio", activity: "#tab-activity" };
  if (wantTab && TAB_TARGETS[wantTab]) {
    const tabBtn = document.querySelector(`[data-bs-target="${TAB_TARGETS[wantTab]}"]`);
    if (tabBtn) new bootstrap.Tab(tabBtn).show();
  }

  // If arriving via ?conv=, jump straight to that conversation.
  const convId = qs("conv");
  if (convId) {
    const tabBtn = document.querySelector('[data-bs-target="#tab-conv"]');
    new bootstrap.Tab(tabBtn).show();
    loaded["tab-conv"] = true;
    await loadConversations();
    openConversation(parseInt(convId));
  }
})();
