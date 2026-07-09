import sys
import os
from sqlalchemy import create_engine, insert, text
from sqlalchemy.orm import Session

# Import models to register them on Base.metadata
sys.path.append("backend")
from app.database import Base
from app.models.user import User
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.audio import AudioRecording
from app.models.file import FileRecord
from app.models.project import Project
from app.models.channel import Channel
from app.models.activity import Activity
from app.models.ai_analysis import AIAnalysis

src_url = "postgresql+psycopg2://postgres:postgres@127.0.0.1:5433/comm_agent"
dest_url = "postgresql+psycopg2://neondb_owner:npg_xL3dj5gmAnsI@ep-super-heart-at950jsl.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"

src_engine = create_engine(src_url)
dest_engine = create_engine(dest_url)

print("Creating tables in destination Neon DB...")
Base.metadata.create_all(dest_engine)

print("Starting migration...")

with Session(src_engine) as src_session, Session(dest_engine) as dest_session:
    # Disable foreign keys temporarily if needed or copy in correct order
    for table in Base.metadata.sorted_tables:
        print(f"Migrating table: {table.name}...")
        
        # Read all rows from source
        rows = src_session.execute(table.select()).all()
        if not rows:
            print(f"  No rows to migrate for {table.name}")
            continue
            
        print(f"  Found {len(rows)} rows. Inserting into destination...")
        
        # Insert into destination
        for row in rows:
            row_dict = row._asdict()
            dest_session.execute(insert(table).values(**row_dict))
            
    print("Committing changes...")
    dest_session.commit()
    
    # Reset sequences for all tables with an 'id' column
    print("Resetting sequences in Neon database...")
    for table in Base.metadata.sorted_tables:
        if 'id' in table.columns:
            seq_res = dest_session.execute(
                text(f"SELECT pg_get_serial_sequence('{table.name}', 'id')")
            ).scalar()
            if seq_res:
                print(f"  Resetting sequence {seq_res} for table {table.name}...")
                dest_session.execute(
                    text(f"SELECT setval('{seq_res}', COALESCE((SELECT MAX(id) FROM {table.name}), 1), COALESCE((SELECT MAX(id) FROM {table.name}) IS NOT NULL, false))")
                )
    
    dest_session.commit()
    
print("Migration completed successfully!")
