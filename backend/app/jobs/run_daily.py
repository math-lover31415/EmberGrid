import argparse
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from app import create_app
from app.extensions import db
from app.jobs import live, load_fire, load_weather, predict_day
from app.jobs.db_util import run_procedure


def today_ist():
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def step_scope(start, end):
    moved = db.session.execute(
        db.text("UPDATE ingest_scope SET to_date = :end WHERE rolling AND to_date < :end"), {"end": end}).rowcount
    db.session.commit()

    rolling = db.session.scalar(db.text("SELECT count(*) FROM ingest_scope WHERE rolling"))
    if not rolling:
        print("  WARNING: no district is marked rolling, so new days will not get rows")
    return f"{moved} districts advanced to {end}"


def step_fire(start, end):
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        raise RuntimeError("FIRMS_MAP_KEY is not set (use --skip fire to run without hotspots)")
    source = os.environ.get("FIRMS_SOURCE", "VIIRS_NOAA20_NRT")

    # the rectangle around all cells in scope
    west, south, east, north = db.session.execute(db.text("""
        SELECT min(c.lon), min(c.lat), max(c.lon), max(c.lat)
        FROM cells c JOIN ingest_scope s ON s.district = c.district""")).one()
    if west is None:
        raise RuntimeError("ingest_scope selects no cells")
    margin = 0.05
    bbox = (west - margin, south - margin, east + margin, north + margin)

    feed = live.fetch_firms(key, source, bbox, start, end)
    in_feed, new = load_fire.ingest_firms_df(feed, source)
    return f"{in_feed} detections in feed, {new} new"


def step_weather(start, end):
    points = pd.read_sql(db.text("""
        SELECT DISTINCT p.weather_point_id, p.lat, p.lon
        FROM weather_points p
        JOIN cell_weather_map m ON m.weather_point_id = p.weather_point_id
        JOIN cells c ON c.cell_id = m.cell_id
        JOIN ingest_scope s ON s.district = c.district
        ORDER BY 1"""), db.engine)
    if points.empty:
        raise RuntimeError("no weather points cover the scope (is cell_weather_map loaded?)")

    wind_unit = os.environ.get("OPENMETEO_WIND_UNIT", "ms")
    today = today_ist()
    archive_end = today - timedelta(days=int(os.environ.get("ARCHIVE_LAG_DAYS", 6)))   # last day the archive has
    era5_rows = forecast_rows = 0

    # 1) final ERA5 values up to the archive's last day. Starting 5 days early replaces older provisional values.
    era5_start, era5_end = start - timedelta(days=5), min(end, archive_end)
    if era5_start <= era5_end:
        df = live.fetch_openmeteo(points, era5_start, era5_end, "archive", wind_unit)
        era5_rows = load_weather.upsert_weather_df(df, "era5")

    # 2) provisional forecast-API values for the days after that, so there is no gap
    forecast_start = archive_end + timedelta(days=1)
    if forecast_start <= end:
        df = live.fetch_openmeteo(points, forecast_start, end, "forecast", wind_unit, today=today)
        forecast_rows = load_weather.upsert_weather_df(df, "forecast")

    fwi_rows = load_weather.compute_fwi(wind_unit, point_ids=list(points.weather_point_id))
    return f"{len(points)} points: {era5_rows} era5 rows, {forecast_rows} forecast rows, FWI for {fwi_rows} point-days"


def step_labels(start, end):
    run_procedure("CALL build_label_layer(%s, %s)", (start, end), "label_layer")
    return f"fire counts for {start}..{end}"


def step_features(start, end):
    load_weather.build_features(start, end)
    return f"weather copied onto cells for {start}..{end}"


def step_predict(start, end):
    return f"{predict_day.run(start, end)} predictions"


STEPS = {"scope": step_scope, "fire": step_fire, "weather": step_weather,
         "labels": step_labels, "features": step_features, "predict": step_predict}


def run(end=None, days=5, skip=()):
    end = end or today_ist()
    start = end - timedelta(days=days - 1)
    print(f"run_daily {start}..{end}")

    for name, step in STEPS.items():
        if name in skip:
            print(f"  {name:9s} skipped")
            continue
        try:
            print(f"  {name:9s} {step(start, end)}")
        except Exception as exc:
            db.session.rollback()
            raise SystemExit(f"FAILED at step '{name}': {exc}")
    print("run_daily done")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", type=date.fromisoformat, help="last day to process (default: today, IST)")
    parser.add_argument("--days", type=int, default=5, help="how many days to process, ending at --date")
    parser.add_argument("--skip", default="", help="comma-separated steps to leave out")
    args = parser.parse_args()

    skip = set(filter(None, args.skip.split(",")))
    unknown = skip - set(STEPS)
    if unknown:
        raise SystemExit(f"unknown steps {sorted(unknown)}; valid: {list(STEPS)}")

    with create_app().app_context():
        run(args.date, args.days, skip)