import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttributionControl, Map as MapLibreMap, Marker } from "maplibre-gl";
import {
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

const STARTING_VIEW = { center: [0, 18], zoom: 2 };
const MAP_OPTIONS = [
  { id: "street", label: "Street", icon: MapPin },
  { id: "satellite", label: "Satellite", icon: Satellite },
  { id: "terrain", label: "Terrain", icon: Mountain },
];

function streetStyle(theme) {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [
          theme === "dark"
            ? "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
            : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: theme === "dark"
          ? "&copy; OpenStreetMap contributors &copy; CARTO"
          : "&copy; OpenStreetMap contributors",
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

function getMapStyle(type, theme) {
  if (type === "street") return streetStyle(theme);

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
        <p>Explore every corner of the living planet.</p>
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
            <span>FIRE RISK & WEATHER LAYERS</span>
            <small>Future layer extension</small>
          </div>
        </div>
      )}

      <div className="map-atmosphere">
        <span className="atmosphere-icon"><Orbit size={14} /></span>
        <span>{mapReady ? "GLOBAL MAP · LIVE" : "CONNECTING TO ATLAS"}</span>
      </div>
      <div className="map-scale-label">NAVIGATE · OBSERVE · UNDERSTAND</div>
      {/* Future layer hook: attach fire-risk contours and weather sources here when APIs exist. */}
      <div className="map-layer-extension" aria-hidden="true" />
    </section>
  );
}
