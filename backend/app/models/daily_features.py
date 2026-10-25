from app.extensions import db


class DailyFeature(db.Model):
    __tablename__ = "daily_features"

    cell_id = db.Column(db.String, db.ForeignKey("cells.cell_id"), primary_key=True)
    date = db.Column(db.Date, primary_key=True, index=True)

    fwi = db.Column(db.Float)
    temp_c = db.Column(db.Float)
    rainfall_mm = db.Column(db.Float)
    wind_speed = db.Column(db.Float)
    wind_dir = db.Column(db.Float)