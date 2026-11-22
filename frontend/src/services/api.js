const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
  /\/+$/,
  "",
);
const SESSION_KEY = "ember-grid-session";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getErrorMessage(payload) {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return payload.message || "Something went wrong. Please try again.";
}

function readSession() {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(tokens) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function request(path, { body, token, signal } = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
      0,
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(payload),
      response.status,
    );
  }
  return payload;
}

async function get(path, token, signal) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
      0,
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      getErrorMessage(payload),
      response.status,
    );
  }
  return payload;
}

async function refreshSession() {
  const session = readSession();
  if (!session?.refreshToken) return null;

  try {
    const tokens = await request("/auth/refresh", {
      body: { refresh_token: session.refreshToken },
    });
    const nextSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
    saveSession(nextSession);
    return nextSession;
  } catch (error) {
    clearSession();
    throw error;
  }
}

export const api = {
  async login(email, password) {
    const tokens = await request("/auth/login", {
      body: { email, password },
    });
    const session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };
    saveSession(session);
    return session;
  },

  async register(email, password) {
    return request("/auth/register", { body: { email, password } });
  },

  async currentUser() {
    let session = readSession();
    if (!session?.accessToken) return null;

    try {
      return await get("/auth/me", session.accessToken);
    } catch (error) {
      if (error.status !== 401 || !session.refreshToken) {
        clearSession();
        if (error.status === 0) throw error;
        return null;
      }
      session = await refreshSession();
      if (!session) return null;
      try {
        return await get("/auth/me", session.accessToken);
      } catch (refreshError) {
        clearSession();
        if (refreshError.status === 0) throw refreshError;
        return null;
      }
    }
  },

  async logout() {
    const session = readSession();
    try {
      if (session?.refreshToken) {
        await request("/auth/logout", {
          body: { refresh_token: session.refreshToken },
        });
      }
    } finally {
      clearSession();
    }
  },

  // Map data endpoints are public and go through cachedGet (see below).
  // `signal` lets a caller say it no longer needs a response.
  heatmap({ date, layer = "risk", bbox, limit, offset, signal } = {}) {
    const params = new URLSearchParams({ layer, format: "geojson" });
    if (date) params.set("date", date);
    if (bbox) params.set("bbox", bbox);
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    return cachedGet(`/heatmap?${params}`, signal);
  },

  historyMonths() {
    return cachedGet("/history/months");
  },

  historyGrid(to, signal) {
    return cachedGet(`/history/grid?to=${encodeURIComponent(to)}`, signal);
  },

  historyDetail(bbox, to, signal) {
    const params = new URLSearchParams({ bbox, to });
    return cachedGet(`/history/detail?${params}`, signal);
  },

  historyRisk(date) {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
    return cachedGet(`/history/risk${suffix}`);
  },

  historyPoint(lat, lon, deg, signal) {
    const params = new URLSearchParams({
      lat: Number(lat).toFixed(5),
      lon: Number(lon).toFixed(5),
      deg: String(deg),
    });
    return cachedGet(`/history/point?${params}`, signal);
  },

  cell(cellId, date, signal) {
    const params = date ? `?date=${encodeURIComponent(date)}` : "";
    return cachedGet(`/cells/${encodeURIComponent(cellId)}${params}`, signal);
  },

  timeseries(cellId, feature, start, end, signal) {
    const params = new URLSearchParams({ feature, start, end });
    return cachedGet(`/cells/${encodeURIComponent(cellId)}/timeseries?${params}`, signal);
  },
};

/* ------------------------------------------------------------------------ */
/* Response cache + request queue for the map data endpoints                 */
/* ------------------------------------------------------------------------ */
// Why: the /history/grid, /history/detail and /history/point endpoints each take
// ~13-17 s on the backend, and they slow each other down when run in parallel
// (3 at once take ~38 s each). So:
//   1. Every response is cached in memory (keyed by request path), and identical
//      requests share one network call -> revisiting an area/month/cell is instant.
//   2. Those slow endpoints run one at a time through a queue, so they never pile
//      up on the backend or block the browser's ~6 connections per host (which
//      used to stall fast requests such as the risk heatmap).
//   3. A caller can cancel with an AbortSignal. A request that is still waiting in
//      the queue is dropped when nobody needs it any more; one that has already
//      started is left to finish (the backend computes it anyway) and is cached.

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_WEIGHT = 600000; // roughly: history cells + 5 x GeoJSON features
const SLOW_PATH = /^\/history\/(grid|detail|point)\b/;

