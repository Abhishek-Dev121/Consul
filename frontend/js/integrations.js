(async function () {
  await renderLayout("/integrations", "Integrations", { crumb: "Integrations", hideSearch: true });
  const root = document.getElementById("intg-root");

  // Super-Admin only — the API enforces it too, but fail clearly here.
  if (!isSuperAdmin()) {
    root.innerHTML = `<div class="intg-card"><div class="intg-body">
      <h2 style="font-size:1.05rem;margin:0 0 6px">Restricted</h2>
      <p class="muted mb-0">Only a Super Admin can manage AI integration settings.</p>
    </div></div>`;
    return;
  }

  const OPENAI_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M21.3 10a5.4 5.4 0 0 0-.5-4.5 5.5 5.5 0 0 0-5.9-2.6A5.4 5.4 0 0 0 10.8 1 5.5 5.5 0 0 0 5.5 4.9 5.4 5.4 0 0 0 1.9 7.5a5.5 5.5 0 0 0 .7 6.4 5.4 5.4 0 0 0 .5 4.5 5.5 5.5 0 0 0 5.9 2.6A5.4 5.4 0 0 0 13.2 23a5.5 5.5 0 0 0 5.3-3.9 5.4 5.4 0 0 0 3.6-2.6 5.5 5.5 0 0 0-.7-6.5Zm-8.1 11.3a4 4 0 0 1-2.6-.9l3.6-2.1a.6.6 0 0 0 .3-.5v-5.1l1.5.9v4.2a4.1 4.1 0 0 1-2.8 3.5ZM5.9 17.7a4 4 0 0 1-.5-2.7l3.6 2.1a.6.6 0 0 0 .6 0l4.4-2.6v1.8L10.4 19a4.1 4.1 0 0 1-4.5-1.3ZM4.6 8.7a4 4 0 0 1 2.1-1.8v4.3a.6.6 0 0 0 .3.5l4.4 2.5-1.5.9-3.6-2.1a4.1 4.1 0 0 1-1.7-4.3ZM17.9 12l-4.4-2.6 1.5-.8 3.6 2a4 4 0 0 1-.6 7.2v-4.3a.6.6 0 0 0-.3-.5Zm1.5-2.2-3.6-2.1a.6.6 0 0 0-.6 0l-4.4 2.6V8.5L14.6 6a4 4 0 0 1 5.9 4.3 4 4 0 0 1-1.1.6ZM9.5 12.9 8 12V7.8a4 4 0 0 1 6.6-3.1L11 6.8a.6.6 0 0 0-.3.5ZM10.3 11l2-1.1 2 1.1v2.3l-2 1.1-2-1.1Z"/></svg>`;

  let cfg = null;
  let originalPrompts = {};   // kind -> loaded value, to detect edits
  let keyRevealed = false;    // API key shown in full vs half-masked
  let replacing = false;      // editing/pasting a new key

  // Show the first half of the key and mask the rest, so it's identifiable but
  // the full secret isn't exposed until the user clicks "view".
  function halfMask(key) {
    if (!key) return "";
    const shown = Math.max(4, Math.floor(key.length / 2));
    return key.slice(0, shown) + "•".repeat(Math.max(4, key.length - shown));
  }

  // The icon set has "eye" but no "eye-off"; inline a crossed-eye for the hide state.
  const EYE_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const eyeIcon = (revealed) => (revealed ? EYE_OFF : Icon("eye", { size: 15 }));

  async function load() {
    cfg = await Api.get("/api/integrations/ai", { stale: false });
    originalPrompts = {};
    cfg.prompts.forEach((p) => { originalPrompts[p.kind] = p.value; });
    render();
  }

  function render() {
    const connected = cfg.api_key_set;
    const statusChip = connected
      ? `<span class="chip intg-status" style="background:var(--pos-soft);color:var(--pos)">${Icon("check", { size: 12 })} Connected</span>`
      : `<span class="chip intg-status" style="background:var(--neg-soft);color:var(--neg)">Disconnected</span>`;

    // Model dropdown: suggested models + the current one if it isn't in the list.
    const models = [...(cfg.suggested_models || [])];
    if (cfg.model && !models.includes(cfg.model)) models.unshift(cfg.model);
    const modelOpts = models.map((m) =>
      `<option value="${esc(m)}" ${m === cfg.model ? "selected" : ""}>${esc(m)}${m === "gpt-4o-mini" ? " (default)" : ""}</option>`).join("");

    // API key control: either the saved key (masked/reveal/copy) or an input to paste one.
    const keyDisplayVal = keyRevealed ? cfg.api_key : halfMask(cfg.api_key);
    const keyControl = (connected && !replacing)
      ? `<div class="key-field">
           <input class="form-control key-mono" id="api-key-display" readonly value="${esc(keyDisplayVal)}" />
           <button type="button" class="key-btn" id="key-view" title="${keyRevealed ? "Hide" : "Show"} key">${eyeIcon(keyRevealed)}</button>
           <button type="button" class="key-btn" id="key-copy" title="Copy key">${Icon("clipboard", { size: 15 })}</button>
         </div>
         <div class="intg-hint">A key is configured. <a href="#" id="key-replace">Replace key</a></div>`
      : `<div class="key-field">
           <input class="form-control key-mono" id="api-key-new" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" />
           ${replacing ? `<button type="button" class="key-btn" id="key-cancel-replace" title="Cancel">${Icon("x", { size: 15 })}</button>` : ""}
         </div>
         <div class="intg-hint">${replacing ? "Paste the new key, then Save or Reconnect." : "Paste your OpenAI API key to connect."}</div>`;

    const prompts = cfg.prompts.map((p, i) => `
      <div class="prompt-item ${i === 0 ? "open" : ""}" data-kind="${p.kind}">
        <div class="prompt-top" data-toggle="${p.kind}">
          <div>
            <div class="p-title">${esc(p.label)}</div>
            <div class="p-desc">${esc(p.description)}</div>
          </div>
          ${p.is_custom ? `<span class="chip prompt-badge info">Customised</span>` : `<span class="chip prompt-badge" style="background:var(--surface-2);color:var(--muted-2)">Default</span>`}
          <span class="chev">${Icon("chevronDown", { size: 16 })}</span>
        </div>
        <div class="prompt-body" ${i === 0 ? "" : "hidden"}>
          <textarea class="form-control" data-prompt="${p.kind}" spellcheck="false">${esc(p.value)}</textarea>
          <div class="prompt-actions">
            <button type="button" class="btn btn-light btn-sm" data-reset="${p.kind}" ${p.is_custom ? "" : "disabled"}>
              ${Icon("restore", { size: 13 })} Reset to default
            </button>
          </div>
        </div>
      </div>`).join("");

    root.innerHTML = `
      <div class="intg-card">
        <div class="intg-head">
          <div class="intg-logo">${OPENAI_ICON}</div>
          <div>
            <h2>OpenAI</h2>
            <div class="sub">AI Enrichment — summaries, key points & sentiment</div>
          </div>
          ${statusChip}
        </div>
        <div class="intg-body">
          <div class="intg-sec-label">Configuration</div>

          <div class="intg-field">
            <label>API Key <span class="req">*</span></label>
            ${keyControl}
          </div>

          <div class="intg-field">
            <label>Model <span class="req">*</span></label>
            <select class="form-select" id="model">${modelOpts}</select>
            <div class="intg-hint">${(cfg.suggested_models || []).length} models available · GPT-4o Mini is the default.</div>
          </div>

          <div class="intg-divider"></div>
          <div class="intg-sec-label">Connection</div>
          <div class="conn-row">
            <span class="conn-status ${connected ? "on" : "off"}">
              <span class="conn-dot"></span>${connected ? "Connected" : "Disconnected"}
            </span>
            <span class="spacer"></span>
            ${connected
              ? `<button type="button" class="btn btn-soft btn-sm" id="reconnect-btn">${Icon("restore", { size: 14 })} Reconnect</button>
                 <button type="button" class="btn btn-light btn-sm text-danger" id="disconnect-btn">${Icon("x", { size: 14 })} Disconnect</button>`
              : `<button type="button" class="btn btn-primary btn-sm" id="connect-btn">${Icon("check", { size: 14 })} Connect</button>`}
          </div>

          <div class="intg-divider"></div>
          <div class="intg-sec-label">System Prompts</div>
          <p class="intg-hint" style="margin:-6px 0 14px">These instruct the AI for each kind of analysis. Changes apply to all future analyses.</p>
          ${prompts}
        </div>
        <div class="intg-foot">
          <span class="muted small">Model &amp; prompt changes save here. Key changes use the Connection buttons above.</span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary" id="save-btn">Save changes</button>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    // Collapsible prompt sections
    root.querySelectorAll(".prompt-top").forEach((el) =>
      el.addEventListener("click", () => {
        const item = el.closest(".prompt-item");
        const body = item.querySelector(".prompt-body");
        const open = item.classList.toggle("open");
        body.hidden = !open;
      }));

    root.querySelectorAll("[data-reset]").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const kind = btn.dataset.reset;
        const ok = await confirmDialog(
          "This restores the built-in default prompt for this analysis. Your customised version will be discarded.",
          { title: "Reset to default?", confirmText: "Reset prompt", danger: false, icon: "restore" }
        );
        if (!ok) return;
        try {
          cfg = await Api.post("/api/integrations/ai/reset-prompt", { kind });
          originalPrompts = {}; cfg.prompts.forEach((p) => { originalPrompts[p.kind] = p.value; });
          render();
          toast("Prompt reset to default", "success");
        } catch (err) { toast(err.message); }
      }));

    // ── API key: view / hide / copy / replace ──
    const viewBtn = document.getElementById("key-view");
    if (viewBtn) viewBtn.addEventListener("click", () => {
      keyRevealed = !keyRevealed;
      const input = document.getElementById("api-key-display");
      input.value = keyRevealed ? cfg.api_key : halfMask(cfg.api_key);
      viewBtn.title = (keyRevealed ? "Hide" : "Show") + " key";
      viewBtn.innerHTML = eyeIcon(keyRevealed);
    });
    const copyBtn = document.getElementById("key-copy");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cfg.api_key || "");
        toast("API key copied to clipboard", "success");
      } catch (_) { toast("Could not copy — your browser blocked clipboard access"); }
    });
    const replaceLink = document.getElementById("key-replace");
    if (replaceLink) replaceLink.addEventListener("click", (e) => { e.preventDefault(); replacing = true; keyRevealed = false; render(); document.getElementById("api-key-new")?.focus(); });
    const cancelReplace = document.getElementById("key-cancel-replace");
    if (cancelReplace) cancelReplace.addEventListener("click", () => { replacing = false; render(); });

    // ── Connection buttons ──
    const connectBtn = document.getElementById("connect-btn");
    if (connectBtn) connectBtn.addEventListener("click", () => connect(connectBtn, false));
    const reconnectBtn = document.getElementById("reconnect-btn");
    if (reconnectBtn) reconnectBtn.addEventListener("click", () => connect(reconnectBtn, true));
    const disconnectBtn = document.getElementById("disconnect-btn");
    if (disconnectBtn) disconnectBtn.addEventListener("click", disconnect);

    document.getElementById("save-btn").addEventListener("click", save);
  }

  async function connect(btn, isReconnect) {
    const newKeyEl = document.getElementById("api-key-new");
    const newKey = newKeyEl ? newKeyEl.value.trim() : "";
    if (!isReconnect && !newKey) { toast("Paste your OpenAI API key first"); newKeyEl?.focus(); return; }
    const orig = btn.innerHTML; btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> ${isReconnect ? "Reconnecting" : "Connecting"}…`;
    try {
      if (newKey) await Api.request("PUT", "/api/integrations/ai", { api_key: newKey });
      const r = await Api.post("/api/integrations/ai/test", {});   // verify it actually works
      replacing = false; keyRevealed = false;
      await load();
      toast(`Connected — responded as ${r.model}`, "success");
    } catch (err) {
      toast(err.message);
      try { await load(); } catch (_) {}   // reflect whatever state we ended in
    }
  }

  async function disconnect() {
    const ok = await confirmDialog(
      "This disconnects OpenAI and disables AI analysis until a key is connected again.",
      { title: "Disconnect OpenAI?", confirmText: "Disconnect", icon: "x" }
    );
    if (!ok) return;
    try {
      cfg = await Api.post("/api/integrations/ai/disconnect", {});
      replacing = false; keyRevealed = false;
      originalPrompts = {}; cfg.prompts.forEach((p) => { originalPrompts[p.kind] = p.value; });
      render();
      toast("Disconnected", "success");
    } catch (err) { toast(err.message); }
  }

  async function save() {
    const btn = document.getElementById("save-btn");
    const body = {};

    const newKeyEl = document.getElementById("api-key-new");
    const key = newKeyEl ? newKeyEl.value.trim() : "";
    if (key) body.api_key = key;

    const model = document.getElementById("model").value.trim();
    if (!model) return toast("Model cannot be empty");
    body.model = model;

    // Only send prompts that were actually edited.
    const changedPrompts = [];
    root.querySelectorAll("[data-prompt]").forEach((ta) => {
      const kind = ta.dataset.prompt;
      if (ta.value !== originalPrompts[kind]) {
        if (!ta.value.trim()) { ta.classList.add("is-invalid"); return; }
        changedPrompts.push({ kind, value: ta.value });
      }
    });
    if ([...root.querySelectorAll("[data-prompt].is-invalid")].length) return toast("A prompt cannot be empty");
    if (changedPrompts.length) body.prompts = changedPrompts;

    btn.disabled = true; const orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Saving…`;
    try {
      cfg = await Api.request("PUT", "/api/integrations/ai", body);
      originalPrompts = {}; cfg.prompts.forEach((p) => { originalPrompts[p.kind] = p.value; });
      render();
      toast("Settings saved", "success");
    } catch (err) { toast(err.message); }
    finally {
      const b = document.getElementById("save-btn");
      if (b) { b.disabled = false; b.innerHTML = "Save changes"; }
    }
  }

  try { await load(); }
  catch (e) { root.innerHTML = `<div class="intg-card"><div class="intg-body text-danger">Could not load settings: ${esc(e.message)}</div></div>`; }
})();
