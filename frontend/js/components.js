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
  restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5"/><path d="M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  eraser: '<path d="M8.5 20H21"/><path d="m14.5 4.5 5 5a2 2 0 0 1 0 2.8l-7.6 7.6a2 2 0 0 1-2.8 0l-5-5a2 2 0 0 1 0-2.8l7.6-7.6a2 2 0 0 1 2.8 0Z"/><path d="m8 8 8 8"/>',
  dots: '<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>',
  // Consul brand monogram — a bold "C" ring.
  consul: '<path d="M17 7a6.6 6.6 0 1 0 0 10" stroke-width="2.6"/>',
};
function Icon(name, opts = {}) {
  const size = opts.size || 16;
  const sw = opts.strokeWidth || 2;
  const cls = opts.cls ? ` class="${opts.cls}"` : "";
  const style = opts.inline === false ? "" : "vertical-align:-3px;";
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="${style}${opts.style || ""}">${ICONS[name] || ""}</svg>`;
}

// Channel brand colors (for dots/icons) shared across views. Declared before the
// glyph helper below, which resolves a channel's brand colour from here.
const CHAN_COLORS = {
  whatsapp: "#25D366", upwork: "#108A00", slack: "#611F69",
  email: "#4A6CF7", telegram: "#229ED9", linkedin: "#0A66C2", other: "#8A94A6",
};
const chanColor = (p) => CHAN_COLORS[p] || CHAN_COLORS.other;

// Recognisable brand glyphs per platform (filled, inherit colour via fill).
// Simplified marks — not exact logo artwork — rendered in each platform's colour.
const PLATFORM_GLYPHS = {
  whatsapp: '<path d="M12 2A10 10 0 0 0 3.5 17.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.3-1.7c-.1-.2 0-.4.1-.5l.4-.4.2-.4a.5.5 0 0 0 0-.4c0-.1-.5-1.3-.7-1.8s-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3A2.9 2.9 0 0 0 6.4 10a5 5 0 0 0 1.1 2.7 11.5 11.5 0 0 0 4.4 3.9c.6.3 1.1.4 1.5.5a3.6 3.6 0 0 0 1.6.1 2.7 2.7 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/>',
  slack: '<path d="M6 15.1a1.9 1.9 0 1 1-1.9-1.9H6v1.9Zm1 0a1.9 1.9 0 0 1 3.8 0v4.8a1.9 1.9 0 0 1-3.8 0v-4.8Z"/><path d="M8.9 6a1.9 1.9 0 1 1 1.9-1.9V6H8.9Zm0 1a1.9 1.9 0 0 1 0 3.8H4.1a1.9 1.9 0 0 1 0-3.8h4.8Z"/><path d="M18 8.9a1.9 1.9 0 1 1 1.9 1.9H18V8.9Zm-1 0a1.9 1.9 0 0 1-3.8 0V4.1a1.9 1.9 0 0 1 3.8 0v4.8Z"/><path d="M15.1 18a1.9 1.9 0 1 1-1.9 1.9V18h1.9Zm0-1a1.9 1.9 0 0 1 0-3.8h4.8a1.9 1.9 0 0 1 0 3.8h-4.8Z"/>',
  telegram: '<path d="M21.9 4.3 2.9 11.6c-.9.3-.9 1-.1 1.3l4.8 1.5 1.8 5.9c.2.5.4.6.9.3l2.7-2 4.9 3.6c.5.3.9.1 1-.5l3.4-16c.2-.7-.3-1-1.3-.7Zm-3.5 3.4-8.5 7.7-.3 3.6-1.4-4.5 9.9-6.5c.4-.3.8.1.3.5Z"/>',
  upwork: '<path d="M17.6 9.2a3.5 3.5 0 0 0-3.3 2.6c-.5-.8-.9-1.8-1.1-2.6h-2v3.1a1.6 1.6 0 0 1-3.2 0V9.2H5.9v3.1a3.6 3.6 0 0 0 6.5 2.1c.4.9 1.2 1.9 2.9 1.9a3.6 3.6 0 1 0 .3-7.1Zm-.1 5.2a1.7 1.7 0 0 1-1.6-1.6l.1-.6c.2-.7.8-1.1 1.5-1.1a1.65 1.65 0 0 1 0 3.3Z"/>',
  email: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2 8 5.5L20 6H4Zm16 2.3-8 5.5-8-5.5V18h16V8.3Z"/>',
  linkedin: '<path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.779-1.75-1.75s.784-1.75 1.75-1.75 1.75.779 1.75 1.75-.784 1.75-1.75 1.75zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>',
  other: '<path d="M10 13a5 5 0 0 0 7 0l2.5-2.5a5 5 0 0 0-7-7L11 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a5 5 0 0 0-7 0l-2.5 2.5a5 5 0 0 0 7 7L13 19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

// A channel icon in its own brand colour. `mono` renders it in the current text
// colour instead (e.g. on a coloured background).
function channelIcon(platform, size = 14, mono = false) {
  const p = PLATFORM_GLYPHS[platform] ? platform : "other";
  const color = mono ? "currentColor" : chanColor(p);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" style="vertical-align:-2px;flex:none">${PLATFORM_GLYPHS[p]}</svg>`;
}

