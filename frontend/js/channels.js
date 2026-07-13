(async function () {
  const actions = `<div class="d-flex gap-2">
    <button class="btn btn-soft" id="new-channel" data-bs-toggle="modal" data-bs-target="#channelModal">${Icon("plus", { size: 14 })} Channel</button>
    <button class="btn btn-primary" id="new-client" data-bs-toggle="modal" data-bs-target="#clientModal">${Icon("plus", { size: 14 })} Client</button>
  </div>`;
  await renderLayout("/channels", "Channel Management", { crumb: "Workspace", hideSearch: true, actions });
  const admin = isAdmin();
  if (!admin) { const b = document.getElementById("new-channel"); if (b) b.remove(); }
  if (!canWrite()) { const b = document.getElementById("new-client"); if (b) b.remove(); }

  const BUILTINS = ["whatsapp", "upwork", "slack", "email", "telegram", "linkedin"];
  let channels = [], allClients = [], users = [];
  let typeFilter = "all", userFilter = "", searchTerm = "";
  let newPlatformLogo = "";   // data-URL of the logo picked for a "Create New" platform

  // Distinct platform keys actually present, plus the built-ins and any custom
  // types — so filters and the dropdown stay in sync as platforms are added.
  function knownPlatforms() {
    const seen = new Set(BUILTINS);
    Object.keys(CUSTOM_PLATFORMS).forEach((k) => seen.add(k));
    channels.forEach((c) => seen.add(c.platform));   // includes legacy "other"
    return [...seen];
  }

  function contactsFor(id) { return allClients.filter((c) => c.channels.some((ch) => ch.id === id)); }

  async function loadData() {
    // `/api/users` is paginated and returns { items, total, limit, offset } — not
    // an array. Reading it as one threw before the filters ever rendered, which
    // left this page stuck on its loading skeletons.
    const [ch, cl, us] = await Promise.all([
      Api.get("/api/channels"),
      Api.get("/api/clients"),
      Api.get("/api/users?limit=200").catch(() => ({ items: [] })),
    ]);
    channels = ch || [];
    allClients = cl || [];
    users = Array.isArray(us) ? us : (us.items || []);
  }

  // ---- Filters ----
  function renderFilters() {
    const types = ["all", ...knownPlatforms()];
    const tf = document.getElementById("type-filter");
    tf.innerHTML = types.map((t) =>
      `<button type="button" class="pill ${t === typeFilter ? "active" : ""}" data-t="${t}">${t === "all" ? "All" : platformName(t)}</button>`).join("");
    tf.querySelectorAll(".pill").forEach((el) =>
      el.addEventListener("click", () => { typeFilter = el.dataset.t; renderFilters(); renderGrid(); }));

    const uf = document.getElementById("user-filter");
    if (uf.options.length === 0) {
      uf.innerHTML = '<option value="">All users</option>' +
        users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
      uf.addEventListener("change", () => { userFilter = uf.value; renderGrid(); });
    }
  }

  function visibleChannels() {
    let list = channels.slice();
    if (typeFilter !== "all") list = list.filter((c) => c.platform === typeFilter);
    if (searchTerm) list = list.filter((c) => c.name.toLowerCase().includes(searchTerm));
    if (userFilter) {
      const uid = parseInt(userFilter, 10);
      list = list.filter((c) => contactsFor(c.id).some((cl) => (cl.assignees || []).some((a) => a.id === uid)));
    }
    return list;
  }

  // ---- Grid ----
  function renderGrid() {
    const list = visibleChannels();
    const grid = document.getElementById("grid");

    const countEl = document.getElementById("chan-count");
    if (countEl) countEl.textContent = `${list.length} of ${channels.length} channel${channels.length === 1 ? "" : "s"}`;

    if (!channels.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="em-ico">${Icon("rss", { size: 26 })}</span>
        No channels yet.${admin ? " Create one with the “+ Channel” button above." : ""}</div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="em-ico">${Icon("search", { size: 26 })}</span>
        No channels match these filters.</div>`;
      return;
    }

    grid.innerHTML = list.map((c) => {
      const m = platformMeta(c.platform);
      const clients = contactsFor(c.id);
      const shown = clients.slice(0, 4);
      const rest = clients.length - shown.length;
      const tint = chanColor(c.platform);
      // A button cannot legally nest inside an <a>. The card is a plain element
      // and the title link stretches over it, so the whole card is clickable
      // while the delete button stays a real sibling button.
      return `<div class="chan-card">
        <div class="chan-top" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="chan-ico" style="background:${tint}">${m.icon}</div>
          <span class="chip pf pf-${esc(c.platform)}">${esc(platformName(c.platform))}</span>
        </div>
        <a class="chan-name stretch" href="/channel?id=${c.id}" title="${esc(c.name)}">${esc(c.name)}</a>
        <div class="chan-meta">${clients.length} client${clients.length === 1 ? "" : "s"}</div>
        <div class="chan-foot">
          ${clients.length
            ? `<span class="chan-avs">${shown.map((cl) => avBox(cl.name)).join("")}${rest > 0 ? `<span class="more">+${rest}</span>` : ""}</span>`
            : `<span class="chan-none">No clients linked</span>`}
          <span style="display:flex;align-items:center;gap:8px">
            <span class="chan-open">Open ${Icon("chevronDown", { size: 13, style: "transform:rotate(-90deg)" })}</span>
            ${admin ? `<button type="button" class="chan-del" data-del="${c.id}" title="Delete channel" aria-label="Delete channel ${esc(c.name)}">${Icon("trash", { size: 14 })}</button>` : ""}
          </span>
        </div>
      </div>`;
    }).join("");

    grid.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => delChannel(parseInt(btn.dataset.del, 10))));
  }

  document.getElementById("search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  async function delChannel(id) {
    const ch = channels.find((c) => c.id === id);
    const linked = contactsFor(id).length;
    const ok = await confirmDialog(
      `Clients stay, but they'll lose this channel link.`,
      {
        title: `Delete ${ch ? `“${ch.name}”` : "this channel"}?`,
        confirmText: "Delete channel",
        consequences: linked
          ? [`${linked} client${linked === 1 ? "" : "s"} will be unlinked from this channel.`,
             "The clients themselves and their conversations are not deleted."]
          : ["No clients are linked to this channel."],
      }
    );
    if (!ok) return;
    try {
      await Api.del(`/api/channels/${id}`);
      await loadData();
      refreshClientChannelOptions();
      renderGrid();
      toast("Channel deleted", "success");
    } catch (e) { toast(e.message); }
  }

  // ---- Create channel ----
  const CREATE_NEW = "__new__";

  // Build the platform dropdown: built-ins, then any custom types, then a
  // "Create New…" option (replacing the old "Other").
  function populatePlatformSelect() {
    const sel = document.getElementById("ch-platform");
    const customKeys = Object.keys(CUSTOM_PLATFORMS);
    let html = BUILTINS.map((p) => `<option value="${p}">${esc(platformName(p))}</option>`).join("");
    if (customKeys.length) {
      html += `<optgroup label="Custom">` +
        customKeys.map((k) => `<option value="${k}">${esc(CUSTOM_PLATFORMS[k].name)}</option>`).join("") +
        `</optgroup>`;
    }
    html += `<option value="${CREATE_NEW}">+ Create New…</option>`;
    sel.innerHTML = html;
    toggleNewPlatformPanel();
  }

  function toggleNewPlatformPanel() {
    const isNew = document.getElementById("ch-platform").value === CREATE_NEW;
    document.getElementById("new-platform-panel").hidden = !isNew;
  }

  function resetNewPlatform() {
    newPlatformLogo = "";
    document.getElementById("np-name").value = "";
    document.getElementById("np-logo-input").value = "";
    const prev = document.getElementById("np-logo-preview");
    prev.style.backgroundImage = ""; prev.classList.add("empty");
  }

  document.getElementById("ch-platform").addEventListener("change", toggleNewPlatformPanel);

  // Logo picker → validate + read as a data URL for inline preview and upload.
  document.getElementById("np-logo-btn").addEventListener("click", () => document.getElementById("np-logo-input").click());
  document.getElementById("np-logo-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please choose an image file"); e.target.value = ""; return; }
    if (file.size > 250 * 1024) { toast("Logo is too large — please use an image under 250 KB"); e.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      newPlatformLogo = reader.result;
      const prev = document.getElementById("np-logo-preview");
      prev.style.backgroundImage = `url("${newPlatformLogo}")`; prev.classList.remove("empty");
    };
    reader.onerror = () => toast("Could not read that image");
    reader.readAsDataURL(file);
  });

  // Reset the "Create New" state whenever the modal closes.
  document.getElementById("channelModal").addEventListener("hidden.bs.modal", () => {
    document.getElementById("ch-name").value = "";
    const sel = document.getElementById("ch-platform");
    if (sel.value === CREATE_NEW) sel.value = BUILTINS[0];
    resetNewPlatform();
    toggleNewPlatformPanel();
  });

  document.getElementById("save-channel").addEventListener("click", async () => {
    const name = document.getElementById("ch-name").value.trim();
    if (!name) return toast("Channel name required");
    let platform = document.getElementById("ch-platform").value;

    try {
      // Creating a brand-new platform type first (name + required logo), then the
      // channel that uses it.
      if (platform === CREATE_NEW) {
        const pName = document.getElementById("np-name").value.trim();
        if (!pName) return toast("Platform name required");
        if (!newPlatformLogo) return toast("Please upload a logo for the new platform");
        const created = await Api.post("/api/channels/platform-types", { name: pName, logo: newPlatformLogo });
        CUSTOM_PLATFORMS[created.key] = { name: created.name, logo: created.logo };
        platform = created.key;
      }
      await Api.post("/api/channels", { name, platform, config: {} });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("channelModal")).hide();
      await loadData(); populatePlatformSelect(); refreshClientChannelOptions(); renderFilters(); renderGrid();
      toast("Channel created", "success");
    } catch (e) { toast(e.message); }
  });

  // ---- Create client (with channel assignment) ----
  function refreshClientChannelOptions() {
    document.getElementById("cl-channel").innerHTML =
      channels.map((c) => `<option value="${c.id}">${esc(c.name)} · ${platformName(c.platform)}</option>`).join("");
    document.getElementById("cl-assignees").innerHTML =
      users.map((u) => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join("");
  }

  document.getElementById("save-client").addEventListener("click", async () => {
    const name = document.getElementById("cl-name").value.trim();
    const channelId = document.getElementById("cl-channel").value;
    if (!name) return toast("Client name required");
    if (!channelId) return toast("Please create a channel first, then assign the client");
    try {
      const created = await Api.post("/api/clients", {
        name,
        company: document.getElementById("cl-company").value.trim() || null,
        email: document.getElementById("cl-email").value.trim() || null,
        phone: document.getElementById("cl-phone").value.trim() || null,
        channel_ids: [parseInt(channelId, 10)],
        assignee_ids: Array.from(document.getElementById("cl-assignees").selectedOptions).map((o) => parseInt(o.value, 10)),
      });
      bootstrap.Modal.getOrCreateInstance(document.getElementById("clientModal")).hide();
      toast("Client created — opening conversation…", "success");
      location.href = "/chat?id=" + created.id;
    } catch (e) { toast(e.message); }
  });

  // ---- Init ----
  // A failure here used to leave the page on its skeletons forever. Show what
  // went wrong instead.
  try {
    await loadData();
    populatePlatformSelect();
    renderFilters();
    refreshClientChannelOptions();
    renderGrid();
  } catch (e) {
    document.getElementById("grid").innerHTML =
      `<div class="empty" style="grid-column:1/-1"><span class="em-ico">${Icon("alert", { size: 26 })}</span>
        Couldn't load channels — ${esc(e.message || "unknown error")}</div>`;
    toast(e.message || "Failed to load channels");
  }
})();
