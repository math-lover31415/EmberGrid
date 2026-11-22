import { useEffect, useRef, useState } from "react";
import { Activity, ChevronDown, Flame, X } from "lucide-react";
import { api } from "../services/api.js";

const show = (value) => value ?? "—";

// Loads panel data for the current cell. The request is cancelled when the panel
// switches to another cell or closes (a queued history request is then never sent).
// `delay` waits briefly first, so quickly clicking through cells doesn't start slow
// backend lookups for cells the user has already moved past.
function usePanelData(load, key, delay = 0) {
  const [state, setState] = useState({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = window.setTimeout(() => {
      load(controller.signal)
        .then((data) => setState({ status: "ready", data }))
        .catch((error) => {
          if (error.name !== "AbortError") setState({ status: "error", error: error.message });
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function Panel({ label, kicker, icon: Icon, onClose, children }) {
  return (
    <aside className="risk-detail-panel" aria-label={label}>
      <button className="detail-close" type="button" onClick={onClose} aria-label="Close details"><X size={15} /></button>
      <span className="detail-kicker"><Icon size={13} /> {kicker}</span>
      {children}
    </aside>
  );
}

function RiskScore({ prediction }) {
  return (
    <div className={`risk-score risk-${prediction.level}`}>
      <strong>{Math.round(prediction.probability * 100)}%</strong>
      <span>{prediction.level} fire risk</span>
    </div>
  );
}

/* ------------------------------ Risk mode ------------------------------ */

export function RiskCellPanel({ cellId, date, onClose }) {
  const cell = usePanelData((signal) => api.cell(cellId, date, signal), `${cellId}|${date}`);
  const [feature, setFeature] = useState("risk");
  const [trend, setTrend] = useState({ status: "idle" });
  const trendRequest = useRef(null);

  useEffect(() => {
    setTrend({ status: "idle" });
    return () => trendRequest.current?.abort();
  }, [cellId, date]);

  function loadTrend(nextFeature) {
    const data = cell.data;
    setFeature(nextFeature);
    if (!data) return;
    const end = data.date;
    const startDate = new Date(`${end}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - 13);
    const start = startDate.toISOString().slice(0, 10);
    trendRequest.current?.abort();
    const controller = new AbortController();
    trendRequest.current = controller;
    setTrend({ status: "loading" });
    api.timeseries(data.cell_id, nextFeature, start, end, controller.signal)
      .then((series) => setTrend({ status: series.points?.length ? "ready" : "empty", series }))
      .catch((error) => {
        if (error.name !== "AbortError") setTrend({ status: "error", error: error.message });
      });
  }

  const data = cell.data;
  return (
    <Panel label="Selected cell risk details" kicker={`CELL ${cellId}`} icon={Activity} onClose={onClose}>
      {cell.status === "loading" && <p className="detail-feedback">Loading local prediction…</p>}
      {cell.status === "error" && <p className="detail-feedback detail-error">{cell.error}</p>}
      {data && (
        <>
          <h2>{data.location?.district || "Selected area"}</h2>
          <p className="detail-location">{data.location?.lat?.toFixed(3)}, {data.location?.lon?.toFixed(3)} · {data.date}</p>
          {data.prediction
            ? <RiskScore prediction={data.prediction} />
            : <p className="detail-feedback">No prediction for this cell on {data.date}.</p>}
          <div className="weather-grid">
            <span><b>{show(data.weather?.temp_c)}°</b> temperature</span>
            <span><b>{show(data.weather?.rainfall_mm)} mm</b> rainfall</span>
            <span><b>{show(data.weather?.wind_speed)}</b> wind speed</span>
            <span><b>{show(data.static?.elevation)} m</b> elevation</span>
          </div>
          <div className="detail-actions">
            <label htmlFor="detail-feature">Trend</label>
            <div className="select-wrap">
              <select id="detail-feature" value={feature} onChange={(event) => loadTrend(event.target.value)}>
                <option value="risk">Predicted risk</option>
                <option value="fwi">Fire weather index</option>
                <option value="rainfall_mm">Rainfall</option>
                <option value="temp_c">Temperature</option>
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          {trend.status === "idle" && <button className="trend-button" type="button" onClick={() => loadTrend(feature)}>Load 14-day trend</button>}
          {trend.status === "loading" && <p className="detail-feedback">Loading trend…</p>}
          {trend.status === "error" && <p className="detail-feedback detail-error">{trend.error}</p>}
          {trend.status === "empty" && <p className="detail-feedback">No trend data for this period.</p>}
          {trend.status === "ready" && (
            <div className="trend-list" aria-label={`${trend.series.label} trend`}>
              {trend.series.points.map((point) => (
                <div className="trend-row" key={point.date}>
                  <span>{point.date.slice(5)}</span>
                  <i><em style={{ width: `${Math.min(100, Math.max(3, (point.value || 0) * (feature === "risk" ? 100 : 10)))}%` }} /></i>
                  <b>{point.value ?? "—"}{trend.series.unit && ` ${trend.series.unit}`}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ----------------------------- History mode ---------------------------- */

// cell = { row, col, deg, value, month } from the clicked heatmap square: the count is
// shown straight away; place, latest conditions and yearly totals load from /history/point.
export function HistoryCellPanel({ cell, onClose }) {
  const lat = (cell.row + 0.5) * cell.deg;
  const lon = (cell.col + 0.5) * cell.deg;
  const point = usePanelData(
    (signal) => api.historyPoint(lat, lon, cell.deg, signal),
    `${cell.row}|${cell.col}|${cell.deg}`,
    400,
  );
  const data = point.data;
  const yearly = data?.fires?.yearly || [];
  const maxYear = Math.max(1, ...yearly.map((bar) => bar.n));
  const size = cell.deg < 0.05 ? "0.01° CELL · ~1 KM" : "0.1° BLOCK · ~11 KM";

  return (
    <Panel label="Selected cell fire history" kicker={`FIRE HISTORY · ${size}`} icon={Flame} onClose={onClose}>
      <h2>{data?.place?.label || "Selected area"}</h2>
      <p className="detail-location">{lat.toFixed(3)}, {lon.toFixed(3)}</p>
      <div className="risk-score risk-high">
        <strong>{Number(cell.value || 0).toLocaleString()}</strong>
        <span className="score-note">fires recorded in this cell up to {cell.month.slice(0, 7)}</span>
      </div>
      {point.status === "loading" && <p className="detail-feedback">Loading place and yearly history…</p>}
      {point.status === "error" && <p className="detail-feedback detail-error">{point.error}</p>}
      {data?.latest && (
        <>
          {data.latest.risk?.probability != null && <RiskScore prediction={data.latest.risk} />}
          <div className="weather-grid">
            <span><b>{show(data.latest.fwi)}</b> fire weather index</span>
            <span><b>{show(data.latest.temp_c)}°</b> temperature</span>
            <span><b>{show(data.latest.rainfall_mm)} mm</b> rainfall</span>
            <span><b>{show(data.elevation)} m</b> elevation</span>
          </div>
          <p className="detail-location">Latest conditions · {data.latest.date}</p>
        </>
      )}
      {yearly.length > 0 && (
        <>
          <p className="detail-feedback">
            {data.fires.total.toLocaleString()} fires in and around this cell ({data.fires.from.slice(0, 4)}–{data.fires.to.slice(0, 4)}), by year:
          </p>
          <div className="trend-list" aria-label="Fires per year">
            {yearly.map((bar) => (
              <div className="trend-row" key={bar.year}>
                <span>{bar.year}{bar.partial ? "*" : ""}</span>
                <i><em style={{ width: `${bar.n ? Math.max(3, (bar.n / maxYear) * 100) : 0}%` }} /></i>
                <b>{bar.n.toLocaleString()}</b>
              </div>
            ))}
          </div>
        </>
      )}
      {point.status === "ready" && yearly.length === 0 && <p className="detail-feedback">No yearly records near this cell.</p>}
    </Panel>
  );
}