const responseCache = new Map(); // path -> entry, in least-recently-used order
let cacheWeight = 0;
const slowQueue = [];
let slowRunning = false;

const abortError = () => new DOMException("The request was cancelled.", "AbortError");

function responseWeight(data) {
  if (!data || typeof data !== "object") return 1;
  return (data.cells?.length || 0) + 5 * (data.features?.length || 0) + 1;
}

function evictCache() {
  for (const [path, entry] of responseCache) {
    if (cacheWeight <= CACHE_MAX_WEIGHT) break;
    if (entry.state !== "done") continue;
    responseCache.delete(path);
    cacheWeight -= entry.weight;
  }
}

// Heatmap data goes before cell-detail lookups (/history/point) waiting in the queue.
const LOW_PRIORITY_PATH = /^\/history\/point\b/;

function runSlowQueue() {
  if (slowRunning || slowQueue.length === 0) return;
  const next = slowQueue.findIndex((job) => !job.low);
  const job = slowQueue.splice(next >= 0 ? next : 0, 1)[0];
  slowRunning = true;
  job.run().then(job.resolve, job.reject).finally(() => {
    slowRunning = false;
    runSlowQueue();
  });
}

function createEntry(path) {
  const entry = { state: "queued", waiters: 0, keepAlive: false, weight: 0, expires: Infinity, cancel: null };
  const run = () => {
    entry.state = "running";
    return getPublic(path);
  };
  const started = SLOW_PATH.test(path)
    ? new Promise((resolve, reject) => {
      const job = { run, resolve, reject, low: LOW_PRIORITY_PATH.test(path) };
      entry.cancel = () => {
        const index = slowQueue.indexOf(job);
        if (index >= 0) {
          slowQueue.splice(index, 1);
          reject(abortError());
        }
      };
      slowQueue.push(job);
      runSlowQueue();
    })
    : run();
  entry.promise = started.then(
    (data) => {
      entry.state = "done";
      entry.expires = Date.now() + CACHE_TTL_MS;
      if (responseCache.get(path) === entry) {
        entry.weight = responseWeight(data);
        cacheWeight += entry.weight;
        evictCache();
      }
      return data;
    },
    (error) => {
      entry.state = "done";
      if (responseCache.get(path) === entry) responseCache.delete(path); // never cache failures
      throw error;
    },
  );
  entry.promise.catch(() => {}); // rejections are handled by each caller
  responseCache.set(path, entry);
  return entry;
}

function cachedGet(path, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  let entry = responseCache.get(path);
  if (entry && entry.state === "done" && entry.expires <= Date.now()) {
    responseCache.delete(path);
    cacheWeight -= entry.weight;
    entry = null;
  }
  if (entry) {
    responseCache.delete(path); // move to the most-recently-used end
    responseCache.set(path, entry);
  } else {
    entry = createEntry(path);
  }
  if (!signal) {
    entry.keepAlive = true;
    return entry.promise;
  }
  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      entry.waiters -= 1;
      reject(abortError());
      if (entry.state === "queued" && entry.waiters === 0 && !entry.keepAlive) entry.cancel?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (data) => {
        if (signal.aborted) return;
        signal.removeEventListener("abort", onAbort);
        entry.waiters -= 1;
        resolve(data);
      },
      (error) => {
        if (signal.aborted) return;
        signal.removeEventListener("abort", onAbort);
        entry.waiters -= 1;
        reject(error);
      },
    );
  });
}

async function getPublic(path, signal) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { signal });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
      0,
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(getErrorMessage(payload), response.status);
  return payload;
}
