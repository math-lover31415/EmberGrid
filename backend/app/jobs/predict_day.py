import sys
from datetime import date, datetime, timedelta, timezone
import pandas as pd
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app import create_app
from app.extensions import db
from app.ml import FEATURES, get_model
from app.models.risk_prediction import RiskPrediction

BATCH = 10_000      # rows per insert statement

POINTS = text("""
    SELECT w.weather_point_id, p.lat AS latitude, p.lon AS longitude, p.elevation_m AS returned_elevation_m,
           w.temperature_2m_mean, w.temperature_2m_max, w.temperature_2m_min, w.precipitation_sum,
           w.relative_humidity_2m_mean, w.wind_speed_10m_mean, w.wind_speed_10m_max, w.wind_direction_10m_dominant
    FROM weather_daily w JOIN weather_points p USING (weather_point_id)
    WHERE w.date = :d""")

CELLS = text("""
    SELECT f.cell_id, m.weather_point_id
    FROM daily_features f JOIN cell_weather_map m ON m.cell_id = f.cell_id
    WHERE f.date = :d""")


def score_day(d, model):
    points = pd.read_sql(POINTS, db.engine, params={"d": d})
    complete = points.dropna(subset=FEATURES)
    if len(complete) < len(points):
        print(f"  {d}: {len(points) - len(complete)} of {len(points)} weather points skipped (missing values)")
    if complete.empty:
        return 0
    prob = dict(zip(complete.weather_point_id, model.predict_proba(complete)))

    cells = pd.read_sql(CELLS, db.engine, params={"d": d})
    cells = cells[cells.weather_point_id.isin(prob)]
    now = datetime.now(timezone.utc)
    payload = [{"cell_id": c, "date": d, "model_version": model.version, "raw_score": float(prob[w]),
                "calibrated_prob": float(prob[w]), "created_at": now}
               for c, w in zip(cells.cell_id, cells.weather_point_id)]
    for i in range(0, len(payload), BATCH):
        stmt = pg_insert(RiskPrediction).values(payload[i:i + BATCH])
        stmt = stmt.on_conflict_do_update(
            index_elements=["cell_id", "date", "model_version"],
            set_={"raw_score": stmt.excluded.raw_score, "calibrated_prob": stmt.excluded.calibrated_prob,
                  "created_at": stmt.excluded.created_at})
        db.session.execute(stmt)
    db.session.commit()
    return len(payload)


def run(start, end, step=1):
    """Returns the total number of predictions written."""
    model, total, d = get_model(), 0, start
    while d <= end:
        total += score_day(d, model)
        d += timedelta(days=step)
    return total


if __name__ == "__main__":
    start, end = (date.fromisoformat(a) for a in sys.argv[1:3])
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    with create_app().app_context():
        print(f"{run(start, end, step)} predictions written")
