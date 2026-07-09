(async function () {
  const actions = `<button class="btn btn-primary" id="new-conv-btn" data-bs-toggle="modal" data-bs-target="#convModal">+ New conversation</button>`;
  await renderLayout("/conversations", "Conversations", { crumb: "Client chats with AI analysis", actions });
  const writable = canWrite();
  if (!writable) { const b = document.getElementById("new-conv-btn"); if (b) b.remove(); }

  const FILTERS = ["all", "whatsapp", "upwork", "slack", "email", "telegram"];
  let clients = [], channels = [], active = null, chanFilter = "all", searchQ = "", view = "active";
  const preselect = parseInt(qs("client")) || null;
  const canPurge = isAdmin();

  const platOf = (cl) => (cl.channels && cl.channels[0] && cl.channels[0].platform) || "other";
  const _ns = (s) => (!s ? "neu" : s.toLowerCase().includes("pos") ? "pos" : s.toLowerCase().includes("neg") ? "neg" : "neu");

  // ─── Left panel ───
  function renderViewTabs() {
    document.querySelectorAll("#cl-view-tabs .f-chip").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === view);
      el.onclick = () => {
        if (view === el.dataset.view) return;
        view = el.dataset.view;
        renderViewTabs();
        closeThread();
        load();
      };
    });
  }

  function closeThread() {
    active = null;
    document.getElementById("empty-center").style.display = "flex";
    document.getElementById("thread-wrap").style.display = "none";
    document.getElementById("ai-scroll").innerHTML = `<div class="ai2-empty">
      <div class="ai-icon-wrap">${Icon("sparkles", { size: 24 })}</div>
      <h4>No analysis yet</h4>
      <p>Select a client conversation to view or run AI analysis.</p>
    </div>`;
  }

  async function load() {
    try {
      clients = await Api.get(`/api/overview/clients?archived=${view === "archived"}`);
    } catch (e) { toast(e.message); clients = []; }
    renderList();
  }

  function renderFilter() {
    document.getElementById("cl-filter").innerHTML = FILTERS.map((f) =>
      `<button class="f-chip ${f === chanFilter ? "active" : ""}" data-f="${f}">${f === "all" ? "All" : platformName(f)}</button>`
    ).join("");
    document.querySelectorAll("#cl-filter .f-chip").forEach((el) =>
      el.addEventListener("click", () => { chanFilter = el.dataset.f; renderList(); }));
  }

  function renderList() {
    const q = searchQ.toLowerCase();
    const list = clients.filter((cl) =>
      (chanFilter === "all" || cl.channels.some((ch) => ch.platform === chanFilter)) &&
      (!q || cl.name.toLowerCase().includes(q) || (cl.company || "").toLowerCase().includes(q))
    );
    const noun = view === "archived" ? "archived client" : "client";
    document.getElementById("cl-sub").textContent = `${clients.length} ${noun}${clients.length === 1 ? "" : "s"}`;
    const scroll = document.getElementById("cl-scroll");
    if (!list.length) {
      scroll.innerHTML = `<div style="padding:24px 16px; text-align:center; color:var(--muted); font-size:13px;">
        ${view === "archived" ? "No archived conversations." : "No conversations found."}</div>`;
      return;
    }
    const showDelBtn = view === "archived" ? canPurge : writable;
    const delTitle = view === "archived" ? "Delete permanently" : "Archive";
    const delIcon = view === "archived" ? Icon("trash", { size: 13 }) : Icon("x", { size: 13 });
    scroll.innerHTML = list.map((cl) => {
      const plat = platOf(cl);
      return `<div class="ci2 ${cl.id === active ? "on" : ""}" data-id="${cl.id}">
        <span class="av2" style="background:${avHash(cl.name)}">
          ${initialsOf(cl.name)}
          <span class="ch-dot" style="background:${chanColor(plat)}"></span>
        </span>
        <div class="ci2-body">
          <div class="ci2-row1">
            <span class="name">${esc(cl.name)}</span>
          </div>
          <div class="ci2-prev">${esc(cl.company || cl.email || "—")}</div>
          <div class="ci2-foot">
            ${sentPill(cl.sentiment)}
            <span class="ch-pill" style="background:${chanColor(plat)}18;color:${chanColor(plat)}">
              <span class="cd" style="background:${chanColor(plat)}"></span>${platformName(plat)}
            </span>
          </div>
        </div>
        ${showDelBtn ? `<button class="ci2-del" data-del="${cl.id}" title="${delTitle}">${delIcon}</button>` : ""}
      </div>`;
    }).join("");
    document.querySelectorAll("#cl-scroll .ci2").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (!e.target.closest(".ci2-del")) selectClient(parseInt(el.dataset.id));
      }));
    document.querySelectorAll("#cl-scroll .ci2-del").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(b.dataset.del);
        if (view === "archived") permanentlyDeleteClient(id);
        else archiveClient(id);
      }));
  }

  // ─── Center: message thread ───
  let pendingAttachments = [];

  async function renderThread() {
    const cl = clients.find((x) => x.id === active);
    const plat = platOf(cl);

    // Header
    document.getElementById("th2-head").innerHTML = `
      <span class="av2" style="background:${avHash(cl.name)};width:38px;height:38px;font-size:13px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex-shrink:0">
        ${initialsOf(cl.name)}
      </span>
      <div>
        <div class="name">${esc(cl.name)}</div>
        <div class="meta">
          <span class="ch-pill" style="background:${chanColor(plat)}18;color:${chanColor(plat)}">
            <span class="cd" style="background:${chanColor(plat)}"></span>${platformName(plat)}
          </span>
          ${cl.company ? `<span style="color:var(--muted-2)">· ${esc(cl.company)}</span>` : ""}
        </div>
      </div>
      <div class="th2-acts">
        <a class="icon-btn" href="/client?id=${cl.id}" title="Full profile">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </a>
      </div>`;

    // Composer — archived conversations are read-only, no composer at all.
    if (view === "archived") {
      document.getElementById("composer-area").innerHTML = `
        <div class="perm-banner no">
          <svg class="perm-ic" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          This conversation is archived — read-only. Delete it permanently from here if it's no longer needed.
        </div>`;
    } else {
      document.getElementById("composer-area").innerHTML = `
        <div class="perm-banner ${writable ? "ok" : "no"}">
          <svg class="perm-ic" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            ${writable ? '<path d="M5 13l4 4L19 7"/>' : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'}
          </svg>
          ${writable ? "You can reply to this conversation." : "Read-only role — replying is disabled."}
        </div>
        <div id="att-preview-area" class="att-preview" style="display:none"></div>
        <div class="composer-toolbar">
          <button class="toolbar-btn" id="att-btn" title="Attach file" ${writable ? "" : "disabled"}>
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 16.41a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
          </button>
          <div class="toolbar-sep"></div>
          <span style="font-size:11px;color:var(--muted-2);padding:0 4px">Type your reply below</span>
        </div>
        <div class="composer-input-row">
          <textarea id="composer-text" placeholder="${writable ? "Type a reply..." : "Replying is disabled for your role"}" ${writable ? "" : "disabled"} rows="1"></textarea>
          <button class="send-btn2" id="send-btn" ${writable ? "" : "disabled"}>
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="transform:rotate(45deg) translateX(1px)">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>`;

      if (writable) {
        const sendBtn = document.getElementById("send-btn");
        const attBtn = document.getElementById("att-btn");
        const attFileInput = document.getElementById("att-file-input");
        const textarea = document.getElementById("composer-text");

        // Auto-resize textarea
        textarea.addEventListener("input", () => {
          textarea.style.height = "auto";
          textarea.style.height = Math.min(textarea.scrollHeight, 130) + "px";
        });

        // Ctrl+Enter to send
        textarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
        });

        sendBtn.addEventListener("click", sendMessage);
        attBtn.addEventListener("click", () => attFileInput.click());
        attFileInput.addEventListener("change", () => {
          const files = Array.from(attFileInput.files);
          pendingAttachments.push(...files);
          renderAttPreviews();
          attFileInput.value = "";
        });
      }
    }

    // Load messages
    try {
      const msgs = await Api.get(`/api/clients/${cl.id}/messages`);
      const body = document.getElementById("th2-body");
      if (!msgs.length) {
        body.innerHTML = `<div class="conv-empty-state" style="height:auto;padding:40px 0">
          <div class="icon-wrap" style="width:48px;height:48px;font-size:20px">${Icon("message", { size: 20 })}</div>
          <p style="max-width:220px">No messages yet. Start the conversation below.</p>
        </div>`;
      } else {
        body.innerHTML = `<div class="day-sep2"><span>— conversation —</span></div>` +
          msgs.map((m) => {
            let content;
            const token = Api.token();
            const rawUrl = m.attachment_url || "";
            const isExternal = rawUrl.startsWith("http");
            const url = (rawUrl && !isExternal && token) ? `${rawUrl}?token=${token}` : rawUrl;
            
            const extLower = (m.attachment_name || "").toLowerCase();
            const isVideo = extLower.endsWith(".mp4") || extLower.endsWith(".mov") || extLower.endsWith(".m4v") || extLower.endsWith(".webm") || extLower.endsWith(".avi") || extLower.endsWith(".mkv");
            const isImage = extLower.endsWith(".png") || extLower.endsWith(".jpg") || extLower.endsWith(".jpeg") || extLower.endsWith(".gif") || extLower.endsWith(".webp");
            if (m.attachment_type === "audio") {
              if (isVideo) {
                content = `<div class="att-video"><video controls preload="none" src="${esc(url)}" style="max-width:320px; border-radius:8px; display:block;"></video></div>`;
              } else {
                content = `<div class="att-audio"><audio controls preload="none" src="${esc(url)}"></audio></div>`;
              }
            } else if (m.attachment_type === "file") {
              if (isImage) {
                content = `<div class="att-image"><img src="${esc(url)}" style="max-width:320px; max-height:240px; border-radius:8px; display:block; cursor:pointer;" onclick="window.open('${esc(url)}', '_blank')" /></div>`;
              } else {
                const ext = isExternal ? "LINK" : (m.attachment_name || "file").split(".").pop().toUpperCase().slice(0, 4);
                content = `<a class="att-file" href="${esc(url)}" target="_blank" rel="noopener">
                  <div class="file-ic">${ext}</div>
                  <div class="file-info">
                    <div class="file-name">${esc(m.attachment_name || "Download")}</div>
                    <div class="file-sub">${isExternal ? "Open link in new tab" : "Click to download"}</div>
                  </div>
                  <svg class="dl-ic" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </a>`;
              }
            } else {
              content = `<div class="bubble2">${m.is_client ? "" : `<div class="msg-sender">${esc(m.sender_name)}</div>`}${esc(m.body)}</div>`;
            }
            return `<div class="msg2 ${m.is_client ? "in" : "out"}">
              ${!m.is_client && m.attachment_type !== "file" ? `<div class="msg-sender">${esc(m.sender_name)}</div>` : ""}
              ${content}
              <div class="msg-meta">${m.is_client ? esc(m.sender_name) + " · " : ""}${m.sent_at ? fmtDate(m.sent_at) : ""}</div>
            </div>`;
          }).join("");
        body.scrollTop = body.scrollHeight;
      }
    } catch (e) { toast(e.message); }
  }

  function renderAttPreviews() {
    const area = document.getElementById("att-preview-area");
    if (!area) return;
    if (!pendingAttachments.length) { area.style.display = "none"; area.innerHTML = ""; return; }
    area.style.display = "flex";
    area.innerHTML = pendingAttachments.map((f, i) => `
      <div class="att-chip">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span class="att-nm">${esc(f.name)}</span>
        <button class="att-rm" data-idx="${i}" title="Remove">${Icon("x", { size: 12 })}</button>
      </div>`).join("");
    area.querySelectorAll(".att-rm").forEach((b) =>
      b.addEventListener("click", () => {
        pendingAttachments.splice(parseInt(b.dataset.idx), 1);
        renderAttPreviews();
      }));
  }

  async function sendMessage() {
    const ta = document.getElementById("composer-text");
    const text = (ta.value || "").trim();
    if (!text && !pendingAttachments.length) return;
    const cl = clients.find((x) => x.id === active);
    try {
      // Send text first
      if (text) {
        await Api.post(`/api/clients/${cl.id}/messages`, { body: text });
        ta.value = "";
        ta.style.height = "auto";
      }
      // Then upload each attachment — this endpoint classifies by file type and
      // routes video/audio to the audio folder, everything else to documents.
      for (const file of pendingAttachments) {
        const fd = new FormData();
        fd.append("upload", file);
        try {
          await Api.postForm(`/api/clients/${cl.id}/messages/upload`, fd);
        } catch (e) {
          toast("Could not upload " + file.name + ": " + e.message);
        }
      }
      pendingAttachments = [];
      renderAttPreviews();
      await renderThread();
    } catch (e) { toast(e.message); }
  }

  // ─── Right panel: AI ───
  let aiPanelOpen = true;

  function setAiPanelOpen(open) {
    aiPanelOpen = open;
    const panel = document.getElementById("conv-right");
    const toggleBtn = document.getElementById("ai-toggle-btn");
    if (open) {
      panel.classList.remove("collapsed");
      panel.style.width = "";
      toggleBtn.classList.remove("show");
    } else {
      panel.classList.add("collapsed");
      toggleBtn.classList.add("show");
    }
  }

  document.getElementById("ai-close-btn").addEventListener("click", () => setAiPanelOpen(false));
  document.getElementById("ai-toggle-btn").addEventListener("click", () => setAiPanelOpen(true));

  async function renderAI() {
    const cl = clients.find((x) => x.id === active);
    const scroll = document.getElementById("ai-scroll");
    const modelSub = document.getElementById("ai-model-sub");
    scroll.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:12.5px">Loading...</div>`;

    let convs = [];
    try { convs = await Api.get(`/api/conversations?client_id=${cl.id}&is_deleted=${view === "archived"}`); } catch (_) {}
    if (!convs.length) {
      scroll.innerHTML = `<div class="ai2-empty">
        <div class="ai-icon-wrap">${Icon("sparkles", { size: 24 })}</div>
        <h4>No analysis yet</h4>
        <p>Send a message below, or upload a chat log via &ldquo;+ New conversation&rdquo;, to generate a summary, key points and sentiment.</p>
      </div>`;
      return;
    }
    const convId = convs[0].id;
    let a = null;
    try { a = await Api.get(`/api/ai/conversations/${convId}/analysis`); } catch (_) {}
    if (!a) {
      scroll.innerHTML = `<div class="ai2-empty">
        <div class="ai-icon-wrap">${Icon("sparkles", { size: 24 })}</div>
        <h4>Not analyzed yet</h4>
        <p>Run AI analysis on this client's latest conversation.</p>
        ${writable ? `<button class="btn btn-primary btn-sm" id="run-ai" style="margin:0 auto">Run AI analysis</button>` : ""}
      </div>`;
      const r = document.getElementById("run-ai"); if (r) r.onclick = () => runAI(convId);
      return;
    }
    const m = a.response_metrics || {};
    if (a.model) modelSub.textContent = `${a.model} · summary & sentiment`;
    scroll.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        ${sentPill(_ns(a.sentiment))}
        ${writable ? `<button class="btn btn-soft btn-sm" id="run-ai">Re-run analysis</button>` : ""}
      </div>
      <div class="ai2-block">
        <div class="lab"><span class="lab-dot"></span> Summary</div>
        <div class="ai2-sum">${esc(a.summary || "—")}</div>
      </div>
      <div class="ai2-block">
        <div class="lab"><span class="lab-dot purple"></span> Key points</div>
        <ul class="ai2-list">${(a.key_points || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li style="color:var(--muted)">None identified.</li>'}</ul>
      </div>
      <div class="ai2-block">
        <div class="lab"><span class="lab-dot amber"></span> Pending actions</div>
        <ul class="ai2-list todo">${(a.pending_actions || []).map((p) => `<li>${esc(p)}</li>`).join("") || '<li style="color:var(--muted)">None identified.</li>'}</ul>
      </div>
      ${m.available ? `<div class="ai2-block">
        <div class="lab"><span class="lab-dot"></span> Response time</div>
        <div class="ai2-metrics">
          <div class="ai2-metric"><div class="n">${m.avg_response_minutes}m</div><div class="l">Avg response</div></div>
          <div class="ai2-metric"><div class="n">${m.slowest_seconds}s</div><div class="l">Slowest reply</div></div>
        </div>
      </div>` : ""}
      ${(a.follow_ups && a.follow_ups.length) ? `<div class="ai2-block">
        <div class="lab"><span class="lab-dot purple"></span> Follow-up</div>
        <div class="ai2-follow">${a.follow_ups.map(esc).join(" ")}</div>
      </div>` : ""}`;
    const r = document.getElementById("run-ai"); if (r) r.onclick = () => runAI(convId);
  }

  async function runAI(convId) {
    const scroll = document.getElementById("ai-scroll");
    scroll.innerHTML = `<div class="ai2-empty"><div class="ai-icon-wrap" style="animation:spin 1.2s linear infinite">${Icon("sparkles", { size: 24 })}</div><p>Analyzing...</p></div>`;
    try { await Api.post(`/api/ai/conversations/${convId}/analyze`); await renderAI(); toast("Analysis complete", "success"); }
    catch (e) { toast(e.message); renderAI(); }
  }

  function selectClient(id) {
    active = id;
    pendingAttachments = [];
    document.querySelectorAll("#cl-scroll .ci2").forEach((el) =>
      el.classList.toggle("on", parseInt(el.dataset.id) === id));
    // Show thread area
    document.getElementById("empty-center").style.display = "none";
    document.getElementById("thread-wrap").style.display = "flex";
    renderThread();
    renderAI();
  }

  async function archiveClient(id) {
    const cl = clients.find((c) => c.id === id);
    const ok = await confirmDialog(
      `This moves ${cl ? cl.name : "this client"}'s chat to the Archive (hidden from the active list, not permanently erased).`,
      { title: "Archive this chat?", confirmText: "Archive" }
    );
    if (!ok) return;
    try {
      const convs = await Api.get(`/api/conversations?client_id=${id}`).catch(() => []);
      for (const cv of convs) await Api.del(`/api/conversations/${cv.id}`);
      clients = clients.filter((c) => c.id !== id);
      if (active === id) closeThread();
      renderList();
      toast("Chat archived", "success");
    } catch (e) { toast(e.message); }
  }

  async function permanentlyDeleteClient(id) {
    const cl = clients.find((c) => c.id === id);
    const ok = await confirmDialog(
      `This permanently erases ${cl ? cl.name : "this client"}'s archived chat — messages, attachments and analysis. This can't be undone.`,
      { title: "Delete permanently?", confirmText: "Delete forever" }
    );
    if (!ok) return;
    try {
      const convs = await Api.get(`/api/conversations?client_id=${id}&is_deleted=true`).catch(() => []);
      for (const cv of convs) await Api.del(`/api/conversations/${cv.id}/permanent`);
      clients = clients.filter((c) => c.id !== id);
      if (active === id) closeThread();
      renderList();
      toast("Conversation permanently deleted", "success");
    } catch (e) { toast(e.message); }
  }

  // ─── New conversation modal ───
  function populateConvModal() {
    document.getElementById("nc-client").innerHTML = clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    document.getElementById("nc-channel").innerHTML =
      '<option value="">— none —</option>' + channels.map((ch) => `<option value="${ch.id}">${esc(ch.name)} · ${ch.platform}</option>`).join("");
    if (active) document.getElementById("nc-client").value = String(active);
  }

  async function saveNewConversation() {
    const clientId = parseInt(document.getElementById("nc-client").value);
    const content = document.getElementById("nc-content").value;
    if (!clientId) return toast("Select a client");
    if (!content.trim()) return toast("Paste the conversation log");
    const channel = document.getElementById("nc-channel").value;
    try {
      await Api.post("/api/conversations", {
        client_id: clientId, channel_id: channel ? parseInt(channel) : null,
        title: document.getElementById("nc-title").value.trim() || null, raw_content: content,
      });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("convModal")).hide();
      document.getElementById("nc-content").value = "";
      document.getElementById("nc-title").value = "";
      if (active === clientId) { await renderThread(); await renderAI(); }
      else selectClient(clientId);
      toast("Conversation uploaded", "success");
    } catch (e) { toast(e.message); }
  }

  // ─── Drag-to-resize panels ───
  function makeDraggable(handleId, targetId, side) {
    const handle = document.getElementById(handleId);
    const target = document.getElementById(targetId);
    let startX = 0, startW = 0, dragging = false;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = target.getBoundingClientRect().width;
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const delta = side === "left" ? e.clientX - startX : startX - e.clientX;
      const newW = Math.max(220, Math.min(520, startW + delta));
      target.style.width = newW + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  }

  makeDraggable("drag-left", "conv-left", "left");
  makeDraggable("drag-right", "conv-right", "right");

  // ─── Search ───
  document.getElementById("cl-search").addEventListener("input", (e) => {
    searchQ = e.target.value;
    renderList();
  });

  // ─── Init ───
  try {
    const [cls, chs] = await Promise.all([
      Api.get("/api/overview/clients?archived=false"),
      Api.get("/api/channels").catch(() => []),
    ]);
    clients = cls; channels = chs;
    populateConvModal();
    document.getElementById("nc-save").addEventListener("click", saveNewConversation);
    renderViewTabs(); renderFilter(); renderList();
    const first = (preselect && clients.find((c) => c.id === preselect)) ? preselect : (clients[0] && clients[0].id);
    if (first) selectClient(first);
  } catch (e) { toast(e.message); }
})();
