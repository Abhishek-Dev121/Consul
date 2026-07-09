"""Shared FastAPI dependencies for auth + DB access."""
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services.auth_service import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise credentials_exc
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        raise credentials_exc
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise credentials_exc
    return user
