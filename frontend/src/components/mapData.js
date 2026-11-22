// Helpers for MapExplorer: base maps, grid/bbox maths, what heatmap data each view
// needs ("plans"), colour scales and the MapLibre layers. No React in here.
import { api } from "../services/api.js";

/* ------------------------------------------------------------------ */
/* Base maps                                                           */
/* ------------------------------------------------------------------ */

const BASEMAPS = {
  street: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Tiles &copy; Esri",
  },
  terrain: {
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution: "&copy; OpenStreetMap contributors &copy; OpenTopoMap",
  },
};

const BASE_ID = "base";

// Dark mode darkens only the base map with raster paint properties. (It used to be a CSS
// invert filter on the whole canvas, which also inverted the heatmap colours.)
// Swapping brightness min/max inverts lightness; the 180° hue rotation keeps the hues.
function rasterPaint(type, theme) {
  if (theme !== "dark") {
    return { "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-saturation": 0, "raster-hue-rotate": 0 };
  }
  if (type === "street") {
    return { "raster-brightness-min": 0.72, "raster-brightness-max": 0.06, "raster-saturation": -0.3, "raster-hue-rotate": 180 };
  }
  return { "raster-brightness-min": 0, "raster-brightness-max": 0.82, "raster-saturation": -0.25, "raster-hue-rotate": 0 };
}

const rasterSource = (type) => ({ type: "raster", tiles: BASEMAPS[type].tiles, tileSize: 256, attribution: BASEMAPS[type].attribution });

export function initialStyle(type, theme) {
  return {
    version: 8,
    sources: { [BASE_ID]: rasterSource(type) },
    layers: [{ id: BASE_ID, type: "raster", source: BASE_ID, paint: rasterPaint(type, theme) }],
  };
}

// Switch base map / theme by replacing only the raster layer, below everything else.
// The heatmap layers are never touched, so they can't disappear on a style switch.
export function applyBasemap(map, type, theme, typeChanged) {
  if (!typeChanged) {
    for (const [property, value] of Object.entries(rasterPaint(type, theme))) {
      map.setPaintProperty(BASE_ID, property, value);
    }
    return;
  }
  if (map.getLayer(BASE_ID)) map.removeLayer(BASE_ID);
  if (map.getSource(BASE_ID)) map.removeSource(BASE_ID);
  map.addSource(BASE_ID, rasterSource(type));
  const firstLayer = map.getStyle().layers[0]?.id;
  map.addLayer({ id: BASE_ID, type: "raster", source: BASE_ID, paint: rasterPaint(type, theme) }, firstLayer);
}

/* ------------------------------------------------------------------ */
/* Grid / bbox maths                                                   */
/* ------------------------------------------------------------------ */

// Area that has fire/risk data (India). Views outside it never trigger requests.
const DATA_BOUNDS = [67, 6, 98, 38];
const MAX_BOX_AREA = 9; // sq. degrees: backend limit for /history/detail
const BOX_STEP = 0.5; // box edges snap to a 0.5° grid so nearby views share requests

