import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker } from "maplibre-gl";
import {
  Activity,
  AlertCircle,
  CalendarDays,
  ChevronDown,
  Compass,
  Crosshair,
  Layers2,
  MapPin,
  Orbit,
  Search,
  Satellite,
  Mountain,
  X,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../services/api.js";

const STARTING_VIEW = { center: [0, 18], zoom: 2 };
const MAP_OPTIONS = [
  { id: "street", label: "Street", icon: MapPin },
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "terrain", label: "Terrain", icon: Mountain },
];

function streetStyle() {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

const BASE_STYLES = {
  satellite: {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Tiles &copy; Esri",
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  },
  terrain: {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors &copy; OpenTopoMap",
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  },
};
const RISK_SOURCE = "fire-risk-source";
const RISK_FILL = "fire-risk-fill";
const RISK_OUTLINE = "fire-risk-outline";
const HISTORY_SOURCE = "fire-history-source";
const HISTORY_FILL = "fire-history-fill";

function getMapStyle(type, theme) {
  if (type === "street") return streetStyle();

  const style = BASE_STYLES[type];
  return {
    ...style,
    layers: style.layers.map((layer) => ({
      ...layer,
      paint: theme === "dark"
        ? { "raster-brightness-max": 0.82, "raster-saturation": -0.25 }
        : { "raster-brightness-max": 1, "raster-saturation": 0 },
    })),
  };
}

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
  };
}

