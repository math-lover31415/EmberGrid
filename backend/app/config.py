import os
from pathlib import Path
from dotenv import load_dotenv


load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")


def _origins():
    raw = os.environ.get("CORS_ORIGINS", "*")
    return "*" if raw.strip() == "*" else [o.strip() for o in raw.split(",") if o.strip()]

class Config:
    FRONT_END_URL = os.environ.get("FRONT_END_URL", "dummy frontend url")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql://fireheatmap:fireheatmap@localhost:5432/firemap"
    )
    JWT_SECRET_KEY= os.environ.get("JWT_SECRET_KEY")
    CORS_ORIGINS = _origins()
    COMPRESS_MIN_SIZE = 1024
    