export const bboxText = (bbox) => bbox.map((value) => value.toFixed(4)).join(",");
export const bboxArea = (bbox) => (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
const contains = (outer, inner) => (
  outer[0] <= inner[0] + 1e-9 && outer[1] <= inner[1] + 1e-9
  && outer[2] >= inner[2] - 1e-9 && outer[3] >= inner[3] - 1e-9
);

function clipToData(bbox) {
  const clipped = [
    Math.max(bbox[0], DATA_BOUNDS[0]), Math.max(bbox[1], DATA_BOUNDS[1]),
    Math.min(bbox[2], DATA_BOUNDS[2]), Math.min(bbox[3], DATA_BOUNDS[3]),
  ];
  return clipped[0] < clipped[2] && clipped[1] < clipped[3] ? clipped : null;
}

export function squareRing(row, col, deg) {
  const w = col * deg;
  const s = row * deg;
  const e = (col + 1) * deg;
  const n = (row + 1) * deg;
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

// "r1907c8196" -> { row: 1907, col: 8196 } (risk cells are 0.01°).
export function parseCellId(cellId) {
  const match = /^r(-?\d+)c(-?\d+)$/.exec(cellId || "");
  return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}

// Keep only the [row, col, count] cells whose square touches the bbox [w, s, e, n].
function cropCells(data, bbox) {
  const deg = data.cell_deg || 0.1;
  const [w, s, e, n] = bbox;
  const cells = (data.cells || []).filter(([row, col]) => (
    (col + 1) * deg >= w && col * deg <= e && (row + 1) * deg >= s && row * deg <= n
  ));
  return { ...data, cells };
}

// One span (lon or lat) of a box that must contain [low, high]: as close as possible to
// `size` wide (snapped to BOX_STEP) and positioned on the BOX_STEP grid when it fits.
function placeSpan(low, high, size) {
  const centred = (low + high) / 2 - size / 2;
  const first = Math.ceil((high - size) / BOX_STEP - 1e-9) * BOX_STEP;
  const last = Math.floor(low / BOX_STEP + 1e-9) * BOX_STEP;
  if (first <= last) {
    const snapped = Math.round(centred / BOX_STEP) * BOX_STEP;
    return Math.min(last, Math.max(first, snapped));
  }
  return Math.floor(centred * 1e4) / 1e4;
}

// A box of up to MAX_BOX_AREA around the view. The history endpoints cost the same
// for any box size, so each request covers as much as the backend allows; small and
// medium pans then stay inside an already-loaded box. Returns null if the view is too
// large for a detail request.
function boxAround(view) {
  const width = view[2] - view[0];
  const height = view[3] - view[1];
  const limit = MAX_BOX_AREA * 0.98;
  if (width * height > limit) return null;
  const grow = Math.sqrt(limit / (width * height));
  const snap = (value) => Math.floor(value / BOX_STEP + 1e-9) * BOX_STEP;
  // Snapped sizes: fix one side first, give the other the rest of the area; keep the
  // option that leaves the most room to pan in the tightest direction.
  const options = [];
  const fixedWidth = snap(width * grow);
  if (fixedWidth >= width) options.push([fixedWidth, snap(limit / fixedWidth)]);
  const fixedHeight = snap(height * grow);
  if (fixedHeight >= height) options.push([snap(limit / fixedHeight), fixedHeight]);
  const room = ([w, h]) => (w >= width && h >= height ? Math.min(w / width, h / height) : 0);
  let [boxWidth, boxHeight] = options.sort((a, b) => room(b) - room(a))[0] || [0, 0];
  if (!room([boxWidth, boxHeight])) {
    // View is close to the maximum size: use it scaled up just enough, unsnapped.
    boxWidth = Math.floor(width * grow * 1e4) / 1e4;
    boxHeight = Math.floor(height * grow * 1e4) / 1e4;
  }
  const west = placeSpan(view[0], view[2], boxWidth);
  const south = placeSpan(view[1], view[3], boxHeight);
  return [west, south, west + boxWidth, south + boxHeight].map((value) => Number(value.toFixed(4)));
}

// Boxes that have loaded successfully, per scope (history month / risk date), newest first.
const loadedBoxes = new Map();
function rememberBox(scope, box) {
  const boxes = (loadedBoxes.get(scope) || []).filter((known) => bboxText(known) !== bboxText(box));
  loadedBoxes.set(scope, [box, ...boxes].slice(0, 20));
}

// Reuse the box being shown/loaded, or one already loaded (cache hit), if it still
// contains the view; otherwise make a new one. undefined = view has no data area.
function pickBox(scope, viewport, current) {
  const view = clipToData(viewport);
  if (!view) return undefined;
  if (current?.scope === scope && current.box && contains(current.box, view)) return current.box;
  const known = (loadedBoxes.get(scope) || []).find((box) => contains(box, view));
  return known || boxAround(view);
}

/* ------------------------------------------------------------------ */
/* Heatmap plans                                                       */
/* ------------------------------------------------------------------ */
// A plan says which dataset the current view needs:
//   key  - identity of the dataset; when it equals what is already shown or loading,
//          nothing is requested (e.g. a small pan inside the loaded box).
//   load - (signal) => Promise<{ geojson, cellCount, truncated, date, resolution }>

const DETAIL_MIN_ZOOM = 8; // below this, 1 km cells are too small to see
const RISK_PAGE_SIZE = 5000; // backend maximum for /heatmap
const RISK_MAX_PAGES = 10;
const FINE = "0.01° cells (~1 km)";
const COARSE = "0.1° blocks (~11 km)";

const emptyResult = (resolution) => ({
  geojson: { type: "FeatureCollection", features: [] }, cellCount: 0, truncated: false, resolution,
});

function historyResult(data) {
  const deg = data.cell_deg || 0.1;
  const features = (data.cells || []).map(([row, col, value]) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [squareRing(row, col, deg)] },
    properties: { row, col, deg, value },
  }));
  return {
    geojson: { type: "FeatureCollection", features },
    cellCount: features.length,
    truncated: Boolean(data.truncated),
    resolution: deg < 0.05 ? FINE : COARSE,
  };
}

export function planHistory({ month, place, zoom, viewport, current }) {
  if (!month) return null;
  const scope = `history|${month}`;
  if (zoom >= DETAIL_MIN_ZOOM) {
    const box = pickBox(scope, viewport, current);
    if (box === undefined) {
      return { key: `history|outside|${month}`, load: async () => emptyResult(FINE) };
    }
    if (box) {
      return {
        key: `history|detail|${month}|${bboxText(box)}`,
        scope,
        box,
        load: (signal) => api.historyDetail(bboxText(box), month, signal).then((data) => {
          rememberBox(scope, box);
          return historyResult(data);
        }),
      };
    }
  }
  // Zoomed out: the coarse national grid, cut to the searched place if there is one.
  return {
    key: `history|grid|${month}|${place ? place.id : "all"}`,
    load: (signal) => api.historyGrid(month, signal)
      .then((grid) => historyResult(place ? cropCells(grid, place.bbox) : grid)),
  };
}

