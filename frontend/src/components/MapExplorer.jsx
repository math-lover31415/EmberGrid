import { useCallback, useEffect, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker } from "maplibre-gl";
import {
  AlertCircle,
  CalendarDays,
  Compass,
  Crosshair,
  Layers2,
  MapPin,
  Minus,
  Mountain,
  Orbit,
  Plus,
  Satellite,
  Search,
  X,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../services/api.js";
import {
  HEAT_FILL,
  addOverlayLayers,
  applyBasemap,
  initialStyle,
  parseCellId,
  planHistory,
  planRisk,
  setHeatmap,
  setSelectedCell,
} from "./mapData.js";
import { HistoryCellPanel, RiskCellPanel } from "./CellDetailPanels.jsx";

const STARTING_VIEW = { center: [0, 18], zoom: 2 };
const MAP_OPTIONS = [
  { id: "street", label: "Street", icon: MapPin },
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "terrain", label: "Terrain", icon: Mountain },
];
const LOCATION_WAIT_MS = 2500; // how long the first heatmap load waits for the location fix
const SLIDER_SETTLE_MS = 300; // history slider: load once the user stops dragging
const NOTICE_MS = 6000;
const NO_HEAT = { status: "idle", error: "", cellCount: 0, truncated: false, resolution: "" };

// Keep geocoding behind one provider function so it can be swapped independently.
async function searchPlaces(query, signal) {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("Location search is temporarily unavailable.");
  return response.json();
}

function toPlace(result) {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: result.place_id,
    label: result.display_name,
    center: [longitude, latitude],
    bbox: toBbox(result.boundingbox, longitude, latitude),
  };
}

// Nominatim gives [south, north, west, east] as strings; we use [west, south, east, north].
// Tiny places (a village, a street) are padded so the box is at least ~0.2 degrees wide.
function toBbox(box, lon, lat) {
  const [south, north, west, east] = (box || []).map(Number);
  const valid = [south, north, west, east].every(Number.isFinite);
  const pad = (low, high, mid) => (high - low < 0.2 ? [mid - 0.1, mid + 0.1] : [low, high]);
  const [w, e] = pad(valid ? west : lon, valid ? east : lon, valid ? (west + east) / 2 : lon);
  const [s, n] = pad(valid ? south : lat, valid ? north : lat, valid ? (south + north) / 2 : lat);
  return [w, s, e, n];
}

