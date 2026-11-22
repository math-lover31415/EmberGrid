
from datetime import datetime, timezone
from uuid import UUID

import jwt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.extensions import db
from app.models.user import User, RefreshSession
from app.services.security import (
    hash_password,
    verify_password,
    make_access_token,
    new_refresh_token,
    hash_refresh_token,
    refresh_expiry,
)


def register(payload):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password")

    if not email or not isinstance(password, str) or not password:
        return {"error": "Email and password are required"}, 400

    if len(password) > 1024:
        return {"error": "Password is too long"}, 400

    existing = db.session.scalar(
        select(User).where(User.email == email)
    )
    if existing:
        return {"error": "Unable to register with this email"}, 409

    user = User(
        email=email,
        password_hash=hash_password(password),
    )

    try:
        db.session.add(user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return {"error": "Unable to register with this email"}, 409

    return {
        "id": str(user.id),
        "email": user.email,
        "status": "registered",
    }, 201


def login(payload):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password")

    if not email or not isinstance(password, str) or not password:
        return {"error": "Email and password are required"}, 400

    user = db.session.scalar(
        select(User).where(User.email == email)
    )

    if (
        user is None
        or not verify_password(password, user.password_hash)
    ):
        return {"error": "Invalid email or password"}, 401

    if not user.is_active:
        return {"error": "Account is inactive"}, 403

    raw_refresh, stored_hash = new_refresh_token()

    session = RefreshSession(
        user_id=user.id,
        token_hash=stored_hash,
        expires_at=refresh_expiry(),
    )

    try:
        db.session.add(session)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    print(type(user.id))
    return {
        "access_token": make_access_token(user.id),
        "refresh_token": raw_refresh,
        "token_type": "Bearer",
        "expires_in": 900,
    }, 200


def refresh(payload):
    raw_token = payload.get("refresh_token")

    if not isinstance(raw_token, str) or not raw_token:
        return {"error": "Refresh token is required"}, 400

    token_hash = hash_refresh_token(raw_token)

    session = db.session.scalar(
    select(RefreshSession)
    .where(RefreshSession.token_hash == token_hash)
    .with_for_update()
)
    if session is None or session.revoked:
        return {"error": "Invalid refresh token"}, 401

    now = datetime.now(timezone.utc)
    expiry = session.expires_at

   
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry <= now:
        session.revoked = True
        db.session.commit()
        return {"error": "Refresh token has expired"}, 401

    user = db.session.get(User, session.user_id)

    if user is None or not user.is_active:
        session.revoked = True
        db.session.commit()
        return {"error": "Account is unavailable"}, 401

    # Rotating the refresh token
    session.revoked = True

    new_raw, new_hash = new_refresh_token()
    replacement = RefreshSession(
        user_id=user.id,
        token_hash=new_hash,
        expires_at=refresh_expiry(),
    )

    try:
        db.session.add(replacement)
        access_token = make_access_token(user.id)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    return {
        "access_token": access_token,
        "refresh_token": new_raw,
        "token_type": "Bearer",
        "expires_in": 900,
    }, 200


def logout(payload):
    raw_token = payload.get("refresh_token")

    if not isinstance(raw_token, str) or not raw_token:
        return {"error": "Refresh token is required"}, 400

    session = db.session.scalar(
        select(RefreshSession).where(
            RefreshSession.token_hash == hash_refresh_token(raw_token)
        )
    )

    if session is None or session.revoked:
        return {"status": "logged out"}, 200

    session.revoked = True
    db.session.commit()

    return {"status": "logged out"}, 200


def get_user_from_access_token(token):
    from app.services.security import decode_access_token

    claims = decode_access_token(token)
    user_id = UUID(claims["sub"])
    user = db.session.get(User, user_id)

    if user is None or not user.is_active:
        return None

    return user
