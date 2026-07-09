(async function () {
  const actions = `<button class="btn btn-primary" id="upload-btn" data-bs-toggle="modal" data-bs-target="#uploadModal">${Icon('upload', { size: 14 })} Upload recording</button>`;
  await renderLayout("/calls", "Call Recordings", { crumb: "Uploaded calls with AI analysis", actions });
  const writable = canWrite();
  if (!writable) { const b = document.getElementById("upload-btn"); if (b) b.remove(); }

  function wave(seed) {
    let x = seed * 9301 + 49297;
    const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    return `<div class="wave">${Array.from({ length: 34 }).map(() => `<i style="height:${20 + Math.round(rnd() * 70)}%"></i>`).join("")}</div>`;
  }
  const dur = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

  let calls = [], clientsList = [];
  let activeClientFolder = "all";

  function list(items) {
    const lab = (t) => `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted-2);font-weight:600;margin-bottom:7px">${t}</div>`;
    return items.length ? items.map((c) => {
      const a = c.analysis;
      const body = a ? `<div class="card-pad" style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:20px;border-top:1px solid var(--line-2)">
          <div>${lab(`${Icon('sparkles', { size: 12 })} AI summary`)}<p style="font-size:12.5px;line-height:1.55">${esc(a.summary || "—")}</p>
            ${a.behavioral_assessment ? `<p style="font-size:11.5px;color:var(--muted);margin-top:8px"><b>Behavior:</b> ${esc(a.behavioral_assessment)}</p>` : ""}</div>
          <div>${lab("Key points")}<ul class="ai-list">${(a.key_points || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>
          <div>${lab("Action items")}<ul class="ai-list todo">${(a.pending_actions || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>
        </div>`
        : `<div class="card-pad" style="border-top:1px solid var(--line-2);display:flex;align-items:center;justify-content:space-between">
            <span class="muted small">No AI analysis yet.</span>
            ${writable ? `<button class="btn btn-soft btn-sm" onclick="analyze(${c.id})">${Icon('sparkles', { size: 14 })} Transcribe & analyze</button>` : ""}</div>`;
      const projBadge = c.project_title ? `<span class="badge bg-secondary-subtle text-secondary-emphasis ms-2" style="font-size:10px">${Icon('folder', { size: 12 })} ${esc(c.project_title)}</span>` : "";
      return `<div class="card">
        <div class="call-row">
          <button class="play" onclick="toast('Open the client profile to play this recording','info')" title="${esc(c.filename)}">▶</button>
          <div style="min-width:160px"><div style="font-weight:600;font-size:13.5px">${esc(c.client)}${projBadge}</div>
            <div style="font-size:11.5px;color:var(--muted-2)">${esc(c.filename)}</div></div>
          ${wave(c.id)}
          <div style="text-align:right;min-width:120px"><div class="mono" style="font-size:13px;font-weight:600">${dur(c.duration)}</div>
            <div style="font-size:11px;color:var(--muted-2)">${c.created_at ? fmtDate(c.created_at) : ""}</div></div>
          ${a ? sentPill(a.sentiment) : ""}
        </div>${body}</div>`;
    }).join("") : `<div class="empty"><span class="em-ico">${Icon('phone', { size: 24 })}</span>No call recordings yet inside this folder. Upload one using the button above.</div>`;
  }

  function render() {
    const folderCounts = {};
    clientsList.forEach(c => {
      folderCounts[c.name] = 0;
    });
    calls.forEach(c => {
      if (folderCounts[c.client] !== undefined) {
        folderCounts[c.client] += 1;
      } else {
        folderCounts[c.client] = 1;
      }
    });
    
    const uniqueClients = clientsList.map(c => c.name).sort();
    
    const foldersHtml = uniqueClients.map(cName => {
      const count = folderCounts[cName];
      const isActive = cName === activeClientFolder;
      return `
        <div class="card p-3 d-flex flex-row align-items-center gap-3 folder-card ${isActive ? 'border-primary bg-primary-subtle' : ''}" 
             style="cursor:pointer; width:220px; flex-shrink:0; transition: all 0.12s; user-select:none" 
             onclick="window.selectFolder('${esc(cName)}')">
          <span style="font-size:28px">${Icon('folder', { size: 22 })}</span>
          <div style="min-width:0; flex-grow:1">
            <div class="fw-bold text-truncate" style="font-size:13.5px; color:var(--ink)">${esc(cName)}</div>
            <div class="text-muted" style="font-size:11px">${count} recording${count === 1 ? '' : 's'}</div>
          </div>
        </div>
      `;
    }).join("");
    
    const allActive = activeClientFolder === "all";
    const allFolderHtml = `
      <div class="card p-3 d-flex flex-row align-items-center gap-3 folder-card ${allActive ? 'border-primary bg-primary-subtle' : ''}" 
           style="cursor:pointer; width:220px; flex-shrink:0; transition: all 0.12s; user-select:none" 
           onclick="window.selectFolder('all')">
        <span style="font-size:28px">${Icon('folderOpen', { size: 22 })}</span>
        <div style="min-width:0; flex-grow:1">
          <div class="fw-bold text-truncate" style="font-size:13.5px; color:var(--ink)">All Recordings</div>
          <div class="text-muted" style="font-size:11px">${calls.length} total</div>
        </div>
      </div>
    `;

    const filteredCalls = activeClientFolder === "all" 
      ? calls 
      : calls.filter(c => c.client === activeClientFolder);

    document.getElementById("view").innerHTML = `
      <div class="page-head">
        <div>
          <h2>Call Recordings</h2>
          <p>Uploaded recordings with AI-generated summaries, key points and action items.</p>
        </div>
      </div>
      
      <h3 class="mb-3" style="font-size:15px; font-family:var(--display); color:var(--ink)">Client Folders</h3>
      <div class="d-flex gap-3 mb-4 overflow-auto pb-2" style="scrollbar-width: thin;">
        ${allFolderHtml}
        ${foldersHtml}
      </div>
      
      <h3 class="mb-3" style="font-size:15px; font-family:var(--display); color:var(--ink)">
        ${activeClientFolder === 'all' ? 'All Recordings' : esc(activeClientFolder) + ' Recordings'}
      </h3>
      <div style="display:flex;flex-direction:column;gap:16px">${list(filteredCalls)}</div>
    `;
  }

  window.selectFolder = (folderName) => {
    activeClientFolder = folderName;
    render();
  };

  window.analyze = async (id) => {
    toast("Transcribing with Deepgram + analyzing…", "info");
    try { 
      await Api.post(`/api/audio/${id}/analyze`); 
      calls = await Api.get("/api/overview/calls"); 
      render(); 
      toast("Analysis complete", "success"); 
    } catch (e) { toast(e.message); }
  };

  // Upload recording
  if (writable) {
    const upClient = document.getElementById("up-client");
    const upProj = document.getElementById("up-project");
    
    const loadProjectsForClient = async (cid) => {
      if (!cid) {
        upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
        return;
      }
      try {
        const projects = await Api.get(`/api/projects?client_id=${cid}`);
        upProj.innerHTML = '<option value="">Select Project (Optional)</option>' +
          projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
      } catch (e) {
        upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
      }
    };
    
    Api.get("/api/overview/clients").then((cl) => {
      upClient.innerHTML = '<option value="">Select a client...</option>' + 
        cl.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
      
      // Auto pre-select client if user is currently inside a client folder
      document.getElementById("upload-btn")?.addEventListener("click", () => {
        if (activeClientFolder !== "all") {
          const opts = Array.from(upClient.options);
          const match = opts.find(o => o.text === activeClientFolder);
          if (match) {
            upClient.value = match.value;
            loadProjectsForClient(match.value);
          }
        } else {
          upClient.value = "";
          upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
        }
      });
    }).catch(() => {});
    
    upClient.addEventListener("change", () => {
      loadProjectsForClient(upClient.value);
    });

    document.getElementById("up-save").addEventListener("click", async () => {
      const cid = upClient.value;
      const pid = upProj.value;
      const file = document.getElementById("up-file").files[0];
      if (!cid) return toast("Select a client");
      if (!file) return toast("Choose an audio file");
      
      const clientName = upClient.options[upClient.selectedIndex].text;
      const fd = new FormData();
      fd.append("client_id", cid);
      fd.append("upload", file);
      if (pid) fd.append("project_id", pid);
      
      try {
        await Api.postForm("/api/audio", fd);
        bootstrap.Modal.getOrCreateInstance(document.getElementById("uploadModal")).hide();
        document.getElementById("up-file").value = "";
        upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
        calls = await Api.get("/api/overview/calls");
        activeClientFolder = clientName;
        render();
        toast("Recording uploaded", "success");
      } catch (e) { toast(e.message); }
    });
  }

  try { 
    const [cls, allCalls] = await Promise.all([
      Api.get("/api/overview/clients"),
      Api.get("/api/overview/calls")
    ]);
    clientsList = cls;
    calls = allCalls;
    render(); 
  } catch (e) { toast(e.message); }
})();
