import os
import sys
# Add current directory to path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.config import settings
from app.models.user import User
from app.routers.overview import dashboard_overview, _accessible_clients

engine = create_engine(settings.database_url, pool_pre_ping=True)
with Session(engine) as db:
    # Get the super admin user
    user = db.execute(select(User).where(User.email == "admin@devexhub.com")).scalar_one()
    print("User found:", user.email, "Role:", user.role)
    
    # Check accessible clients
    clients = _accessible_clients(db, user)
    print("Accessible clients:", [c.name for c in clients])
    
    # Run dashboard_overview simulation
    res = dashboard_overview(db, user)
    import pprint
    pprint.pprint(res)
