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
      payload.error || payload.message || "Something went wrong. Please try again.",
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
      payload.error || payload.message || "Something went wrong. Please try again.",
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
};
