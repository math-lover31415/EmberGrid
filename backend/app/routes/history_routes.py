from flask import Blueprint, jsonify, request

from app.services import history_services

history_bp = Blueprint("history", __name__)


@history_bp.get("/months")
def get_months():
    return jsonify(history_services.get_months()), 200


@history_bp.get("/grid")
def get_grid():
    return jsonify(history_services.get_grid(request.args.get("to"))), 200