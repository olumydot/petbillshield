import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { clearBillingCache } from "../lib/billing";

const AUTH_CACHE_KEY = "petbill_user_cache";
const IDLE_LIMIT_MS  = 30 * 60 * 1000;          // 30 minutes of inactivity
const LAST_ACTIVITY_KEY = "petbill_last_activity";

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

  const logout = useCallback(async (opts = {}) => {
    try {
      await api.post("/auth/logout");
    } catch {}

    localStorage.removeItem("petbill_session_token");
    localStorage.removeItem("petbill_auth_next");
    localStorage.removeItem(AUTH_CACHE_KEY);
    localStorage.removeItem("petbill_sidebar"); // clear so next login starts expanded
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    clearBillingCache();

    setUser(null);

    // After an idle timeout, send the user to login with a notice flag.
    window.location.assign(opts.idle ? "/auth?reason=timeout" : "/");
  }, []);

  // ── 30-minute inactivity auto-logout ───────────────────────────────────────
  // Resets on real user activity (throttled), persists last-activity in
  // localStorage so it works across tabs and survives a refresh, and checks on
  // an interval + when the tab regains focus (covers a laptop being closed).
  useEffect(() => {
    if (!user) return undefined;

    const now = () => Date.now();
    let lastWrite = 0;

    const markActivity = () => {
      const t = now();
      if (t - lastWrite < 5000) return;       // throttle writes to once / 5s
      lastWrite = t;
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(t)); } catch {}
    };

    const checkIdle = () => {
      let last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
      if (!last) { markActivity(); return; }
      if (now() - last >= IDLE_LIMIT_MS) {
        logout({ idle: true });
      }
    };

    // Treat the current load as activity, then start watching.
    markActivity();

    const activityEvents = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    activityEvents.forEach((e) => window.addEventListener(e, markActivity, { passive: true }));

    const onVisible = () => { if (document.visibilityState === "visible") checkIdle(); };
    document.addEventListener("visibilitychange", onVisible);

    const interval = setInterval(checkIdle, 30 * 1000);   // check every 30s

    return () => {
      clearInterval(interval);
      activityEvents.forEach((e) => window.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, logout]);

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
