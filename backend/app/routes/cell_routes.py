from flask import Blueprint, jsonify, request

from app.services import cell_services

cell_bp = Blueprint("cells",__name___)

@cell_bp.get("/<cell_id>")
def get_cell(cell_id):
    result = cell_services.get_cell(
        cell_id,
        request.args.get("date"),
    )
    return jsonify(result),200



