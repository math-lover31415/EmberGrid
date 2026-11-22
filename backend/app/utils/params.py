from datetime import date

from app.error import APIError


def parser_date(value,name="date"):
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise APIError(f"'{name}' must be YYYY-MM-DD")

parse_date = parser_date

def parse_bbox(value):
    if value is None:
        return None
    try:
        min_lon, min_lat, max_lon, max_lat = (float(x) for x in value.split(","))
    except ValueError:
        raise APIError("bbox must be 'min_lon,min_lat,max_lon,max_lat'")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise APIError("bbox min values must be smaller than max values")
    return min_lon, min_lat, max_lon, max_lat

def parse_int(value, name, default, lo, hi):
    if value is None:
        return default
    try:
        n = int(value)
    except ValueError:
        raise APIError(f"'{name}' must be an integer")
    if not lo <= n <= hi:
        raise APIError(f"'{name}' must be between {lo} and {hi}")
    return n