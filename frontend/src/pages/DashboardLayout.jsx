import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PetVaultWordmark } from "../components/PetVaultLogo";
import {
  FileSearch,
  PawPrint,
  Receipt,
  MessagesSquare,
  Tag,
  LogOut,
  Home as HomeIcon,
  Bell,
  Sparkles,
  Scale,
  ShieldHalf,
  Activity,
  Lock,
  ArrowRight,
  X,
  Settings,
  Clock,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCircle2,
  Menu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import SafetyDisclaimer from "../components/SafetyDisclaimer";
import LanguageToggle from "../components/LanguageToggle";
import FeedbackButton from "../components/FeedbackButton";
import PaymentStatusWatcher from "../components/PaymentStatusWatcher";
import WelcomeModal from "../components/WelcomeModal";
import TourOverlay from "../components/TourOverlay";
import { useBilling } from "../lib/billing";
import { useState, useEffect, useRef } from "react";
import ProfilePictureButton from "../components/ProfilePictureButton";
import api from "@/lib/api";
import {toast} from "sonner";

// Routes locked to paid plans only (free gets: analyze, timeline, reminders, pets[1])
const ROUTE_REQUIREMENTS = {
  "/dashboard/compare": {
    requiredTier: "Pet Cost Vault",
    message: "Compare estimates is included with Pet Cost Vault and higher plans.",
  },
  "/dashboard/claims": {
    requiredTier: "Pet Cost Vault",
    message: "Insurance claim help is included with Pet Cost Vault and higher plans.",
  },
  "/dashboard/scripts": {
    requiredTier: "Pet Cost Vault",
    message: "Question scripts is included with Pet Cost Vault and higher plans.",
  },
};

function getTierInfo(billing) {
  if (!billing?.active) {
    return {
      label: "Free",
      shortLabel: "Free tier",
      tone: "free",
      canUsePremium: false,
    };
  }

  const planId = billing.plan_id || "";
  const label = billing.plan_label || "Active plan";

  if (planId.includes("rescue")) {
    return {
      label,
      shortLabel: "Rescue / Foster",
      tone: "rescue",
      canUsePremium: true,
    };
  }

  if (planId.includes("family")) {
    return {
      label,
      shortLabel: "Family",
      tone: "family",
      canUsePremium: true,
    };
  }

  if (planId.includes("vault")) {
    return {
      label,
      shortLabel: "Pet Cost Vault",
      tone: "vault",
      canUsePremium: true,
    };
  }

  return {
    label,
    shortLabel: label,
    tone: "active",
    canUsePremium: true,
  };
}

function getRenewalPeriodWindowMs(planId = "") {
  const day = 24 * 60 * 60 * 1000;
  return String(planId).includes("yearly") ? 400 * day : 35 * day;
}

function shouldShowRenewalSuccess({ previousRenewalAt, currentRenewalAt, planId }) {
  if (!previousRenewalAt || !currentRenewalAt) return false;
  const previous = new Date(previousRenewalAt).getTime();
  const current = new Date(currentRenewalAt).getTime();
  const now = Date.now();

  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
  if (current <= previous) return false;

  const periodDelta = current - previous;
  const maxExpectedDelta = getRenewalPeriodWindowMs(planId);

  return now >= previous && now < current && periodDelta <= maxExpectedDelta;
}

export default function DashboardLayout() {
  const { user, logout, refresh } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  const { billing, loading: billingLoading, refresh: refreshBilling, cancelSwitch, reactivatePlan } = useBilling();
  const [cancellingSwitch, setCancellingSwitch] = useState(false);
  const [reactivatingPlan, setReactivatingPlan] = useState(false);
  const [reminders, setReminders]             = useState([]);
  const [reminderBadge, setReminderBadge]     = useState(null);
  const [showBellDropdown, setShowBellDropdown] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Sidebar collapse — single key, no user-specific logic.
  // State is intentionally NOT reactive to auth loading; it reads once on mount.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("petbill_sidebar") === "true"
  );

  // Renewal success modal — shown once after each automatic renewal
  const [showRenewalModal, setShowRenewalModal] = useState(false);

  // Downgrade notice — shown for 2 logins after a plan downgrade
  const [downgradeNotice, setDowngradeNotice] = useState(null);

  useEffect(() => {
    if (!user?.user_id) return;
    api.get("/billing/downgrade-notice")
      .then(({ data }) => {
        if (data?.notice) {
          setDowngradeNotice(data.notice);
          // Increment shown_count immediately so next login count is tracked
          api.post(`/billing/downgrade-notice/${data.notice.notice_id}/seen`).catch(() => {});
        }
      })
      .catch(() => {});
  }, [user?.user_id]);

  function dismissDowngradeNotice() {
    if (!downgradeNotice) return;
    api.post(`/billing/downgrade-notice/${downgradeNotice.notice_id}/dismiss`).catch(() => {});
    setDowngradeNotice(null);
  }

  const bellTimerRef                          = useRef(null);
  const isPricingPage = location.pathname === "/dashboard/pricing";
  const isCheckoutPage = location.pathname === "/dashboard/checkout";

  useEffect(() => {
    setMobileNavOpen(false);
    setShowBellDropdown(false);
  }, [location.pathname]);

  function toggleSidebar() {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("petbill_sidebar", String(next));
      return next;
    });
  }

  // Detect automatic renewal — show once on the first login after renewal.
  // If the user skips a whole billing period, this seeds the latest date without
  // showing a stale renewal receipt.
  useEffect(() => {
    if (!user?.user_id || !billing?.active || !billing?.entitlement_expires_at) return;

    const key = `petbill_last_renewal_date:${user.user_id}`;
    const legacyKey = "petbill_last_renewal_date";
    const previousRenewalAt = localStorage.getItem(key);
    const currentRenewalAt = billing.entitlement_expires_at;

    if (shouldShowRenewalSuccess({
      previousRenewalAt,
      currentRenewalAt,
      planId: billing.plan_id,
    })) {
      setShowRenewalModal(true);
    }

    localStorage.setItem(key, currentRenewalAt);
    localStorage.removeItem(legacyKey);
  }, [billing?.entitlement_expires_at, billing?.active, billing?.plan_id, user?.user_id]);

  // Fetch reminders for navbar bell badge + dropdown preview
  useEffect(() => {
    api.get("/reminders")
      .then(({ data }) => {
        const all = data || [];
        setReminders(all);
        const now = new Date();
        const pending = all.filter(r => r.status === "pending" && r.scheduled_for);
        const hasOverdue  = pending.some(r => new Date(r.scheduled_for) < now);
        const hasUpcoming = pending.some(r => {
          const d = new Date(r.scheduled_for);
          return d >= now && d <= new Date(now.getTime() + 7 * 86400000);
        });
        setReminderBadge(hasOverdue ? "overdue" : hasUpcoming ? "upcoming" : null);
      })
      .catch(() => {}); // non-critical — silently ignore
  }, [location.pathname]);

  function handleBellEnter() {
    if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
    setShowBellDropdown(true);
  }
  function handleBellLeave() {
    bellTimerRef.current = setTimeout(() => setShowBellDropdown(false), 160);
  }
  const currentPlanId = billing?.plan_id || billing?.plan || "";
  const isRescuePlan = billing?.active && currentPlanId.includes("rescue");

  const currentPlan = billing?.plan_id || "free";

  // While billing is loading, treat as paid so no upgrade flashes appear.
  // The real state replaces this in <200 ms once the API/cache resolves.
  const isFreeTier = billingLoading
    ? false
    : (!billing?.active || currentPlan === "free" || currentPlan === "free_tier");

  const canUseVault     = true;           // free gets 1 pet; paid gets more
  const canUseCompare   = !isFreeTier;
  const canUseTimeline  = true;           // basic timeline is free
  const canUseReminders = true;           // reminders are free
  const canUseClaims    = !isFreeTier;
  const canUseScripts   = !isFreeTier;

  const [dismissedUpgrade, setDismissedUpgrade] = useState(false);

  // --- First-time onboarding: welcome modal + optional tour ---
  const [showWelcome, setShowWelcome] = useState(false);
  const [showTour,    setShowTour]    = useState(false);
  const onboardingUserId = user?.user_id || user?.id || user?.email || "";
  const onboardingSeenKey = onboardingUserId ? `petbill_onboarded_${onboardingUserId}` : "";
  const tourDoneKey = onboardingUserId ? `petbill_tour_done_${onboardingUserId}` : "";

  useEffect(() => {
    if (!onboardingSeenKey) {
      setShowWelcome(false);
      setShowTour(false);
      return;
    }

    if (localStorage.getItem(onboardingSeenKey) === "true") {
      setShowWelcome(false);
      return;
    }

    // Give the dashboard a beat to paint before the modal slides in.
    const t = setTimeout(() => setShowWelcome(true), 500);
    return () => clearTimeout(t);
  }, [onboardingSeenKey]);

  const markOnboardingSeen = () => {
    if (onboardingSeenKey) {
      localStorage.setItem(onboardingSeenKey, "true");
    }
  };

  const handleWelcomeTour = () => {
    setShowWelcome(false);
    markOnboardingSeen();
    // The modal fades out over ~260 ms; give it a little extra before tour starts
    setTimeout(() => setShowTour(true), 380);
  };

  const handleWelcomeSkip = () => {
    setShowWelcome(false);
    markOnboardingSeen();
  };

  const tier = getTierInfo(billing);
  const currentRequirement = ROUTE_REQUIREMENTS[location.pathname];

  // Never flash the upgrade notice while billing is still loading
  const shouldShowUpgradeNotice =
    !billingLoading &&
    !dismissedUpgrade &&
    currentRequirement &&
    !tier.canUsePremium;

  const navItems = [
    {
      to: "/dashboard",
      label: t("dashboard.overview"),
      icon: HomeIcon,
      end: true,
      testid: "nav-overview",
    },
    {
      to: "/dashboard/analyze",
      label: t("dashboard.analyze_a_bill"),
      icon: FileSearch,
      testid: "nav-analyze",
    },
    {
      to: "/dashboard/compare",
      label: "Compare estimates",
      icon: Scale,
      locked: !canUseCompare,
      testid: "nav-compare",
    },
    {
      to: "/dashboard/pets",
      label: t("dashboard.pet_vault"),
      icon: PawPrint,
      locked: !canUseVault,
      testid: "nav-pets",
    },
    {
      to: "/dashboard/timeline",
      label: "Health Timeline",
      icon: Activity,
      locked: !canUseTimeline,
      testid: "nav-timeline",
    },
    {
      to: "/dashboard/reminders",
      label: t("common.reminders_title"),
      icon: Bell,
      locked: !canUseReminders,
      testid: "nav-reminders",
    },
    {
      to: "/dashboard/claims",
      label: t("dashboard.insurance_claims"),
      icon: Receipt,
      locked: !canUseClaims,
      testid: "nav-claims",
    },
    {
      to: "/dashboard/scripts",
      label: t("dashboard.question_scripts"),
      icon: MessagesSquare,
      locked: !canUseScripts,
      testid: "nav-scripts",
    },
    {
      to: "/dashboard/pricing",
      label: t("dashboard.plans"),
      icon: Tag,
      testid: "nav-pricing",
    },
    {
      to: "/dashboard/settings",
      label: t("dashboard.settings"),
      icon: Settings,
      testid: "nav-settings",
    },
  ];

  if (isRescuePlan) {
    navItems.splice(navItems.length - 1, 0, {
      to: "/dashboard/rescue",
      label: "Rescue / Foster",
      icon: PawPrint,
      testid: "nav-rescue",
    });
  }

  if (user?.is_admin) {
    navItems.push({
      to: "/dashboard/admin",
      label: "Admin",
      icon: ShieldHalf,
      testid: "nav-admin",
    });
  }

  async function handleCancelSwitch() {
    if (cancellingSwitch) return;
    setCancellingSwitch(true);
    try {
      const result = await cancelSwitch();
      toast.success(`Scheduled switch cancelled — staying on ${result.plan_label}.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel the scheduled switch.");
    } finally {
      setCancellingSwitch(false);
    }
  }

  async function handleReactivate() {
    if (reactivatingPlan) return;
    setReactivatingPlan(true);
    try {
      const result = await reactivatePlan();
      toast.success(`Welcome back! ${result.plan_label} subscription reactivated.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reactivate subscription.");
    } finally {
      setReactivatingPlan(false);
    }
  }

  return (
    <div
      className="min-h-screen paper-grain"
      data-plan-theme={tier.tone}
      data-testid="dashboard-layout"
    >
      <header className="glass-header sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {!isCheckoutPage && (
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden inline-flex items-center gap-2 rounded-xl border border-[#3A4142] bg-[#1D2222] px-3 py-2 text-sm font-semibold text-[#EFE8DA] shadow-sm"
                aria-label="Open dashboard menu"
                aria-expanded={mobileNavOpen}
                data-testid="mobile-dashboard-menu-btn"
              >
                <Menu size={17} />
                Menu
              </button>
            )}
            <Link
              to="/"
              className="flex items-center gap-2.5 group min-w-0"
              data-testid="dash-logo-link"
            >
              <PetVaultWordmark iconSize={30} className="group-hover:opacity-90 transition-opacity" />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <LanguageToggle />
            </div>

            {billingLoading ? (
              /* Skeleton pill — prevents "Free tier" flash while billing loads */
              <span className="hidden md:inline-flex h-6 w-20 rounded-full bg-[#E5E2D9] animate-pulse" />
            ) : (
              <Link
                to="/dashboard/pricing"
                className={`hidden md:inline-flex chip ${
                  billing?.active ? "chip-wait" : "chip-warning"
                } hover:opacity-90`}
                data-testid={
                  billing?.active ? "plan-badge-active" : "plan-badge-upgrade"
                }
              >
                <Sparkles size={11} />
                {tier.shortLabel}
              </Link>
            )}

            {/* Reminder bell — hover to preview, click to go to reminders */}
            <div
              className="relative"
              onMouseEnter={handleBellEnter}
              onMouseLeave={handleBellLeave}
            >
              <Link
                to="/dashboard/reminders"
                className="relative w-9 h-9 rounded-xl inline-flex items-center justify-center text-[#65635C] hover:bg-[#F2F0E9] hover:text-[#2D2C28] transition-colors"
                title="Reminders"
                data-testid="nav-bell"
                onClick={() => setShowBellDropdown(false)}
              >
                <Bell size={17} strokeWidth={1.75} />
                {reminderBadge === "overdue" && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#D26D53] ring-2 ring-white" />
                )}
                {reminderBadge === "upcoming" && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#E6AE2E] ring-2 ring-white" />
                )}
              </Link>

              {showBellDropdown && (
                <BellDropdown
                  reminders={reminders}
                  onClose={() => setShowBellDropdown(false)}
                  onMouseEnter={handleBellEnter}
                  onMouseLeave={handleBellLeave}
                />
              )}
            </div>

            <ProfilePictureButton user={user} refresh={refresh} />

            <Link
              to="/dashboard/settings"
              className="hidden sm:inline text-sm text-[#2D2C28] hover:text-[#D26D53] transition font-medium"
              data-testid="dash-user-name"
              title="Account settings"
            >
              {user?.name}
            </Link>

            <button
              onClick={logout}
              className="btn-ghost rounded-md px-3 py-2 text-xs hidden sm:inline-flex items-center gap-1.5"
              data-testid="dash-logout-btn"
            >
              <LogOut size={14} /> {t("common.sign_out")}
            </button>
          </div>
        </div>
      </header>

      {mobileNavOpen && !isCheckoutPage && (
        <div className="fixed inset-0 z-[85] lg:hidden" role="dialog" aria-modal="true" aria-label="Dashboard menu">
          <div className="absolute inset-0 bg-[#2D2C28]/55 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[min(88vw,360px)] overflow-y-auto border-r border-[#3A4142] bg-[#161B1B] text-[#D4CEC0] shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-[#3A4142] bg-[#161B1B]/95 px-4 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <PetVaultWordmark iconSize={30} />
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-full p-2 text-[#A8A196] hover:bg-[#202625] hover:text-[#EFE8DA]"
                  aria-label="Close dashboard menu"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4 rounded-[22px] border border-[#3A4142] bg-[#202625] p-3.5">
                <div className="flex items-center gap-3">
                  <ProfilePictureButton user={user} refresh={refresh} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#EFE8DA] truncate">{user?.name || "Pet parent"}</p>
                    <p className="text-xs text-[#A8A196] truncate">{user?.email}</p>
                  </div>
                  <Link
                    to="/dashboard/settings"
                    onClick={() => setMobileNavOpen(false)}
                    className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-[#3A4142] bg-[#171C1C] text-[#EFE8DA]"
                    aria-label="Open account settings"
                  >
                    <Settings size={17} />
                  </Link>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Link
                  to="/dashboard/pricing"
                  className={`chip ${billing?.active ? "chip-wait" : "chip-warning"} hover:opacity-90`}
                  onClick={() => setMobileNavOpen(false)}
                >
                  <Sparkles size={11} />
                  {billingLoading ? "Checking plan" : tier.shortLabel}
                </Link>
                <LanguageToggle />
              </div>
            </div>

            <nav className="px-3 py-4 space-y-1">
              {navItems.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setMobileNavOpen(false)}
                  data-testid={`mobile-${n.testid}`}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition-colors ${
                      isActive
                        ? "bg-[#2D2C28] text-[#FAF9F6] font-semibold"
                        : "text-[#C7C0B2] hover:bg-[#202625] hover:text-[#EFE8DA]"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0 ${
                          isActive
                            ? "bg-white/15 text-[#FAF9F6]"
                            : "bg-[#171C1C] text-[#A8A196]"
                        }`}
                      >
                        <n.icon size={16} strokeWidth={1.75} />
                      </span>
                      <span className="flex-1">{n.label}</span>
                      {n.locked && (
                        <Lock size={13} className={isActive ? "text-[#FAF9F6]/55" : "text-[#D26D53]"} />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-[#3A4142] px-4 py-4">
              <button
                onClick={() => {
                  setMobileNavOpen(false);
                  logout();
                }}
                className="w-full rounded-2xl border border-[#3A4142] bg-[#1D2222] px-4 py-3 text-sm font-semibold text-[#EFE8DA] inline-flex items-center justify-center gap-2"
              >
                <LogOut size={15} />
                {t("common.sign_out")}
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className={`mx-auto px-5 sm:px-8 flex gap-6 py-8 items-start ${isCheckoutPage ? "max-w-[1200px]" : "max-w-[1400px]"}`}>

        {/* ── Sidebar ── */}
          {!isCheckoutPage && (
	        <aside
	          data-testid="dashboard-sidebar"
	          className={`relative z-[120] shrink-0 transition-all duration-300 ease-in-out hidden lg:block ${
	            sidebarCollapsed ? "w-14" : "w-72"
	          }`}
	        >
          <div className="sticky top-20 space-y-2">

            {/* ── Sidebar collapse toggle ─────────────────────────────────────
                TOP of sidebar — always the first element, can never scroll out.
                Separate from the nav so overflow-hidden can never hide it.    */}
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              data-testid="sidebar-toggle"
              className={`flex items-center transition-all bg-[#2D2C28] text-[#FAF9F6] hover:bg-[#3F3E39] ${
                sidebarCollapsed
                  // Collapsed: icon-only, same width/height as nav items, no border
                  ? "w-full justify-center rounded-xl py-2.5"
                  // Expanded: full-width labelled button with border
                  : "w-full gap-2.5 px-4 py-2.5 rounded-2xl border border-[#2D2C28]"
              }`}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen  size={15} strokeWidth={1.75} />
                : <PanelLeftClose size={15} strokeWidth={1.75} />
              }
              {!sidebarCollapsed && (
                <span className="text-xs font-semibold flex-1 text-left">
                  {t("dashboard.collapse")}
                </span>
              )}
            </button>

            {/* Nav items */}
	            <nav className="relative z-[130] rounded-[24px] border border-[#E5E2D9] bg-[#FAF9F6] p-2">
              {navItems.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  data-testid={n.testid}
	                  title={sidebarCollapsed ? n.label : undefined}
	                  className={({ isActive }) =>
	                    `group relative z-[140] flex items-center w-full rounded-xl text-sm transition-all hover:z-[999] ${
	                      sidebarCollapsed
	                        ? "justify-center px-0 py-2.5"
	                        : "gap-3 justify-between px-3 py-2.5"
                    } ${
                      isActive
                        ? "bg-[#2D2C28] text-[#FAF9F6] font-semibold"
                        : "text-[#65635C] hover:bg-[#F2F0E9] hover:text-[#2D2C28]"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${
                          isActive
                            ? "bg-white/15 text-[#FAF9F6]"
                            : "bg-[#F2F0E9] text-[#8A887F]"
                        }`}
                      >
                        <n.icon size={14} strokeWidth={1.75} />
                      </span>
                      {!sidebarCollapsed && (
                        <>
	                          <span className="flex-1">{n.label}</span>
	                          {n.locked && (
	                            <Lock size={12} className={isActive ? "text-[#FAF9F6]/50" : "text-[#D26D53]"} />
	                          )}
	                        </>
	                      )}
	                      {sidebarCollapsed && (
	                        <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-[9999] -translate-y-1/2 whitespace-nowrap rounded-xl border border-[#D26D53]/25 bg-[#FFF7F2] px-3 py-2 text-xs font-semibold text-[#8C2D14] opacity-0 shadow-2xl ring-1 ring-white/80 transition-opacity duration-150 group-hover:opacity-100">
	                          {n.label}
	                          {n.locked ? " · Locked" : ""}
	                        </span>
	                      )}
	                    </>
	                  )}
	                </NavLink>
              ))}
            </nav>

            {!sidebarCollapsed && !billingLoading && <div className="pbs-dark-card rounded-[22px] overflow-hidden">
              <div className="p-4 space-y-3">

                {/* ── Plan name + icon ── */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`eyebrow mb-1 ${tier.tone === "rescue" ? "text-[#E6AE2E]" : "text-[#D26D53]"}`}>
                      Current plan
                    </div>
                    <p className="font-semibold text-sm truncate text-[#EFE8DA]">
                      {tier.label}
                    </p>

                    {/* Renews / Ends date + countdown */}
                    {billing?.entitlement_expires_at ? (() => {
                      const expDt    = new Date(billing.entitlement_expires_at);
                      const daysLeft = Math.max(0, Math.ceil((expDt - Date.now()) / 86400000));
                      const isCancelling = billing?.cancel_at_period_end;
                      const urgent   = !isCancelling && daysLeft <= 7;
                      const soon     = !isCancelling && daysLeft > 7 && daysLeft <= 30;
                      return (
                        <div className="mt-0.5 space-y-0.5">
                          <p className={`text-xs ${isCancelling || urgent || soon ? "text-[#F2C95B] font-semibold" : "text-[#B9B1A3]"}`}>
                            {isCancelling ? "Ends" : "Renews"}{" "}
                            {expDt.toLocaleDateString()}
                          </p>
                          {!isCancelling && daysLeft <= 30 && (
                            <p className={`text-[11px] font-semibold ${urgent ? "text-[#F6A28C]" : "text-[#F2C95B]"}`}>
                              {daysLeft === 0 ? "Renews today"
                               : daysLeft === 1 ? "Renews tomorrow"
                               : `${daysLeft} days until renewal`}
                            </p>
                          )}
                        </div>
                      );
                    })() : (
                      <p className="text-xs mt-0.5 text-[#B9B1A3]">
                        {tier.canUsePremium ? "All premium features unlocked." : "Upgrade for premium tools."}
                      </p>
                    )}
                  </div>

                  <span className={`w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0 ${
                    tier.tone === "rescue" ? "bg-[#D26D53]"
                    : tier.tone === "family" ? "bg-[#556045]"
                    : tier.tone === "vault"  ? "bg-[#F2E5DE]"
                    : "bg-[#F2F0E9]"
                  }`}>
                    <Sparkles size={15} className={tier.tone === "rescue" || tier.tone === "family" ? "text-white" : "text-[#D26D53]"} />
                  </span>
                </div>

                {/* ── Pending downgrade notice ── */}
                {billing?.pending_downgrade_plan_id && !billing?.cancel_at_period_end && (
                  <div className={`rounded-xl px-3 py-2.5 flex items-start gap-2 ${
                    tier.tone === "rescue" ? "bg-white/8" : "bg-[#FEF6E4] border border-[#E6AE2E]/25"
                  }`}>
                    <Clock size={12} className={`shrink-0 mt-0.5 ${tier.tone === "rescue" ? "text-[#E6AE2E]" : "text-[#8A5A24]"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug ${tier.tone === "rescue" ? "text-[#E6AE2E]" : "text-[#8A5A24]"}`}>
                        Switching to{" "}
                        <strong>{billing.pending_downgrade_plan_label}</strong>
                        {billing.pending_downgrade_at && (
                          <> · {new Date(billing.pending_downgrade_at).toLocaleDateString()}</>
                        )}
                      </p>
                      <button
                        onClick={handleCancelSwitch}
                        disabled={cancellingSwitch}
                        className={`mt-0.5 text-[11px] underline underline-offset-2 transition-colors disabled:opacity-50 ${
                          tier.tone === "rescue"
                            ? "text-[#FAF9F6]/45 hover:text-[#FAF9F6]"
                            : "text-[#65635C] hover:text-[#D26D53]"
                        }`}
                      >
                        {cancellingSwitch ? "Cancelling…" : "Undo scheduled switch"}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Ending-soon notice ── */}
                {billing?.cancel_at_period_end && (
                  <div className={`rounded-xl px-3 py-2.5 text-xs leading-snug ${
                    tier.tone === "rescue" ? "bg-white/8 text-[#E6AE2E]" : "bg-[#FEF6E4] border border-[#E6AE2E]/25 text-[#8A5A24]"
                  }`}>
                    Moves to free tier after end date. Your data is never deleted.
                  </div>
                )}

                {/* ── Bottom action link ── */}
                <div className={`pt-2 border-t ${tier.tone === "rescue" ? "border-white/10" : "border-[#E5E2D9]"}`}>
                  {billing?.cancel_at_period_end ? (
                    <button
                      type="button"
                      onClick={handleReactivate}
                      disabled={reactivatingPlan}
                      className={`text-xs font-semibold inline-flex items-center gap-1 transition-opacity disabled:opacity-50 ${
                        tier.tone === "rescue" ? "text-[#E6AE2E]" : "text-[#D26D53]"
                      }`}
                    >
                      {reactivatingPlan
                        ? <><Loader2 size={11} className="animate-spin" />Reactivating…</>
                        : <>Reactivate subscription<ArrowRight size={11} /></>
                      }
                    </button>
                  ) : !isPricingPage ? (
                    <Link
                      to="/dashboard/pricing"
                      className={`text-xs font-semibold inline-flex items-center gap-1 ${
                        tier.tone === "rescue" ? "text-[#E6AE2E]" : "text-[#D26D53]"
                      }`}
                    >
                      {tier.canUsePremium ? "Manage plan" : "Upgrade plan"}<ArrowRight size={11} />
                    </Link>
                  ) : null}
                </div>

              </div>
            </div>}

            {!sidebarCollapsed && <SafetyDisclaimer compact />}
          </div>
        </aside>
          )}

        {/* ── Main content — grows to fill all remaining space ── */}
        <main className={`min-w-0 ${isCheckoutPage ? "w-full" : "flex-1"}`} key={location.pathname}>
          <PaymentStatusWatcher onPaid={refreshBilling} />
          {shouldShowUpgradeNotice && (
            <div
              className="cream-card p-5 mb-6 border border-[#D26D53]/35 bg-[#FFF7F2]"
              data-testid="upgrade-required-banner"
            >
              <div className="flex items-start gap-4">
                <span className="w-10 h-10 rounded-md bg-[#D26D53] text-white inline-flex items-center justify-center shrink-0">
                  <Lock size={18} />
                </span>

                <div className="flex-1">
                  <div className="eyebrow text-[#D26D53] mb-1">
                    Upgrade needed
                  </div>

                  <h3 className="font-serif-display text-2xl leading-tight">
                    This feature requires a paid plan.
                  </h3>

                  <p className="text-sm text-[#65635C] mt-2 max-w-xl">
                    {currentRequirement.message}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      to="/dashboard/pricing"
                      className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2"
                    >
                      Upgrade plan <ArrowRight size={14} />
                    </Link>

                    <button
                      onClick={() => setDismissedUpgrade(true)}
                      className="btn-ghost rounded-md px-4 py-2 text-sm font-semibold"
                    >
                      Not now
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setDismissedUpgrade(true)}
                  className="text-[#65635C] hover:text-[#2D2C28]"
                  aria-label="Dismiss upgrade notice"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          <Outlet />
          <DashboardFooter />
        </main>
      </div>

      {!isCheckoutPage && <FeedbackButton floating />}

      {/* First-time onboarding — welcome modal */}
      {showWelcome && (
        <WelcomeModal
          onStartTour={handleWelcomeTour}
          onSkip={handleWelcomeSkip}
        />
      )}

      {/* Guided spotlight tour — shown after modal if user picks "Take a tour" */}
      {showTour && (
        <TourOverlay
          storageKey={tourDoneKey}
          onDone={() => setShowTour(false)}
        />
      )}

      {/* Renewal success modal — auto-dismissed after 8 s or on click */}
      {showRenewalModal && (
        <RenewalSuccessModal
          billing={billing}
          onClose={() => setShowRenewalModal(false)}
        />
      )}

      {/* Downgrade notice — shown for 2 logins after a plan downgrade */}
      {downgradeNotice && (
        <DowngradeNoticeModal
          notice={downgradeNotice}
          onClose={dismissDowngradeNotice}
        />
      )}
    </div>
  );
}

function DashboardFooter() {
  return (
    <footer
      className="mt-10 border-t border-[#3A4142]/70 pt-5 pb-24 text-xs text-[#A8A196] sm:pb-20 lg:pr-56"
      data-testid="dashboard-footer"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold text-[#D4CEC0]">
            PetBill Shield
          </p>
          <p>
            © {new Date().getFullYear()} · No diagnosis, no refusal-of-care advice.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            to="/contact"
            className="font-semibold text-[#F2A58F] transition-colors hover:text-[#FFD7CB]"
            data-testid="dashboard-footer-contact"
          >
            Contact support
          </Link>
          <Link
            to="/dashboard/pricing"
            className="transition-colors hover:text-[#EFE8DA]"
          >
            Plans
          </Link>
          <Link
            to="/dashboard/settings"
            className="transition-colors hover:text-[#EFE8DA]"
          >
            Account
          </Link>
        </nav>
      </div>
    </footer>
  );
}

// ── Bell dropdown helpers ──────────────────────────────────────────────────────

function formatReminderRelative(iso) {
  if (!iso) return "";
  const now   = new Date();
  const d     = new Date(iso);
  const diff  = d - now;
  const abs   = Math.abs(diff);
  const hours = Math.floor(abs / 3_600_000);
  const days  = Math.floor(abs / 86_400_000);

  if (diff < 0) {
    if (hours < 1)  return "Overdue";
    if (hours < 24) return `${hours}h overdue`;
    return `${days}d overdue`;
  }
  if (hours < 1)  return "Due soon";
  if (hours < 24) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7)  return `In ${days} days`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function BellDropdown({ reminders, onClose, onMouseEnter, onMouseLeave }) {
  const now = new Date();

  const actionable = (reminders || [])
    .filter(r => r.status === "pending" && r.scheduled_for)
    .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));

  const overdue  = actionable.filter(r => new Date(r.scheduled_for) <  now);
  const upcoming = actionable.filter(r => new Date(r.scheduled_for) >= now);

  // Overdue first, then soonest upcoming — show at most 5
  const items = [...overdue, ...upcoming].slice(0, 5);

  return (
    <div
      className="absolute right-0 top-full mt-2 w-[300px] rounded-[20px] border border-[#E5E2D9] bg-[#FAF9F6] shadow-2xl z-50 overflow-hidden"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-testid="bell-dropdown"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-[#E5E2D9]">
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#8A887F]">
          Reminders
        </span>
        {overdue.length > 0 && (
          <span className="text-[10px] font-bold bg-[#D26D53] text-white rounded-full px-2 py-0.5">
            {overdue.length} overdue
          </span>
        )}
      </div>

      {/* ── Items ── */}
      {items.length === 0 ? (
        <div className="px-4 py-6 text-sm text-center text-[#65635C]">
          No pending reminders
        </div>
      ) : (
        <div>
          {items.map((r, i) => {
            const isOverdue = new Date(r.scheduled_for) < now;
            return (
              <Link
                key={r.reminder_id}
                to="/dashboard/reminders"
                onClick={onClose}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-[#F2F0E9] transition-colors ${
                  i < items.length - 1 ? "border-b border-[#E5E2D9]" : ""
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isOverdue ? "bg-[#D26D53]" : "bg-[#E6AE2E]"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-tight truncate">
                    {r.title}
                  </div>
                  {r.pet_name && (
                    <div className="text-[11px] text-[#8A887F] mt-0.5">{r.pet_name}</div>
                  )}
                </div>
                <span
                  className={`text-[11px] font-semibold shrink-0 ml-2 ${
                    isOverdue ? "text-[#D26D53]" : "text-[#8A5A24]"
                  }`}
                >
                  {formatReminderRelative(r.scheduled_for)}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E2D9] bg-[#F2F0E9]">
        <Link
          to="/dashboard/reminders"
          onClick={onClose}
          className="text-xs font-semibold text-[#D26D53] inline-flex items-center gap-1.5 hover:gap-2 transition-all"
        >
          See all reminders
          <ArrowRight size={12} />
        </Link>
        {actionable.length > 0 && (
          <span className="text-[11px] text-[#8A887F]">
            {actionable.length} pending
          </span>
        )}
      </div>
    </div>
  );
}

// ── Downgrade notice modal ─────────────────────────────────────────────────────
// Shown for the first 2 logins after a plan downgrade that reduced pet slots.
// Explains which pets stayed active and why — then disappears automatically.

function DowngradeNoticeModal({ notice, onClose }) {
  const keptPets       = notice.kept_pets        || [];
  const deactivated    = notice.deactivated_pets || [];
  const shownCount     = notice.shown_count      || 0;   // already incremented by API call
  const loginsLeft     = Math.max(0, 2 - shownCount);    // how many more times it will show

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 bg-[#2D2C28]/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-[28px] bg-[#FAF9F6] border border-[#E5E2D9] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="p-6 pb-4 border-b border-[#E5E2D9]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow text-[#E6AE2E] mb-1">Plan changed</div>
              <h2 className="font-serif-display text-2xl leading-tight text-[#2D2C28]">
                {notice.old_plan_label} → {notice.new_plan_label}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#F2F0E9] inline-flex items-center justify-center text-[#8A887F] hover:bg-[#E5E2D9] transition-colors shrink-0 mt-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
            Your new plan supports up to <strong>{notice.pet_limit} pet{notice.pet_limit !== 1 ? "s" : ""}</strong>.
            We kept your most recently analyzed pets active. All pet records remain safe and accessible.
          </p>
        </div>

        {/* Kept pets */}
        {keptPets.length > 0 && (
          <div className="px-6 pt-4 pb-2">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#556045] mb-2.5">
              ✓ Staying active
            </div>
            <div className="space-y-2">
              {keptPets.map((pet) => (
                <div key={pet.pet_id} className="flex items-center gap-3 rounded-2xl bg-[#E8F5EC] border border-[#C8E8D4] px-3.5 py-2.5">
                  <div className="w-2 h-2 rounded-full bg-[#556045] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm text-[#2D2C28]">{pet.name}</span>
                  </div>
                  <span className="text-[11px] text-[#556045] shrink-0">{pet.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deactivated pets */}
        {deactivated.length > 0 && (
          <div className="px-6 pt-3 pb-4">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#8A887F] mb-2.5">
              Paused (records safe)
            </div>
            <div className="rounded-2xl bg-[#F2F0E9] border border-[#E5E2D9] px-3.5 py-2.5">
              <p className="text-sm text-[#65635C]">
                {deactivated.map((p) => p.name).join(", ")}
              </p>
              <p className="text-xs text-[#8A887F] mt-1">
                Upgrade your plan to reactivate them — no data is ever deleted.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3 border-t border-[#E5E2D9] pt-4">
          <p className="text-[11px] text-[#8A887F] leading-relaxed">
            {loginsLeft > 0
              ? `This notice will show ${loginsLeft} more time${loginsLeft > 1 ? "s" : ""}, then disappear.`
              : "This is the last time this notice will appear."}
          </p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-xl bg-[#2D2C28] text-[#FAF9F6] px-4 py-2 text-sm font-semibold hover:bg-[#3F3E39] transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Renewal success modal ─────────────────────────────────────────────────────

function RenewalSuccessModal({ billing, onClose }) {
  const planLabel  = billing?.plan_label || "your plan";
  const renewDate  = billing?.entitlement_expires_at
    ? new Date(billing.entitlement_expires_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 bg-[#2D2C28]/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-[24px] bg-[#FAF9F6] border border-[#E5E2D9] shadow-2xl p-6 relative animate-[fadeSlideUp_0.3s_ease]">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-full bg-[#F2F0E9] inline-flex items-center justify-center text-[#8A887F] hover:bg-[#E5E2D9] transition-colors"
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>

        {/* Content */}
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-[#E8F5EA] border border-[#C8E8D4] flex items-center justify-center shrink-0">
            <CheckCircle2 size={22} className="text-[#2B6A39]" strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#556045] mb-1">
              Renewed automatically ✓
            </div>
            <p className="font-semibold text-[#2D2C28] leading-snug">
              {planLabel} subscription renewed
            </p>
            {renewDate && (
              <p className="text-xs text-[#65635C] mt-1">
                Your next renewal is on <strong>{renewDate}</strong>. No action needed.
              </p>
            )}
          </div>
        </div>

        {/* Progress bar — shows auto-dismiss countdown */}
        <div className="mt-4 h-1 bg-[#E5E2D9] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#556045] rounded-full"
            style={{ animation: "shrinkWidth 8s linear forwards" }}
          />
        </div>

        <style>{`
          @keyframes fadeSlideUp {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes shrinkWidth {
            from { width: 100%; }
            to   { width: 0%; }
          }
        `}</style>
      </div>
    </div>
  );
}