// Per-platform icon + tint class, used by channel cards/pills.
const PLATFORM_META = {
  whatsapp: { icon: channelIcon("whatsapp", 16, true), tint: "tint-green" },
  slack:    { icon: channelIcon("slack", 16, true),    tint: "tint-violet" },
  email:    { icon: channelIcon("email", 16, true),    tint: "tint-sky" },
  upwork:   { icon: channelIcon("upwork", 16, true),   tint: "tint-green" },
  telegram: { icon: channelIcon("telegram", 16, true), tint: "tint-sky" },
  linkedin: { icon: channelIcon("linkedin", 16, true), tint: "tint-sky" },
  other:    { icon: channelIcon("other", 16, true),    tint: "tint-blue" },
};
function platformMeta(p) { return PLATFORM_META[p] || PLATFORM_META.other; }

const platformName = (p) => ({ whatsapp: "WhatsApp", upwork: "Upwork", slack: "Slack",
  email: "Email", telegram: "Telegram", linkedin: "LinkedIn", other: "Other" }[p] || "Other");

// Avatar box (colored by string hash) — matches reference .av
const AV_PALETTE = ["#2E6BFF", "#5B6CE0", "#C2702A", "#9D4ED2", "#1F9D6B", "#D2473D", "#3A8DDE", "#B0467E"];
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
    case "document.analyzed": return `ran AI analysis on${obj(detail.filename) || " a document"}`;
    case "message.sent": return "sent a reply";
    case "file.uploaded": return `uploaded${obj(detail.filename) || " a document"}`;
    case "bitrix.synced": return "synced Bitrix24 projects";
    case "chat.cleared": {
      const n = detail.messages;
      return n ? `cleared the chat (${n} message${n === 1 ? "" : "s"})` : "cleared the chat";
    }
    case "chat.cleared_all": {
      const c = detail.clients, m = detail.messages;
      return (c != null && m != null)
        ? `cleared every chat (${m} message${m === 1 ? "" : "s"} across ${c} client${c === 1 ? "" : "s"})`
        : "cleared every chat";
    }
  }
  if (action.startsWith("user.bulk_")) return `ran a bulk ${action.split("_")[1]} on users`;
  return action.replace(/[._]/g, " ");
}

// Icon + tone for an activity entry. Destructive actions read red, AI reads
// purple, uploads/creations read green — so the feed is scannable at a glance.
const ACTIVITY_META = {
  "message.sent":          { icon: "message",    tone: "" },
  "file.uploaded":         { icon: "file",       tone: "good" },
  "audio.uploaded":        { icon: "phone",      tone: "good" },
  "audio.analyzed":        { icon: "sparkles",   tone: "ai" },
  "document.analyzed":     { icon: "sparkles",   tone: "ai" },
  "conversation.analyzed": { icon: "sparkles",   tone: "ai" },
  "conversation.created":  { icon: "message",    tone: "" },
  "client.created":        { icon: "users",      tone: "good" },
  "client.updated":        { icon: "edit",       tone: "" },
  "channel.created":       { icon: "rss",        tone: "good" },
  "user.created":          { icon: "users",      tone: "good" },
  "user.updated":          { icon: "edit",       tone: "" },
  "user.deleted":          { icon: "trash",      tone: "bad" },
  "bitrix.synced":         { icon: "link",       tone: "" },
  "chat.cleared":          { icon: "eraser",     tone: "warn" },
  "chat.cleared_all":      { icon: "alert",      tone: "bad" },
};
function activityMeta(action) {
  return ACTIVITY_META[action] || { icon: "clock", tone: "" };
}

// Project status -> pill class. Bitrix reports "active"/"closed"; the rest are
// defensive so an unexpected value still renders as a neutral pill.
function statusPill(status) {
  const s = (status || "").toLowerCase();
  let cls = "st-done";
  if (s.includes("active") || s.includes("open")) cls = "st-active";
  else if (s.includes("progress")) cls = "st-progress";
  else if (s.includes("hold") || s.includes("pause")) cls = "st-hold";
  return `<span class="st ${cls}"><span class="sd"></span>${esc(status || "unknown")}</span>`;
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

// Generates professional modern skeleton loaders for page views
function skeletonLoader(type) {
  if (type === "table" || type === "list") {
    return `
      <div style="padding: 16px;">
        <div class="skeleton" style="height: 35px; width: 100%; margin-bottom: 15px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 25px; width: 95%; margin-bottom: 12px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 25px; width: 90%; margin-bottom: 12px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 25px; width: 97%; margin-bottom: 12px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 25px; width: 85%; margin-bottom: 12px; border-radius: 6px;"></div>
        <div class="skeleton" style="height: 25px; width: 92%; margin-bottom: 12px; border-radius: 6px;"></div>
      </div>`;
  }
  if (type === "cards") {
    return `
      <div class="grid g-4" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); padding: 8px;">
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
        <div class="skeleton" style="height: 180px; border-radius: 12px;"></div>
      </div>`;
  }
  if (type === "reports") {
    return `
      <div style="padding: 8px;">
        <div class="row g-3 mb-4">
          <div class="col-md-3 col-6"><div class="skeleton" style="height:100px;border-radius:12px"></div></div>
          <div class="col-md-3 col-6"><div class="skeleton" style="height:100px;border-radius:12px"></div></div>
          <div class="col-md-3 col-6"><div class="skeleton" style="height:100px;border-radius:12px"></div></div>
          <div class="col-md-3 col-6"><div class="skeleton" style="height:100px;border-radius:12px"></div></div>
        </div>
        <div class="row g-3">
          <div class="col-md-8"><div class="skeleton" style="height:320px;border-radius:14px"></div></div>
          <div class="col-md-4"><div class="skeleton" style="height:320px;border-radius:14px"></div></div>
        </div>
      </div>`;
  }
  return `<div class="skeleton" style="height: 200px; border-radius: 8px;"></div>`;
}

