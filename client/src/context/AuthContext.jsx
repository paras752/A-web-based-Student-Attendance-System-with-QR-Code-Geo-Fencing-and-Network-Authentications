import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { refreshSession, setAccessToken, setAuthFailureHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setAuthFailureHandler(clearSession);
  }, [clearSession]);

  useEffect(() => {
    // On first load, silently try to exchange the httpOnly refresh cookie (if any) for a
    // new access token, so a page reload doesn't force a full re-login. This goes through
    // the shared refreshSession() (not a separate api.post call) so it can never race the
    // axios interceptor's own 401-triggered refresh against the server's token rotation.
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshSession();
        if (!cancelled) {
          setUser(data.user);
        }
      } catch (err) {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, initializing, login, register, logout }),
    [user, initializing, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
