// Shared "edit client" modal — mirrors the New client form (single-channel
// dropdown + compact assignees dropdown). Used by Clients, the client profile,
// and the Channels hub.
const ClientEditModal = (function () {
  let modal, channelsCache = null, usersCache = null, currentId = null, onSavedCb = null;

  function ensureDom() {
    if (document.getElementById("clientEditModal")) return;
    const html = `
    <div class="modal fade" id="clientEditModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Edit client</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body"><div class="row g-3">
        <div class="col-md-6"><label class="form-label">Name <span class="req">*</span></label><input class="form-control" id="ce-name" /></div>
        <div class="col-md-6"><label class="form-label">Company</label><input class="form-control" id="ce-company" /></div>
        <div class="col-md-6"><label class="form-label">Email</label><input type="email" class="form-control" id="ce-email" /></div>
        <div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" id="ce-phone" /></div>
        <div class="col-md-6"><label class="form-label">Status</label>
          <select class="form-select" id="ce-status"><option value="active">Active</option>
            <option value="inactive">Inactive</option><option value="lead">Lead</option></select></div>
        <div class="col-md-6">
          <label class="form-label d-flex justify-content-between w-100 mb-1">
            <span>Channel <span class="req">*</span></span>
            <a href="#" class="small text-decoration-none" id="ce-add-chan-btn" style="font-weight: 500">+ Create New</a>
          </label>
          <select class="form-select" id="ce-channel"><option value="">Select a channel…</option></select>
          
          <!-- Inline New Channel Form -->
          <div class="mt-2 p-2 border rounded bg-light d-none" id="ce-new-chan-wrap" style="font-size:12.5px">
            <div class="row g-2">
              <div class="col-7">
                <input type="text" class="form-control form-control-sm" id="ce-new-chan-name" placeholder="Channel Name" />
              </div>
              <div class="col-5">
                <select class="form-select form-select-sm" id="ce-new-chan-platform">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="upwork">Upwork</option>
                  <option value="slack">Slack</option>
                  <option value="email">Email</option>
                  <option value="telegram">Telegram</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div class="col-12 d-flex justify-content-end gap-1">
                <button type="button" class="btn btn-light btn-sm py-0 px-2" style="font-size:11px" id="ce-new-chan-cancel">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm py-0 px-2" style="font-size:11px" id="ce-new-chan-save">Create</button>
              </div>
            </div>
          </div>
        </div>
        <div class="col-12" id="ce-assignees-wrap"><label class="form-label">Assignees</label>
          <div class="dropdown w-100">
            <button class="form-select text-start text-muted" type="button" id="ce-assignees-btn">Select team members…</button>
            <div class="dropdown-menu p-2 w-100" style="max-height:220px;overflow:auto" id="ce-assignees-menu"></div>
          </div>
        </div>
        <div class="col-12"><label class="form-label">Notes</label><textarea class="form-control" id="ce-notes" rows="2"></textarea></div>
      </div></div>
      <div class="modal-footer"><button class="btn btn-light" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" id="ce-save">Save changes</button></div>
    </div></div></div>`;
    document.body.insertAdjacentHTML("beforeend", html);
    modal = new bootstrap.Modal(document.getElementById("clientEditModal"));
    document.getElementById("ce-save").addEventListener("click", save);

    // Inline Channel Creation Toggle
    const addChanBtn = document.getElementById("ce-add-chan-btn");
    const chanWrap = document.getElementById("ce-new-chan-wrap");
    const chanNameInput = document.getElementById("ce-new-chan-name");
    const chanPlatSelect = document.getElementById("ce-new-chan-platform");
    const cancelChanBtn = document.getElementById("ce-new-chan-cancel");
    const saveChanBtn = document.getElementById("ce-new-chan-save");

    if (addChanBtn) {
      addChanBtn.onclick = (e) => {
        e.preventDefault();
        chanWrap.classList.toggle("d-none");
        chanNameInput.focus();
      };
    }
    if (cancelChanBtn) {
      cancelChanBtn.onclick = () => {
        chanWrap.classList.add("d-none");
        chanNameInput.value = "";
      };
    }
    if (saveChanBtn) {
      saveChanBtn.onclick = async () => {
        const name = chanNameInput.value.trim();
        const platform = chanPlatSelect.value;
        if (!name) return toast("Channel Name is required");
        try {
          const ch = await Api.post("/api/channels", { name, platform, config: {} });
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.textContent = `${ch.name} · ${platformName(ch.platform)}`;
          opt.selected = true;
          document.getElementById("ce-channel").appendChild(opt);
          chanWrap.classList.add("d-none");
          chanNameInput.value = "";
          toast("Channel created", "success");
        } catch (e) {
          toast(e.message);
        }
      };
    }

    // Reliable assignees dropdown toggle (avoids Bootstrap-dropdown-in-modal quirks).
    const aBtn = document.getElementById("ce-assignees-btn");
    const aMenu = document.getElementById("ce-assignees-menu");
    aBtn.onclick = (e) => { e.stopPropagation(); aMenu.classList.toggle("show"); };
    aMenu.onclick = (e) => e.stopPropagation();
    document.addEventListener("click", () => aMenu.classList.remove("show"));
  }

  function updateAssigneeLabel() {
    const sel = [...document.querySelectorAll("#ce-assignees-menu input:checked")];
    const btn = document.getElementById("ce-assignees-btn");
    btn.textContent = !sel.length ? "Select team members…"
      : sel.length === 1 ? sel[0].dataset.name : `${sel.length} assignees selected`;
    btn.classList.toggle("text-muted", sel.length === 0);
  }

  async function open(client, onSaved) {
    ensureDom();
    currentId = client.id;
    onSavedCb = onSaved;
    document.getElementById("ce-name").value = client.name || "";
    document.getElementById("ce-company").value = client.company || "";
    document.getElementById("ce-email").value = client.email || "";
    document.getElementById("ce-phone").value = client.phone || "";
    document.getElementById("ce-status").value = client.status || "active";
    document.getElementById("ce-notes").value = client.notes || "";

    // Channel — single-select, pre-select the client's current channel.
    // Fetch fresh each time so newly-created channels appear immediately.
    channelsCache = await Api.get("/api/channels").catch(() => []);
    const cur = (client.channels || [])[0];
    document.getElementById("ce-channel").innerHTML = '<option value="">Select a channel…</option>' +
      channelsCache.map((c) => `<option value="${c.id}" ${cur && cur.id === c.id ? "selected" : ""}>${esc(c.name)} · ${platformName(c.platform)}</option>`).join("");

    // Assignees — admin-only; compact checkbox dropdown pre-checked with current assignees.
    const wrap = document.getElementById("ce-assignees-wrap");
    if (typeof isAdmin === "function" && isAdmin()) {
      const r = await Api.get("/api/users?limit=200").catch(() => ({ items: [] }));
      usersCache = r.items || r;
      const have = new Set((client.assignees || []).map((a) => a.id));
      document.getElementById("ce-assignees-menu").innerHTML = usersCache.map((u) =>
        `<label class="dropdown-item d-flex align-items-center gap-2" style="cursor:pointer">
          <input type="checkbox" class="form-check-input m-0" value="${u.id}" data-name="${esc(u.name)}" ${have.has(u.id) ? "checked" : ""}>
          <span>${esc(u.name)}</span><span class="muted small">· ${u.role.replace("_", " ")}</span></label>`).join("");
      document.querySelectorAll("#ce-assignees-menu input").forEach((cb) => cb.addEventListener("change", updateAssigneeLabel));
      updateAssigneeLabel();
      wrap.style.display = "";
    } else {
      wrap.style.display = "none";
    }
    modal.show();
  }

  async function save() {
    const channel = document.getElementById("ce-channel").value;
    const payload = {
      name: document.getElementById("ce-name").value.trim(),
      company: document.getElementById("ce-company").value.trim() || null,
      email: document.getElementById("ce-email").value.trim() || null,
      phone: document.getElementById("ce-phone").value.trim() || null,
      status: document.getElementById("ce-status").value,
      notes: document.getElementById("ce-notes").value.trim() || null,
      channel_ids: channel ? [parseInt(channel)] : [],
    };
    if (typeof isAdmin === "function" && isAdmin())
      payload.assignee_ids = [...document.querySelectorAll("#ce-assignees-menu input:checked")].map((i) => parseInt(i.value));
    if (!payload.name) return toast("Name is required");
    if (!payload.channel_ids.length) return toast("Select a channel");
    try {
      await Api.patch(`/api/clients/${currentId}`, payload);
      modal.hide();
      toast("Client updated", "success");
      if (onSavedCb) onSavedCb();
    } catch (e) { toast(e.message); }
  }

  return { open };
})();
