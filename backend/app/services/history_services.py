
from datetime import date

from sqlalchemy import text

from app.error import NotFound
from app.extensions import db
from app.utils.params import parse_date
from app.error import APIError, NotFound          
from app.utils.params import parse_bbox, parse_date  
from app.utils.window import get_window

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
    to = parse_date(to_str, "to") or date.max
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
def get_risk(date_str):
    from app.ml import get_model
    version = get_model().version
    day = parse_date(date_str, "date") or db.session.execute(
        text("SELECT max(date) FROM risk_predictions WHERE model_version = :v"), {"v": version}).scalar()
    if day is None:
        raise NotFound(f"no risk_predictions for model {version}")
    rows = db.session.execute(text("""
        SELECT floor(round(c.lat::numeric / 0.1, 9))::int, floor(round(c.lon::numeric / 0.1, 9))::int,
               round(avg(p.calibrated_prob)::numeric, 4)::float
        FROM risk_predictions p JOIN cells c USING (cell_id)
        WHERE p.date = :d AND p.model_version = :v
        GROUP BY 1, 2 ORDER BY 1, 2"""), {"d": day, "v": version}).all()
    if not rows:
        raise NotFound(f"no risk_predictions for {day} ({version})")
    return {"cell_deg": CELL_DEG, "date": day.isoformat(), "model": version, "cells": [list(r) for r in rows]}


def get_detail(bbox_str, to_str):
    bbox = parse_bbox(bbox_str)
    if bbox is None:
        raise APIError("bbox is required")
    w, s, e, n = bbox
    if (e - w) * (n - s) > MAX_BBOX_AREA:
        raise APIError(f"bbox too large (max {MAX_BBOX_AREA} square degrees); zoom in")
    start, end = get_window()
    to = min(parse_date(to_str, "to") or date.max, end)
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