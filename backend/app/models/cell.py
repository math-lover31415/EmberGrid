from app.extensions import db


class Cell(db.Model):
    __tablename__="cells"
    
    cell_id= db.Column(db.String, primary_key=True)
    lat =db.Column(db.Float,nullable=False)
    lon = db.Column(db.Float,nullable=False)
    district= db.Column(db.String)
    elevation = db.Column(db.Float)
    
    __table_args__= (db.Index("ix_cells_lat_lon","lon"),)