import hashlib
import os
import pickle
from pathlib import Path

LEVEL_BREAKS = [("low", 0.10), ("moderate", 0.25), ("high", 0.50), ("extreme", 1.0)]

# the exact columns, in the exact order, the random forest was trained on
FEATURES = ["latitude", "longitude", "returned_elevation_m", "temperature_2m_mean", "temperature_2m_max",
            "temperature_2m_min", "precipitation_sum", "relative_humidity_2m_mean", "wind_speed_10m_mean",
            "wind_speed_10m_max", "wind_direction_10m_dominant"]

MODEL_PATH = Path(os.environ.get("MODEL_PATH") or Path(__file__).resolve().parents[2] / "app/ml" / "random_forest.pkl")


def risk_level(p):
    for name, upper in LEVEL_BREAKS:
        if p < upper:
            return name
    return LEVEL_BREAKS[-1][0]


class RandomForestModel:
    def __init__(self, path):
        raw = Path(path).read_bytes()
        self.version = "rf-" + hashlib.sha256(raw).hexdigest()[:8]     
        self._forest = pickle.loads(raw)
        if list(self._forest.feature_names_in_) != FEATURES:
            raise RuntimeError(f"model features {list(self._forest.feature_names_in_)} do not match FEATURES")
        if list(self._forest.classes_) != [0, 1]:
            raise RuntimeError("model classes must be [0, 1] (no fire, fire)")

    def predict_proba(self, X):
        """X: DataFrame with the FEATURES columns. Returns the fire probability of every row."""
        return self._forest.predict_proba(X[FEATURES])[:, 1]


_model = None


def get_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise RuntimeError(f"model file not found: {MODEL_PATH} (set MODEL_PATH or put random_forest.pkl in backend/models/)")
        _model = RandomForestModel(MODEL_PATH)
    return _model