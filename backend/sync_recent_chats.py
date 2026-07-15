import sys
import time
from sqlalchemy import select
from app.database import SessionLocal
from app.models.client import Client
from app.models.project import Project
from app.models.conversation import Conversation
from app.models.message import Message
from app.services import bitrix_service
from app.services.bitrix_service import call_api, _parse_iso_date

def get_or_create_conversation(db, client_id, title):
    convo_title = f"Bitrix24 Chat - {title}"
    convo = db.execute(select(Conversation).where(
        Conversation.client_id == client_id,
        Conversation.title == convo_title
    )).scalar_one_or_none()

    if not convo:
        convo = Conversation(
            client_id=client_id,
            title=convo_title,
            raw_content=f"Synced conversation stream for recent chat: {title}"
        )
        db.add(convo)
        db.flush()
    return convo

def main():
    db = SessionLocal()
    try:
        # 1. Fetch recent chats
        print("Fetching recent chats from Bitrix24...", flush=True)
        res = call_api(db, "im.recent.list")
        result_data = res.get("result") or {}
        if isinstance(result_data, dict):
            recent_chats = result_data.get("items") or []
        else:
            recent_chats = []
        print(f"Found {len(recent_chats)} recent chats.", flush=True)

        synced = 0
        from app.services.chat_service import _is_client_speaker, _name_tokens

        for chat in recent_chats:
            chat_id = chat.get("chat_id")
            dialog_id = chat.get("id") or f"chat{chat_id}"
            title = chat.get("title") or f"Chat {chat_id}"
            
            client_id = None
            group_id = None

            # 2. Map to existing Client / Project in database
            # Strategy A: Check if dialog_id indicates a Sonet Group (sg<group_id>)
            if str(dialog_id).startswith("sg"):
                group_id = str(dialog_id)[2:]
            else:
                # Resolve chat details to see if it's a Sonet Group
                try:
                    chat_data = call_api(db, "im.chat.get", {"CHAT_ID": int(chat_id)})
                    result = chat_data.get("result") or {}
                    if result.get("entity_type") == "SONET_GROUP":
                        group_id = result.get("entity_id")
                except Exception:
                    pass

            if group_id:
                # Find matching project in our DB
                project = db.execute(select(Project).where(Project.bitrix_project_id == str(group_id))).scalar_one_or_none()
                if project:
                    client_id = project.client_id
                    print(f"Mapped chat '{title}' via Project Group {group_id} to Client ID {client_id}.", flush=True)

            # Strategy B: Match by Name fallback
            if not client_id:
                client = db.execute(select(Client).where(Client.name == title)).scalar_one_or_none()
                if client:
                    client_id = client.id
                    print(f"Mapped chat '{title}' via Name Match to Client ID {client_id}.", flush=True)

            # 3. Sync Messages if client matched
            if client_id:
                try:
                    def _fetch_all_dialog_messages(params: dict):
                        all_msgs = []
                        all_users = []
                        all_files = []
                        last_id = None
                        for _ in range(100):
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

                    messages, users_list, files_list = _fetch_all_dialog_messages({"DIALOG_ID": dialog_id})
                    users_map = {str(u["id"]): f"{u.get('name', '')} {u.get('last_name', '')}".strip() for u in users_list}
                    files_map = {str(f["id"]): f for f in files_list if "id" in f}

                    client = db.get(Client, client_id)
                    client_name = client.name if client else ""
                    tokens = _name_tokens(client_name)

                    convo = get_or_create_conversation(db, client_id, title)
                    
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
                                    from app.services.bitrix_service import _download_and_save_bitrix_file
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
                    
                    db.commit()
                    print(f"Synced {new_msgs} new messages for chat '{title}'.", flush=True)
                    synced += 1
                except Exception as e:
                    print(f"Failed to sync messages for chat '{title}': {e}", flush=True)

        print(f"Done. Successfully synced {synced} matching client chats from recent list.", flush=True)

        # 4. Sync chats for all mapped projects in the database
        print("Syncing chats for all mapped projects in the database...", flush=True)
        mapped_projects = db.execute(select(Project).where(Project.bitrix_project_id != None)).scalars().all()
        print(f"Found {len(mapped_projects)} mapped projects.", flush=True)
        
        from app.services.bitrix_service import _sync_chats
        for proj in mapped_projects:
            try:
                _sync_chats(db, proj, proj.client_id)
                db.commit()
                print(f"Synced chat for project '{proj.title}' (Client ID {proj.client_id})", flush=True)
            except Exception as e:
                db.rollback()
                print(f"Failed to sync chat for project '{proj.title}': {e}", flush=True)

        print("Finished syncing all mapped project chats.", flush=True)

    finally:
        db.close()

if __name__ == "__main__":
    main()
