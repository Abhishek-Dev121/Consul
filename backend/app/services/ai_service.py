"""OpenAI-backed analysis for conversations, documents and call transcripts.

Each analyser returns a structured dict (summary, key_points, pending_actions,
follow_ups, sentiment, sentiment_score) that maps 1:1 onto the AIAnalysis model.
When no API key is configured they raise, so callers surface a clear error.

The prompts are written for one reader: the team member who has to act on this
next. That means owners, deadlines, decisions, blockers and open questions —
never a restatement of what was said.
"""
import json

from app.config import settings

# Hard character budget per request. Documents in particular can be far longer,
# so we keep the head and the tail rather than silently dropping the ending,
# where conclusions, signatures and deadlines usually live.
_MAX_CHARS = 24000

_SHARED_RULES = (
    "Rules:\n"
    "- Ground every statement in the supplied text. Never invent names, dates, "
    "prices or commitments. If something is unclear, say so in open_questions.\n"
    "- Write for a teammate who must act, not for a reader who wants a recap. "
    "Prefer specifics (who, what, when) over generalities.\n"
    "- Every entry in pending_actions must be imperative and, where the text "
    "supports it, name the owner and the due date, e.g. "
    '"Ravi: send the revised SOW to Acme by Fri 14 Mar".\n'
    "- If a fact is stated in the text, use its exact figure, date or name.\n"
    "- Prefix each key_point with its kind: Decision:, Requirement:, Risk:, "
    "Blocker:, Change:, or Context:.\n"
    "- Return [] for any list with nothing to report. Do not pad.\n"
    "- Respond ONLY with valid JSON. No prose outside the JSON."
)

_CONVO_SYSTEM = (
    "You analyse client communication threads for a project delivery team.\n"
    "Produce a briefing that lets a teammate pick up this client cold.\n\n"
    "Return JSON matching this schema:\n"
    "{\n"
    '  "summary": string,             // 3-5 sentences: what this thread is about, '
    "where it now stands, and what is blocking progress\n"
    '  "key_points": [string],        // decisions, requirements, constraints, commitments\n'
    '  "pending_actions": [string],   // outstanding work, owner + deadline when stated\n'
    '  "follow_ups": [string],        // who must be contacted next, about what, by when\n'
    '  "open_questions": [string],    // unresolved questions blocking the work\n'
    '  "sentiment": "positive"|"neutral"|"negative",  // the CLIENT\'s satisfaction\n'
    '  "sentiment_score": number,     // -1.0 .. 1.0\n'
    '  "risk_level": "low"|"medium"|"high"  // risk to the account or delivery\n'
    "}\n\n" + _SHARED_RULES
)

_DOC_SYSTEM = (
    "You analyse a project document (contract, specification, requirements sheet, "
    "proposal, report or shared link) for the team delivering the work.\n"
    "Extract what the team is committed to and what could hurt them. This is a "
    "DOCUMENT, not a conversation — do not describe it as a discussion.\n\n"
    "Return JSON matching this schema:\n"
    "{\n"
    '  "summary": string,             // 3-5 sentences: the document\'s purpose, scope, '
    "and its consequences for the team\n"
    '  "key_points": [string],        // scope, deliverables, obligations, dates, '
    "acceptance criteria, payment or legal terms\n"
    '  "pending_actions": [string],   // what the team must do because of this document\n'
    '  "follow_ups": [string],        // clarifications to request, approvals to chase\n'
    '  "open_questions": [string],    // ambiguities, gaps, anything underspecified\n'
    '  "sentiment": "positive"|"neutral"|"negative",  // how favourable the terms are '
    "to the team\n"
    '  "sentiment_score": number,     // -1.0 .. 1.0\n'
    '  "risk_level": "low"|"medium"|"high"  // commercial or delivery risk\n'
    "}\n\n" + _SHARED_RULES
)

_AUDIO_SYSTEM = (
    "You analyse the transcript of a client call or voice note for a project "
    "delivery team. The transcript comes from automatic speech recognition, so "
    "expect mis-heard words; infer intent, but never invent facts.\n\n"
    "Return JSON matching this schema:\n"
    "{\n"
    '  "summary": string,             // 3-5 sentences: why the call happened, what was '
    "agreed, what is outstanding\n"
    '  "key_points": [string],        // decisions, requirements, constraints, commitments\n'
    '  "pending_actions": [string],   // agreed next steps, owner + deadline when stated\n'
    '  "follow_ups": [string],        // who to contact next, about what, by when\n'
    '  "open_questions": [string],    // unresolved questions raised on the call\n'
    '  "sentiment": "positive"|"neutral"|"negative",  // the CLIENT\'s satisfaction\n'
    '  "sentiment_score": number,     // -1.0 .. 1.0\n'
    '  "risk_level": "low"|"medium"|"high",\n'
    '  "behavioral_assessment": string  // 1-3 sentences on the speakers\' tone, '
    "professionalism, engagement and any friction worth flagging\n"
    "}\n\n" + _SHARED_RULES
)


