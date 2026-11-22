"""
POST /api/v1/auth/login
"""

import jwt
from flask import Blueprint, jsonify, request
from functools import wraps
from app.services.auth_services import (
    register,
    login,
    refresh,
    logout,
    get_user_from_access_token,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/v1/auth")

ERROR_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 409: "conflict"}


def error_response(message, status):
    return jsonify({"error": {"code": ERROR_CODES.get(status, "error"), "message": message, "details": None}}), status


def reply(body, status):
    if isinstance(body.get("error"), str):
        return error_response(body["error"], status)
    return jsonify(body), status


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")

        if scheme.lower() != "bearer" or not token:
            # return jsonify({
            #     "error": "Authentication required"
            # }), 401
            return error_response("Authentication required", 401)

        try:
            user = get_user_from_access_token(token)
        except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
            # return jsonify({
            #     "error": "Invalid or expired access token"
            # }), 401
            return error_response("Invalid or expired access token", 401)

        if user is None:
            # return jsonify({
            #     "error": "User unavailable"
            # }), 401
            return error_response("User unavailable", 401)

        return view(*args, current_user=user, **kwargs)

    return wrapped
def read_payload():
    return request.get_json(silent=True) or {}

@auth_bp.post("/login")
def login_route():
    body, status = login(read_payload())
    # return jsonify(body), status
    return reply(body, status)

@auth_bp.post("/register")
def register_route():
    body, status = register(read_payload())
    # return jsonify(body), status
    return reply(body, status)


@auth_bp.post("/refresh")
def refresh_route():
    body, status = refresh(read_payload())
    # return jsonify(body), status
    return reply(body, status)

@auth_bp.post("/logout")
def logout_route():
    body, status = logout(read_payload())
    # return jsonify(body), status
    return reply(body, status)

@auth_bp.get("/me")
@require_auth
def me(current_user):
    return jsonify({
        "id": str(current_user.id),
        "email": current_user.email,
        "is_active": current_user.is_active,
    }), 200
