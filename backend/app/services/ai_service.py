"""OpenAI-backed analysis for conversations and audio transcripts.

`analyze_conversation` returns a structured dict (summary, key_points,
pending_actions, follow_ups, sentiment, sentiment_score). When no API key is
configured it raises, so callers surface a clear error to the UI.
"""
import json

from app.config import settings

_CONVO_SYSTEM = (
    "You are an assistant that analyses client communication transcripts for a "
    "project-management team. Respond ONLY with valid JSON matching this schema:\n"
    "{\n"
    '  "summary": string,                # 2-4 sentence overview\n'
    '  "key_points": [string],           # main discussion points\n'
    '  "pending_actions": [string],      # outstanding action items / tasks\n'
    '  "follow_ups": [string],           # follow-up requirements / next contacts\n'
    '  "sentiment": "positive"|"neutral"|"negative",\n'
    '  "sentiment_score": number         # -1.0 (very negative) .. 1.0 (very positive)\n'
    "}"
)

_AUDIO_SYSTEM = (
    "You are an assistant that analyses a transcript of a client call/voice note. "
    "Respond ONLY with valid JSON matching this schema:\n"
    "{\n"
    '  "summary": string,\n'
    '  "key_points": [string],\n'
    '  "pending_actions": [string],\n'
    '  "follow_ups": [string],\n'
    '  "sentiment": "positive"|"neutral"|"negative",\n'
    '  "sentiment_score": number,\n'
    '  "behavioral_assessment": string   # tone, professionalism, engagement, concerns\n'
    "}"
)


def _client():
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    from openai import OpenAI

    return OpenAI(api_key=settings.openai_api_key)


def _chat_json(system_prompt: str, user_content: str) -> dict:
    client = _client()
    resp = client.chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        temperature=0.2,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    return json.loads(resp.choices[0].message.content)


def analyze_conversation(text: str) -> dict:
    data = _chat_json(_CONVO_SYSTEM, text[:24000])
    return _normalize(data)


def analyze_transcript(transcript: str) -> dict:
    data = _chat_json(_AUDIO_SYSTEM, transcript[:24000])
    out = _normalize(data)
    out["behavioral_assessment"] = data.get("behavioral_assessment")
    return out


def _normalize(data: dict) -> dict:
    """Defensive normalisation so the DB layer always gets the expected types."""
    def _list(v):
        if isinstance(v, list):
            return [str(x) for x in v]
        if v in (None, ""):
            return []
        return [str(v)]

    score = data.get("sentiment_score")
    try:
        score = float(score) if score is not None else None
    except (TypeError, ValueError):
        score = None

    return {
        "summary": data.get("summary"),
        "key_points": _list(data.get("key_points")),
        "pending_actions": _list(data.get("pending_actions")),
        "follow_ups": _list(data.get("follow_ups")),
        "sentiment": data.get("sentiment"),
        "sentiment_score": score,
        "model": settings.openai_model,
    }
