"""Response-time metrics from a pasted chat log.

Parses lines of the common form:
    [2024-01-02 13:45] Alice: message text
    2024-01-02 13:47 - Bob: reply
    13:45 Alice: hello            (time-only)

We detect speaker turns and measure the interval each time the speaker changes,
then summarise per-speaker and overall average response time (in seconds/minutes).
Best-effort: lines that don't parse are ignored.
"""
import re
from datetime import datetime, timedelta
from statistics import mean

# Capture an optional leading timestamp and a "Speaker:" prefix.
_TS_PATTERNS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%m/%d/%Y %H:%M",
    "%H:%M:%S",
    "%H:%M",
]
# A leading timestamp (bracketed or bare) followed by "Speaker: message".
# The timestamp is matched explicitly so colons inside it (e.g. 13:45) are not
# mistaken for the speaker delimiter.
_TS = r"\d{1,4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?"
_LINE_RE = re.compile(
    rf"^\s*[\[\(]?\s*(?P<ts>{_TS})\s*[\]\)]?\s*-?\s*(?P<speaker>[^:]{{1,40}}?):\s*(?P<msg>.+)$"
)


def _parse_ts(raw: str) -> datetime | None:
    raw = raw.strip()
    for fmt in _TS_PATTERNS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def compute_response_times(raw_content: str) -> dict:
    turns: list[tuple[datetime, str]] = []
    for line in raw_content.splitlines():
        m = _LINE_RE.match(line)
        if not m:
            continue
        ts = _parse_ts(m.group("ts"))
        if ts is None:
            continue
        turns.append((ts, m.group("speaker").strip()))

    if len(turns) < 2:
        return {"available": False, "reason": "Not enough timestamped turns to compute metrics."}

    per_speaker: dict[str, list[float]] = {}
    overall: list[float] = []
    for (t_prev, s_prev), (t_cur, s_cur) in zip(turns, turns[1:]):
        if s_cur == s_prev:
            continue
        delta = (t_cur - t_prev).total_seconds()
        # Guard against day-rollover artifacts on time-only logs.
        if delta < 0:
            delta += timedelta(days=1).total_seconds()
        if delta <= 0:
            continue
        overall.append(delta)
        per_speaker.setdefault(s_cur, []).append(delta)

    if not overall:
        return {"available": False, "reason": "No speaker changes detected."}

    return {
        "available": True,
        "turns": len(turns),
        "avg_response_seconds": round(mean(overall), 1),
        "avg_response_minutes": round(mean(overall) / 60, 2),
        "fastest_seconds": round(min(overall), 1),
        "slowest_seconds": round(max(overall), 1),
        "per_speaker_avg_seconds": {
            spk: round(mean(vals), 1) for spk, vals in per_speaker.items()
        },
    }
