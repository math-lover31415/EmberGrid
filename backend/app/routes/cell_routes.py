from flask import Blueprint, jsonify, request

from app.services import cell_services

cell_bp = Blueprint("cells",__name__)

@cell_bp.get("/<cell_id>")
def get_cell(cell_id):
    result = cell_services.get_cell(
        cell_id,
        request.args.get("date"),
    )
    return jsonify(result),200

@cell_bp.get("/<cell_id>/timeseries")
def get_cell_timeseries(cell_id):
    result= cell_services.get_cell_timeseries(
        cell_id= cell_id,
        feature=request.args.get("feature"),
        start_str=request.args.get("start"),
        end_str=request.args.get("end")
    )
    return jsonify(result),200

