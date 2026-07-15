"""File storage abstraction: local disk by default, S3 when configured.

Returns/accepts opaque `storage_key` strings. The local backend stores files under
`settings.local_storage_dir`; the S3 backend uses the configured bucket.
"""
import mimetypes
import os
import re
from pathlib import Path

from app.config import settings


def guess_content_type(filename: str, provided: str | None = None) -> str:
    """Resolve a media MIME type. Browsers sometimes omit content_type on upload
    (curl, drag-drop, share sheets), which would serve a video as audio or an
    image as octet-stream and break inline playback/preview. Fall back to the
    filename extension."""
    if provided and provided != "application/octet-stream":
        return provided
    return mimetypes.guess_type(filename or "")[0] or provided or "application/octet-stream"


def client_dir(client) -> str:
    """Per-client storage folder, e.g. 'clients/Acme Global'. Files and audio
    for a client live under here so each client's uploads are grouped together."""
    name = getattr(client, "name", "") or "client"
    # Keep spaces, alphanumeric, hyphens, underscores
    clean_name = re.sub(r"[^a-zA-Z0-9 _-]+", "", name).strip() or "client"
    return f"clients/{clean_name}"


def new_key(filename: str, prefix: str = "files") -> str:
    """A unique storage key WITHOUT writing anything — used when the bytes are
    stored in the DB instead of on disk. Retrieval is by row id, so the key is
    just a stable, human-readable reference."""
    import uuid
    path = Path(filename)
    stem = re.sub(r"[^a-zA-Z0-9 _-]+", "_", path.stem).strip() or "file"
    return f"{prefix}/{stem}-{uuid.uuid4().hex[:8]}{path.suffix.lower()}"


def save_bytes(data: bytes, filename: str, prefix: str = "files") -> str:
    # Clean the stem to prevent directory traversal or bad chars
    path = Path(filename)
    stem = re.sub(r"[^a-zA-Z0-9 _-]+", "_", path.stem).strip() or "file"
    ext = path.suffix.lower()
    
    base_key = f"{prefix}/{stem}{ext}"
    key = base_key
    counter = 1
    
    if settings.storage_backend == "s3":
        s3 = _s3_client()
        while True:
            try:
                s3.head_object(Bucket=settings.s3_bucket, Key=key)
                key = f"{prefix}/{stem}_{counter}{ext}"
                counter += 1
            except Exception:
                break
        s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=data)
    elif settings.storage_backend == "local":
        while True:
            dest = Path(settings.local_storage_dir) / key
            if not dest.exists():
                break
            key = f"{prefix}/{stem}_{counter}{ext}"
            counter += 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    # If backend is "db", we just generate and return the unique key. The caller 
    # is responsible for actually persisting `data` to the Postgres database.
    return key


class StoredFileMissing(FileNotFoundError):
    """The DB row exists but the underlying bytes are gone (e.g. a region migration
    that copied the database but not the local uploads)."""


def read_bytes(key: str) -> bytes:
    if settings.storage_backend == "s3":
        try:
            obj = _s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
        except _s3_client().exceptions.NoSuchKey as e:
            raise StoredFileMissing(key) from e
        return obj["Body"].read()
    path = Path(settings.local_storage_dir) / key
    if not path.is_file():
        # Surface a typed error so the router can answer 404, not an opaque 500.
        raise StoredFileMissing(key)
    return path.read_bytes()


def local_path(key: str) -> str | None:
    """Return an on-disk path for the key when using local storage (else None)."""
    if settings.storage_backend == "s3":
        return None
    return str(Path(settings.local_storage_dir) / key)


def _s3_client():
    import boto3

    return boto3.client(
        "s3",
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


# Ensure local storage dir exists at import time for the default backend.
if settings.storage_backend == "local":
    os.makedirs(settings.local_storage_dir, exist_ok=True)


def _content_disposition(filename: str, inline: bool) -> str:
    """Build a Content-Disposition header that survives non-ASCII filenames.

    Starlette encodes headers as latin-1, so a raw Arabic/emoji/accented filename
    raises UnicodeEncodeError and 500s the whole response. Provide an ASCII-safe
    fallback plus an RFC 5987 filename* for modern browsers.
    """
    from urllib.parse import quote

    disp = "inline" if inline else "attachment"
    ascii_name = (filename or "file").encode("ascii", "ignore").decode().replace('"', "") or "file"
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename or 'file')}"


def range_response(request, data: bytes, content_type: str, filename: str, inline: bool = False):
    from fastapi.responses import Response

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": _content_disposition(filename, inline),
    }

    range_header = request.headers.get("Range")
    if not range_header:
        return Response(content=data, status_code=200, media_type=content_type, headers=headers)

    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(status_code=400, content="Invalid Range Header")

    start_str, end_str = match.groups()
    file_size = len(data)

    start = int(start_str)
    # Clamp the end to the last byte per RFC 7233 (Safari/some players request past EOF).
    end = int(end_str) if end_str else file_size - 1
    end = min(end, file_size - 1)

    # Only unsatisfiable when the start is past the end of the file.
    if start >= file_size or start > end:
        return Response(
            status_code=416,
            content="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    chunk = data[start : end + 1]
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(len(chunk))

    return Response(content=chunk, status_code=206, media_type=content_type, headers=headers)

