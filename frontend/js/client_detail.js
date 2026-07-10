(async function () {
  const clientId = parseInt(qs("id"));
  if (!clientId) { location.href = "/clients"; return; }

  const actions = `<a class="btn btn-soft" href="/chat?id=${clientId}">${Icon("message", { size: 14 })} Chat</a>
    <button class="btn btn-soft" id="team-roster-btn">${Icon("users", { size: 14 })} Project Team</button>
    <button class="btn btn-soft" id="edit-btn">${Icon("edit", { size: 14 })} Edit</button>
    <button class="btn btn-primary" id="sync-btn">⟳ Sync Bitrix24</button>`;
  await renderLayout("/clients", "Client profile", { crumb: "Clients", actions });
  const writable = canWrite();

  function setTitle(name) {
    const h = document.querySelector("#app-topbar .page-h");
    if (h) h.textContent = name;
  }

  let client = null;

  async function loadClient() {
    client = await Api.get(`/api/clients/${clientId}`);
    setTitle(client.name);
    renderInfo();
  }

  function renderInfo() {
    document.getElementById("info-body").innerHTML = `
      <div class="row g-3">
        <div class="col-md-6"><div class="card"><div class="card-header">Contact</div><div class="card-body">
          <p class="mb-1"><strong>Company:</strong> ${esc(client.company || "—")}</p>
          <p class="mb-1"><strong>Email:</strong> ${esc(client.email || "—")}</p>
          <p class="mb-1"><strong>Phone:</strong> ${esc(client.phone || "—")}</p>
          <p class="mb-1"><strong>Status:</strong> <span class="badge bg-secondary">${esc(client.status)}</span></p>
          <p class="mb-0"><strong>Notes:</strong> ${esc(client.notes || "—")}</p>
        </div></div></div>
        <div class="col-md-6"><div class="card"><div class="card-header">Team & Channels</div><div class="card-body">
          <p class="mb-1"><strong>Assignees:</strong> ${client.assignees.map((a) => esc(a.name)).join(", ") || "—"}</p>
          <p class="mb-0"><strong>Channels:</strong> ${client.channels.map((c) => `<span class="badge bg-info text-dark me-1">${esc(c.name)}</span>`).join("") || "—"}</p>
        </div></div></div>
      </div>`;
  }

  // ---- Conversations tab ----
  async function loadConversations() {
    const convos = await Api.get(`/api/conversations?client_id=${clientId}`);
    const body = document.getElementById("conv-body");
    const addBtn = writable
      ? `<button class="btn btn-sm btn-primary mb-3" onclick="addConversation()">+ Log conversation</button>` : "";
    if (!convos.length) { body.innerHTML = addBtn + '<p class="muted">No conversations.</p>'; return; }
    body.innerHTML = addBtn + `<div class="list-group">` + convos.map((c) => `
      <button class="list-group-item list-group-item-action" onclick="openConversation(${c.id})">
        <div class="d-flex justify-content-between"><strong>${esc(c.title || "Untitled")}</strong>
          <span class="small muted">${fmtDate(c.created_at)}</span></div></button>`).join("") + `</div>`;
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
    
    const linkBtn = writable
      ? `<button class="btn btn-sm btn-primary mb-3" onclick="openLinkProjectModal()">+ Link Bitrix24 Project</button>`
      : "";
      
    if (!projects.length) {
      body.innerHTML = linkBtn + '<p class="muted">No linked projects. Use "Link Bitrix24 Project".</p>';
      return;
    }
    
    const cards = projects.map((p) => {
      const totalTasks = p.tasks.length;
      const doneStatuses = ["done", "completed", "complete", "closed", "won", "5"];
      const doneTasks = p.tasks.filter((t) => doneStatuses.includes((t.status || "").toLowerCase())).length;
      const prog = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
      
      const membersHtml = p.members.map((m) => {
        return `<span class="badge bg-light text-dark border me-1 mb-1" title="${esc(m.work_position || 'Member')}">${esc(m.name)} (${esc(m.role)})</span>`;
      }).join("") || '<span class="muted small">No members synced</span>';

      const tasksRows = p.tasks.map((t) => {
        const priorityBadge = t.priority === "2" ? `<span class="badge bg-danger">Urgent</span>` : t.priority === "1" ? `<span class="badge bg-warning text-dark">High</span>` : `<span class="badge bg-secondary">Normal</span>`;
        const estText = t.time_estimate ? `${Math.round(t.time_estimate / 3600)}h` : "—";
        return `<tr>
          <td>
            <strong>${esc(t.title)}</strong>
            ${t.description ? `<div class="text-muted small mt-1" style="max-height: 80px; overflow: auto; white-space: pre-line; font-size:11px;">${esc(t.description)}</div>` : ""}
          </td>
          <td>${esc(t.responsible_name || 'Unassigned')}</td>
          <td><span class="badge bg-light text-dark border">${esc(t.status || 'Pending')}</span></td>
          <td>${priorityBadge}</td>
          <td>${estText}</td>
          <td class="mono small">${t.due_date ? fmtDate(t.due_date).split(",")[0] : '—'}</td>
        </tr>`;
      }).join("");

      const tasksTable = totalTasks > 0
        ? `<table class="table table-sm mt-3 table-borderless">
            <thead>
              <tr class="table-light">
                <th>Task Details</th>
                <th>Assignee</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Est</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              ${tasksRows}
            </tbody>
           </table>`
        : '<p class="text-muted small mt-3">No tasks in this project group.</p>';

      return `<div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
          <div>
            <h5 class="mb-0 d-inline-block">${esc(p.title)}</h5>
            <span class="badge bg-info text-dark ms-2">ID: ${esc(p.bitrix_project_id)}</span>
          </div>
          <span class="badge bg-secondary">${esc(p.status || "—")}</span>
        </div>
        <div class="card-body">
          ${p.description ? `<p class="text-muted mb-3">${esc(p.description)}</p>` : ""}
          <div class="mb-2"><strong>Team Members:</strong></div>
          <div class="mb-3 d-flex flex-wrap">${membersHtml}</div>
          
          <div class="mb-1 d-flex justify-content-between align-items-center">
            <strong>Tasks Progress:</strong>
            <span class="mono small">${doneTasks} / ${totalTasks} (${prog}%)</span>
          </div>
          <div class="pbar mb-3" style="height: 8px;">
            <div style="width: ${prog}%; background: ${prog === 100 ? "var(--pos)" : "var(--brand)"}"></div>
          </div>
          
          ${tasksTable}
          
          ${writable ? `<div class="d-flex gap-2 mt-3">
            <button class="btn btn-sm btn-outline-primary" onclick="syncProject(${p.id})">⟳ Re-sync Group</button>
            <button class="btn btn-sm btn-outline-danger" onclick="unlinkProject(${p.id})">${Icon("trash", { size: 14 })} Unlink Project</button>
          </div>` : ""}
        </div>
      </div>`;
    }).join("");
    
    body.innerHTML = linkBtn + cards;
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
      toast("Project synced successfully", "success");
      await loadProjects();
      await loadConversations();
    } catch (e) {
      toast(e.message);
    }
  };

  window.unlinkProject = async (id) => {
    if (!confirm("Are you sure you want to unlink this project? This does not delete the group in Bitrix24.")) return;
    try {
      await Api.del(`/api/bitrix/link-project/${id}`);
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

  // ---- Files tab ----
  async function loadFiles() {
    const [files, projects] = await Promise.all([
      Api.get(`/api/files?client_id=${clientId}`),
      getClientProjects()
    ]);
    const body = document.getElementById("files-body");
    
    let uploader = "";
    if (writable) {
      const projOpts = projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
      const projSelect = projects.length > 1 ? `
        <select class="form-select form-select-sm mb-2" id="f-project-select">
          <option value="">Select Project (Optional)</option>
          ${projOpts}
        </select>
      ` : "";
      uploader = `
        <div class="row g-2 mb-3" style="max-width:720px">
          <div class="col-sm-6">
            <div class="input-group">
              <input type="file" class="form-control form-control-sm" id="f-upload">
              <button class="btn btn-primary btn-sm" onclick="uploadFile()">Upload File</button>
            </div>
          </div>
          <div class="col-sm-6">
            <div class="input-group mb-1">
              <input type="text" class="form-control form-control-sm" id="f-link-title" placeholder="Link Title (e.g. Google Sheets)">
              <input type="text" class="form-control form-control-sm" id="f-link-url" placeholder="https://...">
              <button class="btn btn-primary btn-sm" onclick="addFileLink()">Add Link</button>
            </div>
            ${projSelect}
          </div>
        </div>
      `;
    }
    
    const rows = files.map((f) => {
      const isLink = f.content_type === "url";
      const label = isLink ? `${Icon("external", { size: 14 })} Open Link` : `${Icon("download", { size: 14 })} Download`;
      const href = isLink ? f.storage_key : `/api/files/${f.id}/download`;
      const badgeCls = isLink ? "bg-success-subtle text-success-emphasis" : "bg-light text-dark border";
      const badgeText = isLink ? "LINK" : (f.content_type || "FILE").toUpperCase().slice(0, 16);
      const projBadge = f.project_title ? `<span class="badge bg-secondary-subtle text-secondary-emphasis ms-2" style="font-size:10px">${Icon("folder", { size: 12 })} ${esc(f.project_title)}</span>` : "";

      let actionBtns = `<a class="btn btn-sm ${isLink ? "btn-outline-success" : "btn-outline-secondary"} me-1" href="${esc(href)}" target="_blank">${label}</a>`;

      if (f.analysis) {
        actionBtns += `<button class="btn btn-sm btn-info text-white me-1" type="button" data-bs-toggle="collapse" data-bs-target="#doc-analysis-${f.id}">${Icon("sparkles", { size: 14 })} View AI</button>`;
      } else if (writable) {
        actionBtns += `<button class="btn btn-sm btn-success me-1" onclick="analyzeDocument(${f.id}, this)">${Icon("bot", { size: 14 })} Analyze</button>`;
      }

      if (writable) {
        actionBtns += `<button class="btn btn-sm btn-outline-danger" onclick="deleteDocument(${f.id})">${Icon("trash", { size: 14 })}</button>`;
      }

      let analysisRow = "";
      if (f.analysis) {
        const a = f.analysis;
        const keyPointsList = (a.key_points || []).map(p => `<li>${esc(p)}</li>`).join("");
        const actionsList = (a.pending_actions || []).map(p => `<li>${esc(p)}</li>`).join("");
        const followList = (a.follow_ups || []).map(p => `<li>${esc(p)}</li>`).join("");
        const sentimentPill = `
          <span class="badge bg-${a.sentiment === 'positive' ? 'success' : a.sentiment === 'negative' ? 'danger' : 'secondary'}-subtle text-${a.sentiment === 'positive' ? 'success' : a.sentiment === 'negative' ? 'danger' : 'secondary'}-emphasis">
            ${(a.sentiment || 'neutral').toUpperCase()} (${(a.sentiment_score || 0).toFixed(2)})
          </span>
        `;
        
        analysisRow = `
          <tr class="collapse border-0" id="doc-analysis-${f.id}">
            <td colspan="3" class="bg-light p-3">
              <div class="card shadow-sm border-0">
                <div class="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
                  <span>${Icon("sparkles", { size: 16 })} Document AI Analysis</span>
                  ${sentimentPill}
                </div>
                <div class="card-body">
                  <div class="mb-3"><strong>Summary:</strong> <p class="mb-0 text-muted" style="font-size:13.5px">${esc(a.summary || "No summary available.")}</p></div>
                  <div class="row">
                    <div class="col-md-4">
                      <strong>Key Points:</strong>
                      <ul class="text-muted ps-3 mb-0" style="font-size:13px">${keyPointsList || "<li>—</li>"}</ul>
                    </div>
                    <div class="col-md-4">
                      <strong>Pending Actions:</strong>
                      <ul class="text-muted ps-3 mb-0" style="font-size:13px">${actionsList || "<li>—</li>"}</ul>
                    </div>
                    <div class="col-md-4">
                      <strong>Follow-ups:</strong>
                      <ul class="text-muted ps-3 mb-0" style="font-size:13px">${followList || "<li>—</li>"}</ul>
                    </div>
                  </div>
                  <div class="mt-2 text-end text-muted small" style="font-size:11px">Model: ${esc(a.model || "gpt-4o-mini")}</div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }

      return `<tr>
        <td><span class="fw-semibold">${esc(f.filename)}</span>${projBadge}</td>
        <td><span class="badge ${badgeCls}">${esc(badgeText)}</span></td>
        <td><div class="d-flex align-items-center">${actionBtns}</div></td>
      </tr>${analysisRow}`;
    }).join("");
    
    body.innerHTML = uploader + (files.length
      ? `<table class="table align-middle"><thead><tr><th>Name</th><th>Format</th><th style="width:200px">Action</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">No files.</p>');
  }

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
    if (!confirm("Are you sure you want to delete this file? This will remove it from the disk permanently.")) return;
    try {
      await Api.delete(`/api/files/${id}`);
      toast("File deleted", "success");
      await loadFiles();
    } catch (e) {
      toast(e.message);
    }
  };

  // ---- Audio tab ----
  async function loadAudio() {
    const [items, projects] = await Promise.all([
      Api.get(`/api/audio?client_id=${clientId}`),
      getClientProjects()
    ]);
    const body = document.getElementById("audio-body");
    
    let uploader = "";
    if (writable) {
      const projOpts = projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
      const projSelect = projects.length > 1 ? `
        <select class="form-select form-select-sm w-auto me-2" id="a-project-select">
          <option value="">Select Project (Optional)</option>
          ${projOpts}
        </select>
      ` : "";
      uploader = `<div class="d-flex flex-wrap align-items-center gap-2 mb-3" style="max-width:640px">
        <input type="file" accept="audio/*,video/*" class="form-control form-control-sm w-auto flex-grow-1" id="audio-input" />
        ${projSelect}
        <button class="btn btn-primary btn-sm" onclick="uploadAudio()">Upload</button></div>`;
    }
    
    const cards = items.map((a) => {
      const projBadge = a.project_title ? `<span class="badge bg-secondary-subtle text-secondary-emphasis ms-2" style="font-size:10px">${Icon("folder", { size: 12 })} ${esc(a.project_title)}</span>` : "";
      return `<div class="card mb-2"><div class="card-body">
        <div class="d-flex justify-content-between align-items-center">
          <div><strong>${esc(a.filename)}</strong>${projBadge}</div>
          ${writable ? `<button class="btn btn-sm btn-success" onclick="analyzeAudio(${a.id})">${Icon("bot", { size: 14 })} Transcribe & analyze</button>` : ""}
        </div>
        <div class="small muted">Duration: ${a.duration ? a.duration.toFixed(1) + "s" : "—"}</div>
        <div id="audio-analysis-${a.id}" class="mt-2"></div></div></div>`;
    }).join("");
    
    body.innerHTML = uploader + (items.length ? cards : '<p class="muted">No audio recordings.</p>');
    // Lazy-load any existing analysis.
    for (const a of items) {
      Api.get(`/api/audio/${a.id}/analysis`).then((an) => {
        if (an) document.getElementById(`audio-analysis-${a.id}`).innerHTML =
          `<div class="card"><div class="card-body">${renderAnalysis(an)}</div></div>`;
      }).catch(() => {});
    }
  }

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
    body.innerHTML = acts.length
      ? `<ul class="list-group">${acts.map((a) => `<li class="list-group-item d-flex justify-content-between">
          <span><code>${esc(a.action)}</code> <span class="small">${esc(JSON.stringify(a.detail))}</span></span>
          <span class="small muted">${fmtDate(a.created_at)}</span></li>`).join("")}</ul>`
      : '<p class="muted">No activity.</p>';
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
    el.querySelector(".ml-content").innerHTML = isVideo
      ? `<video src="${url}" controls autoplay></video>`
      : `<img src="${url}" alt="" />`;
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
      body.querySelectorAll(".media-cell[data-img]").forEach((c) => c.addEventListener("click", () => openMediaLightbox(c.dataset.img, false)));
      body.querySelectorAll(".media-cell[data-vid]").forEach((c) => c.addEventListener("click", () => openMediaLightbox(c.dataset.vid, true)));
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
