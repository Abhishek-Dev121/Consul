// Reusable render helpers shared across pages.

// ---- Icon system: minimal line icons (SVG, stroke=currentColor) replacing
// emoji throughout the UI. Inherits color from context — no fixed palette,
// so it respects light/dark theme automatically.
const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M15.2 14.6c2.6.3 4.3 2.2 4.3 5.4"/>',
  message: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.3a.6.6 0 0 1-1-.5V5.5Z"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.2h8A1.5 1.5 0 0 1 20.5 8.7v8.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-11Z"/>',
  folderOpen: '<path d="M3.5 8.5V6.5A1.5 1.5 0 0 1 5 5h4l2 2h6a1.5 1.5 0 0 1 1.5 1.5"/><path d="M3.7 8.5h15.6a1 1 0 0 1 .97 1.24l-1.6 6.8a1.5 1.5 0 0 1-1.46 1.16H5.8a1.5 1.5 0 0 1-1.46-1.16l-1.6-6.8a1 1 0 0 1 .96-1.24Z"/>',
  phone: '<path d="M6 3h3l1.4 4.3-2 1.6a12 12 0 0 0 5.7 5.7l1.6-2L20 14v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
  file: '<path d="M7 3h6l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M13 3v4h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.4"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3Z"/>',
  scroll: '<path d="M6 4h9a2 2 0 0 1 2 2v11a2 2 0 0 0 2 2M6 4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11"/><path d="M8 8h6M8 12h6"/>',
  link: '<path d="M9 15l6-6"/><path d="M10 6l1-1a3.5 3.5 0 0 1 5 5l-1 1"/><path d="M14 18l-1 1a3.5 3.5 0 0 1-5-5l1-1"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0v4l1.5 3h-15L6 13V9Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.2 1-1.2 1.9"/><path d="M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  trash: '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="13.5" r="1.2"/><circle cx="15" cy="13.5" r="1.2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>',
  external: '<path d="M9 6h9v9"/><path d="M18 6 7 17"/>',
  clipboard: '<rect x="6" y="4" width="12" height="16" rx="1.5"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="11" rx="2"/><path d="M8.5 7.5v-2a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/><path d="M3.5 12h17"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M10 2h4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/>',
  logout: '<path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
};
function Icon(name, opts = {}) {
  const size = opts.size || 16;
  const sw = opts.strokeWidth || 2;
  const cls = opts.cls ? ` class="${opts.cls}"` : "";
  const style = opts.inline === false ? "" : "vertical-align:-3px;";
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="${style}${opts.style || ""}">${ICONS[name] || ""}</svg>`;
}

// Per-platform icon + tint class, used by channel cards/pills.
const PLATFORM_META = {
  whatsapp: { icon: Icon("message"), tint: "tint-green" },
  slack:    { icon: "#",  tint: "tint-violet" },
  email:    { icon: Icon("mail"), tint: "tint-sky" },
  upwork:   { icon: Icon("briefcase"), tint: "tint-green" },
  telegram: { icon: Icon("send"), tint: "tint-sky" },
  other:    { icon: Icon("link"), tint: "tint-blue" },
};
function platformMeta(p) { return PLATFORM_META[p] || PLATFORM_META.other; }

// Channel brand colors (for dots/icons) shared across views.
const CHAN_COLORS = {
  whatsapp: "#25D366", upwork: "#108A00", slack: "#611F69",
  email: "#4A6CF7", telegram: "#229ED9", other: "#8A94A6",
};
const chanColor = (p) => CHAN_COLORS[p] || CHAN_COLORS.other;
const platformName = (p) => ({ whatsapp: "WhatsApp", upwork: "Upwork", slack: "Slack",
  email: "Email", telegram: "Telegram", other: "Other" }[p] || "Other");

// Avatar box (colored by string hash) — matches reference .av
const AV_PALETTE = ["#0E8C8C", "#5B6CE0", "#C2702A", "#9D4ED2", "#1F9D6B", "#D2473D", "#3A8DDE", "#B0467E"];
function avHash(s) { let h = 0; for (const ch of (s || "")) h = (h * 31 + ch.charCodeAt(0)) % AV_PALETTE.length; return AV_PALETTE[h]; }
function initialsOf(n) { return (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
function avBox(name, cls = "") { return `<span class="av ${cls}" style="background:${avHash(name)}">${initialsOf(name)}</span>`; }

// Sentiment pill (pos/neu/neg)
function sentPill(s) {
  const m = { pos: ["s-pos", "Positive"], neu: ["s-neu", "Neutral"], neg: ["s-neg", "Negative"] };
  const [cls, label] = m[s] || m.neu;
  return `<span class="spill ${cls}"><span class="pdot"></span>${label}</span>`;
}
function chanChip(p) {
  return `<span class="chan"><span class="cd" style="background:${chanColor(p)}"></span>${platformName(p)}</span>`;
}

// Relative time ("2h ago"), full timestamp on hover.
function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso), s = Math.floor((Date.now() - d.getTime()) / 1000);
  let txt;
  if (s < 60) txt = "just now";
  else if (s < 3600) txt = `${Math.floor(s / 60)}m ago`;
  else if (s < 86400) txt = `${Math.floor(s / 3600)}h ago`;
  else if (s < 604800) txt = `${Math.floor(s / 86400)}d ago`;
  else txt = d.toLocaleDateString();
  return `<span title="${d.toLocaleString()}">${txt}</span>`;
}

// Turn a raw activity action+detail into a readable phrase.
function humanizeActivity(action, detail) {
  detail = detail || {};
  const obj = (v) => (v ? ` ${v}` : "");
  switch (action) {
    case "user.created": return detail.invited ? `invited a user${obj(detail.email)}` : `created a user${obj(detail.email)}`;
    case "user.updated": return "updated a user";
    case "user.deleted": return `deleted a user${obj(detail.email)}`;
    case "channel.created": return `created channel${obj(detail.name)}`;
    case "client.created": return `added client${obj(detail.name)}`;
    case "client.updated": return "updated a client";
    case "conversation.created": return "logged a conversation";
    case "conversation.analyzed": return "ran AI analysis on a chat";
    case "audio.uploaded": return "uploaded a call recording";
    case "audio.analyzed": return "analyzed a call recording";
    case "message.sent": return "sent a reply";
    case "file.uploaded": return `uploaded${obj(detail.filename) || " a document"}`;
    case "bitrix.synced": return "synced Bitrix24 projects";
  }
  if (action.startsWith("user.bulk_")) return `ran a bulk ${action.split("_")[1]} on users`;
  return action.replace(/[._]/g, " ");
}


function sentimentBadge(sentiment, score) {
  if (!sentiment) return "";
  const cls = `sentiment-${sentiment}`;
  const s = score != null ? ` (${Number(score).toFixed(2)})` : "";
  return `<span class="${cls}">${esc(sentiment)}${s}</span>`;
}

function listGroup(items) {
  if (!items || !items.length) return '<span class="muted">None</span>';
  return `<ul class="mb-0 ps-3">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

// Render an AI analysis object into a Bootstrap card body.
function renderAnalysis(a) {
  if (!a) return '<p class="muted">No analysis yet.</p>';
  const metrics = a.response_metrics || {};
  let metricsHtml = "";
  if (metrics.available) {
    metricsHtml = `
      <div class="mt-3"><strong>Response time</strong>
        <ul class="mb-0 ps-3">
          <li>Average: ${metrics.avg_response_minutes} min (${metrics.avg_response_seconds}s)</li>
          <li>Fastest: ${metrics.fastest_seconds}s · Slowest: ${metrics.slowest_seconds}s</li>
        </ul>
      </div>`;
  } else if (metrics.reason) {
    metricsHtml = `<p class="muted mt-2 small">Response metrics: ${esc(metrics.reason)}</p>`;
  }

  return `
    <div class="row g-3">
      <div class="col-md-12"><strong>Summary</strong><p class="mb-2">${esc(a.summary || "—")}</p></div>
      <div class="col-md-6"><strong>Key points</strong>${listGroup(a.key_points)}</div>
      <div class="col-md-6"><strong>Pending actions</strong>${listGroup(a.pending_actions)}</div>
      <div class="col-md-6"><strong>Follow-ups</strong>${listGroup(a.follow_ups)}</div>
      <div class="col-md-6">
        <strong>Sentiment</strong><div>${sentimentBadge(a.sentiment, a.sentiment_score) || "—"}</div>
        ${a.behavioral_assessment ? `<div class="mt-2"><strong>Behavioral assessment</strong><p class="mb-0">${esc(a.behavioral_assessment)}</p></div>` : ""}
      </div>
    </div>
    ${metricsHtml}
    ${a.transcript ? `<div class="mt-3"><strong>Transcript</strong><div class="chat-log mt-1">${esc(a.transcript)}</div></div>` : ""}
    <p class="muted small mt-2 mb-0">Model: ${esc(a.model || "—")} · ${fmtDate(a.created_at)}</p>`;
}
