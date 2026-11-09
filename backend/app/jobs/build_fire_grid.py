import sys

from sqlalchemy import text

from app import create_app
from app.extensions import db
from app.utils.window import get_window


CREATE = """
CREATE TABLE IF NOT EXISTS fire_grid_01 (
    ym   date    NOT NULL,          -- first day of the month
    grow integer NOT NULL,          -- block row    = floor(lat / 0.1)
    gcol integer NOT NULL,          -- block column = floor(lon / 0.1)
    n    integer NOT NULL,          -- fires in that block that month
    PRIMARY KEY (ym, grow, gcol)
)
"""
INDEX = "CREATE INDEX IF NOT EXISTS ix_fire_grid_01_rc ON fire_grid_01 (grow, gcol)"

INSERT = """
INSERT INTO fire_grid_01 (ym, grow, gcol, n)
SELECT date_trunc('month', local_date)::date,
       floor(round(latitude::numeric / 0.1, 9))::int,
       floor(round(longitude::numeric / 0.1, 9))::int,
       count(*)
FROM v_fire
WHERE local_date BETWEEN :start AND :end
GROUP BY 1, 2, 3
"""


def build():
    if db.session.execute(db.text("SELECT to_regclass('v_fire')")).scalar() is None:
        sys.exit("v_fire is missing. Run db/sql/006_fire_view.sql first")
    start, end = get_window()
    window = {"start": start, "end": end}
    
    db.session.execute(db.text(CREATE))
    db.session.execute(db.text(INDEX))
    db.session.execute(db.text("DELETE FROM fire_grid_01"))
    blocks = db.session.execute(text(INSERT), window).rowcount
    db.session.commit()
        
    in_grid = db.session.execute(text("SELECT coalesce(sum(n), 0) FROM fire_grid_01")).scalar()
    in_events = db.session.execute(
        text("SELECT count(*) FROM v_fire WHERE local_date BETWEEN :start AND :end"), window).scalar()
    return blocks, in_grid, in_events, start, end

if __name__ == "__main__":
    with create_app().app_context():
        blocks, in_grid, in_events, start, end = build()
        print(f"window={start}..{end} blocks={blocks} fires_in_grid={in_grid} fires_in_events={in_events}")
        if in_grid != in_events:
            sys.exit("MISMATCH: every fire must land in exactly one block")
        print("OK")