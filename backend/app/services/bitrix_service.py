"""Bitrix24 local-app Webhook + OAuth client.

Flow:
  1. The app can connect via a persistent incoming webhook URL (recommended).
  2. Alternatively, it can connect via OAuth redirect callbacks.
  3. `sync_project_group` pulls metadata, tasks, members, chats, and calls for a Bitrix group.
"""
import time
import json
import secrets
from datetime import datetime, timezone
import httpx
from sqlalchemy import select, delete
from sqlalchemy.orm import Session

from app.config import settings
from app.models.bitrix import BitrixToken
from app.models.project import Project, ProjectTask, ProjectMember
from app.models.user import User, UserRole
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.audio import AudioRecording
from app.services.auth_service import hash_password

OAUTH_TOKEN_URL = "https://oauth.bitrix.info/oauth/token/"


# --------------------------------------------------------------------------- OAuth/Webhook Core

def authorize_url() -> str:
    portal = settings.bitrix_portal_url.rstrip("/")
    return (
        f"{portal}/oauth/authorize/?client_id={settings.bitrix_client_id}"
        f"&response_type=code&redirect_uri={settings.bitrix_redirect_uri}"
    )


def _store_tokens(db: Session, data: dict) -> BitrixToken:
    token = db.execute(select(BitrixToken).limit(1)).scalar_one_or_none()
    if token is None:
        token = BitrixToken(access_token="", refresh_token="")
        db.add(token)
    token.access_token = data["access_token"]
    token.refresh_token = data.get("refresh_token", token.refresh_token)
    token.portal_domain = data.get("domain") or data.get("server_endpoint")
    expires_in = int(data.get("expires_in", 3600))
    token.expires_at = int(time.time()) + expires_in
    db.flush()
    return token


def exchange_code(db: Session, code: str) -> BitrixToken:
    params = {
        "grant_type": "authorization_code",
        "client_id": settings.bitrix_client_id,
        "client_secret": settings.bitrix_client_secret,
        "code": code,
    }
    resp = httpx.get(OAUTH_TOKEN_URL, params=params, timeout=30)
    resp.raise_for_status()
    return _store_tokens(db, resp.json())


def _refresh(db: Session, token: BitrixToken) -> BitrixToken:
    params = {
        "grant_type": "refresh_token",
        "client_id": settings.bitrix_client_id,
        "client_secret": settings.bitrix_client_secret,
        "refresh_token": token.refresh_token,
    }
    resp = httpx.get(OAUTH_TOKEN_URL, params=params, timeout=30)
    resp.raise_for_status()
    return _store_tokens(db, resp.json())


def _valid_token(db: Session) -> BitrixToken:
    token = db.execute(select(BitrixToken).limit(1)).scalar_one_or_none()
    if token is None:
        raise RuntimeError("Bitrix24 is not connected. Complete the OAuth install or configure BITRIX_WEBHOOK_URL in .env")
    if token.expires_at and token.expires_at <= int(time.time()) + 60:
        token = _refresh(db, token)
    return token


