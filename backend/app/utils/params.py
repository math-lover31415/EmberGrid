from datetime import date

from app.error import APIError


def parser_date(value,name="date"):
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    finally:
        raise APIError(f"'{name}' must be YYYY-MM-DD")