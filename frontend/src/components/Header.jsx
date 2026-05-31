import { useLocation, Link } from "react-router-dom";
import { LayoutDashboard, LogIn, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import LanguageToggle from "./LanguageToggle";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { PetVaultWordmark } from "./PetVaultLogo";
import { BACKEND_ORIGIN } from "../lib/api";

export default function Header({ variant = "marketing" }) {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const onDashboard = location.pathname.startsWith("/dashboard");
  const onHome = location.pathname === "/";
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const BACKEND = BACKEND_ORIGIN;

  function getProfileImageUrl(path) {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `${BACKEND}${path}`;
  }

  const anchor = (hash) => (onHome ? `#${hash}` : `/#${hash}`);

  const NAV_ITEMS = [
    { hash: "how", label: t("common.how_it_works"), testId: "nav-how" },
    { hash: "features", label: t("common.features"), testId: "nav-features" },
    { hash: "pricing", label: t("common.pricing"), testId: "nav-pricing" },
    { hash: "faq", label: t("common.faq"), testId: "nav-faq" },
  ];

  return (
    <header className="glass-header sticky top-0 z-40" data-testid="site-header">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5 group min-w-0" data-testid="logo-home-link">
          <PetVaultWordmark iconSize={30} className="group-hover:opacity-90 transition-opacity" />
        </Link>

        {variant === "marketing" && (
          <nav className="hidden md:flex items-center gap-7 text-sm">
            {NAV_ITEMS.map((n) =>
              onHome ? (
                <a key={n.hash} href={`#${n.hash}`} className="editorial-link" data-testid={n.testId}>
                  {n.label}
                </a>
              ) : (
                <Link key={n.hash} to={anchor(n.hash)} className="editorial-link" data-testid={n.testId}>
                  {n.label}
                </Link>
              )
            )}
            <Link to="/contact" className="editorial-link" data-testid="nav-contact">
              Contact
            </Link>
          </nav>
        )}

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <LanguageToggle />
          </div>

          {/* Suppress auth-dependent buttons while the session check is in flight
              to avoid a signed-in → sign-in button flicker on first paint */}
          {loading ? (
            <div className="w-24 h-8 bg-[#E5E2D9] rounded-xl animate-pulse" />
          ) : user ? (
            <>
              {!onDashboard && (
                <Link
                  to="/dashboard"
                  className="inline-flex btn-primary rounded-md px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold items-center gap-1.5"
                  data-testid="header-go-to-dashboard"
                >
                  <LayoutDashboard size={14} strokeWidth={1.75} />
                  <span className="hidden min-[380px]:inline">{t("common.open_dashboard")}</span>
                  <span className="min-[380px]:hidden">Dashboard</span>
                </Link>
              )}

              <button
                onClick={logout}
                className="btn-ghost rounded-md px-3 py-2 text-sm font-medium inline-flex items-center gap-2"
                data-testid="header-logout-btn"
                title={t("common.sign_out")}
              >
                <LogOut size={15} strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("common.sign_out")}</span>
              </button>

              <div className="hidden sm:flex items-center gap-2 pl-2 ml-1 border-l border-[#E5E2D9]">
                {user.picture || user.profile_picture ? (
                  <img
                    src={getProfileImageUrl(user.picture || user.profile_picture)}
                    alt={user.name || "User"}
                    className="w-9 h-9 rounded-full object-cover border border-[#E5E2D9]"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-[#F2F0E9] border border-[#E5E2D9] flex items-center justify-center text-xs font-semibold text-[#65635C]">
                    {(user.name || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm text-[#2D2C28] max-w-[140px] truncate" data-testid="header-user-name">
                  {user.name}
                </span>
              </div>
            </>
          ) : (
            <>
              <Link
                to="/auth"
                className="hidden sm:inline-flex btn-primary rounded-md px-4 py-2 text-sm font-semibold items-center gap-2"
                data-testid="header-signin-link"
                aria-label="Sign in"
              >
                <LogIn size={15} strokeWidth={1.75} />
                <span>Sign in</span>
              </Link>

              {variant === "marketing" && (
                <button
                  onClick={() => setMobileOpen((v) => !v)}
                  className="md:hidden btn-ghost rounded-md p-2"
                  aria-label="Toggle navigation"
                >
                  {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {mobileOpen && variant === "marketing" && (
        <div className="md:hidden border-t border-[#E5E2D9] bg-[#FAF9F6] px-5 py-4 space-y-3">
          {NAV_ITEMS.map((n) =>
            onHome ? (
              <a
                key={n.hash}
                href={`#${n.hash}`}
                className="block text-sm text-[#2D2C28] hover:text-[#D26D53] py-2"
                onClick={() => setMobileOpen(false)}
              >
                {n.label}
              </a>
            ) : (
              <Link
                key={n.hash}
                to={anchor(n.hash)}
                className="block text-sm text-[#2D2C28] hover:text-[#D26D53] py-2"
                onClick={() => setMobileOpen(false)}
              >
                {n.label}
              </Link>
            )
          )}
          <Link
            to="/contact"
            className="block text-sm text-[#2D2C28] hover:text-[#D26D53] py-2"
            onClick={() => setMobileOpen(false)}
          >
            Contact
          </Link>
          {!user && (
            <Link
              to="/auth"
              className="btn-primary rounded-xl px-4 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 w-full"
              onClick={() => setMobileOpen(false)}
            >
              <LogIn size={15} strokeWidth={1.75} />
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
