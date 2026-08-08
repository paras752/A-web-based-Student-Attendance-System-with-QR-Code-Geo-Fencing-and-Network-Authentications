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

  // `identifier` is an email or a college-issued student number; the server resolves either.
  const login = useCallback(async (identifier, password) => {
    const { data } = await api.post('/auth/login', { identifier, password });
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

  // No updateProfile here on purpose. Name, email and academic details are institutional
  // records corrected by an admin, not preferences a signed-in user can edit; the password
  // is the one thing they genuinely own.
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.post('/auth/me/password', { currentPassword, newPassword });
  }, []);

  const value = useMemo(
    () => ({ user, initializing, login, register, logout, changePassword }),
    [user, initializing, login, register, logout, changePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
