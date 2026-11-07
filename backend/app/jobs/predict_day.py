from datetime import date, datetime, timedelta, timezone
import sys
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app import create_app
from app.extensions import db
from app.ml.dummy_model import get_model, build_feature_row
from app.models.cell import Cell
from app.models.daily_features import DailyFeature
from app.models.risk_prediction import RiskPrediction

BATCH =10000 #rows per insert statement



def score_day(d, model):
    rows= (db.session.query(Cell,DailyFeature).join(DailyFeature,DailyFeature.cell_id==Cell.cell_id).filter(DailyFeature.date==d).all())
    now= datetime.now(timezone.utc)
    payload=[]
    
    for cell,daily in rows:
        row = build_feature_row(cell,daily)
        payload.append({
            "cell_id": cell.cell_id,
            "date": d,
            "model_version": model.version,
            "raw_score": model.predict_logit(row),
            "calibrated_prob": model.predict_proba(row),
            "created_at": now})
    
    for i in range(0,len(payload),BATCH):
        stmt = pg_insert(RiskPrediction).values(payload[i:i+BATCH])
        stmt= stmt.on_conflict_do_update(
            index_elements=["cell_id","date","model_version"],
            set_={"raw_score": stmt.excluded.raw_score, "calibrated_prob": stmt.excluded.calibrated_prob,
                  "created_at": stmt.excluded.created_at}
            )
        db.session.execute(stmt)
    db.session.commit()
    return len(payload)


def run(start, end):
    model, total, d = get_model(), 0, start
    while d <= end:
        total += score_day(d, model)
        d += timedelta(days=1)
    return total


if __name__=="main":
    start,end= (date.isoformat(a) for a in sys.argv[1:3])
    with create_app().app_context():
        print(f"{run(start,end)} predictions written")