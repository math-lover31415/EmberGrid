import hashlib
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.extensions import db
from app.models.cell import Cell
from app.models.fire_event import FireEvent
from app.utils.grid import cell_ids


def ingest_firms_df(df, source):
    if df.empty:
        return 0, 0

    hhmm = df.acq_time.astype(str).str.zfill(4)
    detected = pd.to_datetime(df.acq_date.astype(str) + " " + hhmm.str[:2] + ":" + hhmm.str[2:], utc=True)
    satellite = df.satellite.replace({"N20": "NOAA20"})
    rows = pd.DataFrame({
        "event_key": [hashlib.sha256(f"nrt|{s}|{a}|{t}|{la}|{lo}".encode()).hexdigest()
                      for s, a, t, la, lo in zip(satellite, df.acq_date, hhmm, df.latitude, df.longitude)],
        "latitude": df.latitude, "longitude": df.longitude,
        "detected_at": detected, "local_date": detected.dt.tz_convert("Asia/Kolkata").dt.date,
        "satellite": satellite, "instrument": df.get("instrument"), "confidence": df.confidence, "frp": df.frp,
        "brightness": df.get("bright_ti4"), "detection_type": df.get("type"), "source": source,
    }).drop_duplicates("event_key")

    # attach each hotspot to its grid cell, or leave it empty when that cell is not in the cells table
    guess = pd.Series(cell_ids(rows.latitude, rows.longitude), index=rows.index)
    known = {c for (c,) in db.session.query(Cell.cell_id).filter(Cell.cell_id.in_(guess.unique().tolist()))}
    rows["cell_id"] = guess.where(guess.isin(known), None)

    # skip hotspots already stored under another key (same time and place, e.g. loaded earlier from an archive file)
    have = {(t, la, lo) for t, la, lo in db.session.query(FireEvent.detected_at, FireEvent.latitude, FireEvent.longitude)
            .filter(FireEvent.local_date.between(rows.local_date.min(), rows.local_date.max()))}
    new = rows[[(t.to_pydatetime(), la, lo) not in have
                for t, la, lo in zip(rows.detected_at, rows.latitude, rows.longitude)]]
    if new.empty:
        return len(rows), 0

    now = datetime.now(timezone.utc)
    records = [{**r, "detected_at": r["detected_at"].to_pydatetime(), "ingested_at": now}
               for r in new.astype(object).where(new.notna(), None).to_dict("records")]
    result = db.session.execute(pg_insert(FireEvent).values(records).on_conflict_do_nothing(index_elements=["event_key"]))
    db.session.commit()
    return len(rows), result.rowcount