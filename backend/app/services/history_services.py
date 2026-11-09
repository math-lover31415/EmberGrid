
from datetime import date

from sqlalchemy import text

from app.error import NotFound
from app.extensions import db
from app.utils.params import parse_date

CELL_DEG = 0.1


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