function monthsBetween(first, last) {
  const months = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

// The cell under the cursor, read from the rendered heatmap feature (no request needed).
function cellFromFeature(feature, mode, month) {
  const props = feature.properties || {};
  if (mode === "risk") {
    const position = parseCellId(props.cell_id);
    if (!position) return null;
    return { kind: "risk", cellId: props.cell_id, ...position, deg: 0.01, value: props.value, level: props.level };
  }
  return { kind: "history", row: props.row, col: props.col, deg: props.deg, value: props.value, month };
}

function hoverLabel(cell) {
  if (cell.kind === "risk") {
    return cell.value == null ? "no prediction" : `${Math.round(cell.value * 100)}% ${cell.level || ""} risk`.trim();
  }
  return `${Number(cell.value || 0).toLocaleString()} fires in this cell`;
}

export default function MapExplorer({ theme }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const selectedResultRef = useRef("");
  // True once the map has loaded and our heatmap layers exist. (map.isStyleLoaded() is
  // not used: it is false whenever tiles are still loading, e.g. during the fly-to after
  // a search, which made finished heatmap requests skip painting.)
  const readyRef = useRef(false);
  const basemapRef = useRef({ type: "street", theme }); // what the map currently shows
  const wantedBasemapRef = useRef({ type: "street", theme });
  // The dataset on screen or loading: only the newest request (ticket) may paint.
  const heatRef = useRef({ ticket: 0, plan: null, controller: null });
  const locatingRef = useRef(false);
  const locateTimerRef = useRef(0);
  const hoverKeyRef = useRef("");
  const inputsRef = useRef({});

  const [mapType, setMapType] = useState("street");
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const [mapError, setMapError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [viewMode, setViewMode] = useState("history");
  const [place, setPlace] = useState(null);
  const [riskDate, setRiskDate] = useState("");
  const [historyMonths, setHistoryMonths] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyMonth, setHistoryMonth] = useState("");
  const [monthsError, setMonthsError] = useState("");
  const [heat, setHeat] = useState({ ...NO_HEAT, status: "loading" });
  const [hoverText, setHoverText] = useState("");
  const [selected, setSelected] = useState(null);

  // Latest values for code that runs from map events, outside React's render cycle.
  inputsRef.current = { viewMode, place, month: historyMonth, date: selectedDate };
  wantedBasemapRef.current = { type: mapType, theme };

  /* ---------------------------- heatmap loading ---------------------------- */

  // The single entry point for heatmap updates: mode/place/date/month changes and the
  // end of every pan/zoom call this. It works out which dataset the view needs, does
  // nothing if that dataset is already shown or loading, and lets only the newest
  // request paint (older ones are cancelled, or ignored if already running).
  const refreshHeatmap = useCallback(() => {
    const map = mapRef.current;
    // While the camera moves, wait: moveend calls this again with the final view.
    if (!map || !readyRef.current || locatingRef.current || map.isMoving()) return;
    const { viewMode: mode, place: currentPlace, month, date } = inputsRef.current;
    const bounds = map.getBounds();
    const view = {
      place: currentPlace,
      zoom: map.getZoom(),
      viewport: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      current: heatRef.current.plan,
    };
    const plan = mode === "risk" ? planRisk({ ...view, date }) : planHistory({ ...view, month });
    if (!plan || plan.key === heatRef.current.plan?.key) return;

    heatRef.current.controller?.abort();
    const controller = new AbortController();
    const ticket = heatRef.current.ticket + 1;
    heatRef.current = { ticket, plan, controller };

    if (plan.empty) {
      setHeatmap(map, mode, null);
      setHeat({ ...NO_HEAT, status: plan.empty });
      return;
    }
    // The previous heatmap stays visible until the new data arrives.
    setHeat((current) => ({ ...current, status: "loading", error: "" }));
    plan.load(controller.signal)
      .then((result) => {
        if (heatRef.current.ticket !== ticket || mapRef.current !== map) return;
        setHeatmap(map, mode, result.geojson);
        if (mode === "risk" && result.date && !inputsRef.current.date) setRiskDate(result.date);
        setHeat({
          status: result.cellCount ? "ready" : "empty",
          error: "",
          cellCount: result.cellCount,
          truncated: result.truncated,
          resolution: result.resolution,
        });
      })
      .catch((error) => {
        if (heatRef.current.ticket !== ticket || error.name === "AbortError") return;
        heatRef.current.plan = null; // so the next change or move retries
        const notFound = error.status === 404;
        if (notFound && mapRef.current === map) setHeatmap(map, mode, null);
        setHeat({ ...NO_HEAT, status: notFound ? "empty" : "error", error: notFound ? "" : error.message });
      });
  }, []);

  /* ------------------------------- map setup ------------------------------- */

  const syncBasemap = useCallback(() => {
    const map = mapRef.current;
    const shown = basemapRef.current;
    const wanted = wantedBasemapRef.current;
    if (!map || !readyRef.current || (shown.type === wanted.type && shown.theme === wanted.theme)) return;
    applyBasemap(map, wanted.type, wanted.theme, shown.type !== wanted.type);
    basemapRef.current = { ...wanted };
  }, []);

  const markUserLocation = useCallback((position) => {
    const location = [position.coords.longitude, position.coords.latitude];
    if (!mapRef.current) return;
    if (!userMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "user-location-marker";
      userMarkerRef.current = new Marker({ element, anchor: "center" })
        .setLngLat(location)
        .addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat(location);
    }
    mapRef.current.flyTo({ center: location, zoom: 11, duration: 1200 });
    setLocationMessage("");
  }, []);

  // `initial`: on first load, hold the heatmap request briefly until we know whether the
  // map is about to fly to the user, so we don't start a slow load for the world view.
  const requestLocation = useCallback((initial = false) => {
    const release = () => {
      if (!initial || !locatingRef.current) return;
      locatingRef.current = false;
      window.clearTimeout(locateTimerRef.current);
      refreshHeatmap();
    };
    if (!navigator.geolocation) {
      setLocationMessage("Location is not available in this browser. Showing the global view.");
      release();
      return;
    }
    if (initial) {
      locatingRef.current = true;
      locateTimerRef.current = window.setTimeout(release, LOCATION_WAIT_MS);
    }
    setLocationMessage("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        markUserLocation(position);
        release();
      },
      () => {
        setLocationMessage("Location unavailable. You can search for a place instead.");
        release();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [markUserLocation, refreshHeatmap]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    let map;
    try {
      // The map instance stays in a ref; its internal render loop handles pan/zoom
      // without pushing high-frequency camera updates through React.
      map = new MapLibreMap({
        container: containerRef.current,
        style: initialStyle(wantedBasemapRef.current.type, wantedBasemapRef.current.theme),
        ...STARTING_VIEW,
        minZoom: 2,
        maxZoom: 18,
        maxTileCacheSize: 512,
        refreshExpiredTiles: false,
        attributionControl: false,
        // Full-page map: plain scroll / drag zoom and pan directly. Rotation and tilt are
        // off because accidental right-drag rotation is easy and useless on a flat grid.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch (error) {
      console.error("Could not initialize the map:", error);
      setMapError("The interactive map could not be initialized in this browser.");
      return undefined;
    }
    basemapRef.current = { ...wantedBasemapRef.current };
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      addOverlayLayers(map);
      readyRef.current = true;
      syncBasemap();
      setMapReady(true);
      requestLocation(true);
      refreshHeatmap();
    });
    // Fires once at the end of every pan/zoom/fly (not on every frame).
    map.on("moveend", refreshHeatmap);

    // Hover reads the value of the cell under the cursor locally; React state only
    // changes when the cursor moves onto a different cell.
    map.on("mousemove", (event) => {
      if (!readyRef.current) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [HEAT_FILL] })[0];
      map.getCanvas().style.cursor = feature ? "pointer" : "";
      const { viewMode: mode, month } = inputsRef.current;
      const cell = feature ? cellFromFeature(feature, mode, month) : null;
      const key = cell ? `${mode}|${cell.row}|${cell.col}|${cell.deg}|${cell.value}` : "";
      if (key === hoverKeyRef.current) return;
      hoverKeyRef.current = key;
      setHoverText(cell ? hoverLabel(cell) : "");
    });
    map.on("mouseout", () => {
      hoverKeyRef.current = "";
      setHoverText("");
    });
    map.on("click", (event) => {
      if (!readyRef.current) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [HEAT_FILL] })[0];
      const { viewMode: mode, month } = inputsRef.current;
      const cell = feature ? cellFromFeature(feature, mode, month) : null;
      if (cell) setSelected(cell);
    });
    map.on("error", (event) => {
      if (event.error) setMapError("Some map tiles could not be loaded. Check your connection.");
    });

    return () => {
      readyRef.current = false;
      locatingRef.current = false;
      window.clearTimeout(locateTimerRef.current);
      heatRef.current.controller?.abort();
      heatRef.current = { ticket: heatRef.current.ticket + 1, plan: null, controller: null };
      userMarkerRef.current?.remove();
      searchMarkerRef.current?.remove();
      userMarkerRef.current = null;
      searchMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [refreshHeatmap, requestLocation, syncBasemap]);

  // Base map type / theme changes swap only the raster base layer.
  useEffect(() => {
    syncBasemap();
  }, [mapType, theme, syncBasemap]);

  // Tile/location notices are temporary.
  useEffect(() => {
    if (!mapError) return undefined;
    const timer = window.setTimeout(() => setMapError(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [mapError]);

  useEffect(() => {
    if (!locationMessage || locationMessage.startsWith("Finding")) return undefined;
    const timer = window.setTimeout(() => setLocationMessage(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [locationMessage]);

  /* --------------------------- heatmap triggers ---------------------------- */

  // Mode switch: remove the other mode's cells straight away, then load this mode.
  useEffect(() => {
    heatRef.current.controller?.abort();
    heatRef.current = { ticket: heatRef.current.ticket + 1, plan: null, controller: null };
    hoverKeyRef.current = "";
    setHoverText("");
    setSelected(null);
    setHeat({ ...NO_HEAT, status: "loading" });
    if (mapRef.current && readyRef.current) setHeatmap(mapRef.current, viewMode, null);
    refreshHeatmap();
  }, [viewMode, refreshHeatmap]);

  // Place, forecast date or history month changed (or the map just became ready).
  useEffect(() => {
    refreshHeatmap();
  }, [place, selectedDate, historyMonth, mapReady, refreshHeatmap]);

  // Outline the selected cell.
  useEffect(() => {
    if (mapRef.current && readyRef.current) setSelectedCell(mapRef.current, selected);
  }, [selected, mapReady]);

  // History months load once, so the slider keeps its position across mode switches.
  useEffect(() => {
    let active = true;
    api.historyMonths()
      .then(({ first, last }) => {
        if (!active) return;
        const months = monthsBetween(first, last);
        setHistoryMonths(months);
        setHistoryIndex(Math.max(0, months.length - 1));
        setHistoryMonth(months.at(-1) || "");
      })
      .catch((error) => { if (active) setMonthsError(error.message); });
    return () => { active = false; };
  }, []);

  // The slider label moves instantly; data loads once the slider settles.
  useEffect(() => {
    const month = historyMonths[historyIndex];
    if (!month || month === historyMonth) return undefined;
    const timer = window.setTimeout(() => setHistoryMonth(month), SLIDER_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [historyIndex, historyMonths, historyMonth]);

  /* --------------------------------- search -------------------------------- */

  useEffect(() => {
    const query = searchText.trim();
    if (query && query === selectedResultRef.current) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return undefined;
    }
    selectedResultRef.current = "";
    if (query.length < 3) {
      setResults([]);
      setSearchError("");
      setHasSearched(false);
      setIsSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((places) => {
          setResults(places.map(toPlace).filter(Boolean));
          setHasSearched(true);
        })
        .catch((error) => {
          if (error.name !== "AbortError") setSearchError(error.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 1000);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchText]);

  const selectPlace = useCallback((nextPlace) => {
    if (!mapRef.current) return;
    setPlace(nextPlace);
    setSelected(null);
    mapRef.current.fitBounds(
      [[nextPlace.bbox[0], nextPlace.bbox[1]], [nextPlace.bbox[2], nextPlace.bbox[3]]],
      { padding: 60, maxZoom: 11, duration: 1400 },
    );
    if (!searchMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "search-location-marker";
      searchMarkerRef.current = new Marker({ element, anchor: "bottom" })
        .setLngLat(nextPlace.center)
        .addTo(mapRef.current);
    } else {
      searchMarkerRef.current.setLngLat(nextPlace.center);
    }
    const selectedLabel = nextPlace.label.split(",")[0];
    selectedResultRef.current = selectedLabel;
    setSearchText(selectedLabel);
    setResults([]);
    setHasSearched(false);
    setSearchError("");
  }, []);

  function clearPlace() {
    selectedResultRef.current = "";
    setSearchText("");
    setResults([]);
    setHasSearched(false);
    setPlace(null);
    setSelected(null);
    if (searchMarkerRef.current) { searchMarkerRef.current.remove(); searchMarkerRef.current = null; }
  }

  function recenter() {
    if (userMarkerRef.current && mapRef.current) {
      mapRef.current.flyTo({ center: userMarkerRef.current.getLngLat(), zoom: 11, duration: 1000 });
    } else {
      requestLocation();
    }
  }

  /* --------------------------------- render -------------------------------- */

  const placeName = place?.label.split(",")[0];
  const riskBadge = {
    idle: "",
    noplace: "Search a place",
    loading: "Loading risk grid",
    error: "Unavailable",
    empty: "No risk data here",
    ready: `${heat.cellCount.toLocaleString()} cells${heat.truncated ? " (partial)" : ""}`,
  }[heat.status];
  const historyBadge = historyMonths[historyIndex]
    ? `Up to ${historyMonths[historyIndex].slice(0, 7)}${heat.status === "loading" ? " · loading…" : ""}`
    : "Loading history";
  const stripText = !mapReady
    ? "LOADING BASEMAP"
    : [
      viewMode === "risk" ? "FIRE RISK · PREDICTED PROBABILITY" : "FIRE HISTORY · CUMULATIVE HOTSPOTS",
      heat.status === "loading" ? "LOADING…" : heat.resolution,
      hoverText,
    ].filter(Boolean).join(" · ");

  return (
    <section className="map-workspace" aria-label="Interactive global map">
      <div className="map-canvas" ref={containerRef} />
      <div className="map-vignette" aria-hidden="true" />
      {mapError && <div className="map-status map-error" role="status">{mapError}</div>}
      {locationMessage && <div className="map-status location-status" role="status">{locationMessage}</div>}

      <div className="map-heading">
        <span className="map-overline"><span className="status-dot" /> PLANETARY OBSERVATION</span>
        <h1>Your world,<br /><em>in perspective.</em></h1>
        <p>Fire risk forecast · click a cell to inspect local conditions.</p>
      </div>

      <div className="risk-controls" aria-label="Fire risk controls">
        <div className="mode-toggle" role="group" aria-label="Map data mode">
          <button type="button" className={viewMode === "risk" ? "selected" : ""} onClick={() => setViewMode("risk")}>Risk</button>
          <button type="button" className={viewMode === "history" ? "selected" : ""} onClick={() => setViewMode("history")}>History</button>
        </div>
        {viewMode === "risk" ? (
          <>
            <label htmlFor="risk-date"><CalendarDays size={14} /> FORECAST DATE</label>
            <input id="risk-date" type="date" value={selectedDate || riskDate} onChange={(event) => setSelectedDate(event.target.value)} />
            <span className={`risk-state risk-state-${heat.status}`}>{riskBadge}</span>
          </>
        ) : (
          <>
            <label htmlFor="history-slider"><CalendarDays size={14} /> HISTORY</label>
            <input
              id="history-slider"
              className="history-slider"
              type="range"
              min="0"
              max={Math.max(0, historyMonths.length - 1)}
              value={historyIndex}
              onChange={(event) => setHistoryIndex(Number(event.target.value))}
              disabled={!historyMonths.length}
            />
            <span className={`risk-state risk-state-${heat.status}`}>{historyBadge}</span>
          </>
        )}
      </div>

      <div className="map-search-panel">
        <div className="search-control">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="Search for a place"
            type="search"
            placeholder="Search a place or location..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") clearPlace();
            }}
          />
          {isSearching && <span className="search-spinner" aria-label="Searching" />}
          {searchText && (
            <button
              className="clear-search"
              type="button"
              onClick={clearPlace}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {(results.length > 0 || searchError || hasSearched) && (
          <div className="search-results" role="listbox" aria-label="Search results">
            {searchError && <p className="search-feedback" role="alert">{searchError}</p>}
            {results.map((result) => (
              <button
                className="search-result"
                type="button"
                role="option"
                aria-selected="false"
                key={result.id}
                onClick={() => selectPlace(result)}
              >
                <MapPin size={16} />
                <span>{result.label}</span>
              </button>
            ))}
            {results.length === 0 && !searchError && <p className="search-feedback">No places found.</p>}
          </div>
        )}
        {searchText.trim().length > 0 && searchText.trim().length < 3 && (
          <p className="search-hint">Type at least 3 characters to search.</p>
        )}
      </div>

      <div className="map-tool-stack">
        <button
          className={`map-tool ${isStyleMenuOpen ? "tool-active" : ""}`}
          type="button"
          onClick={() => setIsStyleMenuOpen((open) => !open)}
          aria-label="Choose map style"
          aria-expanded={isStyleMenuOpen}
          title="Map style"
        >
          <Layers2 size={19} />
        </button>
        <button
          className="map-tool"
          type="button"
          onClick={recenter}
          aria-label="Recenter on my location"
          title={mapReady ? "Recenter on my location" : "Map is loading"}
          disabled={!mapReady}
        >
          <Crosshair size={19} />
        </button>
        <button className="map-tool" type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in" title="Zoom in" disabled={!mapReady}>
          <Plus size={19} />
        </button>
        <button className="map-tool" type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out" title="Zoom out" disabled={!mapReady}>
          <Minus size={19} />
        </button>
      </div>

      {isStyleMenuOpen && (
        <div className="map-style-switcher" aria-label="Map style">
          <span className="switcher-title"><Compass size={13} /> MAP LAYERS</span>
          <div className="style-options">
            {MAP_OPTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`style-option ${mapType === id ? "selected" : ""}`}
                type="button"
                onClick={() => setMapType(id)}
                aria-pressed={mapType === id}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="layer-extension">
            <span className="extension-dot" />
            <span>{viewMode === "risk" ? "FIRE RISK LAYER ACTIVE" : "FIRE HISTORY LAYER ACTIVE"}</span>
            <small>
              {viewMode === "risk"
                ? "Colour shows predicted probability · click a cell for details"
                : "Colour shows recorded fire count · zoom in for 1 km cells · click a cell for details"}
            </small>
          </div>
        </div>
      )}

      <div className="map-atmosphere">
        <span className="atmosphere-icon"><Orbit size={14} /></span>
        <span>{stripText}</span>
      </div>
      <div className="map-scale-label">NAVIGATE · OBSERVE · UNDERSTAND</div>
      {viewMode === "risk" && heat.status === "noplace" && (
        <div className="map-status risk-error" role="status">Search a place (a city, district or state) or zoom in to see its fire risk.</div>
      )}
      {viewMode === "risk" && heat.status === "empty" && (
        <div className="map-status risk-error" role="status">
          No risk predictions for {placeName || "this area"}{selectedDate ? ` on ${selectedDate}` : ""}. Predictions only exist for areas and dates that have been scored.
        </div>
      )}
      {heat.error && <div className="map-status risk-error" role="alert"><AlertCircle size={14} /> {heat.error}</div>}
      {monthsError && viewMode === "history" && <div className="map-status risk-error" role="alert"><AlertCircle size={14} /> {monthsError}</div>}

      {selected?.kind === "risk" && (
        <RiskCellPanel cellId={selected.cellId} date={selectedDate || riskDate} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === "history" && (
        <HistoryCellPanel cell={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
