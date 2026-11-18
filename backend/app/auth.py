import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User

SECRET = os.getenv("SECRET_KEY")
if not SECRET:
    if os.getenv("ENV") == "production":
        raise RuntimeError("SECRET_KEY must be set")
    SECRET = "dev-only-secret-change-me-before-deploying"
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_pw(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode()[:72], hashed.encode())


def make_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({"sub": str(user_id), "exp": exp}, SECRET, algorithm="HS256")


def user_from_token(token: str, db: Session) -> User:
    try:
        uid = int(jwt.decode(token, SECRET, algorithms=["HS256"])["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Your session expired. Please sign in again.")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "Account not found")
    return user


def current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    return user_from_token(token, db)