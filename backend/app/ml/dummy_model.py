import math

FEATURES = ["fwi", "rainfall_mm"]
LEVEL_BREAKS = [("low", 0.10), ("moderate", 0.25), ("high", 0.50), ("extreme", 1.0)]
STUB_P = 0.05                                   


def risk_level(p):
    for name, upper in LEVEL_BREAKS:
        if p < upper:
            return name
    return LEVEL_BREAKS[-1][0]


class StubModel:
    version = "stub-0.1.0"
    is_dummy = True
    feature_list = FEATURES

    def predict_logit(self, row):
        return math.log(STUB_P / (1 - STUB_P))

    def predict_proba(self, row):
        return STUB_P

    def explain(self, row):
        logit = round(self.predict_logit(row), 4)
        return {"probability": STUB_P, "logit": logit, "base_value": logit,
                "contributions": {f: {"value": row.get(f), "shap": 0.0} for f in FEATURES}}


_model = StubModel()


def get_model():
    return _model


def build_feature_row(cell, daily):
    return {f: getattr(daily, f) for f in FEATURES}