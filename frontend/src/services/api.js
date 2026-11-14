const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(
  /\/+$/,
  "",
);
const SESSION_KEY = "wildfire-atlas-session";

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

  heatmap({ date, layer = "risk", bbox, limit, offset } = {}) {
    const params = new URLSearchParams({ layer, format: "geojson" });
    if (date) params.set("date", date);
    if (bbox) params.set("bbox", bbox);
    if (limit) params.set("limit", String(limit));
    if (offset) params.set("offset", String(offset));
    return getPublic(`/heatmap?${params}`);
  },

  historyMonths() {
    return getPublic("/history/months");
  },

  historyGrid(to) {
    return getPublic(`/history/grid?to=${encodeURIComponent(to)}`);
  },

  historyDetail(bbox, to) {
    const params = new URLSearchParams({ bbox, to });
    return getPublic(`/history/detail?${params}`);
  },

  historyRisk(date) {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
    return getPublic(`/history/risk${suffix}`);
  },

  historyPoint(lat, lon, deg) {
    const params = new URLSearchParams({
      lat: Number(lat).toFixed(5),
      lon: Number(lon).toFixed(5),
      deg: String(deg),
    });
    return getPublic(`/history/point?${params}`);
  },

  cell(cellId, date) {
    const params = date ? `?date=${encodeURIComponent(date)}` : "";
    return getPublic(`/cells/${encodeURIComponent(cellId)}${params}`);
  },

  timeseries(cellId, feature, start, end) {
    const params = new URLSearchParams({ feature, start, end });
    return getPublic(`/cells/${encodeURIComponent(cellId)}/timeseries?${params}`);
  },
};

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
