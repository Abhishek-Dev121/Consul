"""File storage abstraction: local disk by default, S3 when configured.

Returns/accepts opaque `storage_key` strings. The local backend stores files under
`settings.local_storage_dir`; the S3 backend uses the configured bucket.
"""
import os
import re
from pathlib import Path

from app.config import settings


def client_dir(client) -> str:
    """Per-client storage folder, e.g. 'clients/Acme Global'. Files and audio
    for a client live under here so each client's uploads are grouped together."""
    name = getattr(client, "name", "") or "client"
    # Keep spaces, alphanumeric, hyphens, underscores
    clean_name = re.sub(r"[^a-zA-Z0-9 _-]+", "", name).strip() or "client"
    return f"clients/{clean_name}"


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
    else:
        while True:
            dest = Path(settings.local_storage_dir) / key
            if not dest.exists():
                break
            key = f"{prefix}/{stem}_{counter}{ext}"
            counter += 1
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return key


def read_bytes(key: str) -> bytes:
    if settings.storage_backend == "s3":
        obj = _s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
        return obj["Body"].read()
    return (Path(settings.local_storage_dir) / key).read_bytes()


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


def range_response(request, data: bytes, content_type: str, filename: str, inline: bool = False):
    from fastapi.responses import Response
    
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename=\"{filename}\"",
    }
    
    range_header = request.headers.get("Range")
    if not range_header:
        return Response(
            content=data,
            status_code=200,
            media_type=content_type,
            headers=headers
        )
        
    match = re.match(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return Response(status_code=400, content="Invalid Range Header")
        
    start_str, end_str = match.groups()
    file_size = len(data)
    
    start = int(start_str)
    end = int(end_str) if end_str else file_size - 1
    
    if start >= file_size or end >= file_size or start > end:
        return Response(
            status_code=416,
            content="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"}
        )
        
    chunk = data[start : end + 1]
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(len(chunk))
    
    return Response(
        content=chunk,
        status_code=206,
        media_type=content_type,
        headers=headers
    )

