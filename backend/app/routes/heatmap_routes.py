from flask import Blueprint, jsonify, request
from app.services.heat_services import get_heatmap
from app.services import heatmap_services

heatmap_bp = Blueprint("heatmap", __name__)


@heatmap_bp.get("")
def get_heatmap():
    a = request.args
    result = heatmap_services.get_heatmap(
        a.get("date"),
        a.get("bbox"),
        a.get("layer","risk"),
        a.get("format","geojson"),
        a.get("limit"),
        a.get("offset"))
    return jsonify(result),200