export default function MapExplorer({ theme }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const searchMarkerRef = useRef(null);
  const selectedThemeRef = useRef(theme);
  const lastStyleKeyRef = useRef(`street:${theme}`);
  const selectedResultRef = useRef("");
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
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [viewMode, setViewMode] = useState("risk");
  const [historyMonths, setHistoryMonths] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyData, setHistoryData] = useState(null);
  const [historyStatus, setHistoryStatus] = useState("idle");
  const [historyError, setHistoryError] = useState("");
  const [historyHover, setHistoryHover] = useState("");
  const [riskData, setRiskData] = useState(null);
  const [riskStatus, setRiskStatus] = useState("loading");
  const [riskError, setRiskError] = useState("");
  const [selectedCell, setSelectedCell] = useState(null);
  const [cellStatus, setCellStatus] = useState("idle");
  const [cellError, setCellError] = useState("");
  const [timeseries, setTimeseries] = useState(null);
  const [timeseriesStatus, setTimeseriesStatus] = useState("idle");
  const [selectedFeature, setSelectedFeature] = useState("risk");
  const currentStyle = useMemo(() => getMapStyle(mapType, theme), [mapType, theme]);

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

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationMessage("Location is not available in this browser. Showing the global view.");
      return;
    }
    setLocationMessage("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      markUserLocation,
      () => setLocationMessage("Location unavailable. You can search for a place instead."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, [markUserLocation]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    try {
      // The map instance stays in a ref; its internal render loop handles pan/zoom
      // without pushing high-frequency camera updates through React.
      const map = new MapLibreMap({
        container: containerRef.current,
        style: getMapStyle("street", selectedThemeRef.current),
        ...STARTING_VIEW,
        maxTileCacheSize: 512,
        refreshExpiredTiles: false,
        attributionControl: false,
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.addControl(new AttributionControl({ compact: true }), "bottom-right");
      map.on("load", () => {
        setMapReady(true);
        requestLocation();
      });
      map.on("error", (event) => {
        if (event.error) setMapError("Some map tiles could not be loaded. Check your connection.");
      });
    } catch (error) {
      console.error("Could not initialize the map:", error);
      setMapError("The interactive map could not be initialized in this browser.");
    }

    return () => {
      userMarkerRef.current?.remove();
      searchMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [requestLocation]);

  useEffect(() => {
    selectedThemeRef.current = theme;
    const styleKey = `${mapType}:${theme}`;
    if (mapRef.current && lastStyleKeyRef.current !== styleKey) {
      mapRef.current.setStyle(currentStyle);
      lastStyleKeyRef.current = styleKey;
    }
  }, [currentStyle, mapType, theme]);

  const paintRiskLayer = useCallback((data) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer(RISK_FILL)) map.removeLayer(RISK_FILL);
    if (map.getLayer(RISK_OUTLINE)) map.removeLayer(RISK_OUTLINE);
    if (map.getSource(RISK_SOURCE)) map.removeSource(RISK_SOURCE);
    map.addSource(RISK_SOURCE, { type: "geojson", data });
    map.addLayer({
      id: RISK_FILL,
      type: "fill",
      source: RISK_SOURCE,
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "value"], 0],
          0, "#35b985", 0.1, "#b9d947", 0.25, "#f5c84c", 0.5, "#ee7045", 1, "#c63357",
        ],
        "fill-opacity": 0.68,
      },
    });
    map.addLayer({
      id: RISK_OUTLINE,
      type: "line",
      source: RISK_SOURCE,
      paint: { "line-color": "rgba(255,255,255,0.22)", "line-width": 0.6 },
    });
  }, []);

  const paintHistoryLayer = useCallback((data) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer(HISTORY_FILL)) map.removeLayer(HISTORY_FILL);
    if (map.getSource(HISTORY_SOURCE)) map.removeSource(HISTORY_SOURCE);
    const cellDeg = data.cell_deg || 0.1;
    const features = (data.cells || []).map(([row, column, value]) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [column * cellDeg, row * cellDeg],
          [(column + 1) * cellDeg, row * cellDeg],
          [(column + 1) * cellDeg, (row + 1) * cellDeg],
          [column * cellDeg, (row + 1) * cellDeg],
          [column * cellDeg, row * cellDeg],
        ]],
      },
      properties: { value },
    }));
    map.addSource(HISTORY_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({
      id: HISTORY_FILL,
      type: "fill",
      source: HISTORY_SOURCE,
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "value"], 0],
          0, "#ffffb2", 1, "#fecc5c", 5, "#fd8d3c", 15, "#e31a1c", 30, "#7f0000",
        ],
        "fill-opacity": 0.75,
      },
    });
  }, []);

  useEffect(() => {
    let active = true;
    setRiskStatus("loading");
    setRiskError("");
    if (viewMode !== "risk") return undefined;
    api.heatmap({ date: selectedDate, layer: "risk", limit: 5000, offset: 0 })
      .then((data) => {
        if (!active) return;
        setRiskData(data);
        setRiskStatus(data.features?.length ? "ready" : "empty");
        if (mapRef.current?.isStyleLoaded()) paintRiskLayer(data);
      })
      .catch((error) => {
        if (!active) return;
        setRiskStatus("error");
        setRiskError(error.message);
      });
    return () => { active = false; };
  }, [paintRiskLayer, selectedDate, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (viewMode === "risk" && map.getLayer(HISTORY_FILL)) {
      map.removeLayer(HISTORY_FILL);
      if (map.getSource(HISTORY_SOURCE)) map.removeSource(HISTORY_SOURCE);
    }
    if (viewMode === "history" && map.getLayer(RISK_FILL)) {
      map.removeLayer(RISK_FILL);
      if (map.getLayer(RISK_OUTLINE)) map.removeLayer(RISK_OUTLINE);
      if (map.getSource(RISK_SOURCE)) map.removeSource(RISK_SOURCE);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "history") return undefined;
    let active = true;
    setHistoryStatus("loading");
    setHistoryError("");
    api.historyMonths()
      .then(({ first, last }) => {
        const months = [];
        const cursor = new Date(`${first}T00:00:00Z`);
        const end = new Date(`${last}T00:00:00Z`);
        while (cursor <= end) {
          months.push(cursor.toISOString().slice(0, 10));
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        if (active) {
          setHistoryMonths(months);
          setHistoryIndex(Math.max(0, months.length - 1));
        }
      })
      .catch((error) => { if (active) { setHistoryStatus("error"); setHistoryError(error.message); } });
    return () => { active = false; };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "history" || !historyMonths.length) return undefined;
    let active = true;
    setHistoryStatus("loading");
    api.historyGrid(historyMonths[historyIndex])
      .then((data) => {
        if (!active) return;
        setHistoryData(data);
        setHistoryStatus(data.cells?.length ? "ready" : "empty");
        if (mapRef.current?.isStyleLoaded()) paintHistoryLayer(data);
      })
      .catch((error) => { if (active) { setHistoryStatus("error"); setHistoryError(error.message); } });
    return () => { active = false; };
  }, [historyIndex, historyMonths, paintHistoryLayer, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || viewMode !== "history" || !historyMonths.length) return undefined;
    let ticket = 0;
    const loadDetail = () => {
      if (map.getZoom() < 9) return;
      const bounds = map.getBounds();
      const bbox = [
        bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
      ].map((value) => value.toFixed(4)).join(",");
      const current = ++ticket;
      api.historyDetail(bbox, historyMonths[historyIndex])
        .then((data) => {
          if (current === ticket) {
            setHistoryData(data);
            paintHistoryLayer(data);
          }
        })
        .catch((error) => { if (current === ticket) setHistoryError(error.message); });
    };
    map.on("moveend", loadDetail);
    loadDetail();
    return () => map.off("moveend", loadDetail);
  }, [historyIndex, historyMonths, mapReady, paintHistoryLayer, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || viewMode !== "history" || !map.getLayer(HISTORY_FILL)) return undefined;
    let controller;
    const handleMove = (event) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [HISTORY_FILL] })[0];
      if (!feature) return;
      if (controller) controller.abort();
      controller = new AbortController();
      const coordinates = feature.geometry.coordinates[0];
      const lat = (coordinates[0][1] + coordinates[2][1]) / 2;
      const lon = (coordinates[0][0] + coordinates[2][0]) / 2;
      api.historyPoint(lat, lon, historyData?.cell_deg || 0.1)
        .then((data) => setHistoryHover(`${data.fires.total.toLocaleString()} fires in this cell`))
        .catch(() => {});
    };
    const clear = () => setHistoryHover("");
    map.on("mousemove", handleMove);
    map.on("mouseleave", HISTORY_FILL, clear);
    return () => {
      if (controller) controller.abort();
      map.off("mousemove", handleMove);
      map.off("mouseleave", HISTORY_FILL, clear);
    };
  }, [historyData, viewMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const onStyleLoad = () => {
      if (viewMode === "risk" && riskData) paintRiskLayer(riskData);
      if (viewMode === "history" && historyData) paintHistoryLayer(historyData);
    };
    map.on("style.load", onStyleLoad);
    return () => map.off("style.load", onStyleLoad);
  }, [historyData, paintHistoryLayer, paintRiskLayer, riskData, viewMode]);

  const selectCell = useCallback((cellId) => {
    setSelectedCell(null);
    setCellStatus("loading");
    setCellError("");
    setTimeseries(null);
    setTimeseriesStatus("idle");
    api.cell(cellId, selectedDate)
      .then((data) => {
        setSelectedCell(data);
        setCellStatus("ready");
      })
      .catch((error) => {
        setCellStatus("error");
        setCellError(error.message);
      });
  }, [selectedDate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (!map.getLayer(RISK_FILL) && !map.getLayer(HISTORY_FILL))) return undefined;
    const handleClick = (event) => {
      const layer = viewMode === "history" ? HISTORY_FILL : RISK_FILL;
      const features = map.queryRenderedFeatures(event.point, { layers: [layer] });
      const cellId = features[0]?.properties?.cell_id;
      if (cellId && viewMode === "risk") selectCell(cellId);
    };
    const handleEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const handleLeave = () => { map.getCanvas().style.cursor = ""; };
    const layer = viewMode === "history" ? HISTORY_FILL : RISK_FILL;
    map.on("click", layer, handleClick);
    map.on("mouseenter", layer, handleEnter);
    map.on("mouseleave", layer, handleLeave);
    return () => {
      map.off("click", layer, handleClick);
      map.off("mouseenter", layer, handleEnter);
      map.off("mouseleave", layer, handleLeave);
    };
  }, [selectCell, mapReady, riskData, historyData, viewMode]);

  function loadTimeseries(feature) {
    if (!selectedCell) return;
    const end = selectedDate;
    const startDate = new Date(`${end}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - 13);
    const start = startDate.toISOString().slice(0, 10);
    setSelectedFeature(feature);
    setTimeseriesStatus("loading");
    api.timeseries(selectedCell.cell_id, feature, start, end)
      .then((data) => { setTimeseries(data); setTimeseriesStatus(data.points?.length ? "ready" : "empty"); })
      .catch((error) => { setTimeseriesStatus("error"); setCellError(error.message); });
  }

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

  const selectPlace = useCallback((place) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({ center: place.center, zoom: 10, duration: 1400 });
    if (!searchMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "search-location-marker";
      searchMarkerRef.current = new Marker({ element, anchor: "bottom" })
        .setLngLat(place.center)
        .addTo(mapRef.current);
    } else {
      searchMarkerRef.current.setLngLat(place.center);
    }
    const selectedLabel = place.label.split(",")[0];
    selectedResultRef.current = selectedLabel;
    setSearchText(selectedLabel);
    setResults([]);
    setHasSearched(false);
    setSearchError("");
  }, []);

  function recenter() {
    if (userMarkerRef.current && mapRef.current) {
      mapRef.current.flyTo({ center: userMarkerRef.current.getLngLat(), zoom: 11, duration: 1000 });
    } else {
      requestLocation();
    }
  }

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
            <input id="risk-date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            <span className={`risk-state risk-state-${riskStatus}`}>
              {riskStatus === "loading" ? "Loading risk grid" : riskStatus === "error" ? "Unavailable" : riskStatus === "empty" ? "No data" : `${riskData?.features?.length || 0} cells`}
            </span>
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
            <span className={`risk-state risk-state-${historyStatus}`}>
              {historyMonths[historyIndex] ? `Up to ${historyMonths[historyIndex].slice(0, 7)}` : "Loading history"}
            </span>
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
              if (event.key === "Escape") {
                setSearchText("");
                setResults([]);
              }
            }}
          />
          {isSearching && <span className="search-spinner" aria-label="Searching" />}
          {searchText && (
            <button
              className="clear-search"
              type="button"
              onClick={() => { selectedResultRef.current = ""; setSearchText(""); setResults([]); setHasSearched(false); }}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {(results.length > 0 || searchError || hasSearched) && (
          <div className="search-results" role="listbox" aria-label="Search results">
            {searchError && <p className="search-feedback" role="alert">{searchError}</p>}
            {results.map((place) => (
              <button
                className="search-result"
                type="button"
                role="option"
                aria-selected="false"
                key={place.id}
                onClick={() => selectPlace(place)}
              >
                <MapPin size={16} />
                <span>{place.label}</span>
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
            <span>FIRE RISK LAYER ACTIVE</span>
            <small>Colour shows predicted probability · click a cell for details</small>
          </div>
        </div>
      )}

      <div className="map-atmosphere">
        <span className="atmosphere-icon"><Orbit size={14} /></span>
        <span>{mapReady ? (viewMode === "risk" ? "FIRE RISK · PREDICTED PROBABILITY" : `FIRE HISTORY · CUMULATIVE HOTSPOTS${historyHover ? ` · ${historyHover}` : ""}`) : "LOADING BASEMAP"}</span>
      </div>
      <div className="map-scale-label">NAVIGATE · OBSERVE · UNDERSTAND</div>
      {riskError && <div className="map-status risk-error" role="alert"><AlertCircle size={14} /> {riskError}</div>}
      {historyError && viewMode === "history" && <div className="map-status risk-error" role="alert"><AlertCircle size={14} /> {historyError}</div>}
      {selectedCell && (
        <aside className="risk-detail-panel" aria-label="Selected cell risk details">
          <button className="detail-close" type="button" onClick={() => { setSelectedCell(null); setTimeseries(null); }} aria-label="Close risk details"><X size={15} /></button>
          <span className="detail-kicker"><Activity size={13} /> CELL {selectedCell.cell_id}</span>
          <h2>{selectedCell.location.district || "Selected area"}</h2>
          <p className="detail-location">{selectedCell.location.lat.toFixed(3)}, {selectedCell.location.lon.toFixed(3)} · {selectedCell.date}</p>
          <div className={`risk-score risk-${selectedCell.prediction.level}`}>
            <strong>{Math.round(selectedCell.prediction.probability * 100)}%</strong>
            <span>{selectedCell.prediction.level} fire risk</span>
          </div>
          <div className="weather-grid">
            <span><b>{selectedCell.weather.temp_c ?? "—"}°</b> temperature</span>
            <span><b>{selectedCell.weather.rainfall_mm ?? "—"} mm</b> rainfall</span>
            <span><b>{selectedCell.weather.wind_speed ?? "—"}</b> wind speed</span>
            <span><b>{selectedCell.static.elevation ?? "—"} m</b> elevation</span>
          </div>
          <div className="detail-actions">
            <label htmlFor="detail-feature">Trend</label>
            <div className="select-wrap">
              <select id="detail-feature" value={selectedFeature} onChange={(event) => loadTimeseries(event.target.value)}>
                <option value="risk">Predicted risk</option>
                <option value="fwi">Fire weather index</option>
                <option value="ndvi">Vegetation index</option>
                <option value="ndmi">Moisture index</option>
                <option value="rainfall_mm">Rainfall</option>
                <option value="temp_c">Temperature</option>
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          {cellStatus === "loading" && <p className="detail-feedback">Loading local prediction…</p>}
          {cellStatus === "error" && <p className="detail-feedback detail-error">{cellError}</p>}
          {timeseriesStatus === "idle" && <button className="trend-button" type="button" onClick={() => loadTimeseries(selectedFeature)}>Load 14-day trend</button>}
          {timeseriesStatus === "loading" && <p className="detail-feedback">Loading trend…</p>}
          {timeseriesStatus === "error" && <p className="detail-feedback detail-error">{cellError}</p>}
          {timeseriesStatus === "empty" && <p className="detail-feedback">No trend data for this period.</p>}
          {timeseriesStatus === "ready" && (
            <div className="trend-list" aria-label={`${timeseries.label} trend`}>
              {timeseries.points.map((point) => <div className="trend-row" key={point.date}><span>{point.date.slice(5)}</span><i><em style={{ width: `${Math.min(100, Math.max(3, (point.value || 0) * (selectedFeature === "risk" ? 100 : 10)))}%` }} /></i><b>{point.value ?? "—"}{timeseries.unit && ` ${timeseries.unit}`}</b></div>)}
            </div>
          )}
        </aside>
      )}
    </section>
  );
}
