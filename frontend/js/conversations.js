(async function () {
  // "New conversation" starts by creating a client — send the user to the Clients
  // page with the New Client form auto-opened.
  const actions = `<a class="btn btn-primary" id="new-conv-btn" href="/clients?new=1">+ New conversation</a>`;
  await renderLayout("/conversations", "Conversations", { crumb: "Client chats with AI analysis", actions });
  const writable = canWrite();
  if (!writable) { const b = document.getElementById("new-conv-btn"); if (b) b.remove(); }
  // Hide the redundant top-bar search on this page (the left panel already has one).
  const tbSearch = document.querySelector(".tb-search");
  if (tbSearch) tbSearch.style.display = "none";

  const FILTERS = ["all", "whatsapp", "upwork", "slack", "email", "telegram", "linkedin"];
  let clients = [], channels = [], active = null, chanFilter = "all", searchQ = "", view = "active";
  const preselect = parseInt(qs("client")) || null;
  const canPurge = isAdmin();
  const canClearAll = isSuperAdmin();

  const platOf = (cl) => (cl.channels && cl.channels[0] && cl.channels[0].platform) || "other";
  const _ns = (s) => (!s ? "neu" : s.toLowerCase().includes("pos") ? "pos" : s.toLowerCase().includes("neg") ? "neg" : "neu");

  // Colour the file-attachment badge by type so a PDF/sheet/doc is recognisable at a glance.
  function fileIcColor(ext) {
    const e = (ext || "").toLowerCase();
    if (e === "pdf") return "#E4483C";
    if (["doc", "docx"].includes(e)) return "#2B6BEF";
    if (["xls", "xlsx", "csv"].includes(e)) return "#1E9E5A";
    if (["ppt", "pptx"].includes(e)) return "#D24726";
    if (["zip", "rar", "7z"].includes(e)) return "#8B5CF6";
    if (["txt", "rtf"].includes(e)) return "#64748B";
    return "var(--brand)";   // links and anything else
  }

  // ─── Client status (Active / Inactive / Lead) ───
  const STATUS_OPTS = [
    { key: "active", label: "Active", cls: "st-active" },
    { key: "inactive", label: "Inactive", cls: "st-done" },
    { key: "lead", label: "Lead", cls: "st-hold" },
  ];
  const statusMeta = (s) => {
    const v = (s || "").toLowerCase();
    return STATUS_OPTS.find((o) => o.key === v)
      || ((v.includes("inactive") || v.includes("closed") || v.includes("archiv")) ? STATUS_OPTS[1] : STATUS_OPTS[0]);
  };
  const canEditStatus = isAdmin();   // Admin + Super Admin

  // Inner markup for the header status control (a pill that opens a dropdown).
  function statusControlHTML(cl) {
    const m = statusMeta(cl.status);
    const items = STATUS_OPTS.map((o) =>
      `<button type="button" class="cd-status-item ${o.key === m.key ? "on" : ""}" data-status="${o.key}">
         <span class="st ${o.cls}" style="pointer-events:none"><span class="sd"></span>${o.label}</span>
         ${o.key === m.key ? Icon("check", { size: 14, style: "margin-left:auto;color:var(--brand)" }) : ""}
       </button>`).join("");
    return `<button type="button" class="st ${m.cls} cd-status-btn" id="th2-status-btn" title="Change client status" aria-haspopup="true">
        <span class="sd"></span>${m.label} ${Icon("chevronDown", { size: 12, style: "margin-left:1px" })}
      </button>
      <div class="cd-status-menu" id="th2-status-menu" hidden style="right:0;left:auto">${items}</div>`;
  }

  function wireStatusControl(cl) {
    const btn = document.getElementById("th2-status-btn");
    if (!btn) return;
    const menu = document.getElementById("th2-status-menu");
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    menu.querySelectorAll("[data-status]").forEach((b) =>
      b.onclick = (e) => { e.stopPropagation(); menu.hidden = true; setClientStatus(cl.id, b.dataset.status); });
    document.addEventListener("click", () => { if (menu) menu.hidden = true; });
  }

  async function setClientStatus(id, newStatus) {
    const cl = clients.find((c) => c.id === id);
    if (!cl || (cl.status || "").toLowerCase() === newStatus) return;
    const prev = cl.status;
    try {
      await Api.patch(`/api/clients/${id}`, { status: newStatus });
      cl.status = newStatus;
      Api.invalidateCache("/api/overview/clients");   // dashboards/lists show status too
      const wrap = document.getElementById("th2-status");
      if (wrap) { wrap.innerHTML = statusControlHTML(cl); wireStatusControl(cl); }
      toast("Client status updated", "success");
    } catch (e) { cl.status = prev; toast(e.message); }
  }

  // ─── Left panel ───
  function renderArchiveToggle() {
    const btn = document.getElementById("archive-toggle");
    if (!btn) return;
    const archived = view === "archived";
    btn.innerHTML = Icon("archive", { size: 16 });
    btn.classList.toggle("on", archived);
    btn.title = archived ? "Back to active chats" : "View archived chats";
    btn.setAttribute("aria-label", btn.title);
    const title = document.getElementById("cl-title");
    if (title) title.textContent = archived ? "Archived" : "Conversations";
    btn.onclick = () => {
      view = archived ? "active" : "archived";
      renderArchiveToggle();
      closeThread();
      load();
    };
  }

  function closeThread() {
    active = null;
    stopPresence();
    closeContactPanel();
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
      // Always fresh: after a send/receive the ordering + unread badges must be
      // current, not a stale cached copy.
      Api.invalidateCache("/api/overview/clients");
      clients = await Api.get(`/api/overview/clients?archived=${view === "archived"}`, { stale: false });
    } catch (e) { toast(e.message); clients = []; }
    renderList();
  }

  // Fingerprint of what the list shows: order + unread badge + latest activity.
  // The background poll only re-renders when this actually changes, so it never
  // disrupts a click or the search box while nothing new has happened.
  function clientsSig(list) {
    return list.map((c) => `${c.id}:${c.unread_count || 0}:${c.last_activity || ""}`).join("|");
  }

  let listTimer = null;
  async function refreshList() {
    let fresh;
    try {
      Api.invalidateCache("/api/overview/clients");
      fresh = await Api.get(`/api/overview/clients?archived=${view === "archived"}`, { stale: false });
    } catch (_) { return; }
    if (clientsSig(fresh) === clientsSig(clients)) return;   // nothing moved
    clients = fresh;
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
    let list = clients.filter((cl) =>
      (chanFilter === "all" || cl.channels.some((ch) => ch.platform === chanFilter)) &&
      (!q || cl.name.toLowerCase().includes(q) || (cl.company || "").toLowerCase().includes(q))
    );
    
    // Sort by last_activity (most recent first), with nulls at the end
    list.sort((a, b) => {
      const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return bTime - aTime;  // Most recent first
    });
    
    const noun = view === "archived" ? "archived client" : "client";
    document.getElementById("cl-sub").textContent = `${clients.length} ${noun}${clients.length === 1 ? "" : "s"}`;
    const scroll = document.getElementById("cl-scroll");
    if (!list.length) {
      scroll.innerHTML = `<div style="padding:24px 16px; text-align:center; color:var(--muted); font-size:13px;">
        ${view === "archived" ? "No archived conversations." : "No conversations found."}</div>`;
      return;
    }
    const archived = view === "archived";
    // Archive view gets an explanatory banner so it's obvious chats can come back.
    const banner = archived
      ? `<div class="arch-banner">
           <span class="ab-ic">${Icon("archive", { size: 16 })}</span>
           <div class="ab-txt"><b>Archived chats</b><span>Use <b>Restore</b> to move a chat back to your main list.</span></div>
         </div>`
      : "";
    scroll.innerHTML = banner + list.map((cl) => {
      const plat = platOf(cl);
      if (archived) {
        // Archived row: prominent labeled Restore button + (admin) Delete.
        return `<div class="ci2 is-archived" data-id="${cl.id}">
          <span class="av2" style="background:${avHash(cl.name)}">
            ${initialsOf(cl.name)}
            <span class="ch-dot" style="background:${chanColor(plat)}"></span>
          </span>
          <div class="ci2-body">
            <div class="ci2-row1"><span class="name">${esc(cl.name)}</span></div>
            <div class="ci2-prev">${esc(cl.company || cl.email || "—")}</div>
            <div class="arch-actions">
              <button class="btn-restore" data-act="restore" data-id="${cl.id}">${Icon("restore", { size: 14 })} Restore</button>
              ${canPurge ? `<button class="btn-purge" data-act="purge" data-id="${cl.id}" title="Delete permanently">${Icon("trash", { size: 13 })} Delete</button>` : ""}
            </div>
          </div>
        </div>`;
      }
      // Active row: opens on click; hover reveals the Archive icon.
      const actions = writable
        ? `<button class="ci2-act" data-act="archive" data-id="${cl.id}" title="Archive chat">${Icon("archive", { size: 14 })}</button>`
        : "";
      const unreadBadge = cl.unread_count && cl.unread_count > 0 
        ? `<span class="unread-badge" style="background:var(--neg);color:#fff;border-radius:50%;width:24px;height:24px;display:grid;place-items:center;font-size:11px;font-weight:700;flex-shrink:0">${cl.unread_count > 99 ? '99+' : cl.unread_count}</span>`
        : "";
      return `<div class="ci2 ${cl.id === active ? "on" : ""}" data-id="${cl.id}">
        <span class="av2" style="background:${avHash(cl.name)}">
          ${initialsOf(cl.name)}
          <span class="ch-dot" style="background:${chanColor(plat)}"></span>
        </span>
        <div class="ci2-body">
          <div class="ci2-row1">
            <span class="name">${esc(cl.name)}</span>
            ${unreadBadge}
          </div>
          <div class="ci2-prev">${esc(cl.company || cl.email || "—")}</div>
          <div class="ci2-foot">
            ${sentPill(cl.sentiment)}
            <span class="ch-pill" style="background:${chanColor(plat)}18;color:${chanColor(plat)}">
              <span class="cd" style="background:${chanColor(plat)}"></span>${platformName(plat)}
            </span>
          </div>
        </div>
        <div class="ci2-actions">${actions}</div>
      </div>`;
    }).join("");
    // Archived chats do NOT open — they must be restored first.
    if (!archived) {
      document.querySelectorAll("#cl-scroll .ci2").forEach((el) =>
        el.addEventListener("click", (e) => {
          if (!e.target.closest(".ci2-act")) selectClient(parseInt(el.dataset.id));
        }));
    }
    document.querySelectorAll("#cl-scroll [data-act]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(b.dataset.id);
        const act = b.dataset.act;
        if (act === "archive") archiveClient(id);
        else if (act === "restore") restoreClient(id);
        else if (act === "purge") permanentlyDeleteClient(id);
      }));
  }

  // ─── Center: message thread ───
  let pendingAttachments = [];
  let recognition = null, recognizing = false;
  let presenceTimer = null, typingSentAt = 0;
  let replyingTo = null, selectMode = false, selected = new Set();
  let sending = false;          // guards against double-send (Enter + click)
  let threadSig = "";           // signature of the last-rendered message set

  // Message pagination state (cursor-based scroll-back).
  const PAGE_LIMIT = 50;
  const threadCache = {};       // clientId -> last-loaded messages, for instant re-open
  let loadedMsgs = [];          // full set currently in view (oldest → newest, deduped by id)
  let hasMoreOlder = false;     // is there an older page to load?
  let loadingOlder = false;     // guard against concurrent scroll-loads

  // Merge a freshly-fetched page (poll) into the loaded set: updates changed
  // messages, adds new ones, and keeps older messages already loaded via scroll.
  function mergeMessages(existing, incoming) {
    const byId = new Map(existing.map((m) => [m.id, m]));
    for (const m of incoming) byId.set(m.id, m);
    const arr = [...byId.values()];
    arr.sort((a, b) => {
      const ta = new Date(a.sent_at || a.created_at).getTime();
      const tb = new Date(b.sent_at || b.created_at).getTime();
      return ta - tb || a.id - b.id;
    });
    return arr;
  }

  // Fetch the page immediately older than what's loaded and prepend it, keeping
  // the user's scroll position anchored to the message they were reading.
  async function loadOlderMessages() {
    if (!hasMoreOlder || loadingOlder || !loadedMsgs.length || active == null) return;
    loadingOlder = true;
    const body = document.getElementById("th2-body");
    const prevHeight = body ? body.scrollHeight : 0;
    const cursor = loadedMsgs[0].sent_at || loadedMsgs[0].created_at;
    try {
      const older = await Api.get(
        `/api/clients/${active}/messages?before=${encodeURIComponent(cursor)}&limit=${PAGE_LIMIT}`,
        { stale: false }
      );
      const known = new Set(loadedMsgs.map((m) => m.id));
      const fresh = older.filter((m) => !known.has(m.id));
      hasMoreOlder = older.length >= PAGE_LIMIT;
      if (fresh.length) {
        loadedMsgs = [...fresh, ...loadedMsgs];
        threadSig = sigOf(loadedMsgs);
        paintMessages(loadedMsgs, true);
        if (body) body.scrollTop = body.scrollHeight - prevHeight;   // anchor position
      }
    } catch (_) { /* transient — try again on next scroll */ }
    finally { loadingOlder = false; }
  }

  // ── Presence + typing + read receipts (team-scoped, light polling) ──
  function markRead(clientId) { return Api.post(`/api/clients/${clientId}/read`).catch(() => {}); }

  function stopPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }

  // ── Live push (WebSocket) — additive; polling below is the fallback ──
  let ws = null, wsConnected = false, wsBackoff = 1000, wsClosed = false;
  function connectWS() {
    if (wsClosed) return;
    const token = Api.token();
    if (!token) return;
    try {
      const base = (typeof BASE_URL !== "undefined" && BASE_URL) ? BASE_URL : location.origin;
      ws = new WebSocket(base.replace(/^http/i, "ws") + "/api/ws?token=" + encodeURIComponent(token));
      ws.onopen = () => { wsConnected = true; wsBackoff = 1000; };
      ws.onmessage = (ev) => {
        let evt; try { evt = JSON.parse(ev.data); } catch (_) { return; }
        if (evt && evt.type === "message") {
          // A new/edited/deleted message somewhere — refresh the open thread if
          // it's the affected client, and the list ordering/unread for everyone.
          if (active != null && evt.client_id === active) refreshMessagesIfChanged(active);
          refreshList();
        }
      };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
      ws.onclose = () => {
        wsConnected = false;
        if (!wsClosed) { setTimeout(connectWS, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 30000); }
      };
    } catch (_) {
      wsConnected = false;
      setTimeout(connectWS, wsBackoff); wsBackoff = Math.min(wsBackoff * 2, 30000);
    }
  }

  function startPresence(clientId) {
    stopPresence();
    let tick = 0;
    const poll = async () => {
      if (active !== clientId) { stopPresence(); return; }
      try {
        const p = await Api.get(`/api/clients/${clientId}/presence`);
        updateTyping(p.typing || []);
        updateOnline(p.online_user_ids || []);
      } catch (_) {}
      // With WS connected, new messages arrive via push — so the poll only pulls
      // messages as a slow safety net (~every 15s). Without WS it stays at 3s.
      if (!wsConnected || (++tick % 5 === 0)) refreshMessagesIfChanged(clientId);
    };
    poll();
    presenceTimer = setInterval(poll, 3000);
  }

  function updateTyping(names) {
    const el = document.getElementById("wa-typing");
    const txt = document.getElementById("wa-typing-txt");
    if (!el || !txt) return;
    if (names.length) {
      txt.textContent = names.length === 1 ? `${names[0]} is typing…` : `${names.length} people are typing…`;
      el.style.display = "flex";
    } else { el.style.display = "none"; }
  }

  function updateOnline(ids) {
    const pill = document.getElementById("online-pill");
    const txt = document.getElementById("online-txt");
    if (!pill || !txt) return;
    const others = ids.filter((id) => id !== CURRENT_USER.id);
    if (others.length) {
      txt.textContent = `${others.length} teammate${others.length > 1 ? "s" : ""} online`;
      pill.style.display = "inline-flex";
    } else { pill.style.display = "none"; }
  }

  function signalTyping(clientId, textarea) {
    let typingTimer = null;
    const stopTyping = () => { Api.post(`/api/clients/${clientId}/typing`, { typing: false }).catch(() => {}); typingSentAt = 0; };
    textarea.addEventListener("input", () => {
      const now = Date.now();
      if (now - typingSentAt > 2500) { typingSentAt = now; Api.post(`/api/clients/${clientId}/typing`, { typing: true }).catch(() => {}); }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(stopTyping, 3000);
    });
    textarea.addEventListener("blur", stopTyping);
  }

  // Voice-to-text: uses the browser Web Speech API. Recognized words are written
  // into the composer textarea so the user can review/edit before sending.
  function setupVoiceInput(textarea, autoGrow) {
    const micBtn = document.getElementById("mic-btn");
    const hint = document.getElementById("mic-hint");
    if (!micBtn) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.title = "Voice input isn't supported in this browser";
      micBtn.addEventListener("click", () => toast("Voice input isn't supported here — try Google Chrome."));
      return;
    }
    let baseText = "", finalText = "";
    micBtn.addEventListener("click", () => {
      if (recognizing) { try { recognition.stop(); } catch (_) {} return; }
      recognition = new SR();
      recognition.lang = navigator.language || "en-US";
      recognition.interimResults = true;
      recognition.continuous = true;
      baseText = textarea.value ? textarea.value.replace(/\s+$/, "") + " " : "";
      finalText = "";
      recognition.onstart = () => { recognizing = true; micBtn.classList.add("listening"); if (hint) hint.style.display = "flex"; };
      recognition.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t + " ";
          else interim += t;
        }
        textarea.value = (baseText + finalText + interim).replace(/\s{2,}/g, " ");
        autoGrow();
      };
      recognition.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed")
          toast("Microphone access denied. Allow mic permission to use voice input.");
        else if (ev.error !== "aborted" && ev.error !== "no-speech")
          toast("Voice input error: " + ev.error);
      };
      recognition.onend = () => { recognizing = false; micBtn.classList.remove("listening"); if (hint) hint.style.display = "none"; textarea.focus(); };
      try { recognition.start(); } catch (_) {}
    });
  }

  async function renderThread() {
    if (recognizing && recognition) { try { recognition.stop(); } catch (_) {} }
    if (selectMode) exitSelectMode();
    const cl = clients.find((x) => x.id === active);
    const plat = platOf(cl);

    // Header — the avatar opens the quick Contact info panel; clicking the name
    // opens the client's full profile page. Only the name and channel show here;
    // company/email/phone live in the contact panel & full profile.
    document.getElementById("th2-head").innerHTML = `
      <button class="th2-id" id="open-contact" title="Open full profile">
        <span class="av2" style="background:${avHash(cl.name)};width:38px;height:38px;font-size:13px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex-shrink:0">
          ${initialsOf(cl.name)}
        </span>
        <span class="th2-id-txt">
          <span class="name name-link" title="Open full profile">${esc(cl.name)}</span>
          <span class="meta">
            <span class="ch-pill" style="background:${chanColor(plat)}18;color:${chanColor(plat)}">
              <span class="cd" style="background:${chanColor(plat)}"></span>${platformName(plat)}
            </span>
            <span class="online-pill" id="online-pill" style="display:none"><span class="odot"></span><span id="online-txt"></span></span>
          </span>
        </span>
      </button>
      <div class="th2-acts">
        ${canEditStatus
          ? `<div class="cd-status th2-status" id="th2-status">${statusControlHTML(cl)}</div>`
          : `<span class="st ${statusMeta(cl.status).cls}"><span class="sd"></span>${statusMeta(cl.status).label}</span>`}
        <a class="icon-btn" href="/client?id=${cl.id}&from=conversations" title="Open full profile" aria-label="Open full profile">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        </a>
        <button class="icon-btn" id="chat-menu-btn" title="Chat options" aria-haspopup="true">${Icon("dots", { size: 16 })}</button>
      </div>`;
    document.getElementById("open-contact").onclick = () => {
      // Clicking anywhere on the identity block (avatar or name) opens the full
      // Client Profile page.
      location.href = `/client?id=${cl.id}&from=conversations`;
    };
    if (canEditStatus) wireStatusControl(cl);
    document.getElementById("chat-menu-btn").onclick = (e) => { e.stopPropagation(); openChatMenu(e.currentTarget, cl); };

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
        ${writable ? "" : `<div class="perm-banner no">
          <svg class="perm-ic" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Read-only role — replying is disabled.
        </div>`}
        <div class="wa-typing" id="wa-typing" style="display:none"><span class="td"></span><span class="td"></span><span class="td"></span><span id="wa-typing-txt"></span></div>
        <div class="wa-listening-hint" id="mic-hint" style="display:none"><span class="dot"></span> Listening… speak now. Your words appear in the box — review before sending.</div>
        <div id="att-preview-area" class="att-preview" style="display:none"></div>
        <div class="wa-composer">
          <div class="wa-input">
            <button class="wa-icon-btn" id="att-btn" title="Attach file" ${writable ? "" : "disabled"}>
              <svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 16.41a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
            </button>
            <textarea id="composer-text" placeholder="${writable ? "Type a message" : "Replying is disabled for your role"}" ${writable ? "" : "disabled"} rows="1"></textarea>
            <button class="wa-icon-btn" id="mic-btn" title="Voice to text" ${writable ? "" : "disabled"}>
              <svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>
            </button>
          </div>
          <button class="wa-send" id="send-btn" title="Send" ${writable ? "" : "disabled"}>
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" style="transform:translateX(1px)">
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
        const autoGrow = () => { textarea.style.height = "auto"; textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px"; };
        textarea.addEventListener("input", autoGrow);

        // Enter to send, Shift+Enter for newline (WhatsApp-style)
        textarea.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });

        sendBtn.addEventListener("click", sendMessage);
        attBtn.addEventListener("click", () => attFileInput.click());
        // #att-file-input is a persistent page element; use onchange (not
        // addEventListener) so re-rendering the composer replaces the handler
        // instead of stacking duplicates (which caused files to send twice).
        attFileInput.onchange = () => {
          const files = Array.from(attFileInput.files);
          pendingAttachments.push(...files);
          renderAttPreviews();
          attFileInput.value = "";
        };

        // Drag-and-drop support
        const composerArea = document.getElementById("composer-area");
        const threadBody = document.getElementById("th2-body");
        
        // Helper function to handle dropped files
        const handleDroppedFiles = (files) => {
          const fileArray = Array.from(files).filter(f => f.type); // Filter out non-file items
          if (fileArray.length) {
            pendingAttachments.push(...fileArray);
            renderAttPreviews();
          }
        };

        // Add drag-over and drop listeners to composer area
        const dragoverHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (composerArea) composerArea.style.backgroundColor = "var(--brand-soft)";
        };

        const dragleaveHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (composerArea) composerArea.style.backgroundColor = "";
        };

        const dropHandler = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (composerArea) composerArea.style.backgroundColor = "";
          if (e.dataTransfer && e.dataTransfer.files) {
            handleDroppedFiles(e.dataTransfer.files);
          }
        };

        // Attach drag-and-drop listeners to composer and thread areas
        if (composerArea) {
          composerArea.addEventListener("dragover", dragoverHandler);
          composerArea.addEventListener("dragleave", dragleaveHandler);
          composerArea.addEventListener("drop", dropHandler);
        }

        if (threadBody) {
          threadBody.addEventListener("dragover", dragoverHandler);
          threadBody.addEventListener("dragleave", dragleaveHandler);
          threadBody.addEventListener("drop", dropHandler);
        }

        setupVoiceInput(textarea, autoGrow);
        signalTyping(cl.id, textarea);
      }
      renderReplyBar();  // restore the reply preview if one is active
    }

    const targetId = cl.id;
    loadingOlder = false;
    const bodyEl = document.getElementById("th2-body");

    // Instant paint: if we've seen this chat before, show its cached messages at
    // once (correct client, no blank flash), then revalidate below. Otherwise
    // clear the previous chat's messages so they never linger while loading.
    const cached = threadCache[targetId];
    if (cached && cached.length) {
      loadedMsgs = cached;
      hasMoreOlder = cached.length >= PAGE_LIMIT;
      threadSig = sigOf(cached);
      paintMessages(cached, false);
    } else {
      loadedMsgs = [];
      hasMoreOlder = false;
      threadSig = "";
      if (bodyEl) bodyEl.innerHTML = "";
    }

    // Revalidate against the server. Discard the response if we've since switched
    // chats, and only repaint when it actually differs from what's shown.
    try {
      const msgs = await Api.get(`/api/clients/${targetId}/messages?limit=${PAGE_LIMIT}`, { stale: false });
      if (active !== targetId) return;   // switched chats mid-fetch — discard
      threadCache[targetId] = msgs;
      loadedMsgs = msgs;
      hasMoreOlder = msgs.length >= PAGE_LIMIT;
      const sig = sigOf(msgs);
      if (sig !== threadSig) { threadSig = sig; paintMessages(msgs, true); }
    } catch (e) { if (active === targetId && !(cached && cached.length)) toast(e.message); }
  }

  // A lightweight fingerprint of the message set — id + read/edited/deleted flags.
  // If it hasn't changed, there's nothing to repaint.
  function sigOf(msgs) {
    return msgs.map((m) => `${m.id}:${m.read ? 1 : 0}:${m.edited ? 1 : 0}:${m.deleted ? 1 : 0}`).join(",");
  }

  // Poll-driven refresh (from startPresence). Repaints only when the set actually
  // changed, and never while the user is mid-interaction or an upload is in flight
  // — so incoming messages appear within the poll interval without disruption.
  async function refreshMessagesIfChanged(clientId) {
    if (active !== clientId || view === "archived" || sending) return;
    if (document.querySelector(".bubble2.editing") || document.getElementById("msg-menu") || selectMode) return;
    let latest;
    try { latest = await Api.get(`/api/clients/${clientId}/messages?limit=${PAGE_LIMIT}`, { stale: false }); }
    catch (_) { return; }
    if (active !== clientId) return;                 // client switched mid-fetch
    // Merge the latest page into what's loaded so scroll-back history is preserved.
    const merged = mergeMessages(loadedMsgs, latest);
    const sig = sigOf(merged);
    if (sig === threadSig) return;                   // nothing new
    threadSig = sig;
    loadedMsgs = merged;
    threadCache[clientId] = merged;   // keep the cache warm for instant re-open
    paintMessages(loadedMsgs, true);
    // The thread is open and on-screen, so anything that just arrived is "seen" —
    // advance the read marker so this chat's badge stays cleared, then refresh the
    // list so ordering + unread badges update (moves this chat to the top).
    await markRead(clientId);
    await refreshList();
  }

  function paintMessages(msgs, preserveScroll) {
    const body = document.getElementById("th2-body");
    if (!body) return;
    // If the user has scrolled up to read history, a poll refresh must not yank
    // them to the bottom. A fresh open / own send always scrolls down.
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
    if (!msgs.length) {
      body.innerHTML = `<div class="conv-empty-state" style="height:auto;padding:40px 0">
        <div class="icon-wrap" style="width:48px;height:48px;font-size:20px">${Icon("message", { size: 20 })}</div>
        <p style="max-width:220px">No messages yet. Start the conversation below.</p>
      </div>`;
      return;
    }
    {
        const token = Api.token();
        const waTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        const waDay = (d) => {
          const dt = new Date(d), s = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
          const diff = Math.round((s(new Date()) - s(dt)) / 86400000);
          if (diff === 0) return "Today";
          if (diff === 1) return "Yesterday";
          return dt.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
        };
        // Single tick = sent; double (blue) tick = seen by a teammate.
        const SINGLE = `<svg width="15" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5l4 4L15 3"/></svg>`;
        const DOUBLE = `<svg width="17" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5l4 4L14 3"/><path d="M8 11.5L16.5 3"/></svg>`;
        const tickFor = (m) => `<span class="tick ${m.read ? "read" : ""}" title="${m.read ? "Seen by a teammate" : "Sent"}">${m.read ? DOUBLE : SINGLE}</span>`;

        let html = "", lastDay = null, lastSide = null;
        for (const m of msgs) {
          const dt = m.sent_at || m.created_at;
          const day = waDay(dt);
          if (day !== lastDay) { html += `<div class="day-sep2">${esc(day)}</div>`; lastDay = day; lastSide = null; }
          const side = m.is_client ? "in" : "out";
          const groupStart = side !== lastSide;
          lastSide = side;

          const rawUrl = m.attachment_url || "";
          const isExternal = rawUrl.startsWith("http");
          const url = (rawUrl && !isExternal && token)
            ? rawUrl + (rawUrl.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token)
            : rawUrl;
          const extLower = (m.attachment_name || "").toLowerCase();
          const isVideo = [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].some((e) => extLower.endsWith(e));
          const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((e) => extLower.endsWith(e));

          let content, hasAtt = false;
          if (m.attachment_type === "audio" && isVideo) {
            hasAtt = true;
            content = `<div class="att-video"><video controls preload="metadata" src="${esc(url)}" style="max-width:100%;width:280px;border-radius:6px;display:block;"></video></div>`;
          } else if (m.attachment_type === "audio") {
            hasAtt = true;
            content = `<div class="att-audio"><audio controls preload="none" src="${esc(url)}"></audio></div>`;
          } else if (m.attachment_type === "file" && isImage) {
            hasAtt = true;
            content = `<div class="att-image"><img class="att-img" data-url="${esc(url)}" src="${esc(url)}" style="max-width:100%;width:280px;max-height:280px;object-fit:cover;border-radius:6px;display:block;cursor:pointer;" /></div>`;
          } else if (m.attachment_type === "file") {
            hasAtt = true;
            const ext = isExternal ? "LINK" : (m.attachment_name || "file").split(".").pop().toUpperCase().slice(0, 4);
            content = `<a class="att-file" href="${esc(url)}" target="_blank" rel="noopener">
              <div class="file-ic" style="background:${fileIcColor(ext)}">${ext}</div>
              <div class="file-info">
                <div class="file-name">${esc(m.attachment_name || "Download")}</div>
                <div class="file-sub">${isExternal ? "Open link" : "Download"}</div>
              </div>
              <svg class="dl-ic" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>`;
          } else {
            content = esc(m.body);
          }

          // WhatsApp-style deleted placeholder + edited tag + actions.
          if (m.deleted) {
            content = `<span class="wa-deleted">${Icon("ban", { size: 13 })} This message was deleted</span>`;
            hasAtt = false;
          }
          const withinWindow = dt && (Date.now() - new Date(dt).getTime() < 86400000);
          const canDelete = m.mine && !m.deleted && m.id > 0 && withinWindow;
          const canEdit = canDelete && !hasAtt;
          const editedTag = (m.edited && !m.deleted) ? `<span class="wa-edited">edited</span>` : "";
          // Quoted reply preview
          const snippet = m.deleted ? "" : (m.body
            || (m.attachment_type === "audio" ? (isVideo ? "Video" : "Audio")
              : (m.attachment_type === "file" ? (isImage ? "Photo" : (m.attachment_name || "Document")) : "")));
          const quote = m.reply_to_sender
            ? `<div class="reply-quote"><span class="rq-sender">${esc(m.reply_to_sender)}</span><span class="rq-text">${esc(m.reply_to_text || "")}</span></div>`
            : "";
          // The options menu is available on every real, non-deleted message.
          const menu = (!m.deleted && m.id > 0)
            ? `<button class="msg-menu-btn" data-id="${m.id}" data-sender="${esc(m.sender_name)}" data-body="${esc(m.body || "")}" data-snippet="${esc(snippet)}" data-edit="${canEdit ? 1 : 0}" data-del="${canDelete ? 1 : 0}" title="Message options">
                 <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18" r="1.6"/></svg>
               </button>`
            : "";

          const sender = groupStart ? `<div class="wa-sender">${esc(m.sender_name)}</div>` : "";
          const time = `<span class="wa-time">${editedTag}${waTime(dt)}${(side === "out" && !m.deleted) ? tickFor(m) : ""}</span>`;
          const rawAttr = (!hasAtt && !m.deleted) ? ` data-raw="${esc(m.body)}"` : "";
          html += `<div class="msg2 ${side} ${groupStart ? "grp" : ""} ${m.deleted ? "is-deleted" : ""}" data-mid="${m.id}" data-del="${canDelete ? 1 : 0}" data-snippet="${esc(snippet)}" data-sender="${esc(m.sender_name)}">
            <span class="msg-check"></span>
            <div class="bubble2 ${hasAtt ? "has-att" : ""}" data-mid="${m.id}"${rawAttr}>${quote}${sender}${content}${time}${menu}</div>
          </div>`;
        }
        body.innerHTML = html;
        wireMessageMenus(body);
        if (!preserveScroll || nearBottom) body.scrollTop = body.scrollHeight;
        // Delegated image click → WhatsApp-style lightbox (no inline onclick = no XSS).
        body.querySelectorAll(".att-img").forEach((img) =>
          img.addEventListener("click", () => openLightbox(img.dataset.url)));
    }
  }

  // Open a media URL in a new tab, but confirm it actually loads first. After the
  // region migration some files exist as DB rows but not on disk (404), which
  // otherwise opened a broken tab. Probe with a 1-byte range GET — the download
  // routes are GET-only (HEAD returns 405) and support ranges, so a missing file
  // returns 404 while an existing one returns 200/206.
  async function openMedia(url, label) {
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
      if (res.status === 404) {
        toast(`${label || "This file"} is no longer available on the server.`);
        return;
      }
      if (!res.ok && res.status !== 206) {
        toast(`Couldn't open ${label ? label.toLowerCase() : "the file"} (error ${res.status}).`);
        return;
      }
      window.open(url, "_blank", "noopener");
    } catch (_) {
      toast("Couldn't open the file — network error.");
    }
  }

  // ── Image lightbox (WhatsApp-style full-screen viewer) ──
  function openLightbox(url) {
    if (!url) return;
    let el = document.getElementById("att-lightbox");
    if (!el) {
      el = document.createElement("div");
      el.id = "att-lightbox";
      el.innerHTML = `
        <button class="lb-close" title="Close" aria-label="Close">${Icon("x", { size: 22 })}</button>
        <a class="lb-download" title="Download" download><span></span>${Icon("download", { size: 20 })}</a>
        <img class="lb-img" alt="" />`;
      document.body.appendChild(el);
      const close = () => el.classList.remove("show");
      el.addEventListener("click", (e) => { if (e.target === el) close(); });
      el.querySelector(".lb-close").addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    }
    const img = el.querySelector(".lb-img");
    img.onerror = () => { el.classList.remove("show"); toast("This image is no longer available on the server."); };
    img.src = url;
    el.querySelector(".lb-download").href = url;
    el.classList.add("show");
  }

  // ── Own-message edit / delete-for-everyone (within 24h) ──
  function closeMsgMenu() { const m = document.getElementById("msg-menu"); if (m) m.remove(); }
  document.addEventListener("click", closeMsgMenu);

  function wireMessageMenus(body) {
    body.querySelectorAll(".msg-menu-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = document.getElementById("msg-menu");
        closeMsgMenu();
        if (open && open.dataset.for === btn.dataset.id) return;  // toggle off
        const id = parseInt(btn.dataset.id);
        const d = btn.dataset;
        const canEdit = d.edit === "1", canDel = d.del === "1", hasBody = !!d.body;
        const menu = document.createElement("div");
        menu.className = "msg-menu"; menu.id = "msg-menu"; menu.dataset.for = d.id;
        menu.innerHTML =
          `<button data-a="reply">${Icon("restore", { size: 14 })} Reply</button>` +
          (hasBody ? `<button data-a="copy">${Icon("clipboard", { size: 14 })} Copy</button>` : "") +
          `<button data-a="select">${Icon("check", { size: 14 })} Select</button>` +
          (canEdit ? `<button data-a="edit">${Icon("edit", { size: 14 })} Edit</button>` : "") +
          `<button data-a="hide" class="danger">${Icon("trash", { size: 14 })} Delete for me</button>` +
          (canDel ? `<button data-a="deleteall" class="danger">${Icon("trash", { size: 14 })} Delete for everyone</button>` : "");
        menu.addEventListener("click", (ev) => ev.stopPropagation());
        document.body.appendChild(menu);
        const r = btn.getBoundingClientRect();
        menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left - 120, window.innerWidth - menu.offsetWidth - 10))}px`;
        const on = (a, fn) => { const b = menu.querySelector(`[data-a="${a}"]`); if (b) b.addEventListener("click", () => { closeMsgMenu(); fn(); }); };
        on("reply", () => setReply(id, d.sender, d.snippet));
        on("copy", () => copyText(d.body));
        on("select", () => enterSelectMode(id));
        on("edit", () => startEditMessage(id, btn));
        on("hide", () => hideChatMessage(id));
        on("deleteall", () => deleteChatMessage(id));
      });
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text || ""); toast("Copied to clipboard", "success"); }
    catch (_) { toast("Couldn't copy — check browser permissions"); }
  }

  // ── Reply (quoted) ──
  function setReply(id, sender, snippet) {
    replyingTo = { id, sender: sender || "", snippet: snippet || "" };
    renderReplyBar();
    const ta = document.getElementById("composer-text"); if (ta) ta.focus();
  }
  function clearReply() { replyingTo = null; renderReplyBar(); }
  function renderReplyBar() {
    const area = document.getElementById("composer-area");
    if (!area) return;
    let bar = document.getElementById("reply-bar");
    if (!replyingTo) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "reply-bar"; area.insertBefore(bar, area.firstChild); }
    bar.innerHTML = `<div class="rb-body"><span class="rb-sender">${esc(replyingTo.sender)}</span><span class="rb-text">${esc(replyingTo.snippet)}</span></div>
      <button class="rb-close" title="Cancel reply">${Icon("x", { size: 16 })}</button>`;
    bar.querySelector(".rb-close").onclick = clearReply;
  }

  // ── Select mode (multi-select) ──
  function enterSelectMode(firstId) {
    selectMode = true;
    selected = new Set(firstId != null && firstId > 0 ? [firstId] : []);
    const body = document.getElementById("th2-body");
    if (body) body.classList.add("select-mode");
    document.querySelectorAll(".msg2").forEach((el) => el.classList.toggle("selected", selected.has(parseInt(el.dataset.mid))));
    updateSelectionUI();
  }
  function exitSelectMode() {
    selectMode = false; selected.clear();
    const body = document.getElementById("th2-body");
    if (body) body.classList.remove("select-mode");
    document.querySelectorAll(".msg2.selected").forEach((el) => el.classList.remove("selected"));
    const bar = document.getElementById("select-bar"); if (bar) bar.remove();
  }
  function updateSelectionUI() {
    let bar = document.getElementById("select-bar");
    if (!bar) { bar = document.createElement("div"); bar.id = "select-bar"; document.getElementById("conv-center").appendChild(bar); }
    const n = selected.size;
    bar.innerHTML = `<button class="sb-close" title="Cancel">${Icon("x", { size: 18 })}</button>
      <span class="sb-count">${n} selected</span>
      <div class="sb-actions">
        <button class="sb-copy" ${n ? "" : "disabled"}>${Icon("clipboard", { size: 15 })} Copy</button>
        <button class="sb-del danger" ${n ? "" : "disabled"}>${Icon("trash", { size: 15 })} Delete</button>
      </div>`;
    bar.querySelector(".sb-close").onclick = exitSelectMode;
    bar.querySelector(".sb-copy").onclick = copySelected;
    bar.querySelector(".sb-del").onclick = deleteSelected;
  }
  async function copySelected() {
    const parts = [];
    document.querySelectorAll("#th2-body .msg2").forEach((row) => {
      if (selected.has(parseInt(row.dataset.mid))) {
        const s = row.dataset.snippet || "";
        parts.push(selected.size > 1 ? `${row.dataset.sender || ""}: ${s}` : s);
      }
    });
    await copyText(parts.join("\n"));
    exitSelectMode();
  }
  async function deleteSelected() {
    const ids = [...document.querySelectorAll("#th2-body .msg2")]
      .filter((row) => selected.has(parseInt(row.dataset.mid)) && row.dataset.del === "1")
      .map((row) => parseInt(row.dataset.mid));
    if (!ids.length) { toast("You can only delete your own messages (within 24h)"); return; }
    const ok = await confirmDialog(
      `Delete ${ids.length} message${ids.length > 1 ? "s" : ""} for everyone? This can't be undone.`,
      { title: "Delete messages?", confirmText: "Delete for everyone" }
    );
    if (!ok) return;
    try {
      for (const id of ids) await Api.del(`/api/clients/${active}/messages/${id}`);
      exitSelectMode();
      await renderThread();
      toast("Messages deleted", "success");
    } catch (e) { toast(e.message); }
  }

  function startEditMessage(id, btn) {
    const bubble = btn.closest(".bubble2");
    if (!bubble) return;
    const raw = bubble.dataset.raw || "";
    bubble.classList.add("editing");
    bubble.innerHTML = `<textarea class="msg-edit-ta" rows="1"></textarea>
      <div class="msg-edit-actions">
        <button class="me-cancel">Cancel</button>
        <button class="me-save">Save</button>
      </div>`;
    const ta = bubble.querySelector(".msg-edit-ta");
    ta.value = raw;
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    ta.focus(); ta.setSelectionRange(raw.length, raw.length);
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
    const save = async () => {
      const val = ta.value.trim();
      if (!val) return toast("Message can't be empty");
      try { await Api.patch(`/api/clients/${active}/messages/${id}`, { body: val }); await renderThread(); toast("Message edited", "success"); }
      catch (e) { toast(e.message); }
    };
    bubble.querySelector(".me-cancel").onclick = () => renderThread();
    bubble.querySelector(".me-save").onclick = save;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
      if (e.key === "Escape") renderThread();
    });
  }

  async function deleteChatMessage(id) {
    const ok = await confirmDialog(
      "This removes the message for everyone in this conversation. This can't be undone.",
      { title: "Delete for everyone?", confirmText: "Delete for everyone" }
    );
    if (!ok) return;
    try { await Api.del(`/api/clients/${active}/messages/${id}`); await renderThread(); toast("Message deleted for everyone", "success"); }
    catch (e) { toast(e.message); }
  }

  async function hideChatMessage(id) {
    // "Delete for me" — hides only from the current user's view.
    try { await Api.post(`/api/clients/${active}/messages/${id}/hide`); await renderThread(); toast("Message deleted for you", "success"); }
    catch (e) { toast(e.message); }
  }

  function renderAttPreviews() {
    const area = document.getElementById("att-preview-area");
    if (!area) return;
    // Revoke any object URLs from a previous render to avoid leaks.
    area.querySelectorAll("[data-objurl]").forEach((el) => URL.revokeObjectURL(el.dataset.objurl));
    if (!pendingAttachments.length) { area.style.display = "none"; area.innerHTML = ""; return; }
    area.style.display = "flex";
    area.innerHTML = pendingAttachments.map((f, i) => {
      const isImg = f.type.startsWith("image/");
      const isVid = f.type.startsWith("video/");
      let thumb;
      if (isImg) {
        const u = URL.createObjectURL(f);
        thumb = `<img class="att-thumb" data-objurl="${u}" src="${u}" alt="" />`;
      } else if (isVid) {
        const u = URL.createObjectURL(f);
        thumb = `<video class="att-thumb" data-objurl="${u}" src="${u}" muted></video>`;
      } else {
        thumb = `<span class="att-thumb att-thumb-file">${Icon("file", { size: 18 })}</span>`;
      }
      return `<div class="att-chip">
        ${thumb}
        <span class="att-nm">${esc(f.name)}</span>
        <button class="att-rm" data-idx="${i}" title="Remove">${Icon("x", { size: 12 })}</button>
      </div>`;
    }).join("");
    area.querySelectorAll(".att-rm").forEach((b) =>
      b.addEventListener("click", () => {
        pendingAttachments.splice(parseInt(b.dataset.idx), 1);
        renderAttPreviews();
      }));
  }

  async function sendMessage() {
    // Guard against a double-send when Enter and the Send button both fire.
    if (sending) return;
    const ta = document.getElementById("composer-text");
    const text = (ta.value || "").trim();
    const files = pendingAttachments.slice();
    if (!text && !files.length) return;
    const cl = clients.find((x) => x.id === active);
    if (!cl) return;

    sending = true;
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.disabled = true;
    // Take ownership of the queue immediately so a second trigger sees nothing.
    pendingAttachments = [];

    try {
      // Send text first (carrying the quoted-reply target, if any).
      if (text) {
        await Api.post(`/api/clients/${cl.id}/messages`, { body: text, reply_to_id: replyingTo ? replyingTo.id : null });
        ta.value = "";
        ta.style.height = "auto";
        clearReply();
      }
      renderAttPreviews();   // clear the composer preview strip

      // Upload each attachment with a WhatsApp-style progress bubble.
      for (const file of files) {
        const bubble = addUploadingBubble(file);
        try {
          await Api.uploadForm(`/api/clients/${cl.id}/messages/upload`, uploadBody(file),
            (frac) => setUploadProgress(bubble, frac));
          setUploadProgress(bubble, 1);
        } catch (e) {
          markUploadFailed(bubble, file.name);
          toast("Could not upload " + file.name + ": " + e.message);
        }
      }
      await renderThread();   // repaint from the server (replaces the bubbles)
      // Reload clients to update last_activity and unread_count (moves chat to top)
      await load();
      // Re-select the active client to keep it highlighted
      if (active) {
        const activeEl = document.querySelector(`#cl-scroll .ci2[data-id="${active}"]`);
        if (activeEl) activeEl.classList.add("on");
      }
    } catch (e) {
      toast(e.message);
    } finally {
      sending = false;
      const b = document.getElementById("send-btn");
      if (b) b.disabled = false;
    }
  }

  function uploadBody(file) { const fd = new FormData(); fd.append("upload", file); return fd; }

  // Optimistic "uploading" bubble shown in the thread while bytes are in flight.
  function addUploadingBubble(file) {
    const body = document.getElementById("th2-body");
    if (!body) return null;
    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    const thumb = (isImg || isVid) ? URL.createObjectURL(file) : null;
    const el = document.createElement("div");
    el.className = "msg2 out grp uploading";
    el.innerHTML = `
      <div class="bubble2 has-att">
        <div class="att-uploading">
          ${isImg ? `<img class="up-thumb" src="${thumb}" alt="" />`
            : isVid ? `<video class="up-thumb" src="${thumb}" muted></video>`
            : `<span class="up-fileic">${Icon("file", { size: 20 })}</span>`}
          <div class="up-ring"><svg viewBox="0 0 36 36"><circle class="up-track" cx="18" cy="18" r="16"/><circle class="up-bar" cx="18" cy="18" r="16"/></svg></div>
          <span class="up-name">${esc(file.name)}</span>
        </div>
        <span class="wa-time">Uploading…</span>
      </div>`;
    if (thumb) el.dataset.objurl = thumb;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function setUploadProgress(el, frac) {
    if (!el) return;
    const bar = el.querySelector(".up-bar");
    if (bar) { const len = 2 * Math.PI * 16; bar.style.strokeDasharray = len; bar.style.strokeDashoffset = len * (1 - Math.max(0, Math.min(1, frac))); }
    const t = el.querySelector(".wa-time");
    if (t) t.textContent = frac >= 1 ? "Processing…" : `Uploading… ${Math.round(frac * 100)}%`;
  }
  function markUploadFailed(el, name) {
    if (!el) return;
    const t = el.querySelector(".wa-time");
    if (t) { t.textContent = "Upload failed"; t.style.color = "var(--neg)"; }
    if (el.dataset.objurl) URL.revokeObjectURL(el.dataset.objurl);
  }

  // ─── Chat options menu (header kebab) ───
  function closeChatMenu() { const m = document.getElementById("chat-menu"); if (m) m.remove(); }
  document.addEventListener("click", closeChatMenu);

  function openChatMenu(btn, cl) {
    const open = document.getElementById("chat-menu");
    closeChatMenu();
    if (open) return;  // toggle off
    const menu = document.createElement("div");
    menu.className = "msg-menu chat-menu"; menu.id = "chat-menu";
    menu.innerHTML =
      `<button data-a="contact">${Icon("users", { size: 14 })} Contact info</button>` +
      // Clear chat is destructive and Super-Admin-only; Archive stays available to any writable role.
      (canClearAll && view !== "archived"
        ? `<button data-a="clear" class="danger">${Icon("eraser", { size: 14 })} Clear chat</button>`
        : "") +
      (writable && view !== "archived"
        ? `<button data-a="archive">${Icon("archive", { size: 14 })} Archive chat</button>`
        : "") +
      (canClearAll
        ? `<div class="menu-sep"></div><button data-a="clearall" class="danger">${Icon("alert", { size: 14 })} Clear all chats</button>`
        : "");
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 10))}px`;
    const on = (a, fn) => { const b = menu.querySelector(`[data-a="${a}"]`); if (b) b.onclick = () => { closeChatMenu(); fn(); }; };
    on("contact", () => openContactPanel(cl.id));
    on("clear", () => clearChat(cl.id));
    on("archive", () => archiveClient(cl.id));
    on("clearall", clearAllChats);
  }

  // ─── Clear chat / Clear all chats ───
  async function clearChat(id) {
    const cl = clients.find((c) => c.id === id);
    const ok = await confirmDialog(
      `Every message in ${cl ? cl.name + "'s" : "this"} conversation will be removed for you and for the whole team.`,
      {
        title: "Clear this chat?",
        confirmText: "Clear chat",
        icon: "eraser",
        consequences: [
          "All messages in this thread are permanently deleted.",
          "Shared files stay available under Documents and Call Recordings.",
          "The client, project and AI analysis are not affected.",
        ],
      }
    );
    if (!ok) return;
    try {
      const res = await Api.del(`/api/clients/${id}/messages`);
      Api.invalidateCache(`/api/clients/${id}/`);
      if (active === id) await renderThread();
      const n = res && res.messages_deleted;
      toast(n ? `Chat cleared — ${n} message${n === 1 ? "" : "s"} removed` : "Chat cleared", "success");
    } catch (e) { toast(e.message); }
  }

  async function clearAllChats() {
    const ok = await confirmDialog(
      "This wipes the message history of every conversation in Consul, for every user. There is no undo and no backup.",
      {
        title: "Clear all chats?",
        confirmText: "Clear all chats",
        icon: "alert",
        confirmPhrase: "CLEAR ALL",
        note: "Only a Super Admin can perform this action.",
        consequences: [
          "Every message in every client conversation is permanently deleted.",
          "Shared files stay available under Documents and Call Recordings.",
          "Clients, projects and archived conversations are not deleted.",
        ],
      }
    );
    if (!ok) return;
    try {
      const res = await Api.del("/api/clients/messages/all");
      Api.invalidateCache("/api/clients/");  // every client's message list is now stale
      if (active) await renderThread();
      toast(`All chats cleared — ${res.messages_deleted} message${res.messages_deleted === 1 ? "" : "s"} removed across ${res.clients} client${res.clients === 1 ? "" : "s"}`, "success");
    } catch (e) { toast(e.message); }
  }

  // ─── Contact info panel (WhatsApp-style) ───
  const _isImgName = (n) => [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((e) => (n || "").toLowerCase().endsWith(e));
  const _isVidName = (n) => [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].some((e) => (n || "").toLowerCase().endsWith(e));
  const _isAudioName = (n) => [".mp3", ".wav", ".m4a", ".ogg", ".oga", ".aac", ".flac"].some((e) => (n || "").toLowerCase().endsWith(e));
  const _withToken = (u) => { const t = Api.token(); return t ? u + (u.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t) : u; };

  function closeContactPanel() {
    const p = document.getElementById("contact-panel");
    if (p) p.classList.remove("show");
    const s = document.getElementById("contact-scrim");
    if (s) s.classList.remove("show");
  }

  async function openContactPanel(id) {
    const cl = clients.find((c) => c.id === id);
    if (!cl) return;
    const plat = platOf(cl);

    let scrim = document.getElementById("contact-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.id = "contact-scrim";
      document.body.appendChild(scrim);
      scrim.addEventListener("click", closeContactPanel);
    }
    let panel = document.getElementById("contact-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "contact-panel";
      // Anchor to the whole conversation shell, not the centre pane. The centre
      // pane narrows when the AI panel is open, which docked the panel to the
      // MIDDLE of the screen on first open instead of the true right edge.
      (document.querySelector(".conv-shell") || document.getElementById("conv-center")).appendChild(panel);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeContactPanel(); });
    }

    const rows = [
      ["Company", cl.company],
      ["Email", cl.email],
      ["Phone", cl.phone],
    ].filter(([, v]) => v);

    panel.innerHTML = `
      <header class="cp-head">
        <button class="cp-close" title="Close" aria-label="Close">${Icon("x", { size: 18 })}</button>
        <span>Contact info</span>
      </header>
      <div class="cp-scroll">
        <div class="cp-hero">
          <span class="cp-av" style="background:${avHash(cl.name)}">${initialsOf(cl.name)}</span>
          <h3>${esc(cl.name)}</h3>
          <div class="cp-chips">
            <span class="ch-pill" style="background:${chanColor(plat)}18;color:${chanColor(plat)}">
              <span class="cd" style="background:${chanColor(plat)}"></span>${platformName(plat)}
            </span>
            ${sentPill(cl.sentiment)}
          </div>
        </div>
        ${rows.length ? `<div class="cp-block">${rows.map(([k, v]) =>
          `<div class="cp-row"><span class="cp-k">${k}</span><span class="cp-v">${esc(v)}</span></div>`
        ).join("")}</div>` : ""}
        <div class="cp-block" id="cp-media">
          <div class="cp-block-head"><h6>Media, links and docs</h6><span class="cp-count" id="cp-media-count"></span></div>
          <div class="cp-media-body"><div class="cp-loading">Loading…</div></div>
        </div>
        <div class="cp-block cp-actions">
          <a class="cp-act" href="/client?id=${cl.id}&from=conversations">${Icon("users", { size: 15 })} Open full profile</a>
          ${canClearAll && view !== "archived" ? `
            <button class="cp-act danger" id="cp-clear">${Icon("eraser", { size: 15 })} Clear chat</button>` : ""}
          ${writable && view !== "archived" ? `
            <button class="cp-act" id="cp-archive">${Icon("archive", { size: 15 })} Archive chat</button>` : ""}
        </div>
      </div>`;

    panel.querySelector(".cp-close").onclick = closeContactPanel;
    const cpClear = panel.querySelector("#cp-clear");
    if (cpClear) cpClear.onclick = () => { closeContactPanel(); clearChat(cl.id); };
    const cpArch = panel.querySelector("#cp-archive");
    if (cpArch) cpArch.onclick = () => { closeContactPanel(); archiveClient(cl.id); };

    // Force the browser to commit the off-screen closed state before showing, so
    // the slide-in transition fires reliably on the very first open (a freshly
    // inserted element otherwise snaps or lands mid-transition — the "middle" bug).
    panel.classList.remove("show");
    void panel.offsetWidth;
    panel.classList.add("show");
    scrim.classList.add("show");
    loadContactMedia(cl.id, panel);
  }

  async function loadContactMedia(id, panel) {
    const body = panel.querySelector(".cp-media-body");
    const countEl = panel.querySelector("#cp-media-count");
    let files = [], audios = [];
    try {
      [files, audios] = await Promise.all([
        Api.get(`/api/files?client_id=${id}`).catch(() => []),
        Api.get(`/api/audio?client_id=${id}`).catch(() => []),
      ]);
    } catch (_) { /* fall through to empty state */ }

    const visual = [], sound = [], docs = [];
    files.forEach((f) => {
      if (f.content_type === "url") { docs.push({ name: f.filename, href: f.storage_key, isLink: true }); return; }
      const url = _withToken(`/api/files/${f.id}/download`);
      if ((f.content_type || "").startsWith("image/") || _isImgName(f.filename)) visual.push({ name: f.filename, url, kind: "img" });
      else if ((f.content_type || "").startsWith("video/") || _isVidName(f.filename)) visual.push({ name: f.filename, url, kind: "vid" });
      else docs.push({ name: f.filename, href: url });
    });
    // Older uploads were routed into audio_recordings by MIME sniffing, so an
    // image or PDF can live there. Trust the extension before the table.
    audios.forEach((a) => {
      const url = _withToken(`/api/audio/${a.id}/download`);
      if (_isVidName(a.filename) || (a.content_type || "").startsWith("video/")) visual.push({ name: a.filename, url, kind: "vid" });
      else if (_isImgName(a.filename) || (a.content_type || "").startsWith("image/")) visual.push({ name: a.filename, url, kind: "img" });
      else if ((a.content_type || "").startsWith("audio/") || _isAudioName(a.filename)) sound.push({ name: a.filename, url });
      else docs.push({ name: a.filename, href: url });
    });

    const total = visual.length + sound.length + docs.length;
    countEl.textContent = total ? `${total}` : "";
    if (!total) {
      body.innerHTML = `<div class="cp-empty">${Icon("folderOpen", { size: 22 })}<span>Nothing shared in this conversation yet.</span></div>`;
      return;
    }

    let html = "";
    if (visual.length) {
      html += `<div class="cp-grid">${visual.slice(0, 9).map((m) => m.kind === "img"
        ? `<button class="cp-cell" data-img="${esc(m.url)}" title="${esc(m.name)}"><img loading="lazy" src="${esc(m.url)}" alt="" /></button>`
        : `<button class="cp-cell vid" data-vid="${esc(m.url)}" title="${esc(m.name)}"><video preload="metadata" src="${esc(m.url)}#t=0.1"></video><span class="cp-play">${Icon("send", { size: 14 })}</span></button>`
      ).join("")}</div>`;
      if (visual.length > 9) html += `<div class="cp-more">+${visual.length - 9} more</div>`;
    }
    if (sound.length) {
      html += `<div class="cp-sub">Audio</div>` + sound.slice(0, 5).map((m) =>
        `<div class="cp-file"><span class="cp-fic">${Icon("phone", { size: 13 })}</span><span class="cp-fn">${esc(m.name)}</span></div>`
      ).join("");
    }
    if (docs.length) {
      html += `<div class="cp-sub">Documents &amp; links</div>` + docs.slice(0, 6).map((d) =>
        `<a class="cp-file" href="${esc(d.href)}" target="_blank" rel="noopener">
          <span class="cp-fic">${Icon(d.isLink ? "link" : "file", { size: 13 })}</span>
          <span class="cp-fn">${esc(d.name)}</span>
        </a>`
      ).join("");
    }
    body.innerHTML = html;
    body.querySelectorAll("[data-img]").forEach((b) => b.onclick = () => openLightbox(b.dataset.img));
    body.querySelectorAll("[data-vid]").forEach((b) => b.onclick = () => openMedia(b.dataset.vid, "This video"));
  }

  // ─── Right panel: AI ───
  // Collapsed by default — the analysis is opt-in, opened via the "AI" tab.
  let aiPanelOpen = false;
  let aiRenderedFor = null;   // client id the AI panel currently reflects
  let aiConvId = null;        // conversation the AI panel is reading
  // Report time filter: "latest" (newest overall) or daily/weekly/monthly + a
  // picker value, so users can browse historical AI Chat Analysis reports.
  let aiFilter = { mode: "latest", value: "" };

  // Turn the current filter into a [start, end) instant range (or null = latest).
  function aiFilterRange() {
    const f = aiFilter;
    if (f.mode === "latest" || !f.value) return null;
    if (f.mode === "daily") {
      const s = new Date(f.value + "T00:00:00");
      const e = new Date(s); e.setDate(s.getDate() + 1);
      return [s, e];
    }
    if (f.mode === "monthly") {
      const [y, mo] = f.value.split("-").map(Number);
      return [new Date(y, mo - 1, 1), new Date(y, mo, 1)];
    }
    if (f.mode === "weekly") {
      const [y, w] = f.value.split("-W").map(Number);   // e.g. "2026-W29"
      const jan4 = new Date(y, 0, 4);
      const wk1Mon = new Date(jan4); wk1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
      const s = new Date(wk1Mon); s.setDate(wk1Mon.getDate() + (w - 1) * 7);
      const e = new Date(s); e.setDate(s.getDate() + 7);
      return [s, e];
    }
    return null;
  }

  // Default picker value for a mode (today / this week / this month).
  function aiDefaultValue(mode) {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    if (mode === "daily") return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    if (mode === "monthly") return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    if (mode === "weekly") {
      // ISO week number for today.
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
      const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      const wk = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
      return `${t.getUTCFullYear()}-W${p2(wk)}`;
    }
    return "";
  }

  function setAiPanelOpen(open) {
    aiPanelOpen = open;
    const panel = document.getElementById("conv-right");
    const toggleBtn = document.getElementById("ai-toggle-btn");
    if (open) {
      panel.classList.remove("collapsed");
      panel.style.width = "";
      toggleBtn.classList.remove("show");
      // Lazily fetch the analysis the first time it's opened for this client.
      if (active && aiRenderedFor !== active) renderAI();
    } else {
      panel.classList.add("collapsed");
      toggleBtn.classList.add("show");
    }
  }

  document.getElementById("ai-close-btn").addEventListener("click", () => setAiPanelOpen(false));
  document.getElementById("ai-toggle-btn").addEventListener("click", () => setAiPanelOpen(true));
  setAiPanelOpen(false);   // start collapsed with the "AI" tab showing

  async function renderAI() {
    const cl = clients.find((x) => x.id === active);
    aiRenderedFor = active;   // this panel now reflects the active client
    const scroll = document.getElementById("ai-scroll");
    scroll.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:12.5px">Loading...</div>`;

    let convs = [];
    try { convs = await Api.get(`/api/conversations?client_id=${cl.id}&is_deleted=${view === "archived"}`); } catch (_) {}
    if (!convs.length) {
      aiConvId = null;
      scroll.innerHTML = `<div class="ai2-empty">
        <div class="ai-icon-wrap">${Icon("sparkles", { size: 24 })}</div>
        <h4>No analysis yet</h4>
        <p>Send a message below, or upload a chat log via &ldquo;+ New conversation&rdquo;, to generate a summary, key points and sentiment.</p>
      </div>`;
      return;
    }
    aiConvId = convs[0].id;
    aiFilter = { mode: "latest", value: "" };   // reset filter when switching client

    // Filter bar (period + date/week/month picker) stays fixed; the report body
    // below reloads whenever the filter changes.
    const modes = [["latest", "Latest"], ["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]];
    scroll.innerHTML = `
      <div class="ai-filter">
        <div class="ai-fseg" id="ai-fseg">
          ${modes.map(([m, l]) => `<button type="button" data-mode="${m}" class="${m === "latest" ? "on" : ""}">${l}</button>`).join("")}
        </div>
        <input type="date" id="ai-fdate" class="form-control form-control-sm" hidden />
      </div>
      <div id="ai-report"><div style="padding:20px 0;text-align:center;color:var(--muted);font-size:12.5px">Loading...</div></div>`;

    const seg = document.getElementById("ai-fseg");
    const dateInput = document.getElementById("ai-fdate");
    seg.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => {
      aiFilter.mode = b.dataset.mode;
      seg.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      if (aiFilter.mode === "latest") {
        dateInput.hidden = true;
      } else {
        dateInput.type = aiFilter.mode === "daily" ? "date" : aiFilter.mode === "weekly" ? "week" : "month";
        aiFilter.value = aiDefaultValue(aiFilter.mode);
        dateInput.value = aiFilter.value;
        dateInput.hidden = false;
      }
      loadAiReport();
    });
    dateInput.onchange = () => { aiFilter.value = dateInput.value; loadAiReport(); };

    await loadAiReport();
  }

  // Fetch + render the report body for the current conversation and filter.
  async function loadAiReport() {
    const report = document.getElementById("ai-report");
    if (!report || !aiConvId) return;
    const modelSub = document.getElementById("ai-model-sub");
    report.innerHTML = `<div style="padding:20px 0;text-align:center;color:var(--muted);font-size:12.5px">Loading...</div>`;

    const range = aiFilterRange();
    let url = `/api/ai/conversations/${aiConvId}/analysis`;
    if (range) url += `?start=${encodeURIComponent(range[0].toISOString())}&end=${encodeURIComponent(range[1].toISOString())}`;

    let a = null;
    try { a = await Api.get(url, { stale: false }); } catch (_) {}

    if (!a) {
      // No report for this window — distinguish "never analysed" from "none in range".
      const periodLabel = aiFilter.mode === "latest" ? "" :
        aiFilter.mode === "daily" ? " for this day" :
        aiFilter.mode === "weekly" ? " for this week" : " for this month";
      report.innerHTML = `<div class="ai2-empty">
        <div class="ai-icon-wrap">${Icon("sparkles", { size: 24 })}</div>
        <h4>${aiFilter.mode === "latest" ? "Not analyzed yet" : "No report" + periodLabel}</h4>
        <p>${aiFilter.mode === "latest"
          ? "Run AI analysis on this client's latest conversation."
          : "There's no AI Chat Analysis in the selected period. Pick another, or view the latest."}</p>
        ${(aiFilter.mode === "latest" && writable) ? `<button class="btn btn-primary btn-sm" id="run-ai" style="margin:0 auto">Run AI analysis</button>` : ""}
      </div>`;
      const r = document.getElementById("run-ai"); if (r) r.onclick = () => runAI(aiConvId);
      return;
    }

    const m = a.response_metrics || {};
    if (a.model) modelSub.textContent = `${a.model} · summary & sentiment`;
    const when = a.created_at ? new Date(a.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
    report.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        ${sentPill(_ns(a.sentiment))}
        ${writable ? `<button class="btn btn-soft btn-sm" id="run-ai">Re-run analysis</button>` : ""}
      </div>
      ${when ? `<div class="ai-report-when">Report generated ${esc(when)}</div>` : ""}
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
    const r = document.getElementById("run-ai"); if (r) r.onclick = () => runAI(aiConvId);
  }

  async function runAI(convId) {
    const scroll = document.getElementById("ai-scroll");
    scroll.innerHTML = `<div class="ai2-empty"><div class="ai-icon-wrap" style="animation:spin 1.2s linear infinite">${Icon("sparkles", { size: 24 })}</div><p>Analyzing...</p></div>`;
    try { await Api.post(`/api/ai/conversations/${convId}/analyze`); await renderAI(); toast("Analysis complete", "success"); }
    catch (e) { toast(e.message); renderAI(); }
  }

  function selectClient(id) {
    active = id;
    closeContactPanel();  // the panel belongs to the previous thread
    pendingAttachments = [];
    replyingTo = null;  // reply context is per-thread
    if (selectMode) exitSelectMode();
    document.querySelectorAll("#cl-scroll .ci2").forEach((el) =>
      el.classList.toggle("on", parseInt(el.dataset.id) === id));
    // Show thread area
    document.getElementById("empty-center").style.display = "none";
    document.getElementById("thread-wrap").style.display = "flex";
    renderThread();
    // Only fetch the AI analysis when the panel is actually open; otherwise defer
    // it until the user expands the "AI" tab (aiRenderedFor stays out of sync so
    // setAiPanelOpen(true) triggers the fetch).
    if (aiPanelOpen) renderAI(); else aiRenderedFor = null;
    // Only active (non-archived) threads get live presence + read receipts.
    if (view !== "archived") {
      markRead(id);
      startPresence(id);
      // Clear this chat's unread badge immediately rather than waiting for the poll.
      const c = clients.find((x) => x.id === id);
      if (c && c.unread_count) { c.unread_count = 0; renderList(); }
    }
  }

  async function archiveClient(id) {
    const cl = clients.find((c) => c.id === id);
    const ok = await confirmDialog(
      `This moves ${cl ? cl.name : "this client"}'s chat to the Archive (hidden from the active list, not permanently erased).`,
      { title: "Archive this chat?", confirmText: "Archive" }
    );
    if (!ok) return;
    try {
      await Api.post(`/api/clients/${id}/archive`);
      Api.invalidateCache("/api/overview/clients");
      clients = clients.filter((c) => c.id !== id);
      if (active === id) closeThread();
      renderList();
      toast("Chat archived", "success");
    } catch (e) { toast(e.message); }
  }

  async function restoreClient(id) {
    const cl = clients.find((c) => c.id === id);
    try {
      await Api.post(`/api/clients/${id}/restore`);
      Api.invalidateCache("/api/overview/clients");
      clients = clients.filter((c) => c.id !== id);  // leaves the archive list
      renderList();
      toast(`${cl ? cl.name + "'s chat" : "Chat"} restored`, "success");
    } catch (e) { toast(e.message); }
  }

  async function permanentlyDeleteClient(id) {
    const cl = clients.find((c) => c.id === id);
    const ok = await confirmDialog(
      `This permanently erases ${cl ? cl.name : "this client"} — chat, attachments and analysis. This can't be undone.`,
      { title: "Delete permanently?", confirmText: "Delete forever" }
    );
    if (!ok) return;
    try {
      await Api.del(`/api/clients/${id}`);
      Api.invalidateCache("/api/overview/clients");
      clients = clients.filter((c) => c.id !== id);
      if (active === id) closeThread();
      renderList();
      toast("Client permanently deleted", "success");
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

  // Infinite scroll-back: near the top of the thread, pull the next older page.
  document.getElementById("th2-body").addEventListener("scroll", (e) => {
    if (e.target.scrollTop < 80) loadOlderMessages();
  });

  // In select mode, clicking a message toggles its selection (capture phase so it
  // preempts the image-lightbox / other click handlers).
  document.getElementById("th2-body").addEventListener("click", (e) => {
    if (!selectMode) return;
    const row = e.target.closest(".msg2");
    if (!row) return;
    const id = parseInt(row.dataset.mid);
    if (isNaN(id)) return;
    e.stopPropagation(); e.preventDefault();
    if (selected.has(id)) { selected.delete(id); row.classList.remove("selected"); }
    else { selected.add(id); row.classList.add("selected"); }
    updateSelectionUI();
  }, true);

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
    renderArchiveToggle(); renderFilter(); renderList();
    const first = (preselect && clients.find((c) => c.id === preselect)) ? preselect : (clients[0] && clients[0].id);
    if (first) selectClient(first);
    // Open the live-push socket (falls back to polling if it can't connect).
    connectWS();
    // WhatsApp-style live list: poll for new messages / reordering / unread badges.
    // When WS is connected this is just a slow safety net (~20s); without it, 5s.
    let listTick = 0;
    listTimer = setInterval(() => { if (!wsConnected || (++listTick % 4 === 0)) refreshList(); }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshList(); });
  } catch (e) { toast(e.message); }
})();
