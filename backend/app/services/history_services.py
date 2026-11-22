
from datetime import date

from sqlalchemy import text

from app.error import NotFound
from app.extensions import db
from app.utils.params import parser_date
from app.error import APIError, NotFound          
from app.utils.params import parse_bbox, parser_date  
from app.utils.window import get_window
import math

CELL_DEG = 0.1
DETAIL_DEG = 0.01
MAX_BBOX_AREA = 9.0
DETAIL_LIMIT = 30000

def _require_table():
    if db.session.execute(text("SELECT to_regclass('fire_grid_01')")).scalar() is None:
        raise NotFound("fire_grid_01 does not exist. Run: python -m app.jobs.build_fire_grid")


def get_months():
    _require_table()
    months = db.session.execute(text("SELECT ym FROM fire_grid_01 GROUP BY ym ORDER BY ym")).scalars().all()
    if not months:
        raise NotFound("fire_grid_01 is empty. Run: python -m app.jobs.build_fire_grid")
    return {"first": months[0].isoformat(), "last": months[-1].isoformat()}


def get_grid(to_str):
    to = parser_date(to_str, "to") or date.max
    _require_table()
    rows = db.session.execute(
        text("SELECT grow, gcol, sum(n)::int FROM fire_grid_01 WHERE ym <= :to GROUP BY 1, 2 ORDER BY 1, 2"),
        {"to": to}).all()
    cells = [[row, col, n] for row, col, n in rows]
    return {
        "cell_deg": CELL_DEG,
        "cell_count": len(cells),
        "total_fires": sum(n for _, _, n in cells),
        "max_count": max((n for _, _, n in cells), default=0),
        "cells": cells,
    }
def get_detail(bbox_str, to_str):
    bbox = parse_bbox(bbox_str)
    if bbox is None:
        raise APIError("bbox is required")
    w, s, e, n = bbox
    if (e - w) * (n - s) > MAX_BBOX_AREA:
        raise APIError(f"bbox too large (max {MAX_BBOX_AREA} square degrees); zoom in")
    start, end = get_window()
    to = min(parser_date(to_str, "to") or date.max, end)
    rows = db.session.execute(text("""
        SELECT floor(round(c.lat::numeric / 0.01, 9))::int, floor(round(c.lon::numeric / 0.01, 9))::int, count(*)::int
        FROM cells c JOIN v_fire f USING (cell_id)
        WHERE c.lat >= :s AND c.lat < :n AND c.lon >= :w AND c.lon < :e
          AND f.local_date BETWEEN :start AND :to
        GROUP BY 1, 2 LIMIT :lim"""),
        {"s": s, "n": n, "w": w, "e": e, "start": start, "to": to, "lim": DETAIL_LIMIT + 1}).all()
    truncated = len(rows) > DETAIL_LIMIT
    cells = [list(r) for r in rows[:DETAIL_LIMIT]]
    return {"cell_deg": DETAIL_DEG, "truncated": truncated, "cells": cells}

def _coord(value, name, lo, hi):
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise APIError(f"'{name}' must be a number")
    if not lo <= v <= hi:
        raise APIError(f"'{name}' must be between {lo} and {hi}")
    return v


def _year_bars(counts, start, end):
    bars = []
    for y in range(start.year, end.year + 1):
        partial = (y == start.year and (start.month, start.day) != (1, 1)) or \
                  (y == end.year and (end.month, end.day) != (12, 31))
        bars.append({"year": y, "n": counts.get(y, 0), "partial": partial})
    return bars


def get_point(lat_str, lon_str, deg_str):
    from app.ml import get_model, risk_level
    from app.models.risk_prediction import RiskPrediction
    from app.models.cell import Cell
    from app.models.daily_features import DailyFeature

    lat, lon = _coord(lat_str, "lat", 6, 38), _coord(lon_str, "lon", 67, 98)
    if (deg_str or "0.1") not in ("0.1", "0.01"):
        raise APIError("deg must be 0.1 or 0.01")
    deg = float(deg_str or "0.1")
    start, end = get_window()

    row, col = (int(math.floor(round(v / 0.01, 9))) for v in (lat, lon))
    cell_id = f"r{row:04d}c{col:04d}"
    cell = db.session.get(Cell, cell_id)

    if deg == 0.1:
        _require_table()
        counts = dict(db.session.execute(text(
            "SELECT extract(year FROM ym)::int, sum(n)::int FROM fire_grid_01 WHERE grow = :r AND gcol = :c GROUP BY 1"),
            {"r": int(math.floor(round(lat / 0.1, 9))), "c": int(math.floor(round(lon / 0.1, 9)))}).all())
        area = "0.1 degree block (about 11 km)"
    else:
        counts = {} if cell is None else dict(db.session.execute(text(
            "SELECT extract(year FROM local_date)::int, count(*)::int FROM v_fire "
            "WHERE cell_id = :id AND local_date BETWEEN :s AND :e GROUP BY 1"),
            {"id": cell_id, "s": start, "e": end}).all())
        area = "0.01 degree cell (about 1 km)"

    place = None
    if cell is not None and cell.district:
        parts = [p.strip() for p in cell.district.split("/")]
        state, district = (parts[0], parts[1]) if len(parts) == 2 else (None, parts[0])
        place = {"state": state, "district": district, "label": f"{district}, {state}" if state else district}

    latest = None
    daily = None if cell is None else (DailyFeature.query.filter_by(cell_id=cell_id)
                                       .order_by(DailyFeature.date.desc()).first())
    if daily is not None:
        model = get_model()
        stored = db.session.get(RiskPrediction, (cell_id, daily.date, model.version))
        risk = None if stored is None else {"probability": round(stored.calibrated_prob, 4),
                                            "level": risk_level(stored.calibrated_prob), "model_version": model.version}
        latest = {"date": daily.date.isoformat(), "fwi": daily.fwi, "temp_c": daily.temp_c,
                  "rainfall_mm": daily.rainfall_mm, "wind_speed": daily.wind_speed, "risk": risk}

    bars = _year_bars(counts, start, end)
    return {"lat": lat, "lon": lon, "cell_id": cell_id if cell is not None else None, "place": place,
            "elevation": None if cell is None else cell.elevation, "latest": latest,
            "fires": {"deg": deg, "area": area, "total": sum(b["n"] for b in bars), "yearly": bars,
                      "from": start.isoformat(), "to": end.isoformat()}}