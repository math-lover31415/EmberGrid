
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from flask import current_app
from pwdlib import PasswordHash

password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def make_access_token(user_id: UUID | str) -> str:
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(
            minutes=current_app.config.get("ACCESS_TOKEN_MINUTES", 15)
        ),
        "type": "access",
    }

    secret = current_app.config.get("JWT_SECRET_KEY")

    if not secret:
        raise RuntimeError(
            "JWT_SECRET_KEY is missing from Flask configuration"
        )
    return jwt.encode(
        payload,
        secret,
        algorithm=current_app.config.get("JWT_ALGORITHM", "HS256"),
    )


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(
        token,
        current_app.config["JWT_SECRET_KEY"],
        algorithms=[current_app.config.get("JWT_ALGORITHM", "HS256")],
        options={"require": ["sub", "iat", "exp", "type"]},
    )

    if payload["type"] != "access":
        raise jwt.InvalidTokenError("Not an access token")

    return payload


def new_refresh_token() -> tuple[str, str]:
    raw_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    return raw_token, token_hash


def refresh_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        days=current_app.config.get("REFRESH_TOKEN_DAYS", 7)
    )


def hash_refresh_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