// /heatmap returns at most 5,000 cells per call; follow next_offset for the rest.
async function loadRisk(bbox, date, signal) {
  const features = [];
  let first = null;
  let next = 0;
  for (let page = 0; page < RISK_MAX_PAGES && next !== null && next !== undefined; page += 1) {
    const data = await api.heatmap({ date, layer: "risk", bbox: bboxText(bbox), limit: RISK_PAGE_SIZE, offset: next, signal });
    first = first || data;
    features.push(...(data.features || []));
    next = data.metadata?.next_offset;
  }
  return {
    geojson: { type: "FeatureCollection", features },
    cellCount: features.length,
    truncated: next !== null && next !== undefined,
    date: first?.metadata?.date,
    resolution: FINE,
  };
}

export function planRisk({ date, place, zoom, viewport, current }) {
  const day = date || "latest";
  const scope = `risk|${day}`;
  if (zoom >= DETAIL_MIN_ZOOM) {
    const box = pickBox(scope, viewport, current);
    if (box === undefined) return { key: `risk|outside|${day}`, load: async () => emptyResult(FINE) };
    if (box) {
      return {
        key: `risk|view|${day}|${bboxText(box)}`,
        scope,
        box,
        load: (signal) => loadRisk(box, date, signal).then((result) => {
          rememberBox(scope, box);
          return result;
        }),
      };
    }
  }
  if (place) return { key: `risk|place|${day}|${place.id}`, load: (signal) => loadRisk(place.bbox, date, signal) };
  return { key: "risk|none", empty: "noplace" };
}

/* ------------------------------------------------------------------ */
/* Colours                                                             */
/* ------------------------------------------------------------------ */

// Fixed stops aligned with the backend risk levels (low < 0.10 <= moderate < 0.25 ...).
const RISK_COLOR = [
  "interpolate", ["linear"], ["coalesce", ["get", "value"], 0],
  0, "#35b985", 0.1, "#b9d947", 0.25, "#f5c84c", 0.5, "#ee7045", 1, "#c63357",
];

// Fire counts are heavily skewed, so history colours follow percentiles of the data.
function historyColor(geojson) {
  const sorted = geojson.features.map((feature) => feature.properties.value).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const stops = [1, q(0.5), q(0.75), q(0.9), q(0.98)];
  for (let i = 1; i < stops.length; i += 1) if (stops[i] <= stops[i - 1]) stops[i] = stops[i - 1] + 1;
  return [
    "interpolate", ["linear"], ["coalesce", ["get", "value"], 0],
    0, "#2e9e5b",
    stops[0], "#8cc152",
    stops[1], "#f5c84c",
    stops[2], "#ee8a3c",
    stops[3], "#d9482b",
    stops[4], "#7f0f2a",
  ];
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */
// One GeoJSON source + fill layer for both modes, created once when the map loads.
// Updates only swap the data (setData) and the colour expression.

export const HEAT_FILL = "heat-fill";
const HEAT_SOURCE = "heat-source";
const HEAT_OUTLINE = "heat-outline";
const SELECTED_SOURCE = "selected-cell-source";
const SELECTED_LINE = "selected-cell-line";
const EMPTY = { type: "FeatureCollection", features: [] };

export function addOverlayLayers(map) {
  map.addSource(HEAT_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({ id: HEAT_FILL, type: "fill", source: HEAT_SOURCE, paint: { "fill-color": RISK_COLOR, "fill-opacity": 0.68 } });
  map.addLayer({
    id: HEAT_OUTLINE,
    type: "line",
    source: HEAT_SOURCE,
    paint: { "line-color": "rgba(255,255,255,0.22)", "line-width": 0.6 },
  });
  map.addSource(SELECTED_SOURCE, { type: "geojson", data: EMPTY });
  map.addLayer({ id: SELECTED_LINE, type: "line", source: SELECTED_SOURCE, paint: { "line-color": "#ffffff", "line-width": 2.5 } });
}

export function setHeatmap(map, mode, geojson) {
  const data = geojson || EMPTY;
  const isRisk = mode === "risk";
  map.setPaintProperty(HEAT_FILL, "fill-color", isRisk ? RISK_COLOR : historyColor(data));
  map.setPaintProperty(HEAT_FILL, "fill-opacity", isRisk ? 0.68 : 0.7);
  map.setLayoutProperty(HEAT_OUTLINE, "visibility", isRisk ? "visible" : "none");
  map.getSource(HEAT_SOURCE).setData(data);
}

export function setSelectedCell(map, cell) {
  const data = cell
    ? { type: "Feature", geometry: { type: "Polygon", coordinates: [squareRing(cell.row, cell.col, cell.deg)] }, properties: {} }
    : EMPTY;
  map.getSource(SELECTED_SOURCE).setData(data);
}
