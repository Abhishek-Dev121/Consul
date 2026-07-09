(async function () {
  const writable = canWrite();
  const actions = writable ? `<button class="btn btn-primary" id="upload-btn" data-bs-toggle="modal" data-bs-target="#uploadModal">⬆ Upload document</button>` : "";
  await renderLayout("/documents", "Documents", { crumb: "Contracts, specs & project files", actions });

  function typeOf(name, ct, key) {
    if (ct === "url") {
      const url = (key || "").toLowerCase();
      if (url.includes("sheet") || url.includes("excel")) return { t: "XLS", c: "#1F9D6B", cat: "Spreadsheet" };
      if (url.includes("doc") || url.includes("word") || url.includes("document")) return { t: "DOC", c: "#2C5AB8", cat: "Document" };
      if (url.includes("slide") || url.includes("presentation") || url.includes("ppt")) return { t: "PPT", c: "#E2574C", cat: "Presentation" };
      return { t: "LINK", c: "#0E8C8C", cat: "Link" };
    }
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf" || (ct || "").includes("pdf")) return { t: "PDF", c: "#D2473D", cat: "Document" };
    if (["doc", "docx"].includes(ext)) return { t: "DOC", c: "#2C5AB8", cat: "Document" };
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return { t: "IMG", c: "#1F9D6B", cat: "Image" };
    if (["xls", "xlsx", "csv"].includes(ext)) return { t: "XLS", c: "#1F9D6B", cat: "Spreadsheet" };
    if (["ppt", "pptx"].includes(ext)) return { t: "PPT", c: "#E2574C", cat: "Presentation" };
    if (ext === "txt") return { t: "TXT", c: "#8A94A6", cat: "Text" };
    return { t: (ext || "FILE").slice(0, 4).toUpperCase(), c: "#8A94A6", cat: "File" };
  }
  const size = (b) => (b ? (b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : (b / 1024).toFixed(0) + " KB") : "—");

  let docs = [], cat = "All", activeClientFolder = "all";
  let page = 1;
  const pageSize = 10;

  function render() {
    const cats = ["All", "Document", "Image", "Spreadsheet", "Presentation", "Link", "File"];
    
    // Group files by client folders
    const folderCounts = {};
    docs.forEach((d) => {
      folderCounts[d.client] = (folderCounts[d.client] || 0) + 1;
    });
    const uniqueClients = Object.keys(folderCounts).sort();

    const allActive = activeClientFolder === "all";
    const allFolderHtml = `
      <div class="card p-3 d-flex flex-row align-items-center gap-3 folder-card ${allActive ? 'border-primary bg-primary-subtle' : ''}" 
           style="cursor:pointer; width:220px; flex-shrink:0; border-radius:10px" 
           onclick="window.selectFolder('all')">
        <div class="folder-icon text-primary" style="font-size:24px">&#128193;</div>
        <div style="min-width:0; flex:1">
          <strong style="font-size:13.5px; display:block">All Folders</strong>
          <span class="text-muted" style="font-size:11.5px">${docs.length} files</span>
        </div>
      </div>`;

    const foldersHtml = uniqueClients.map(cName => {
      const count = folderCounts[cName];
      const isActive = cName === activeClientFolder;
      return `
        <div class="card p-3 d-flex flex-row align-items-center gap-3 folder-card ${isActive ? 'border-primary bg-primary-subtle' : ''}" 
             style="cursor:pointer; width:220px; flex-shrink:0; border-radius:10px" 
             onclick="window.selectFolder('${esc(cName)}')">
          <div class="folder-icon text-warning" style="font-size:24px">&#128194;</div>
          <div style="min-width:0; flex:1">
            <strong style="font-size:13.5px; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${esc(cName)}</strong>
            <span class="text-muted" style="font-size:11.5px">${count} file${count === 1 ? '' : 's'}</span>
          </div>
        </div>`;
    }).join("");

    const filteredDocs = activeClientFolder === "all" ? docs : docs.filter(d => d.client === activeClientFolder);
    const list = filteredDocs.filter((d) => cat === "All" || typeOf(d.filename, d.content_type, d.storage_key).cat === cat);

    const totalPages = Math.ceil(list.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    const paginated = list.slice((page - 1) * pageSize, page * pageSize);

    let pagerHtml = "";
    if (list.length > pageSize) {
      pagerHtml = `
        <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top" style="width: 100%;">
          <span class="muted small">Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, list.length)} of ${list.length} documents</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-soft" id="docs-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
            <button class="btn btn-sm btn-soft" id="docs-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
          </div>
        </div>`;
    }

    const cardsHtml = paginated.length ? paginated.map((d) => {
      const ty = typeOf(d.filename, d.content_type, d.storage_key);
      const clickAction = d.content_type === "url"
        ? `window.open('${esc(d.storage_key)}','_blank')`
        : `window.open('/api/files/${d.id}/download','_blank')`;
      
      let aiButton = "";
      let analysisBox = "";
      
      if (d.analysis) {
        aiButton = `<button class="btn btn-sm btn-info text-white ms-2" style="font-size:11px;padding:3px 8px" onclick="event.stopPropagation(); toggleAIAnalysis(${d.id})">✨ View AI</button>`;
        
        const a = d.analysis;
        const keyPoints = (a.key_points || []).map(p => `<li>${esc(p)}</li>`).join("");
        const actions = (a.pending_actions || []).map(p => `<li>${esc(p)}</li>`).join("");
        const sentimentClass = a.sentiment === 'positive' ? 'success' : a.sentiment === 'negative' ? 'danger' : 'secondary';
        
        analysisBox = `
          <div class="doc-analysis-box d-none mt-3 p-3 bg-light rounded border text-start" id="ai-box-${d.id}" onclick="event.stopPropagation();">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong style="font-size:13px">✨ AI Analysis</strong>
              <span class="badge bg-${sentimentClass}-subtle text-${sentimentClass}-emphasis" style="font-size:10px">${(a.sentiment || 'neutral').toUpperCase()}</span>
            </div>
            <p class="mb-2 text-muted" style="font-size:12.5px;line-height:1.4"><strong>Summary:</strong> ${esc(a.summary || "No summary available.")}</p>
            <div class="row g-2">
              <div class="col-sm-6">
                <strong style="font-size:11.5px">Key Points:</strong>
                <ul class="text-muted ps-3 mb-0" style="font-size:11.5px;max-height:100px;overflow-y:auto">${keyPoints || "<li>—</li>"}</ul>
              </div>
              <div class="col-sm-6">
                <strong style="font-size:11.5px">Pending Actions:</strong>
                <ul class="text-muted ps-3 mb-0" style="font-size:11.5px;max-height:100px;overflow-y:auto">${actions || "<li>—</li>"}</ul>
              </div>
            </div>
          </div>
        `;
      } else if (writable) {
        aiButton = `<button class="btn btn-sm btn-success ms-2" style="font-size:11px;padding:3px 8px" onclick="event.stopPropagation(); runDocumentAI(${d.id}, this)">🤖 Analyze</button>`;
      }

      return `<div class="doc-card" style="display:flex;flex-direction:column;cursor:pointer;height:auto;padding:16px;box-shadow:var(--sh-s)" onclick="${clickAction}">
        <div style="display:flex;align-items:flex-start;gap:12px;width:100%">
          <div class="doc-ic" style="background:${ty.c};flex-shrink:0;height:40px;width:40px;display:flex;align-items:center;justify-content:center;font-weight:bold;color:white;border-radius:4px">${ty.t}</div>
          <div style="min-width:0;flex-grow:1">
            <h4 style="margin:0 0 4px;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.filename)}</h4>
            <div class="dm" style="font-size:12px;color:var(--muted-2)">${ty.cat} ${d.content_type === "url" ? "" : `· ${size(d.size)}`}</div>
            <div class="dm" style="margin-top:2px;display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted-2)">
              ${esc(d.client)} ${d.project_title ? `<span class="badge bg-secondary-subtle text-secondary-emphasis" style="font-size:9.5px;padding:2px 6px">📂 ${esc(d.project_title)}</span>` : ""}
            </div>
            <div class="dlink" style="font-size:11px;color:var(--muted-2);margin-top:4px">${esc(d.by)} · ${d.created_at ? fmtDate(d.created_at) : ""}</div>
          </div>
          <div style="flex-shrink:0">${aiButton}</div>
        </div>
        ${analysisBox}
      </div>`;
    }).join("") : '<div class="empty" style="grid-column:1/-1"><span class="em-ico">📄</span>No documents yet inside this folder. Upload one from a client profile or using the button above.</div>';

    document.getElementById("view").innerHTML = `
      <div class="page-head"><div><h2>Documents</h2>
        <p>Files linked to clients — contracts, requirements, images and project docs.</p></div></div>
      
      <h3 class="mb-3" style="font-size:15px; font-family:var(--display); color:var(--ink)">Client Folders</h3>
      <div class="d-flex gap-3 mb-4 overflow-x-auto pb-2" style="max-width:100%">
        ${allFolderHtml}
        ${foldersHtml}
      </div>

      <div class="d-flex justify-content-between align-items-center mb-3">
        <h3 style="font-size:15px; font-family:var(--display); color:var(--ink); margin:0">
          ${activeClientFolder === 'all' ? 'All Documents' : esc(activeClientFolder) + ' Documents'}
        </h3>
        <div class="toolbar" style="display:flex;gap:8px;margin:0;flex-wrap:wrap">
          ${cats.map((c) => `<button class="chip ${c === cat ? "info" : ""}" data-c="${c}" style="cursor:pointer">${c}</button>`).join("")}
        </div>
      </div>

      <div class="grid g-4" style="margin-bottom:16px">${cardsHtml}</div>
      ${pagerHtml}`;
    
    document.querySelectorAll("[data-c]").forEach((el) => el.addEventListener("click", () => { cat = el.dataset.c; page = 1; render(); }));

    const prevBtn = document.getElementById("docs-prev");
    const nextBtn = document.getElementById("docs-next");
    if (prevBtn) prevBtn.addEventListener("click", () => { page--; render(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { page++; render(); });
  }

  window.selectFolder = (folderName) => {
    activeClientFolder = folderName;
    page = 1;
    render();
  };

  window.toggleAIAnalysis = (id) => {
    const box = document.getElementById(`ai-box-${id}`);
    if (box) box.classList.toggle("d-none");
  };

  window.runDocumentAI = async (id, btn) => {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
      await Api.post(`/api/files/${id}/analyze`);
      toast("Document analysis complete!", "success");
      docs = await Api.get("/api/overview/documents");
      render();
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  window.toggleUploadType = () => {
    const val = document.getElementById("up-type").value;
    const fGroup = document.getElementById("up-file-group");
    const lGroup = document.getElementById("up-link-group");
    if (val === "file") {
      fGroup.classList.remove("d-none");
      lGroup.classList.add("d-none");
    } else {
      fGroup.classList.add("d-none");
      lGroup.classList.remove("d-none");
    }
  };

  // Upload document
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
        }
      });
    }).catch(() => {});
    
    upClient.addEventListener("change", () => {
      loadProjectsForClient(upClient.value);
    });

    document.getElementById("up-save").addEventListener("click", async () => {
      const cid = upClient.value;
      const pid = upProj.value;
      if (!cid) return toast("Select a client");
      
      const type = document.getElementById("up-type").value;
      const clientName = upClient.options[upClient.selectedIndex].text;
      
      if (type === "file") {
        const file = document.getElementById("up-file").files[0];
        if (!file) return toast("Choose a file");
        const fd = new FormData();
        fd.append("client_id", cid);
        fd.append("upload", file);
        if (pid) fd.append("project_id", pid);
        try {
          await Api.postForm("/api/files", fd);
          bootstrap.Modal.getOrCreateInstance(document.getElementById("uploadModal")).hide();
          document.getElementById("up-file").value = "";
          upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
          docs = await Api.get("/api/overview/documents");
          activeClientFolder = clientName;
          render();
          toast("Document uploaded", "success");
        } catch (e) { toast(e.message); }
      } else {
        const title = document.getElementById("up-link-title").value.trim();
        const url = document.getElementById("up-link-url").value.trim();
        if (!title || !url) return toast("Title and URL are required");
        const fd = new FormData();
        fd.append("client_id", cid);
        fd.append("title", title);
        fd.append("url", url);
        if (pid) fd.append("project_id", pid);
        try {
          await Api.postForm("/api/files/link", fd);
          bootstrap.Modal.getOrCreateInstance(document.getElementById("uploadModal")).hide();
          document.getElementById("up-link-title").value = "";
          document.getElementById("up-link-url").value = "";
          upProj.innerHTML = '<option value="">Select Project (Optional)</option>';
          docs = await Api.get("/api/overview/documents");
          activeClientFolder = clientName;
          render();
          toast("Link added", "success");
        } catch (e) { toast(e.message); }
      }
    });
  }

  try { docs = await Api.get("/api/overview/documents"); render(); } catch (e) { toast(e.message); }
})();
