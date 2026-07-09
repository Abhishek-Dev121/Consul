"""Deepgram audio transcription."""
from app.config import settings


def transcribe(audio_bytes: bytes, content_type: str | None = None) -> dict:
    """Transcribe raw audio bytes. Returns {'transcript': str, 'duration': float|None}."""
    if not settings.deepgram_api_key:
        if settings.openai_api_key:
            import io
            from openai import OpenAI
            client = OpenAI(api_key=settings.openai_api_key)
            buffer = io.BytesIO(audio_bytes)
            # OpenAI requires a filename with an extension to detect the format
            buffer.name = "audio.mp3"
            if content_type:
                ext_map = {"audio/wav": "audio.wav", "audio/ogg": "audio.ogg", "audio/webm": "audio.webm", "video/mp4": "video.mp4"}
                if content_type in ext_map:
                    buffer.name = ext_map[content_type]
            try:
                response = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=buffer
                )
                return {"transcript": response.text, "duration": None}
            except Exception as e:
                raise RuntimeError(f"OpenAI Whisper transcription failed: {str(e)}")
        else:
            raise RuntimeError("DEEPGRAM_API_KEY is not configured and no OpenAI API Key fallback is available.")

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