def _client():
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def _fit(text: str) -> str:
    """Keep the head and tail of an oversized input and say so, rather than
    truncating the ending where conclusions and deadlines usually sit."""
    text = text or ""
    if len(text) <= _MAX_CHARS:
        return text
    head = _MAX_CHARS * 2 // 3
    tail = _MAX_CHARS - head
    return (
        text[:head]
        + "\n\n[... middle omitted for length; the ending follows ...]\n\n"
        + text[-tail:]
    )


def _context_header(context: dict | None) -> str:
    """Client, project and date range materially change the reading of a thread."""
    if not context:
        return ""
    lines = [f"{k}: {v}" for k, v in context.items() if v]
    if not lines:
        return ""
    return "CONTEXT (background, not content to summarise):\n" + "\n".join(lines) + "\n\n"


def _chat_json(system_prompt: str, body: str, context: dict | None, label: str) -> dict:
    client = _client()
    user_content = f"{_context_header(context)}{label}:\n\n{_fit(body)}"
    resp = client.chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        temperature=0.2,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    try:
        data = json.loads(resp.choices[0].message.content)
    except (json.JSONDecodeError, TypeError):
        raise RuntimeError("The AI returned a malformed response. Try again.")
    if not isinstance(data, dict):
        raise RuntimeError("The AI returned an unexpected response shape.")
    return data


def analyze_conversation(text: str, context: dict | None = None) -> dict:
    return _normalize(_chat_json(_CONVO_SYSTEM, text, context, "CONVERSATION THREAD"))


def analyze_document(text: str, context: dict | None = None) -> dict:
    return _normalize(_chat_json(_DOC_SYSTEM, text, context, "DOCUMENT CONTENTS"))


def analyze_transcript(transcript: str, context: dict | None = None) -> dict:
    data = _chat_json(_AUDIO_SYSTEM, transcript, context, "CALL TRANSCRIPT")
    out = _normalize(data)
    ba = data.get("behavioral_assessment")
    out["behavioral_assessment"] = str(ba).strip() if ba else None
    return out


_VALID_SENTIMENT = {"positive", "neutral", "negative"}
_VALID_RISK = {"low", "medium", "high"}


def _normalize(data: dict) -> dict:
    """Defensive normalisation so the DB layer always gets the expected types."""

    def _list(v) -> list[str]:
        if v in (None, ""):
            return []
        items = v if isinstance(v, list) else [v]
        out, seen = [], set()
        for x in items:
            # `str(None)` is "None" — skip null entries before stringifying, or the
            # UI renders a literal "None" bullet.
            if x is None:
                continue
            s = str(x).strip()
            if not s or s.lower() in {"none", "null", "n/a", "-", "—"}:
                continue
            if s.lower() not in seen:            # drop duplicates
                seen.add(s.lower())
                out.append(s)
        return out

    score = data.get("sentiment_score")
    try:
        score = float(score) if score is not None else None
    except (TypeError, ValueError):
        score = None
    if score is not None:
        score = max(-1.0, min(1.0, score))       # clamp; models drift outside the range

    sentiment = str(data.get("sentiment") or "").strip().lower()
    if sentiment not in _VALID_SENTIMENT:
        sentiment = "neutral"

    risk = str(data.get("risk_level") or "").strip().lower()
    if risk not in _VALID_RISK:
        risk = None

    summary = data.get("summary")
    summary = str(summary).strip() if summary else None

    # `open_questions` and `risk_level` have no columns of their own. Fold them into
    # the fields the UI already renders rather than losing them.
    key_points = _list(data.get("key_points"))
    if risk:
        key_points.insert(0, f"Risk level: {risk}")

    follow_ups = _list(data.get("follow_ups"))
    follow_ups += [f"Open question: {q}" for q in _list(data.get("open_questions"))]

    return {
        "summary": summary,
        "key_points": key_points,
        "pending_actions": _list(data.get("pending_actions")),
        "follow_ups": follow_ups,
        "sentiment": sentiment,
        "sentiment_score": score,
        "model": settings.openai_model,
    }
