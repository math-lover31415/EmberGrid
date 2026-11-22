import pandas as pd
from app.extensions import db
from psycopg2.extras import execute_values
from app.jobs import fwi as fwi_lib
from app.jobs.db_util import run_procedure
RAW = ["temperature_2m_mean", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
       "relative_humidity_2m_mean", "wind_speed_10m_mean", "wind_speed_10m_max", "wind_direction_10m_dominant"]

def _execute_values(sql,rows):
    conn= db.engine.raw_connection()
    try:
        execute_values(conn.cursor(),sql,rows,page_size=1000)
        conn.commit() 
    finally:
        conn.close()
        
def upsert_weather_df(df: pd.DataFrame,method):
    if df.empty:
        return 0 
    cols= ["weather_point_id", "date"] + RAW
    data= df[cols].astype(object).where(df[cols].notna(),None)
    rows=  [(*r, method) for r in data.itertuples(index=False)]
    _execute_values(f"""INSERT INTO weather_daily ({', '.join(cols)}, method) VALUES %s
                        ON CONFLICT (weather_point_id, date) DO UPDATE SET
                        {', '.join(f'{c} = EXCLUDED.{c}' for c in RAW)}, method = EXCLUDED.method""", rows)
    
    return len(rows)

def compute_fwi(wind_unit="ms", point_ids=None, batch_points=200):
    ids = [r[0] for r in db.session.execute(db.text("SELECT weather_point_id FROM weather_points ORDER BY 1"))]
    if point_ids is not None:
        ids = [i for i in ids if i in set(point_ids)]
    done = 0
    for i in range(0, len(ids), batch_points):
        df = pd.read_sql(db.text("""SELECT weather_point_id, date, temperature_2m_max tmax, temperature_2m_min tmin,
                                    relative_humidity_2m_mean rh_mean, wind_speed_10m_mean wind_mean,
                                    wind_speed_10m_max wind_max, precipitation_sum rain
                                    FROM weather_daily WHERE weather_point_id = ANY(:ids)
                                    ORDER BY weather_point_id, date"""),
                         db.engine, params={"ids": ids[i:i + batch_points]}).dropna()
        
        
        out = []
        for pid, g in df.groupby("weather_point_id", sort=False):
            for vals in fwi_lib.series(g.to_dict("records"), wind_unit):
                out.append((pid, *vals))
                
                
        _execute_values("""UPDATE weather_daily w SET ffmc = t.ffmc, dmc = t.dmc, dc = t.dc, isi = t.isi, bui = t.bui, fwi = t.fwi
                           FROM (VALUES %s) AS t(id, date, ffmc, dmc, dc, isi, bui, fwi)
                           WHERE w.weather_point_id = t.id AND w.date = t.date""", out)
        done += len(out)
    return done

    


def build_features(start, end):
    run_procedure("CALL build_weather_features(%s, %s)", (start, end), "weather_features")