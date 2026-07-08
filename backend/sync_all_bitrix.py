"""One-off script: create a Client per Bitrix24 project group and sync it in full.

Run manually from backend/ with the venv active:
    .venv/Scripts/python.exe sync_all_bitrix.py
"""
import sys
import time

from sqlalchemy import select

from app.database import SessionLocal
from app.models.client import Client
from app.models.user import User, UserRole
from app.services import bitrix_service

RATE_LIMIT_SLEEP = 0.6  # seconds between groups, to stay under Bitrix webhook rate limits


def get_or_create_actor(db):
    actor = db.execute(select(User).where(User.role == UserRole.super_admin)).scalars().first()
    if not actor:
        raise RuntimeError("No super admin user found to attribute the sync to")
    return actor


def main():
    db = SessionLocal()
    actor = get_or_create_actor(db)

    groups = bitrix_service.fetch_project_groups(db)
    total = len(groups)
    print(f"Fetched {total} Bitrix24 project groups", flush=True)

    ok, failed = 0, 0
    for i, g in enumerate(groups, start=1):
        gid = str(g["ID"])
        name = g.get("NAME") or f"Bitrix Group {gid}"
        try:
            client = db.execute(select(Client).where(Client.name == name)).scalar_one_or_none()
            if client is None:
                client = Client(name=name, status="active", created_by=actor.id)
                client.assignees.append(actor)
                db.add(client)
                db.flush()

            bitrix_service.sync_project_group(db, client.id, gid)
            db.commit()
            ok += 1
            print(f"[{i}/{total}] OK   client={client.id} group={gid} name={name!r}", flush=True)
        except Exception as e:  # noqa: BLE001 - keep going across 288 groups
            db.rollback()
            failed += 1
            print(f"[{i}/{total}] FAIL group={gid} name={name!r} error={e}", flush=True)

        time.sleep(RATE_LIMIT_SLEEP)

    print(f"Done. ok={ok} failed={failed} total={total}", flush=True)
    db.close()


if __name__ == "__main__":
    sys.exit(main())
