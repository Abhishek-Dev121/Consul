(async function () {
  const actions = "";
  await renderLayout("/team-chat", "Team Chat", { crumb: "Internal team communication & rooms", actions });
  const currentUser = getCachedUser();
  const writable = canWrite();

  let socket = null;
  let chats = [];
  let roster = [];
  let activeChatId = null;
  let messages = [];
  let limit = 20;
  let offset = 0;
  let hasMoreMessages = true;
  let isFetchingMessages = false;
  let typingTimer = null;
  let typingStatusTimers = {};

  // DOM Elements
  const chatListEl = document.getElementById("chat-list");
  const searchChatsInput = document.getElementById("search-chats");
  const activeChatContainer = document.getElementById("active-chat-container");
  const emptyStateEl = document.getElementById("empty-state");
  const chatHeaderInfoEl = document.getElementById("chat-header-info");
  const messageListEl = document.getElementById("message-list");
  const typingIndicatorEl = document.getElementById("typing-indicator");
  const chatInputEl = document.getElementById("chat-input");
  const btnSendEl = document.getElementById("btn-send");
  const btnAttachEl = document.getElementById("btn-attach");
  const fileInputEl = document.getElementById("attach-file");
  const aiInsightContentEl = document.getElementById("ai-insight-content");
  const rosterSearchInput = document.getElementById("roster-search");
  const rosterListEl = document.getElementById("roster-list");
  const aiModalEl = document.getElementById("aiModal");
  const aiModalBodyEl = document.getElementById("ai-modal-body");

  const bsRosterModal = bootstrap.Modal.getOrCreateInstance(document.getElementById("rosterModal"));
  const bsAiModal = bootstrap.Modal.getOrCreateInstance(aiModalEl);

  // ---- WebSocket Setup ----
  function connectWebSocket() {
    const token = Api.token();
    if (!token) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const host = (location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port !== "8000" && location.port !== "80"
      ? "127.0.0.1:8000"
      : location.host;
    
    socket = new WebSocket(`${protocol}//${host}/ws/chat?token=${token}`);

    socket.onopen = () => {
      console.log("WebSocket connected.");
      if (activeChatId) {
        socket.send(JSON.stringify({ event: "join_chat", chat_id: activeChatId }));
        socket.send(JSON.stringify({ event: "mark_seen", chat_id: activeChatId }));
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleSocketEvent(data);
    };

    socket.onclose = () => {
      console.warn("WebSocket disconnected. Retrying in 3s...");
      setTimeout(connectWebSocket, 3000);
    };
  }

  function handleSocketEvent(data) {
    const { event, chat_id, payload } = data;

    if (chat_id !== activeChatId) {
      // Background message update
      if (event === "receive_message") {
        updateChatPreview(chat_id, payload, true);
      }
      return;
    }

    switch (event) {
      case "receive_message":
        appendMessage(payload);
        updateChatPreview(chat_id, payload, false);
        socket.send(JSON.stringify({ event: "mark_seen", chat_id: activeChatId }));
        break;
      
      case "read_update":
        updateReadReceipts(payload.user_id, payload.last_seen_message_id);
        break;

      case "typing_start":
        showTypingIndicator(payload.user_id, payload.user_name);
        break;

      case "typing_stop":
        hideTypingIndicator(payload.user_id);
        break;
    }
  }

  // ---- Roster & New Chat ----
  async function loadRoster() {
    try {
      const resp = await Api.get("/api/users?limit=100");
      roster = resp.items || resp;
      renderRoster(roster);
    } catch (e) {
      toast("Failed to load roster: " + e.message);
    }
  }

  function renderRoster(list) {
    // Filter out current user
    const filtered = list.filter(u => u.id !== currentUser.id && u.is_active);
    if (!filtered.length) {
      rosterListEl.innerHTML = '<div class="text-center text-muted py-3 small">No other active users found.</div>';
      return;
    }

    rosterListEl.innerHTML = filtered.map(u => `
      <div class="card p-2 d-flex flex-row align-items-center gap-3 start-chat-row" style="cursor:pointer; border-radius:8px;" data-id="${u.id}">
        <span class="av" style="width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:${avHash(u.name)}; color:#fff; font-weight:700;">
          ${initials(u.name)}
        </span>
        <div style="min-width:0; flex:1">
          <strong style="font-size:13.5px; display:block; color:var(--ink);">${esc(u.name)}</strong>
          <span class="text-muted small">${esc(u.email)} · ${esc(u.role.replace("_", " "))}</span>
        </div>
      </div>
    `).join("");

    rosterListEl.querySelectorAll(".start-chat-row").forEach(el => {
      el.onclick = () => startChat(parseInt(el.dataset.id));
    });
  }

  async function startChat(participantId) {
    bsRosterModal.hide();
    try {
      const chat = await Api.post("/api/chats", { participant_id: participantId, is_group: false });
      await loadChats();
      selectChat(chat.id);
    } catch (e) {
      toast("Failed to start chat: " + e.message);
    }
  }

  // ---- Chat List Panel ----
  async function loadChats() {
    try {
      chats = await Api.get("/api/chats");
      renderChatList(chats);
    } catch (e) {
      toast("Failed to load chats: " + e.message);
    }
  }

  function renderChatList(list) {
    if (!list.length) {
      chatListEl.innerHTML = '<div class="text-center text-muted py-4 small">No active chats. Start one using "+ New Chat".</div>';
      return;
    }

    chatListEl.innerHTML = list.map(c => {
      const displayTitle = getChatTitle(c);
      const initialsText = getChatInitials(c);
      const isSelected = c.id === activeChatId;
      const unreadBadge = c.unread_count > 0 ? `<span class="badge bg-danger rounded-pill float-end" style="font-size:10px; margin-top:4px;">${c.unread_count}</span>` : "";
      
      let lastMsgText = "No messages yet.";
      if (c.last_message) {
        lastMsgText = c.last_message.type === "text"
          ? `${c.last_message.sender_name}: ${c.last_message.content}`
          : `${c.last_message.sender_name} sent a media file`;
      }

      return `
        <div class="card p-2 mb-2 d-flex flex-row align-items-center gap-2 chat-thread-item ${isSelected ? "border-primary bg-primary-subtle" : ""}" 
             style="cursor:pointer; border-radius:8px;" data-id="${c.id}">
          <span class="av" style="width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:${avHash(displayTitle)}; color:#fff; font-weight:700; flex-shrink:0;">
            ${initialsText}
          </span>
          <div style="min-width:0; flex:1">
            <div class="d-flex justify-content-between align-items-center">
              <strong class="text-truncate" style="font-size:13.5px; color:var(--ink);">${esc(displayTitle)}</strong>
              ${unreadBadge}
            </div>
            <div class="text-truncate text-muted small" style="margin-top:2px;">${esc(lastMsgText)}</div>
          </div>
        </div>
      `;
    }).join("");

    chatListEl.querySelectorAll(".chat-thread-item").forEach(el => {
      el.onclick = () => selectChat(parseInt(el.dataset.id));
    });
  }

  function getChatTitle(c) {
    if (c.is_group) return "Group Chat " + c.id;
    const other = c.participants.find(p => p.id !== currentUser.id);
    return other ? other.name : "Saved Messages";
  }

  function getChatInitials(c) {
    if (c.is_group) return "GP";
    const other = c.participants.find(p => p.id !== currentUser.id);
    return other ? initials(other.name) : initials(currentUser.name);
  }

  function updateChatPreview(chatId, lastMsg, incrementUnread) {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      chat.last_message = lastMsg;
      if (incrementUnread) chat.unread_count++;
      renderChatList(chats);
    }
  }

  // ---- Message Area & Active Chat ----
  async function selectChat(id) {
    activeChatId = id;
    offset = 0;
    messages = [];
    hasMoreMessages = true;
    
    emptyStateEl.style.display = "none";
    activeChatContainer.style.display = "flex";

    // Update active state in left sidebar
    document.querySelectorAll(".chat-thread-item").forEach(el => {
      el.classList.toggle("border-primary", parseInt(el.dataset.id) === id);
      el.classList.toggle("bg-primary-subtle", parseInt(el.dataset.id) === id);
    });

    const chat = chats.find(c => c.id === id);
    if (chat) {
      chat.unread_count = 0;
      renderChatList(chats);
    }

    renderHeader();
    await loadMessages();
    renderAIInsightSec();

    // WebSocket Room Join
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: "join_chat", chat_id: activeChatId }));
      socket.send(JSON.stringify({ event: "mark_seen", chat_id: activeChatId }));
    }
  }

  function renderHeader() {
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;

    const displayTitle = getChatTitle(chat);
    chatHeaderInfoEl.innerHTML = `
      <span class="av" style="width:38px; height:38px; border-radius:50%; display:grid; place-items:center; background:${avHash(displayTitle)}; color:#fff; font-weight:700;">
        ${getChatInitials(chat)}
      </span>
      <div>
        <h6 class="mb-0" style="font-family: var(--display); font-weight: 700; color: var(--ink);">${esc(displayTitle)}</h6>
        <div class="small text-muted" style="font-size: 11px;">
          ${chat.is_group ? `${chat.participants.length} members` : chat.participants.find(p => p.id !== currentUser.id)?.email || "Personal Space"}
        </div>
      </div>
    `;
  }

  async function loadMessages() {
    if (isFetchingMessages || !hasMoreMessages) return;
    isFetchingMessages = true;

    // Show inline loading indicator
    const currentScrollHeight = messageListEl.scrollHeight;

    try {
      const resp = await Api.get(`/api/chats/${activeChatId}/messages?limit=${limit}&offset=${offset}`);
      if (resp.length < limit) {
        hasMoreMessages = false;
      }
      
      messages = [...resp, ...messages];
      offset += resp.length;
      renderMessageList();

      // Adjust scroll position after loading older messages
      if (offset > resp.length) {
        messageListEl.scrollTop = messageListEl.scrollHeight - currentScrollHeight;
      } else {
        messageListEl.scrollTop = messageListEl.scrollHeight;
      }
    } catch (e) {
      toast("Failed to load messages: " + e.message);
    } finally {
      isFetchingMessages = false;
    }
  }

  function renderMessageList() {
    if (!messages.length) {
      messageListEl.innerHTML = `
        <div class="text-center text-muted py-5 small" style="margin: auto 0;">
          No messages yet. Send a message below to start the conversation!
        </div>
      `;
      return;
    }

    messageListEl.innerHTML = messages.map(m => {
      const isMe = m.sender_id === currentUser.id;
      const bubbleSide = isMe ? "justify-content-end" : "justify-content-start";
      const bubbleBg = isMe ? "bg-primary text-white" : "bg-light text-dark";
      const senderName = isMe ? "" : `<div class="msg-sender text-muted small mb-1" style="font-weight:600; font-size:11px;">${esc(m.sender_name)}</div>`;
      
      let innerContent = esc(m.content);
      if (m.type === "image") {
        innerContent = `<img src="${esc(m.file_url)}" style="max-width: 240px; max-height: 180px; border-radius: 8px; display: block; cursor: pointer;" onclick="window.open('${esc(m.file_url)}', '_blank')" />`;
      } else if (m.type === "video") {
        innerContent = `<video src="${esc(m.file_url)}" controls style="max-width: 240px; max-height: 180px; border-radius: 8px; display: block;"></video>`;
      } else if (m.type === "audio") {
        innerContent = `<audio src="${esc(m.file_url)}" controls style="max-width: 240px; height: 36px; display: block;"></audio>`;
      } else if (m.type === "file") {
        innerContent = `
          <a class="d-flex align-items-center gap-2 text-decoration-none p-2 rounded ${isMe ? "text-white" : "text-primary"}" href="${esc(m.file_url)}" target="_blank" style="background: rgba(0,0,0,0.05);">
            ${Icon("file", { size: 16 })}
            <span class="text-truncate small" style="max-width: 140px;">${esc(m.content)}</span>
          </a>
        `;
      }

      return `
        <div class="d-flex ${bubbleSide} mb-2 msg-row" data-id="${m.id}">
          <div style="max-width: 70%;">
            ${senderName}
            <div class="p-2 rounded ${bubbleBg}" style="font-size: 13.5px; position: relative;">
              ${innerContent}
            </div>
            <div class="text-muted small mt-1" style="font-size: 10px; text-align: ${isMe ? "right" : "left"};">
              ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <span class="viewers-count text-primary cursor-pointer ms-1" style="display:none;" onclick="showViewers(${m.id})"></span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function appendMessage(m) {
    messages.push(m);
    renderMessageList();
    messageListEl.scrollTop = messageListEl.scrollHeight;
  }

  // Scroll event for Infinite Scroll
  messageListEl.addEventListener("scroll", () => {
    if (messageListEl.scrollTop === 0 && !isFetchingMessages && hasMoreMessages) {
      loadMessages();
    }
  });

  // ---- Read Receipts ----
  function updateReadReceipts(userId, lastSeenMsgId) {
    // When read receipts arrive, we can flag message elements or display seen indicators.
    // In our simplified bubble view, we can check who read what if requested.
  }

  window.showViewers = async (messageId) => {
    try {
      const viewers = await Api.get(`/api/chats/messages/${messageId}/viewers`);
      const names = viewers.map(v => v.name).join(", ");
      toast(`Viewed by: ${names || "No one yet"}`, "info");
    } catch (e) {
      toast("Error getting viewers: " + e.message);
    }
  };

  // ---- Typing Indicators ----
  function showTypingIndicator(userId, userName) {
    if (typingStatusTimers[userId]) {
      clearTimeout(typingStatusTimers[userId]);
    }
    typingIndicatorEl.textContent = `${userName} is typing...`;
    typingIndicatorEl.style.display = "block";

    typingStatusTimers[userId] = setTimeout(() => {
      hideTypingIndicator(userId);
    }, 4000);
  }

  function hideTypingIndicator(userId) {
    delete typingStatusTimers[userId];
    if (Object.keys(typingStatusTimers).length === 0) {
      typingIndicatorEl.style.display = "none";
    }
  }

  // Key event listeners on typing
  chatInputEl.addEventListener("input", () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (!typingTimer) {
      socket.send(JSON.stringify({ event: "typing_start", chat_id: activeChatId }));
    } else {
      clearTimeout(typingTimer);
    }

    typingTimer = setTimeout(() => {
      socket.send(JSON.stringify({ event: "typing_stop", chat_id: activeChatId }));
      typingTimer = null;
    }, 2000);
  });

  // ---- Sending Message & Uploads ----
  async function sendTextMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
      event: "send_message",
      chat_id: activeChatId,
      content: text,
      type: "text"
    }));

    chatInputEl.value = "";
    chatInputEl.style.height = "auto";
  }

  btnSendEl.onclick = sendTextMessage;
  chatInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  btnAttachEl.onclick = () => fileInputEl.click();
  fileInputEl.onchange = async () => {
    const file = fileInputEl.files[0];
    if (!file) return;

    // Show loading toast
    toast("Uploading file...", "info");

    try {
      // 1. Get pre-signed URL signature
      const signature = await Api.post(`/api/chats/upload/request?filename=${encodeURIComponent(file.name)}&file_type=${encodeURIComponent(file.type)}&file_size=${file.size}`);
      
      let uploadUrl = signature.url;
      let fileUrl = signature.public_url;

      // 2. Perform direct upload
      const fd = new FormData();
      if (signature.fields) {
        // Pre-signed S3 post fields or Mock local fields
        for (const [k, v] of Object.entries(signature.fields)) {
          fd.append(k, v);
        }
      }
      fd.append("file", file);

      // Perform direct POST to the pre-signed URL
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: fd
      });

      if (!response.ok) {
        throw new Error("Direct upload failed.");
      }

      // Determine message media type
      let type = "file";
      if (file.type.startsWith("image/")) type = "image";
      else if (file.type.startsWith("video/")) type = "video";
      else if (file.type.startsWith("audio/")) type = "audio";

      // 3. Emit message via websocket
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          event: "send_message",
          chat_id: activeChatId,
          content: file.name,
          type: type,
          file_url: fileUrl
        }));
      }

      toast("File uploaded successfully!", "success");
    } catch (e) {
      toast("Upload failed: " + e.message);
    } finally {
      fileInputEl.value = "";
    }
  };

  // ---- AI Insight Panel ----
  function renderAIInsightSec() {
    aiInsightContentEl.innerHTML = `
      <div class="d-grid mb-4">
        <button class="btn btn-primary" id="btn-run-ai">${Icon("sparkles", { size: 14 })} Run AI Analysis</button>
      </div>
      <div id="ai-insight-results" style="display:none;">
        <div class="mb-3">
          <label class="text-muted small fw-bold">Overall Sentiment</label>
          <div id="ai-sentiment-pill" class="mt-1"></div>
        </div>
        <div class="mb-3">
          <label class="text-muted small fw-bold">Summary</label>
          <p id="ai-summary-text" class="small mb-0 mt-1" style="line-height:1.5; color:var(--ink);"></p>
        </div>
        <div class="mb-3">
          <label class="text-muted small fw-bold">Key Topics</label>
          <ul id="ai-topics-list" class="small mt-1 ps-3" style="color:var(--ink);"></ul>
        </div>
      </div>
    `;

    document.getElementById("btn-run-ai").onclick = runAIAnalysis;
  }

  async function runAIAnalysis() {
    const btn = document.getElementById("btn-run-ai");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Analyzing...';

    try {
      const report = await Api.post(`/api/chats/${activeChatId}/analyze`);
      
      const resultsDiv = document.getElementById("ai-insight-results");
      const sentimentPill = document.getElementById("ai-sentiment-pill");
      const summaryText = document.getElementById("ai-summary-text");
      const topicsList = document.getElementById("ai-topics-list");

      resultsDiv.style.display = "block";
      
      // Sentiment style
      const s = report.overallSentiment || "neutral";
      let badgeCls = "bg-secondary-subtle text-secondary-emphasis";
      if (s === "positive") badgeCls = "bg-success-subtle text-success-emphasis";
      if (s === "negative") badgeCls = "bg-danger-subtle text-danger-emphasis";
      
      sentimentPill.innerHTML = `<span class="badge ${badgeCls}" style="text-transform:uppercase; font-size:10px;">${esc(s)}</span>`;
      summaryText.textContent = report.summary || "No summary available.";
      
      topicsList.innerHTML = (report.keyTopics || []).map(t => `<li>${esc(t)}</li>`).join("") || "<li>None</li>";

      // Also render in modal for a larger reading view
      aiModalBodyEl.innerHTML = `
        <div class="mb-3">
          <strong style="font-size:13.5px; display:block;" class="mb-1">Sentiment Sentiment</strong>
          <span class="badge ${badgeCls}" style="text-transform:uppercase;">${esc(s)}</span>
        </div>
        <div class="mb-3">
          <strong style="font-size:13.5px; display:block;" class="mb-1">Executive Summary</strong>
          <p class="text-muted" style="margin-bottom:0; line-height:1.5;">${esc(report.summary)}</p>
        </div>
        <div>
          <strong style="font-size:13.5px; display:block;" class="mb-1">Key Topics & Discussions</strong>
          <ul class="text-muted ps-3 mb-0">${(report.keyTopics || []).map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        </div>
      `;
      bsAiModal.show();

      toast("AI analysis complete!", "success");
    } catch (e) {
      toast("AI analysis failed: " + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  // ---- Searching Roster & Chats ----
  searchChatsInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderChatList(chats.filter(c => getChatTitle(c).toLowerCase().includes(q)));
  });

  rosterSearchInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderRoster(roster.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  });

  // ---- Init ----
  async function init() {
    await Promise.all([loadChats(), loadRoster()]);
    connectWebSocket();
  }
  await init();
})();
