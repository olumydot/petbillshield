import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = location.hash || window.location.hash || "";
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const sessionId = params.get("session_id");
    if (!sessionId) {
      navigate("/", { replace: true });
      return;
    }

    (async () => {
      try {
        const { data } = await api.post("/auth/session", { session_id: sessionId });
        if (data?.session_token) {
          localStorage.setItem("petbill_session_token", data.session_token);
        }
        if (data?.user) setUser(data.user);
        const nextPath =
          sessionStorage.getItem("petbill_auth_next") ||
          localStorage.getItem("petbill_auth_next") ||
          "/dashboard";

        sessionStorage.removeItem("petbill_auth_next");
        localStorage.removeItem("petbill_auth_next");

        window.location.assign(nextPath);
      } catch (e) {
        console.error("Auth exchange failed", e);
        navigate("/", { replace: true });
      }
    })();
  }, [location.hash, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center paper-grain" data-testid="auth-callback">
      <div className="text-center">
        <div className="eyebrow mb-3">Securing your session</div>
        <h2 className="font-serif-display text-3xl">One moment — bringing you in.</h2>
      </div>
    </div>
  );
}
