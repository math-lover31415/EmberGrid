import os
import sys
from datetime import date, timedelta

from app import create_app
from app.jobs.live import fetch_firms
from app.jobs.load_fire import ingest_firms_df
from app.utils.window import get_window

INDIA_BBOX = (67.5, 6.0, 98.5, 37.5)


def month_chunks(start, end):
    d = start
    while d <= end:
        nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        yield d, min(end, nxt - timedelta(days=1))
        d = nxt


def run(start, end, source):
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("set FIRMS_MAP_KEY first")
    with create_app().app_context():
        lo, hi = get_window()
        if start < lo or end > hi:
            sys.exit(f"{start}..{end} is outside the data window {lo}..{hi} (table data_window)")
        for a, b in month_chunks(start, end):
            seen, new = ingest_firms_df(fetch_firms(key, source, INDIA_BBOX, a, b), source)
            print(f"{a} to {b}: {seen} in feed, {new} new")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: python -m app.jobs.backfill_fire START END [SOURCE]   (dates YYYY-MM-DD)")
    run(date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2]),
        sys.argv[3] if len(sys.argv) == 4 else "VIIRS_NOAA20_SP")