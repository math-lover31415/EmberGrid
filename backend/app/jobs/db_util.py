from app.extensions import db


def call_procedure(sql, params):
    conn = db.engine.raw_connection()
    raw = conn.driver_connection
    try:
        raw.autocommit = True
        raw.cursor().execute(sql, params)
    finally:
        raw.autocommit = False
        conn.close()


def run_procedure(sql, params, job_type):
    last_id = db.session.scalar(db.text("SELECT coalesce(max(id), 0) FROM ingestion_runs"))
    call_procedure(sql, params)
    errors = db.session.execute(
        db.text("SELECT error_message FROM ingestion_runs WHERE id > :i AND job_type = :j AND status = 'failed'"),
        {"i": last_id, "j": job_type}).scalars().all()
    db.session.rollback()          # end the read-only transaction opened above
    if errors:
        raise RuntimeError(f"{job_type} failed: {errors[0]}")