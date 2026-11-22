from datetime import datetime, timezone

from app.extensions import db


class RiskPrediction(db.Model):
    __tablename__ = "risk_predictions"
    cell_id = db.Column(db.String, db.ForeignKey("cells.cell_id"), primary_key=True)
    date = db.Column(db.Date, primary_key=True)
    model_version = db.Column(db.String, primary_key=True)

    raw_score = db.Column(db.Float)
    calibrated_prob = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (db.Index("ix_risk_pred_date_version", "date", "model_version"),)