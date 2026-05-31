import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { clearBillingCache } from "../lib/billing";

const AUTH_CACHE_KEY = "petbill_user_cache";

// Read cached user synchronously so the very first render already knows
// who is logged in. Avoids any loading flash for returning users.
function readCache() {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext({
  user: null,
  loading: true,
  refresh: () => {},
  logout: () => {},
});

export function AuthProvider({ children }) {
  // Initialise synchronously from cache — no null flicker for logged-in users
  const [user, setUser] = useState(readCache);
  // Only show a loading state when there is genuinely no cached data to render
  const [loading, setLoading] = useState(() => !readCache());

  const _setUser = useCallback((data) => {
    setUser(data);
    if (data) {
      try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(data)); } catch {}
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      _setUser(data);
    } catch {
      _setUser(null);
    } finally {
      setLoading(false);
    }
  }, [_setUser]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {}

    localStorage.removeItem("petbill_session_token");
    localStorage.removeItem("petbill_auth_next");
    localStorage.removeItem(AUTH_CACHE_KEY);
    localStorage.removeItem("petbill_sidebar"); // clear so next login starts expanded
    clearBillingCache();

    setUser(null);

    window.location.assign("/");
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (typeof window !== "undefined" && window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    refresh();
  }, [refresh]);

  const devLogin = useCallback(async () => {
    const { data } = await api.post("/auth/dev-login");
    localStorage.setItem("petbill_session_token", data.session_token);
    _setUser(data.user);
    const nextPath =
      localStorage.getItem("petbill_auth_next") || "/dashboard";

    localStorage.removeItem("petbill_auth_next");

    window.location.assign(nextPath);
  }, [_setUser]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, devLogin, setUser: _setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
