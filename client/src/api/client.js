import axios from 'axios';

// Access token lives in memory only (never localStorage) so it can't be read by a
// stray XSS payload through storage APIs; the refresh token lives in an httpOnly
// cookie the server sets, which client JS can never read at all (Section 2.6).
let accessToken = null;
let onAuthFailure = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function setAuthFailureHandler(handler) {
  onAuthFailure = handler;
}

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// The server rotates the refresh token on every successful /auth/refresh call (the old
// one is revoked). If two callers each fire their own refresh at the same moment - e.g.
// AuthContext's boot-time check racing a page's own 401 retry right after a fresh page
// load - the loser presents an already-revoked token and gets logged out spuriously. This
// single shared, de-duplicated promise is the ONLY place that calls /auth/refresh, so
// every caller (AuthContext on mount, the 401 interceptor below) always piggybacks on one
// in-flight request instead of racing the server's rotation.
let refreshPromise = null;

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const isRefreshCall = config?.url === '/auth/refresh';

    if (response?.status === 401 && !config._retry && !isRefreshCall) {
      config._retry = true;
      try {
        const data = await refreshSession();
        config.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(config);
      } catch (refreshError) {
        setAccessToken(null);
        if (onAuthFailure) onAuthFailure();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
