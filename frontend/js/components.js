// Reusable render helpers shared across pages.

// Per-platform icon + tint class, used by channel cards/pills.
const PLATFORM_META = {
  whatsapp: { icon: "💬", tint: "tint-green" },
  slack:    { icon: "#",  tint: "tint-violet" },
  email:    { icon: "✉️", tint: "tint-sky" },
  upwork:   { icon: "🟢", tint: "tint-green" },
  telegram: { icon: "✈️", tint: "tint-sky" },
  other:    { icon: "🔗", tint: "tint-blue" },
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