def call_method(db: Session, method: str, params: dict | None = None) -> dict:
    """Invokes Bitrix24 REST API via OAuth."""
    token = _valid_token(db)
    portal = settings.bitrix_portal_url.rstrip("/")
    url = f"{portal}/rest/{method}"
    payload = dict(params or {})
    payload["auth"] = token.access_token
    resp = httpx.post(url, json=payload, timeout=60)
    if resp.status_code == 401:
        token = _refresh(db, token)
        payload["auth"] = token.access_token
        resp = httpx.post(url, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Bitrix error: {data.get('error_description', data['error'])}")
    return data


def call_api(db: Session, method: str, params: dict | None = None) -> dict:
    """Wrapper that routes calls through Webhook first (if configured), falling back to OAuth."""
    if settings.bitrix_webhook_url:
        url = settings.bitrix_webhook_url.rstrip("/") + f"/{method}.json"
        resp = httpx.post(url, json=params or {}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            # Let the caller handle insufficient scope gracefully
            if data["error"] == "insufficient_scope":
                raise PermissionError("insufficient_scope")
            raise RuntimeError(f"Bitrix webhook error: {data.get('error_description', data['error'])}")
        return data
    return call_method(db, method, params)


def is_connected(db: Session) -> bool:
    if settings.bitrix_webhook_url:
        return True
    return db.execute(select(BitrixToken).limit(1)).scalar_one_or_none() is not None


# ----------------------------------------------------------------------- Sync logic (Group focus)

# Short-lived cache for the workgroup list. It changes rarely, but the call is a
# ~2.5s paginated round-trip to Bitrix; without caching it runs on every
# projects-page load and every client-create, dominating those requests.
_GROUPS_CACHE: dict = {"data": None, "at": 0.0}
_GROUPS_TTL = 300  # seconds


def fetch_project_groups(db: Session, use_cache: bool = True) -> list[dict]:
    """Fetch all workgroups from Bitrix24 (paginated up to a limit of 500).

    Result is cached for `_GROUPS_TTL` seconds; pass use_cache=False to force a
    fresh fetch (e.g. right before a full re-sync).
    """
    if use_cache and _GROUPS_CACHE["data"] is not None and (time.time() - _GROUPS_CACHE["at"]) < _GROUPS_TTL:
        return _GROUPS_CACHE["data"]
    groups = []
    start = 0
    while True:
        try:
            res = call_api(db, "sonet_group.get", {"start": start, "ORDER": {"NAME": "ASC"}})
        except PermissionError:
            break
        result = res.get("result") or []
        groups.extend(result)
        if len(result) < 50 or len(groups) >= 500:
            break
        start += 50
    _GROUPS_CACHE["data"] = groups
    _GROUPS_CACHE["at"] = time.time()
    return groups


# Directory of Bitrix users, keyed by id. Changes rarely; the projects list needs
# it only to turn an OWNER_ID into a human name.
_USERS_CACHE: dict = {"data": None, "at": 0.0}
_USERS_TTL = 600  # seconds


def fetch_users(db: Session, use_cache: bool = True) -> dict[str, dict]:
    """Map Bitrix user id -> {name, position, photo}.

    Returns {} on any failure: a missing directory should degrade the owner
    column, never break the projects page.
    """
    if use_cache and _USERS_CACHE["data"] is not None and (time.time() - _USERS_CACHE["at"]) < _USERS_TTL:
        return _USERS_CACHE["data"]

    out: dict[str, dict] = {}
    start = 0
    try:
        while True:
            res = call_api(db, "user.get", {"start": start})
            batch = res.get("result") or []
            for u in batch:
                uid = str(u.get("ID") or "").strip()
                if not uid:
                    continue
                name = " ".join(p for p in (u.get("NAME"), u.get("LAST_NAME")) if p).strip()
                out[uid] = {
                    "name": name or (u.get("EMAIL") or f"User {uid}"),
                    "position": (u.get("WORK_POSITION") or "").strip() or None,
                    "photo": u.get("PERSONAL_PHOTO") or None,
                }
            if len(batch) < 50 or len(out) >= 1000:
                break
            start += 50
    except Exception:  # noqa: BLE001 — the owner column is not worth a 500
        return _USERS_CACHE["data"] or {}

    _USERS_CACHE["data"] = out
    _USERS_CACHE["at"] = time.time()
    return out


def sync_project_group(db: Session, client_id: int, bitrix_group_id: str) -> Project:
    """Sync a Bitrix24 Project Group (Metadata, Tasks, Members, Chats, Calls) locally."""
    # 1. Fetch group metadata
    res = call_api(db, "sonet_group.get", {"FILTER": {"ID": bitrix_group_id}})
    result = res.get("result") or []
    if not result:
        raise RuntimeError(f"Project group with ID {bitrix_group_id} not found in Bitrix24")
    g = result[0]

    proj = db.execute(
        select(Project).where(
            Project.client_id == client_id, Project.bitrix_project_id == str(bitrix_group_id)
        )
    ).scalar_one_or_none()

    if proj is None:
        proj = Project(client_id=client_id, bitrix_project_id=str(bitrix_group_id), title=g["NAME"])
        db.add(proj)

    proj.title = g["NAME"]
    proj.bitrix_group_name = g["NAME"]
    proj.description = g.get("DESCRIPTION")
    proj.member_count = int(g.get("NUMBER_OF_MEMBERS") or 0)
    proj.owner_bitrix_id = str(g.get("OWNER_ID") or "")
    proj.status = "closed" if g.get("CLOSED") == "Y" else "active"
    proj.synced_at = _now()
    db.flush()

    # Auto-create project storage folder on local disk
    import re
    from pathlib import Path
    from app.models.client import Client
    from app.services import storage_service
    client = db.get(Client, client_id)
    if client and settings.storage_backend == "local":
        c_dir = storage_service.client_dir(client)
        clean_title = re.sub(r"[^a-zA-Z0-9 _-]+", "", proj.title).strip() or "project"
        p_path = Path(settings.local_storage_dir) / c_dir / "projects" / clean_title
        p_path.mkdir(parents=True, exist_ok=True)

    # 2. Sync members and auto-create accounts
    _sync_members(db, proj)

    # 3. Sync tasks
    _sync_tasks(db, proj)

    # 4. Fetch Chat messages (via group chat or fallback to task comments)
    _sync_chats(db, proj, client_id)

    # 5. Fetch video call recordings / Drive files (if scope permits)
    _sync_recordings(db, proj, client_id)

    db.flush()
    return proj


def _sync_members(db: Session, proj: Project) -> None:
    """Fetches group members, resolves profiles, auto-creates Users, and links ProjectMembers."""
    from app.models.client import Client

    try:
        members_res = call_api(db, "sonet_group.user.get", {"ID": proj.bitrix_project_id})
    except PermissionError:
        return
    
    sonet_members = members_res.get("result") or []
    if not sonet_members:
        return

    # Map user IDs to roles
    roles_map = {str(m["USER_ID"]): m["ROLE"] for m in sonet_members}
    user_ids = list(roles_map.keys())

    # Resolve full profile details (email, names, positions)
    try:
        profiles_res = call_api(db, "user.get", {"ID": user_ids})
    except Exception:
        return
    
    profiles = profiles_res.get("result") or []
    
    # Fetch department list to resolve user departments
    try:
        dept_res = call_api(db, "department.get")
        depts = dept_res.get("result") or []
        dept_map = {str(d["ID"]): d.get("NAME") or "" for d in depts}
    except Exception:
        dept_map = {}

    # Get client to auto-assign synced members
    client = db.get(Client, proj.client_id)

    # Delete old members to refresh list
    db.execute(delete(ProjectMember).where(ProjectMember.project_id == proj.id))

    for p in profiles:
        bid = str(p["ID"])
        email = p.get("EMAIL")
        name = f"{p.get('NAME') or ''} {p.get('LAST_NAME') or ''}".strip() or email or f"User {bid}"
        work_position = p.get("WORK_POSITION")
        icon_url = p.get("PERSONAL_PHOTO")

        # Resolve department names
        dept_ids = p.get("UF_DEPARTMENT") or []
        if isinstance(dept_ids, (int, str)):
            dept_ids = [dept_ids]
        dept_names = [dept_map.get(str(did)) for did in dept_ids if str(did) in dept_map]
        department = ", ".join([d for d in dept_names if d]) or None

        # Auto-create user account if they have an email and don't exist locally
        local_user = None
        if email:
            local_user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if not local_user:
                local_user = User(
                    name=name,
                    email=email,
                    password_hash=hash_password(secrets.token_hex(16)),
                    role=UserRole.employee
                )
                db.add(local_user)
                db.flush()

            # Assign user to client
            if client and local_user not in client.assignees:
                client.assignees.append(local_user)

        role_code = roles_map.get(bid, "K")
        role_label = "owner" if role_code == "A" else "moderator" if role_code == "E" else "member"

        member = ProjectMember(
            project_id=proj.id,
            bitrix_user_id=bid,
            name=name,
            work_position=work_position,
            icon_url=icon_url,
            role=role_label,
            email=email,
            department=department
        )
        db.add(member)


def _sync_tasks(db: Session, proj: Project) -> None:
    """Pull tasks associated with this project group."""
    try:
        res = call_api(
            db,
            "tasks.task.list",
            {
                "filter": {"GROUP_ID": proj.bitrix_project_id},
                "select": [
                    "ID", "TITLE", "STATUS", "DESCRIPTION", "PRIORITY", "TIME_ESTIMATE",
                    "DEADLINE", "CLOSED_DATE", "CREATED_DATE", "RESPONSIBLE_ID", "CREATED_BY",
                    "AUDITORS", "ACCOMPLICES"
                ]
            },
        )
    except Exception:
        return

    tasks = (res.get("result") or {}).get("tasks", []) if isinstance(res.get("result"), dict) else []
    existing = {t.bitrix_task_id: t for t in proj.tasks}

    for t in tasks:
        tid = str(t["id"]) if "id" in t else str(t.get("ID"))
        row = existing.get(tid) or ProjectTask(project_id=proj.id, bitrix_task_id=tid, title="")
        
        row.title = t.get("title") or t.get("TITLE") or row.title
        row.status = str(t.get("status") or t.get("STATUS") or "")
        row.description = t.get("description") or t.get("DESCRIPTION") or ""
        row.priority = str(t.get("priority") or t.get("PRIORITY") or "1")
        row.time_estimate = int(t.get("timeEstimate") or t.get("TIME_ESTIMATE") or 0)
        
        _set_due(row, t.get("deadline") or t.get("DEADLINE"))
        _set_date_field(row, "closed_date", t.get("closedDate") or t.get("CLOSED_DATE"))
        _set_date_field(row, "created_date", t.get("createdDate") or t.get("CREATED_DATE"))

        # Resolve creator & responsible details
        c_data = t.get("creator") or {}
        r_data = t.get("responsible") or {}
        row.creator_name = c_data.get("name") or ""
        row.creator_position = c_data.get("workPosition") or ""
        row.responsible_name = r_data.get("name") or ""
        row.responsible_position = r_data.get("workPosition") or ""
        
        # Serialize auditors and accomplices
        auditors = t.get("auditorsData") or {}
        if isinstance(auditors, dict):
            row.auditors_json = json.dumps([{"name": a.get("name"), "position": a.get("workPosition")} for a in auditors.values()])
        else:
            row.auditors_json = "[]"

        accomplices = t.get("accomplicesData") or {}
        if isinstance(accomplices, dict):
            row.accomplices_json = json.dumps([a.get("name") for a in accomplices.values()])
        else:
            row.accomplices_json = "[]"

        if row.id is None:
            db.add(row)


def _sync_chats(db: Session, proj: Project, client_id: int, max_pages: int = 100, sync_comments: bool = True) -> None:
    """Sync group chat or fall back to task comments as a conversation stream."""
    convo_title = f"Bitrix24 Chat - {proj.title}"
    convo = db.execute(select(Conversation).where(
        Conversation.client_id == client_id,
        Conversation.title == convo_title
    )).scalar_one_or_none()

    if not convo:
        convo = Conversation(
            client_id=client_id,
            title=convo_title,
            raw_content=f"Synced conversation stream for project: {proj.title}"
        )
        db.add(convo)
        db.flush()

    messages_synced = False

    # Attempt 1: Fetch Group Chat directly via DIALOG_ID = sg<group_id> or via im.chat.get if permissions allow
    try:
        messages = []
        users_list = []
        files_list = []

        def _fetch_all_dialog_messages(params: dict):
            all_msgs = []
            all_users = []
            all_files = []
            last_id = None
            for _ in range(max_pages):
                req_params = dict(params)
                req_params["LIMIT"] = 50
                if last_id is not None:
                    req_params["LAST_ID"] = last_id
                res = call_api(db, "im.dialog.messages.get", req_params)
                result = res.get("result") or {}
                batch = result.get("messages") or []
                users = result.get("users") or []
                files = result.get("files") or []
                if not batch:
                    break
                
                try:
                    current_min_id = min(int(m["id"]) for m in batch)
                except Exception:
                    break
                
                if last_id is not None and current_min_id >= last_id:
                    # Prevent infinite loops if API ignores LAST_ID
                    all_msgs.extend(batch)
                    all_users.extend(users)
                    all_files.extend(files)
                    break
                
                all_msgs.extend(batch)
                all_users.extend(users)
                all_files.extend(files)
                if len(batch) < 50:
                    break
                last_id = current_min_id
            return all_msgs, all_users, all_files

        try:
            # 1a. Try direct fetch using DIALOG_ID = sg<group_id> (e.g. sg620)
            messages, users_list, files_list = _fetch_all_dialog_messages({"DIALOG_ID": f"sg{proj.bitrix_project_id}"})
        except Exception:
            # 1b. Fallback: Fetch Chat ID first via im.chat.get, then query messages
            chat_res = call_api(db, "im.chat.get", {"ENTITY_TYPE": "SONET_GROUP", "ENTITY_ID": proj.bitrix_project_id})
            chat_id = chat_res.get("result", {}).get("id")
            if chat_id:
                messages, users_list, files_list = _fetch_all_dialog_messages({"CHAT_ID": chat_id})

        if messages:
            from app.services.chat_service import _is_client_speaker, _name_tokens
            from app.models.client import Client
            client = db.get(Client, client_id)
            client_name = client.name if client else ""
            tokens = _name_tokens(client_name)

            users_map = {str(u["id"]): f"{u.get('name', '')} {u.get('last_name', '')}".strip() for u in users_list}
            files_map = {str(f["id"]): f for f in files_list if "id" in f}
            new_msgs = 0
            for m in messages:
                mid = f"chat_{m['id']}"
                
                # Check if message already exists in DB
                exists = db.execute(select(Message).where(Message.bitrix_message_id == mid)).scalar_one_or_none()
                
                # Only download file if it's a new message or has an external/un-synced attachment URL
                need_download = False
                if not exists:
                    need_download = True
                elif exists and (not exists.attachment_url or exists.attachment_url.startswith("http")):
                    need_download = True
                
                attachment_type = None
                attachment_url = None
                attachment_name = None
                
                # Check for files
                params = m.get("params") or {}
                file_ids = params.get("FILE_ID") or []
                if isinstance(file_ids, (str, int)):
                    file_ids = [file_ids]
                
                if file_ids:
                    fid = str(file_ids[0])
                    if fid in files_map:
                        f_info = files_map[fid]
                        attachment_name = f_info.get("name")
                        
                        if need_download:
                            dialog_id = f"sg{proj.bitrix_project_id}"
                            local_url, att_type = _download_and_save_bitrix_file(
                                db, client_id, dialog_id, int(fid), attachment_name, f_info.get("type")
                            )
                            if local_url:
                                attachment_url = local_url
                                attachment_type = att_type
                            else:
                                attachment_url = f_info.get("urlDownload") or f_info.get("urlShow")
                                is_audio = (
                                    f_info.get("type") == "audio"
                                    or f_info.get("isVoiceNote")
                                    or str(attachment_name).lower().endswith((".mp3", ".wav", ".m4a", ".ogg", ".oga"))
                                )
                                attachment_type = "audio" if is_audio else "file"
                        elif exists:
                            attachment_url = exists.attachment_url
                            attachment_type = exists.attachment_type
                            attachment_name = exists.attachment_name

                if not exists:
                    author_id = str(m.get("author_id", ""))
                    sender = users_map.get(author_id, "User " + author_id)
                    is_client = _is_client_speaker(sender, tokens)
                    db.add(Message(
                        client_id=client_id,
                        conversation_id=convo.id,
                        sender_name=sender,
                        body=m.get("text") or "",
                        is_client=is_client,
                        bitrix_message_id=mid,
                        sent_at=_parse_iso_date(m.get("date")),
                        attachment_type=attachment_type,
                        attachment_url=attachment_url,
                        attachment_name=attachment_name
                    ))
                    new_msgs += 1
                elif exists and need_download and attachment_url:
                    exists.attachment_type = attachment_type
                    exists.attachment_url = attachment_url
                    exists.attachment_name = attachment_name
                    
            if new_msgs > 0:
                from app.services.ws_manager import notify as ws_notify
                ws_notify({"type": "message", "client_id": client_id, "action": "new"})
            messages_synced = True
    except Exception:
        pass  # Gracefully fall back to task comments if scope lacks 'im' or returns 401

    # Attempt 2: Fallback to Task Comments (always supported under tasks scope)
    if not messages_synced and sync_comments:
        new_msgs = 0
        for t in proj.tasks:
            try:
                comments_res = call_api(db, "task.commentitem.getlist", {"taskId": t.bitrix_task_id})
                comments = comments_res.get("result") or []
                for c in comments:
                    cid = f"comment_{c['ID']}"
                    exists = db.execute(select(Message).where(Message.bitrix_message_id == cid)).first()
                    if not exists:
                        db.add(Message(
                            client_id=client_id,
                            conversation_id=convo.id,
                            sender_name=c.get("AUTHOR_NAME") or "Staff",
                            body=f"[{t.title}] {c.get('POST_MESSAGE') or ''}",
                            is_client=False,
                            bitrix_message_id=cid,
                            sent_at=_parse_comment_date(c.get("POST_DATE"))
                        ))
                        new_msgs += 1
            except Exception:
                continue
        if new_msgs > 0:
            from app.services.ws_manager import notify as ws_notify
            ws_notify({"type": "message", "client_id": client_id, "action": "new"})


def _sync_recordings(db: Session, proj: Project, client_id: int) -> None:
    """Finds audio files inside the project drive folder if permissions allow."""
    try:
        folder_res = call_api(db, "disk.group.getfolder", {"groupId": proj.bitrix_project_id})
        folder_id = folder_res.get("result", {}).get("ID")
        if folder_id:
            children_res = call_api(db, "disk.folder.getchildren", {"id": folder_id})
            files = children_res.get("result") or []
            for f in files:
                # Check for audio / video types
                is_media = "audio" in str(f.get("CONTENT_TYPE", "")).lower() or "video" in str(f.get("CONTENT_TYPE", "")).lower()
                is_media = is_media or str(f.get("NAME", "")).endswith((".mp3", ".wav", ".mp4", ".m4a"))
                
                if is_media:
                    fid = f"drive_{f['ID']}"
                    exists = db.execute(select(AudioRecording).where(AudioRecording.storage_key == fid)).first()
                    if not exists:
                        db.add(AudioRecording(
                            client_id=client_id,
                            filename=f.get("NAME") or "Call Recording",
                            storage_key=fid,
                            content_type=f.get("CONTENT_TYPE") or "audio/mpeg",
                            duration=0.0
                        ))
    except Exception:
        pass  # Gracefully skip if scope lacks 'disk' or returns 401


def _set_due(obj, raw):
    if not raw:
        return
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            obj.due_date = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            return
        except (ValueError, TypeError):
            continue


def _set_date_field(obj, attr, raw):
    if not raw:
        return
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            val = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            setattr(obj, attr, val)
            return
        except (ValueError, TypeError):
            continue


def _parse_comment_date(raw):
    if not raw:
        return _now()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    return _now()


def _parse_iso_date(raw):
    if not raw:
        return _now()
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc)
    except ValueError:
        return _now()


def _now():
    return datetime.now(timezone.utc)


def _download_and_save_bitrix_file(db: Session, client_id: int, dialog_id: str, file_id: int, filename: str, file_type: str) -> tuple[str, str]:
    """Downloads a file from Bitrix using the webhook, saves it locally, and creates a database record.
    Returns a tuple of (local_attachment_url, attachment_type).
    """
    import httpx
    from app.services import storage_service
    from app.models.file import FileRecord
    from app.models.audio import AudioRecording
    
    try:
        # 1. Call im.v2.File.download to get the authenticated download url
        res = call_api(db, "im.v2.File.download", {"dialogId": dialog_id, "fileId": file_id})
        download_url = res.get("result", {}).get("downloadUrl")
        if not download_url:
            return None, None
            
        # 2. Download file content with 25MB size limit
        max_size = 25 * 1024 * 1024  # 25 MB
        with httpx.stream("GET", download_url, timeout=60) as r:
            if r.status_code != 200:
                return None, None
            
            cl_header = r.headers.get("Content-Length")
            if cl_header:
                try:
                    if int(cl_header) > max_size:
                        print(f"Skipping download of Bitrix file {file_id}: size {cl_header} bytes exceeds 25MB limit", flush=True)
                        return None, None
                except ValueError:
                    pass
            
            content_bytes = bytearray()
            for chunk in r.iter_bytes(chunk_size=8192):
                content_bytes.extend(chunk)
                if len(content_bytes) > max_size:
                    print(f"Skipping download of Bitrix file {file_id}: downloaded data exceeds 25MB limit", flush=True)
                    return None, None
            content = bytes(content_bytes)
        
        # 3. Determine if it's audio or general file
        is_audio = (
            file_type == "audio"
            or str(filename).lower().endswith((".mp3", ".wav", ".m4a", ".ogg", ".oga"))
        )
        prefix = "audio" if is_audio else "files"
        
        # 4. Save file to storage
        storage_key = storage_service.save_bytes(content, filename, prefix=prefix)
        ctype = storage_service.guess_content_type(filename)
        
        # 5. Create database record
        if is_audio:
            exists = db.execute(select(AudioRecording).where(AudioRecording.storage_key == storage_key)).scalars().first()
            if not exists:
                rec = AudioRecording(
                    client_id=client_id,
                    filename=filename,
                    storage_key=storage_key,
                    content_type=ctype,
                    duration=0.0,
                    size=len(content),
                    data=content
                )
                db.add(rec)
                db.flush()
                audio_id = rec.id
            else:
                audio_id = exists.id
            local_url = f"/api/audio/{audio_id}/download"
            att_type = "audio"
        else:
            exists = db.execute(select(FileRecord).where(FileRecord.storage_key == storage_key)).scalars().first()
            if not exists:
                rec = FileRecord(
                    client_id=client_id,
                    filename=filename,
                    storage_key=storage_key,
                    content_type=ctype,
                    size=len(content),
                    data=content
                )
                db.add(rec)
                db.flush()
                file_id_db = rec.id
            else:
                file_id_db = exists.id
            local_url = f"/api/files/{file_id_db}/download"
            att_type = "file"
            
        return local_url, att_type
    except Exception as e:
        print(f"Failed to download and save Bitrix file {file_id}: {e}", flush=True)
        return None, None
