(async function () {
  // No top-bar search and no upload button on this page: the page's own filter
  // toolbar handles search, and recordings are uploaded from a client's profile.
  await renderLayout("/calls", "Call Recordings", {
    crumb: "Uploaded calls with AI analysis",
    hideSearch: true,
    hideActions: true,
  });
  const writable = canWrite();

  function wave(seed) {
    let x = seed * 9301 + 49297;
    const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    return `<div class="wave">${Array.from({ length: 34 }).map(() => `<i style="height:${20 + Math.round(rnd() * 70)}%"></i>`).join("")}</div>`;
  }
  const dur = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

  // ── State ──────────────────────────────────────────────────────────────
  let calls = [];
  let openClientId = null;        // null = folder grid, otherwise folder detail
  let filterClientId = null;      // narrows the grid; does NOT open the folder
  let searchQ = "";
  let sortMode = "recent";        // recent | name | count
  let page = 1;
  const pageSize = 10;
  const DAY = 86400000;

  // ── Derive folders from the recordings themselves ──────────────────────
  // A folder exists because it has something in it. `/api/overview/calls`
  // already returns newest-first, so the first row seen per client is its
  // most recent recording.
  function buildFolders() {
    const map = new Map();
    for (const c of calls) {
      let f = map.get(c.client_id);
      if (!f) {
        f = { client_id: c.client_id, name: c.client, count: 0, analyzed: 0, latest: null };
        map.set(c.client_id, f);
      }
      f.count += 1;
      if (c.analysis) f.analyzed += 1;
      const t = c.created_at ? new Date(c.created_at).getTime() : 0;
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

  // ── Recording cards (unchanged content, responsive wrapper) ────────────
  function list(items) {
    const lab = (t) => `<div class="rec-lab">${t}</div>`;
    return items.length ? items.map((c) => {
      const a = c.analysis;
      const ups = (a && a.follow_ups || []).map((p) => `<li>${esc(p)}</li>`).join("");
      const body = a ? `<div class="card-pad rec-ai">
          <div>${lab(`${Icon('sparkles', { size: 12 })} AI summary`)}<p style="font-size:12.5px;line-height:1.55">${esc(a.summary || "—")}</p>
            ${a.behavioral_assessment ? `<p style="font-size:11.5px;color:var(--muted);margin-top:8px"><b>Behavior:</b> ${esc(a.behavioral_assessment)}</p>` : ""}
            ${ups ? `<div style="margin-top:12px">${lab("Follow-ups &amp; open questions")}<ul class="ai-list">${ups}</ul></div>` : ""}</div>
          <div>${lab("Key points")}<ul class="ai-list">${(a.key_points || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>
          <div>${lab("Action items")}<ul class="ai-list todo">${(a.pending_actions || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li class="muted">—</li>'}</ul></div>
        </div>`
        : `<div class="card-pad" style="border-top:1px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span class="muted small">No AI analysis yet.</span>
            ${writable ? `<button class="btn btn-soft btn-sm" onclick="analyze(${c.id})">${Icon('sparkles', { size: 14 })} Transcribe &amp; analyze</button>` : ""}</div>`;
      const projBadge = c.project_title && c.project_title !== "—"
        ? `<span class="chip ms-2" style="font-size:10px">${Icon('folder', { size: 11 })} ${esc(c.project_title)}</span>` : "";
      return `<div class="card">
        <div class="call-row">
          <button class="play" onclick="toast('Open the client profile to play this recording','info')" title="${esc(c.filename)}" aria-label="Play ${esc(c.filename)}">${Icon('send', { size: 14 })}</button>
          <div class="rec-meta"><div class="rec-title">${esc(c.client)}${projBadge}</div>
            <div class="rec-file">${esc(c.filename)}</div></div>
          ${wave(c.id)}
          <div class="rec-right"><div class="mono" style="font-size:13px;font-weight:600">${dur(c.duration)}</div>
            <div style="font-size:11px;color:var(--muted-2)">${c.created_at ? fmtDate(c.created_at) : ""}</div></div>
          ${a ? sentPill(a.sentiment) : ""}
        </div>${body}</div>`;
    }).join("") : `<div class="empty"><span class="em-ico">${Icon('phone', { size: 24 })}</span>No recordings in this folder yet.</div>`;
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
        <option value="count"${sortMode === "count" ? " selected" : ""}>Most recordings</option>
      </select>
      <span class="tb-count">${folders.length} folder${folders.length === 1 ? "" : "s"} · ${calls.length} recording${calls.length === 1 ? "" : "s"}</span>
    </div>`;
  }

  function folderGrid() {
    const folders = visibleFolders();
    if (!calls.length) {
      return toolbar(folders) + `<div class="empty"><span class="em-ico">${Icon("folderOpen", { size: 26 })}</span>
        No recordings yet. Upload one using the button above and a folder will appear here.</div>`;
    }
    if (!folders.length) {
      const why = searchQ.trim() ? `No client matches “${esc(searchQ)}”.` : "No folder matches the current filter.";
      return toolbar(folders) + `<div class="empty"><span class="em-ico">${Icon("search", { size: 26 })}</span>${why}</div>`;
    }
    const now = Date.now();
    return toolbar(folders) + `<div class="folder-grid">${folders.map((f) => {
      const fresh = f.latest && (now - f.latest) < DAY;
      return `<button type="button" class="folder-card" data-client="${f.client_id}"
          aria-label="Open ${esc(f.name)}'s folder, ${f.count} recordings">
        <div class="fc-top">
          <span class="fc-ic">${Icon("folder", { size: 20 })}</span>
          <div style="min-width:0;flex:1">
            <div class="fc-name" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="fc-sub">${f.count} recording${f.count === 1 ? "" : "s"} · ${f.analyzed} analyzed</div>
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
    const items = calls.filter((c) => c.client_id === openClientId);
    const name = items.length ? items[0].client : "Folder";
    const totalPages = Math.ceil(items.length / pageSize) || 1;
    if (page > totalPages) page = totalPages;
    const paginated = items.slice((page - 1) * pageSize, page * pageSize);

    const pager = items.length > pageSize ? `
      <div class="d-flex justify-content-between align-items-center mt-3 pt-3" style="border-top:1px solid var(--line-2)">
        <span class="muted small">Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, items.length)} of ${items.length}</span>
        <div class="btn-group">
          <button class="btn btn-sm btn-soft" id="calls-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
          <button class="btn btn-sm btn-soft" id="calls-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
        </div>
      </div>` : "";

    const analyzed = items.filter((c) => c.analysis).length;
    return `<div class="folder-head">
        <button class="btn-back" id="back-to-folders">${Icon("chevronDown", { size: 14, style: "transform:rotate(90deg)" })} All folders</button>
        <div>
          <div class="fh-title">${esc(name)}</div>
          <div class="fh-sub">${items.length} recording${items.length === 1 ? "" : "s"} · ${analyzed} analyzed</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">${list(paginated)}${pager}</div>`;
  }

  function render() {
    const root = document.getElementById("view");
    root.innerHTML = openClientId === null ? folderGrid() : folderDetail();
    wire(root);
  }

  function wire(root) {
    const search = root.querySelector("#folder-search");
    if (search) {
      search.addEventListener("input", (e) => {
        searchQ = e.target.value;
        render();
        // Re-rendering replaces the input, so restore focus and caret.
        const s = document.getElementById("folder-search");
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      });
    }
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
      el.addEventListener("click", () => { openClientId = parseInt(el.dataset.client, 10); page = 1; render(); }));

    const back = root.querySelector("#back-to-folders");
    if (back) back.addEventListener("click", () => { openClientId = null; page = 1; render(); });

    const prev = root.querySelector("#calls-prev");
    const next = root.querySelector("#calls-next");
    if (prev) prev.addEventListener("click", () => { page--; render(); });
    if (next) next.addEventListener("click", () => { page++; render(); });
  }

  // Refetch bypassing the browser's stale-while-revalidate cache, so a folder
  // that just received a recording really does jump to the top.
  async function refresh() {
    Api.invalidateCache("/api/overview/calls");
    calls = await Api.get("/api/overview/calls", { stale: false });
  }

  window.analyze = async (id) => {
    toast("Transcribing with Deepgram + analyzing…", "info");
    try {
      await Api.post(`/api/audio/${id}/analyze`);
      await refresh();
      render();
      toast("Analysis complete", "success");
    } catch (e) { toast(e.message); }
  };


  try {
    calls = await Api.get("/api/overview/calls");
    render();
  } catch (e) { toast(e.message); }
})();
