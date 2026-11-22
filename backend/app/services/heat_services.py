from app.ml import LEVEL_BREAKS, get_model, risk_level
from app.error import APIError,NotFound
from app.utils.params import parser_date,parse_bbox,parse_int
from app.constants import CELL_SIZE_DEG, COORD_DECIMALS, DEFAULT_CELLS_PER_REQUEST, MAX_CELLS_PER_REQUEST
from app.models.cell import Cell
from app.models.daily_features import DailyFeature
from app.models.risk_prediction import RiskPrediction
from app.extensions import db
from sqlalchemy import func

LAYERS = {"risk", "fwi"}
FORMATS = {"geojson", "tiles"}


def _legend():
    lo, out = 0.0, []
    for name, hi in LEVEL_BREAKS:
        out.append({"level": name, "min": lo, "max": hi})
        lo = hi
    return out

def _ring(lat, lon):
    h, r = CELL_SIZE_DEG / 2, COORD_DECIMALS
    w, e, s, n = round(lon - h, r), round(lon + h, r), round(lat - h, r), round(lat + h, r)
    return [[w, s], [e, s], [e, n], [w, n], [w, s]]

def get_heatmap(date_str, bbox_str, layer,limit_str , offset_str):
    if layer not in LAYERS:
        raise APIError(f"layer must be one of {sorted(LAYERS)}")
    bbox = parse_bbox(bbox_str)
    limit= parse_int(limit_str, "limit", DEFAULT_CELLS_PER_REQUEST, 1, MAX_CELLS_PER_REQUEST)
    offset= parse_int(offset_str, "offset", 0, 0, 10**9)
    model = get_model()
    
    if layer=="risk":
        src, value_col = RiskPrediction, RiskPrediction.calibrated_prob
        filters=[RiskPrediction.model_version==model.version]
    else:
        src,value_col= DailyFeature,DailyFeature.fwi
        filters=[]  
    d = parser_date(date_str)
    if d is None:
        d = db.session.query(func.max(src.date)).filter(*filters).scalar()   
        if d is None:
            raise NotFound(f"no '{layer}' data loaded yet")
    filters.append(src.date == d)
    
    # No date returned 
    if db.session.query(src.cell_id).filter(*filters).first() is None:      
        raise NotFound(f"no '{layer}' data for {d.isoformat()}")
    
    # cell inclusion when center inside the bbox
    q = db.session.query(Cell, value_col).join(src, src.cell_id == Cell.cell_id).filter(*filters)  
    if bbox:
        min_lon, min_lat, max_lon, max_lat = bbox
        q = q.filter(Cell.lon >= min_lon, Cell.lon <= max_lon, Cell.lat >= min_lat, Cell.lat <= max_lat)
    total = q.count()
    rows = q.order_by(Cell.cell_id).offset(offset).limit(limit).all()
    next_offset = offset + len(rows) if offset + len(rows) < total else None
    
    features = [{
        "type": "Feature",
        "id": cell.cell_id,
        "geometry": {"type": "Polygon", "coordinates": [_ring(cell.lat, cell.lon)]},
        "properties": {
            "cell_id": cell.cell_id,
            "value": None if value is None else round(value, 4),
            "level": risk_level(value) if layer == "risk" and value is not None else None,
        },
    } for cell, value in rows]
    
    out = {"type": "FeatureCollection", "features": features,
           "metadata": {"date": d.isoformat(), 
                        "layer": layer,
                        "model_version": model.version if layer == "risk" else None,
                        "cell_size_deg": CELL_SIZE_DEG, 
                        "legend": _legend() if layer == "risk" else None,
                        "cell_count": len(features), 
                        "total_matching": total,
                        "offset": offset, "limit": limit, 
                        "next_offset": next_offset,
                        "truncated": next_offset is not None}}
    if rows:
        h, r = CELL_SIZE_DEG / 2, COORD_DECIMALS
        out["bbox"] = [round(min(c.lon for c, _ in rows) - h, r),
                       round(min(c.lat for c, _ in rows) - h, r),
                       round(max(c.lon for c, _ in rows) + h, r),
                       round(max(c.lat for c, _ in rows) + h, r)]
    
    return out


