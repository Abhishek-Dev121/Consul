"""Deepgram audio transcription."""
from app.config import settings


def transcribe(audio_bytes: bytes, content_type: str | None = None) -> dict:
    """Transcribe raw audio bytes. Returns {'transcript': str, 'duration': float|None}."""
    if not settings.deepgram_api_key:
        raise RuntimeError("DEEPGRAM_API_KEY is not configured.")

    from deepgram import DeepgramClient, PrerecordedOptions

    dg = DeepgramClient(settings.deepgram_api_key)
    options = PrerecordedOptions(
        model="nova-2",
        smart_format=True,
        punctuate=True,
        detect_language=True,
    )
    source = {"buffer": audio_bytes, "mimetype": content_type or "audio/mpeg"}
    response = dg.listen.rest.v("1").transcribe_file(source, options)

    result = response.results
    transcript = ""
    duration = None
    try:
        transcript = result.channels[0].alternatives[0].transcript
    except (AttributeError, IndexError):
        transcript = ""
    try:
        duration = response.metadata.duration
    except AttributeError:
        duration = None
    return {"transcript": transcript, "duration": duration}
