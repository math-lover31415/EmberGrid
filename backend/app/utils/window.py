from sqlalchemy import text
from app.error import NotFound
from app.extensions import db


def get_window():
    row = db.session.execute(text("SELECT start_date, end_date FROM data_window")).first()
    if row is None:
        raise NotFound("data_window is empty. Run db/sql/006_fire_view.sql")
    return row.start_date, row.end_date