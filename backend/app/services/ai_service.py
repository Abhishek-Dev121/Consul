"""OpenAI-backed analysis for conversations, documents and call transcripts.

Each analyser returns a structured dict (summary, key_points, pending_actions,
follow_ups, sentiment, sentiment_score) that maps 1:1 onto the AIAnalysis model.
When no API key is configured they raise, so callers surface a clear error.

The prompts are written for one reader: the team member who has to act on this
next. That means owners, deadlines, decisions, blockers and open questions —
never a restatement of what was said.
"""
import json

from app.database import SessionLocal
from app.services import ai_defaults, settings_service

# Hard character budget per request. Documents in particular can be far longer,
# so we keep the head and the tail rather than silently dropping the ending,
# where conclusions, signatures and deadlines usually live.
_MAX_CHARS = 24000

def _ai_config(kind: str) -> tuple[str, str, str]:
    """Read the live AI settings (prompt for `kind`, model, api key) from the DB,
    falling back to env/built-in defaults. Read fresh each call so edits made in
    the Integrations page take effect immediately, without a restart."""
    with SessionLocal() as db:
        return (
            settings_service.ai_prompt(db, kind),
            settings_service.ai_model(db),
            settings_service.ai_api_key(db),
        )


def _client(api_key: str):
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    from openai import OpenAI

    return OpenAI(api_key=api_key)


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


def _chat_json(system_prompt: str, body: str, context: dict | None, label: str, model: str, api_key: str) -> dict:
    client = _client(api_key)
    user_content = f"{_context_header(context)}{label}:\n\n{_fit(body)}"
    resp = client.chat.completions.create(
        model=model,
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
    prompt, model, api_key = _ai_config("conversation")
    return _normalize(_chat_json(prompt, text, context, "CONVERSATION THREAD", model, api_key), model)


def analyze_document(text: str, context: dict | None = None) -> dict:
    prompt, model, api_key = _ai_config("document")
    return _normalize(_chat_json(prompt, text, context, "DOCUMENT CONTENTS", model, api_key), model)


def analyze_transcript(transcript: str, context: dict | None = None) -> dict:
    prompt, model, api_key = _ai_config("audio")
    data = _chat_json(prompt, transcript, context, "CALL TRANSCRIPT", model, api_key)
    out = _normalize(data, model)
    ba = data.get("behavioral_assessment")
    out["behavioral_assessment"] = str(ba).strip() if ba else None
    return out


_ASSISTANT_SYSTEM = (
    "You are Consul's AI assistant, helping an internal team member understand ONE "
    "specific client. You can answer questions about that client's conversations, their "
    "linked projects, and the tasks under those projects — including task status, owners, "
    "due dates and updates.\n\n"
    "Rules:\n"
    "- Use ONLY the CLIENT CONTEXT provided. If the answer isn't in it, say you don't have "
    "that information for this client rather than guessing.\n"
    "- Be concise and specific. Use short bullet points when listing tasks or actions.\n"
    "- Include owners and dates when they are known.\n"
    "- You are talking to internal staff, not the client."
)


def chat_assistant(question: str, context: str, history: list[dict] | None = None) -> str:
    """Conversational Q&A over a single client's context (conversations + projects/
    tasks). Returns a plain-text answer. Separate from the JSON analysis path."""
    with SessionLocal() as db:
        model = settings_service.ai_model(db)
        api_key = settings_service.ai_api_key(db)
    client = _client(api_key)

    messages = [
        {"role": "system", "content": _ASSISTANT_SYSTEM},
        {"role": "system", "content": "CLIENT CONTEXT:\n\n" + _fit(context)},
    ]
    # Keep only the last few turns to bound token cost.
    for h in (history or [])[-8:]:
        role = "assistant" if (h.get("role") == "assistant") else "user"
        content = str(h.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content[:2000]})
    messages.append({"role": "user", "content": question.strip()[:2000]})

    resp = client.chat.completions.create(model=model, temperature=0.3, messages=messages)
    answer = (resp.choices[0].message.content or "").strip()
    if not answer:
        raise RuntimeError("The AI returned an empty response. Try again.")
    return answer


_VALID_SENTIMENT = {"positive", "neutral", "negative"}
_VALID_RISK = {"low", "medium", "high"}


def _normalize(data: dict, model: str) -> dict:
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
        "model": model,
    }
