from datetime import datetime, timezone

from app.extensions import db


class FireEvent(db.Model):
    __tablename__ = "fire_events"

    id = db.Column(db.BigInteger, primary_key=True)
    event_key = db.Column(db.String, nullable=False, unique=True)
    cell_id = db.Column(db.String, db.ForeignKey("cells.cell_id"), index=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    detected_at = db.Column(db.DateTime(timezone=True), nullable=False)
    local_date = db.Column(db.Date, nullable=False, index=True)
    satellite = db.Column(db.String)
    instrument = db.Column(db.String)
    confidence = db.Column(db.String)
    frp = db.Column(db.Float)
    brightness = db.Column(db.Float)
    detection_type = db.Column(db.Integer)
    source = db.Column(db.String, nullable=False)
    ingested_at = db.Column(db.DateTime(timezone=True), nullable=False,default=lambda: datetime.now(timezone.utc))