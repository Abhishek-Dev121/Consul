(async function () {
  // Matches the Call Recordings page: no top-bar search (the page has its own
  // filter toolbar) and no upload button (files and links are added from a
  // client's profile page).
  await renderLayout("/documents", "Documents", {
    crumb: "Contracts, specs & project files",
    hideSearch: true,
    hideActions: true,
  });
  const writable = canWrite();

  function typeOf(name, ct, key) {
    if (ct === "url") {
      const url = (key || "").toLowerCase();
      if (url.includes("sheet") || url.includes("excel")) return { t: "XLS", c: "#1F9D6B", cat: "Spreadsheet" };
      if (url.includes("doc") || url.includes("word") || url.includes("document")) return { t: "DOC", c: "#2C5AB8", cat: "Document" };
      if (url.includes("slide") || url.includes("presentation") || url.includes("ppt")) return { t: "PPT", c: "#E2574C", cat: "Presentation" };
      return { t: "LINK", c: "#2E6BFF", cat: "Link" };
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

  // The documents overview returns the raw sentiment string ("Positive", "neutral",
  // …), unlike the calls overview which normalises server-side. Normalise here so
  // sentPill() always receives one of pos | neu | neg.
  const normSent = (s) => {
    s = (s || "").toLowerCase();
    return s.includes("pos") ? "pos" : s.includes("neg") ? "neg" : "neu";
  };

  // ── State ──────────────────────────────────────────────────────────────
  let docs = [];
  let openClientId = null;      // null = folder grid, otherwise folder detail
  let filterClientId = null;    // narrows the grid; does NOT open the folder
  let searchQ = "";
  let sortMode = "recent";      // recent | name | count
  let cat = "All";              // type filter, only inside a folder
  let page = 1;
  const pageSize = 10;
  const DAY = 86400000;
  const CATS = ["All", "Document", "Image", "Spreadsheet", "Presentation", "Link", "File"];

  // ── Folders derived from the documents themselves ──────────────────────
  // `/api/overview/documents` returns newest-first, so the first row per client
  // is its most recent file.
  function buildFolders() {
    const map = new Map();
    for (const d of docs) {
      let f = map.get(d.client_id);
      if (!f) {
        f = { client_id: d.client_id, name: d.client, count: 0, analyzed: 0, bytes: 0, latest: null };
        map.set(d.client_id, f);
      }
      f.count += 1;
      if (d.analysis) f.analyzed += 1;
      f.bytes += d.size || 0;
      const t = d.created_at ? new Date(d.created_at).getTime() : 0;
      if (t && (f.latest === null || t > f.latest)) f.latest = t;
    }
    return [...map.values()];
  }

  function visibleFolders() {
    const q = searchQ.trim().toLowerCase();
    let out = buildFolders().filter((f) =>
      (filterClientId === null || f.client_id === filterClientId) &&
      (!q || f.name.toLowerCase().includes(q)));
    if (sortMode === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === "count") out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    else out.sort((a, b) => (b.latest || 0) - (a.latest || 0));   // latest updated first
    return out;
  }

  // ── Document card ──────────────────────────────────────────────────────
  function docCard(d) {
    const ty = typeOf(d.filename, d.content_type, d.storage_key);
    const href = d.content_type === "url" ? d.storage_key : `/api/files/${d.id}/download`;

    let aiButton = "", analysisBox = "";
    if (d.analysis) {
      const a = d.analysis;
      aiButton = `<button class="btn btn-soft btn-sm doc-ai-btn" data-ai="${d.id}">${Icon('sparkles', { size: 13 })} AI</button>`;
      const keyPoints = (a.key_points || []).map((p) => `<li>${esc(p)}</li>`).join("");
      const acts = (a.pending_actions || []).map((p) => `<li>${esc(p)}</li>`).join("");
      analysisBox = `<div class="doc-ai-box" id="ai-box-${d.id}" hidden>
          <div class="dab-head">
            <strong>${Icon('sparkles', { size: 13 })} AI analysis</strong>
            ${sentPill(normSent(a.sentiment))}
          </div>
          <p class="dab-sum">${esc(a.summary || "No summary available.")}</p>
          <div class="dab-cols">
            <div><div class="dab-lab">Key points</div><ul class="ai-list">${keyPoints || "<li class='muted'>—</li>"}</ul></div>
            <div><div class="dab-lab">Pending actions</div><ul class="ai-list todo">${acts || "<li class='muted'>—</li>"}</ul></div>
          </div>
        </div>`;
    } else if (writable) {
      aiButton = `<button class="btn btn-soft btn-sm doc-run-btn" data-run="${d.id}">${Icon('bot', { size: 13 })} Analyze</button>`;
    }

    return `<div class="doc-card2">
      <div class="dc-top">
        <span class="doc-ic" style="background:${ty.c}">${ty.t}</span>
        <div class="dc-body">
          <a class="dc-name" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(d.filename)}">${esc(d.filename)}</a>
          <div class="dc-meta">${ty.cat}${d.content_type === "url" ? "" : ` · ${size(d.size)}`}</div>
          <div class="dc-sub">
            ${esc(d.client)}
            ${d.project_title && d.project_title !== "—" ? `<span class="chip">${Icon('folder', { size: 11 })} ${esc(d.project_title)}</span>` : ""}
          </div>
          <div class="dc-foot">${esc(d.by)} · ${d.created_at ? fmtDate(d.created_at) : ""}</div>
        </div>
        <div class="dc-actions">${aiButton}</div>
      </div>
      ${analysisBox}
    </div>`;
  }

  // ── Views ──────────────────────────────────────────────────────────────
  function toolbar(folders) {
    const all = buildFolders().sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="page-toolbar">
      <div class="tb-field">
        <span class="fi">${Icon("search", { size: 15 })}</span>
        <input class="form-control" id="folder-search" type="search" autocomplete="off"
               placeholder="Search a person by name…" value="${esc(searchQ)}" aria-label="Search folders by client name" />
        ${searchQ ? `<button class="clear" id="folder-search-clear" title="Clear search" aria-label="Clear search">${Icon("x", { size: 14 })}</button>` : ""}
      </div>
      <select class="form-select tb-select" id="client-filter" aria-label="Filter folders by client">
        <option value="">All clients</option>
        ${all.map((f) => `<option value="${f.client_id}"${filterClientId === f.client_id ? " selected" : ""}>${esc(f.name)} (${f.count})</option>`).join("")}
      </select>
      <select class="form-select tb-select" id="sort-filter" aria-label="Sort folders" style="flex:0 1 190px">
        <option value="recent"${sortMode === "recent" ? " selected" : ""}>Recently updated</option>
        <option value="name"${sortMode === "name" ? " selected" : ""}>Name (A–Z)</option>
        <option value="count"${sortMode === "count" ? " selected" : ""}>Most files</option>
      </select>
      <span class="tb-count">${folders.length} folder${folders.length === 1 ? "" : "s"} · ${docs.length} file${docs.length === 1 ? "" : "s"}</span>
    </div>`;
  }

  function folderGrid() {
    const folders = visibleFolders();
    if (!docs.length) {
      return toolbar(folders) + `<div class="empty"><span class="em-ico">${Icon("folderOpen", { size: 26 })}</span>
        No documents yet. Upload a file or add a link from a client's profile and a folder will appear here.</div>`;
    }
    if (!folders.length) {
      const why = searchQ.trim() ? `No client matches “${esc(searchQ)}”.` : "No folder matches the current filter.";
      return toolbar(folders) + `<div class="empty"><span class="em-ico">${Icon("search", { size: 26 })}</span>${why}</div>`;
    }
    const now = Date.now();
    return toolbar(folders) + `<div class="folder-grid">${folders.map((f) => {
      const fresh = f.latest && (now - f.latest) < DAY;
      return `<button type="button" class="folder-card" data-client="${f.client_id}"
          aria-label="Open ${esc(f.name)}'s folder, ${f.count} files">
        <div class="fc-top">
          <span class="fc-ic">${Icon("folder", { size: 20 })}</span>
          <div style="min-width:0;flex:1">
            <div class="fc-name" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="fc-sub">${f.count} file${f.count === 1 ? "" : "s"} · ${size(f.bytes)}</div>
          </div>
        </div>
        <div class="fc-foot">
          <span class="fc-updated">${f.latest ? "Updated " + timeAgo(new Date(f.latest).toISOString()) : "—"}</span>
          <span style="display:flex;align-items:center;gap:8px">
            ${fresh ? `<span class="fc-new">New</span>` : ""}
            <span class="fc-go">${Icon("chevronDown", { size: 15, style: "transform:rotate(-90deg)" })}</span>
          </span>
        </div>
      </button>`;
    }).join("")}</div>`;
  }

  function folderDetail() {
    const mine = docs.filter((d) => d.client_id === openClientId);
    const name = mine.length ? mine[0].client : "Folder";
    const list = mine.filter((d) => cat === "All" || typeOf(d.filename, d.content_type, d.storage_key).cat === cat);

    const totalPages = Math.ceil(list.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    const paginated = list.slice((page - 1) * pageSize, page * pageSize);

    // Only offer a type chip when the folder actually contains that type.
    const present = new Set(mine.map((d) => typeOf(d.filename, d.content_type, d.storage_key).cat));
    const chips = CATS.filter((c) => c === "All" || present.has(c));

    const pager = list.length > pageSize ? `
      <div class="d-flex justify-content-between align-items-center mt-3 pt-3" style="border-top:1px solid var(--line-2)">
        <span class="muted small">Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.length)} of ${list.length}</span>
        <div class="btn-group">
          <button class="btn btn-sm btn-soft" id="docs-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
          <button class="btn btn-sm btn-soft" id="docs-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
        </div>
      </div>` : "";

    const totalBytes = mine.reduce((n, d) => n + (d.size || 0), 0);
    return `<div class="folder-head">
        <button class="btn-back" id="back-to-folders">${Icon("chevronDown", { size: 14, style: "transform:rotate(90deg)" })} All folders</button>
        <div>
          <div class="fh-title">${esc(name)}</div>
          <div class="fh-sub">${mine.length} file${mine.length === 1 ? "" : "s"} · ${size(totalBytes)}</div>
        </div>
        <div class="type-chips">${chips.map((c) => `<button class="chip ${c === cat ? "info" : ""}" data-c="${c}">${c}</button>`).join("")}</div>
      </div>
      <div class="doc-grid">${paginated.length ? paginated.map(docCard).join("")
        : `<div class="empty" style="grid-column:1/-1"><span class="em-ico">${Icon('file', { size: 24 })}</span>No ${cat === "All" ? "" : cat.toLowerCase() + " "}files in this folder.</div>`}</div>
      ${pager}`;
  }

  function render() {
    const root = document.getElementById("view");
    root.innerHTML = openClientId === null ? folderGrid() : folderDetail();
    wire(root);
  }

  function wire(root) {
    const search = root.querySelector("#folder-search");
    if (search) search.addEventListener("input", (e) => {
      searchQ = e.target.value;
      render();
      const s = document.getElementById("folder-search");
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    });

    const clear = root.querySelector("#folder-search-clear");
    if (clear) clear.addEventListener("click", () => { searchQ = ""; render(); });

    // Picking a client narrows the folder grid. It must NOT open the folder —
    // only clicking a folder card reveals what is inside.
    const cf = root.querySelector("#client-filter");
    if (cf) cf.addEventListener("change", (e) => {
      const v = e.target.value;
      filterClientId = v ? parseInt(v, 10) : null;
      render();
    });

    const sf = root.querySelector("#sort-filter");
    if (sf) sf.addEventListener("change", (e) => { sortMode = e.target.value; render(); });

    root.querySelectorAll(".folder-card").forEach((el) =>
      el.addEventListener("click", () => { openClientId = parseInt(el.dataset.client, 10); cat = "All"; page = 1; render(); }));

    const back = root.querySelector("#back-to-folders");
    if (back) back.addEventListener("click", () => { openClientId = null; cat = "All"; page = 1; render(); });

    root.querySelectorAll("[data-c]").forEach((el) =>
      el.addEventListener("click", () => { cat = el.dataset.c; page = 1; render(); }));

    root.querySelectorAll("[data-ai]").forEach((el) =>
      el.addEventListener("click", () => {
        const box = document.getElementById(`ai-box-${el.dataset.ai}`);
        if (box) box.hidden = !box.hidden;
      }));

    root.querySelectorAll("[data-run]").forEach((el) =>
      el.addEventListener("click", () => runDocumentAI(parseInt(el.dataset.run, 10), el)));

    const prev = root.querySelector("#docs-prev");
    const next = root.querySelector("#docs-next");
    if (prev) prev.addEventListener("click", () => { page--; render(); });
    if (next) next.addEventListener("click", () => { page++; render(); });
  }

  // Bypass the browser's stale-while-revalidate cache so a folder that just
  // received a file really does jump to the top.
  async function refresh() {
    Api.invalidateCache("/api/overview/documents");
    docs = await Api.get("/api/overview/documents", { stale: false });
  }

  async function runDocumentAI(id, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
      await Api.post(`/api/files/${id}/analyze`);
      await refresh();
      render();
      toast("Document analysis complete", "success");
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  try { docs = await Api.get("/api/overview/documents"); render(); } catch (e) { toast(e.message); }
})();
