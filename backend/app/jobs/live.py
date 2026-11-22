import io
import time
from datetime import date, timedelta

import pandas as pd
import requests

FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{west},{south},{east},{north}/{days}/{date}"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
DAILY_VARS = ["temperature_2m_mean", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
              "relative_humidity_2m_mean", "wind_speed_10m_mean", "wind_speed_10m_max", "wind_direction_10m_dominant"]


def _get(url, params=None, retries=4):
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=90)
            if r.status_code not in (429, 500, 502, 503, 504):
                r.raise_for_status()
                return r
        except requests.RequestException:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"giving up on {url.split('?')[0]} after {retries} attempts")


def fetch_firms(map_key, source, bbox, start: date, end: date):
    west, south, east, north = bbox
    frames, d = [], start
    while d <= end:
        days = min(5, (end - d).days + 1)
        text = _get(FIRMS_URL.format(key=map_key, source=source, west=round(west, 4), south=round(south, 4),
                                     east=round(east, 4), north=round(north, 4), days=days, date=d.isoformat())).text.strip()
        if text and not text.startswith("latitude"):       # a bad key or quota message arrives as plain text
            raise RuntimeError(f"FIRMS returned an unexpected response: {text[:200]!r}")
        if text:
            frames.append(pd.read_csv(io.StringIO(text), dtype={"acq_time": str, "confidence": str}))
        d += timedelta(days=days)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def fetch_openmeteo(points, start: date, end: date, kind, wind_unit="ms", today=None, batch=25):
    out = []
    for i in range(0, len(points), batch):
        chunk = points.iloc[i:i + batch]
        params = {"latitude": ",".join(f"{v:.4f}" for v in chunk.lat), "longitude": ",".join(f"{v:.4f}" for v in chunk.lon),
                  "daily": ",".join(DAILY_VARS), "timezone": "Asia/Kolkata", "wind_speed_unit": wind_unit}
        if kind == "archive":
            url = ARCHIVE_URL
            params.update(start_date=start.isoformat(), end_date=end.isoformat(), models="era5")
        else:
            url, t = FORECAST_URL, today or date.today()
            params.update(past_days=max((t - start).days, 0), forecast_days=max((end - t).days + 1, 1))
        data = _get(url, params=params).json()
        items = data if isinstance(data, list) else [data]      # one location comes back as a dict, many as a list
        if len(items) != len(chunk):
            raise RuntimeError(f"Open-Meteo returned {len(items)} locations for {len(chunk)} requested")
        for pid, item in zip(chunk.weather_point_id, items):
            daily = item["daily"]
            df = pd.DataFrame({"weather_point_id": pid, "date": pd.to_datetime(daily["time"]).date})
            for v in DAILY_VARS:
                df[v] = pd.to_numeric(pd.Series(daily[v], dtype="float64"), errors="coerce").values
            out.append(df)
    res = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    return res[(res.date >= start) & (res.date <= end)] if not res.empty else res