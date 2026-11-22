import numpy as np

from app.constants import CELL_SIZE_DEG


def cell_ids(lat, lon):
    rows = np.floor(np.round(np.asarray(lat, dtype=float) / CELL_SIZE_DEG, 9)).astype(int)
    cols = np.floor(np.round(np.asarray(lon, dtype=float) / CELL_SIZE_DEG, 9)).astype(int)
    return [f"r{r:04d}c{c:04d}" for r, c in zip(rows, cols)]