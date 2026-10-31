from app.extensions import db 
from app.error import APIError,NotFound
from app.models.cell import Cell
from app.utils.params import parser_date
from app.models.daily_features import DailyFeature
from app.ml.dummy_model import get_model,build_feature_row,risk_level

def _get_cell(cell_id):
    cell = db.session.get(Cell,cell_id)
    if cell is None:
        NotFound(f"'{cell}' not found")
    return cell

def get_cell(cell_id,date_str):
    cell = _get_cell(cell_id)
    d = parser_date(date_str)
    
    q=  DailyFeature.query.filter_by(cell_id=cell_id)
    daily= q.filter_by(date=d).first() if d else q.order_by(DailyFeature.date.desc()).first()
    
    if daily is None:
        raise NotFound(f"no features for cell '{cell_id}' on the requested date")
    
    model= get_model()
    result= model.explain(build_feature_row(cell,daily))
    
    return {
        "cell_id": cell.cell_id,
        "date": daily.date.isoformat(),
        "location": {"lat": cell.lat, "lon": cell.lon, "district": cell.district},
        "static": {"elevation": cell.elevation},
        "weather": {"temp_c": daily.temp_c, "rainfall_mm": daily.rainfall_mm,
                    "wind_speed": daily.wind_speed, "wind_dir": daily.wind_dir},
        "prediction": {**result, "level": risk_level(result["probability"]), "model_version": model.version},
     }


TIMESERIES_FEATURES = {
    "fwi": {"label": "Fire Weather Index", "unit": ""},
    "rainfall_mm": {"label": "Rainfall", "unit": "mm"},
    "temp_c": {"label": "Temperature", "unit": "°C"},
    "wind_speed": {"label": "Wind Speed", "unit": ""},
    "risk": {"label": "Predicted Fire Risk", "unit": "probability"},
}


def get_cell_timeseries(
    cell_id,
    feature,
    start_str,
    end_str
):
    if feature not in TIMESERIES_FEATURES:
        raise APIError("Invalid feature. Supported features: " + ", ".join(TIMESERIES_FEATURES))
    start ,end = parser_date(start_str,"start"),parser_date(end_str,"end")
    if start is None or end is None :
        raise APIError("start and end are required, in YYYY-MM-DD format")
    if start>end :
        raise APIError("start must be earlier than or equal to end")
    if (end - start).days > 365:
        raise APIError("Date range cannot exceed 366 calendar days")
    
    cell = _get_cell(cell_id=cell_id)
    records = (DailyFeature.query.filter(DailyFeature.cell_id == cell_id, DailyFeature.date>= start, DailyFeature.date<=end)).order_by(DailyFeature.date.asc()).all()
    
    model= get_model()
    
    points= []
    
    for record in records:
        point = {"date":record.date.isoformat(),"value":None}
        if feature =="risk":
            p = model.predict_proba(build_feature_row(cell,record))
            point["value"],point["level"]= round(float(p),4),risk_level(p)
        elif getattr(record,feature) is not None:
            point["value"] = float(getattr(record,feature))
        points.append(point)
            
    meta = TIMESERIES_FEATURES[feature]
    return {"cell_id": cell_id, "feature": feature, "label": meta["label"], "unit": meta["unit"],
            "start": start.isoformat(), "end": end.isoformat(), "count": len(points), "points": points}
            
    