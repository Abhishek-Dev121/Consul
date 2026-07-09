import os
import sys
# Add current directory to path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from app.config import settings
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.audio import AudioRecording
from app.models.project import Project
from app.models.user import User

print("Database URL:", settings.database_url)
try:
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    with engine.connect() as conn:
        print("Successfully connected to the database!")
        
        # List tables
        result = conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))
        tables = [row[0] for row in result]
        print("Tables in public schema:", tables)
        
        for table in tables:
            try:
                cnt = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
                print(f"Table '{table}' count: {cnt}")
                
                # Print a few records if it's users or clients
                if table == "users":
                    users = conn.execute(text("SELECT id, email, name, role FROM users")).all()
                    print("Users:", users)
                elif table == "clients":
                    clients = conn.execute(text("SELECT id, name, company FROM clients")).all()
                    print("Clients (first 5):", clients[:5])
            except Exception as table_err:
                print(f"Error querying table '{table}': {table_err}")

except Exception as e:
    print("Error connecting or querying database:")
    import traceback
    traceback.print_exc()
