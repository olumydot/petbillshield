import { useTranslation } from "react-i18next";
import { Check, Loader2, Sparkles, ArrowUp, ArrowDown, Zap, PawPrint, Shield, Users, Heart, Calendar, ArrowRight, Clock, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBilling } from "../lib/billing";
import { toast } from "sonner";
import PromoBanner from "../components/PromoBanner";

const PLAN_TIER = {
  free: 0,
  free_tier: 0,
  vault_monthly: 1,
  vault_yearly: 1,
  family_monthly: 2,
  family_yearly: 2,
  rescue_monthly: 3,
  rescue_yearly: 3,
};

/** Mirrors the backend _is_plan_upgrade() logic. */
function _isUpgrade(fromPlan, toPlan) {
  const ft = PLAN_TIER[fromPlan] ?? 0;
  const tt = PLAN_TIER[toPlan] ?? 0;
  if (tt > ft) return true;
  if (tt === ft && ft > 0) {
    return (fromPlan || "").endsWith("_monthly") && (toPlan || "").endsWith("_yearly");
  }
  return false;
}

const PLANS = [
  {
    id: "free",
    tier: 0,
    name: "Free",
    icon: PawPrint,
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    sub: "Free forever",
    features: [
      "1 pet profile",
      "1 estimate review per month",
      "Basic bill explanation",
      "Basic health timeline (no AI)",
      "Care reminders",
    ],
    plan_id: null,
    color: "neutral",
  },
  {
    id: "vault",
    tier: 1,
    name: "Pet Cost Vault",
    icon: Shield,
    monthlyPrice: "$8.99",
    yearlyPrice: "$89.90",
    monthlySub: "per month",
    yearlySub: "per year",
    monthlyPlanId: "vault_monthly",
    yearlyPlanId: "vault_yearly",
    features: [
      "2 pet profiles",
      "Unlimited estimate reviews",
      "AI estimate defender",
      "Pet vault: records, meds, reminders",
      "Health timeline + cost forecasting",
      "Insurance claim helper + appeals",
    ],
    featured: true,
    color: "terracotta",
  },
  {
    id: "family",
    tier: 2,
    name: "Family",
    icon: Users,
    monthlyPrice: "$19.99",
    yearlyPrice: "$199.90",
    monthlySub: "per month",
    yearlySub: "per year",
    monthlyPlanId: "family_monthly",
    yearlyPlanId: "family_yearly",
    features: [
      "Up to 5 pet profiles",
      "Unlimited estimate reviews",
      "Shared household pet vault",
      "Multi-pet spending summary",
      "Care reminders across all pets",
      "Insurance + appeal support",
    ],
    color: "sage",
  },
  {
    id: "rescue",
    tier: 3,
    name: "Rescue / Foster",
    icon: Heart,
    monthlyPrice: "$49.99",
    yearlyPrice: "$499.90",
    monthlySub: "per month",
    yearlySub: "per year",
    monthlyPlanId: "rescue_monthly",
    yearlyPlanId: "rescue_yearly",
    features: [
      "Unlimited pet profiles",
      "Unlimited estimate reviews",
      "Rescue / Foster command center",
      "Donation-ready expense reports",
      "Adoption & transfer packets",
      "Vaccine logs across all animals",
      "Foster transfer-ready records",
      "AI rescue summaries",
      "Email reports to donors, vets & fosters",
    ],
    wide: true,
    color: "dark",
  },
];

const FEATURE_COMPARISON = [
  { label: "Pet profiles", free: "1", vault: "2", family: "5", rescue: "Unlimited" },
  { label: "Bill analysis / month", free: "1", vault: "Unlimited", family: "Unlimited", rescue: "Unlimited" },
  { label: "Care reminders", free: "✓", vault: "✓", family: "✓", rescue: "✓" },
  { label: "Health timeline", free: "Basic", vault: "Full + forecast", family: "Full + forecast", rescue: "Full + forecast" },
  { label: "Pet vault (records)", free: "—", vault: "✓", family: "✓", rescue: "✓" },
  { label: "Insurance claims", free: "—", vault: "✓", family: "✓", rescue: "✓" },
  { label: "Question scripts", free: "—", vault: "✓", family: "✓", rescue: "✓" },
  { label: "Compare estimates", free: "—", vault: "✓", family: "✓", rescue: "✓" },
  { label: "Rescue / Foster hub", free: "—", vault: "—", family: "—", rescue: "✓" },
  { label: "Donation-ready reports", free: "—", vault: "—", family: "—", rescue: "✓" },
  { label: "Adoption packets", free: "—", vault: "—", family: "—", rescue: "✓" },
];

const YEARLY_PROMO_PLAN_IDS = ["vault_yearly", "family_yearly", "rescue_yearly"];

export default function PricingPage() {
  const { t } = useTranslation();
  const { billing, refresh, switchPlan, cancelSwitch, cancelPlan, reactivatePlan } = useBilling();
  const navigate = useNavigate();

  const [working, setWorking]           = useState(null);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [showComparison, setShowComparison] = useState(false);
  const [activePromo, setActivePromo] = useState(null);

  // Midcycle switch confirmation state
  const [switchTarget, setSwitchTarget] = useState(null); // { plan, planId, isUpgrade }
  const [switching, setSwitching]       = useState(false);

  // Cancel pending downgrade
  const [cancellingSwitch, setCancellingSwitch] = useState(false);

  // Cancel / reactivate the whole subscription
  const [showCancelModal,  setShowCancelModal]  = useState(false);
  const [cancellingPlan,   setCancellingPlan]   = useState(false);
  const [reactivatingPlan, setReactivatingPlan] = useState(false);
  const activePromoCode = activePromo?.promo_code || "";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("promo") || localStorage.getItem("petbill_active_promo_code");
    if (code) {
      setActivePromo((prev) => prev || {
        promo_code: code.toUpperCase(),
        discount_display: "50% off first 3 months",
        plan_scope: "yearly",
        allowed_plan_ids: YEARLY_PROMO_PLAN_IDS,
      });
    }
  }, []);

  const handlePromo = useCallback((promo) => {
    setActivePromo(promo);
    if ((promo?.plan_scope || "").toLowerCase() === "yearly") {
      setBillingCycle("yearly");
    }
  }, []);

  const currentPlanId  = billing?.plan_id || "free";
  const currentTier    = PLAN_TIER[currentPlanId] ?? 0;
  const isSubscribed   = billing?.active === true;
  const pendingDownId  = billing?.pending_downgrade_plan_id  || null;
  const pendingDownAt  = billing?.pending_downgrade_at       || null;
  const pendingDownLbl = billing?.pending_downgrade_plan_label || null;

  function getPlanId(plan) {
    if (!plan.monthlyPlanId) return null;
    return billingCycle === "yearly" ? plan.yearlyPlanId : plan.monthlyPlanId;
  }

  function getPlanPrice(plan) {
    return billingCycle === "yearly"
      ? `${plan.yearlyPrice}/yr`
      : `${plan.monthlyPrice}/mo`;
  }

  function promoAppliesToPlan(planId) {
    if (!activePromoCode || !planId) return false;
    const scope = (activePromo?.plan_scope || "all").toLowerCase();
    if (scope === "yearly" && !planId.endsWith("_yearly")) return false;
    if (scope === "monthly" && !planId.endsWith("_monthly")) return false;
    const allowed = activePromo?.allowed_plan_ids || [];
    return allowed.length === 0 || allowed.includes(planId);
  }

  /**
   * Handles clicking a plan CTA.
   * - Existing active subscriber → show switch confirmation modal.
   * - New / free user → navigate to the dedicated Checkout Sessions page.
   */
  function handlePlanAction(plan) {
    const selectedPlanId = getPlanId(plan);
    if (!selectedPlanId) return;

    if (isSubscribed) {
      // Block if this plan is already the pending downgrade
      if (pendingDownId === selectedPlanId) {
        toast.info(`${plan.name} is already scheduled to start at your next renewal.`);
        return;
      }
      const upgrade = _isUpgrade(currentPlanId, selectedPlanId);
      setSwitchTarget({ plan, planId: selectedPlanId, isUpgrade: upgrade });
      return;
    }

    const promoQuery = promoAppliesToPlan(selectedPlanId)
      ? `&promo=${encodeURIComponent(activePromoCode)}`
      : "";
    navigate(`/dashboard/checkout?plan=${selectedPlanId}${promoQuery}`);
  }

  /** Cancels a pending plan downgrade and reverts the subscription. */
  async function handleCancelSwitch() {
    if (cancellingSwitch) return;
    setCancellingSwitch(true);
    try {
      const result = await cancelSwitch();
      toast.success(`Scheduled switch cancelled — you're staying on ${result.plan_label}.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel the scheduled switch.");
    } finally {
      setCancellingSwitch(false);
    }
  }

  /** Cancels the whole subscription at period end — called from CancelPlanModal. */
  async function handleCancelPlan() {
    if (cancellingPlan) return;
    setCancellingPlan(true);
    try {
      const result = await cancelPlan();
      setShowCancelModal(false);
      const endsAt = result.ends_at
        ? new Date(result.ends_at).toLocaleDateString()
        : "your renewal date";
      toast.success(`Subscription cancelled. You keep ${result.plan_label} access until ${endsAt}.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel subscription. Please try again.");
    } finally {
      setCancellingPlan(false);
    }
  }

  /** Removes the scheduled cancellation — keeps the subscription active. */
  async function handleReactivatePlan() {
    if (reactivatingPlan) return;
    setReactivatingPlan(true);
    try {
      const result = await reactivatePlan();
      toast.success(`Welcome back! Your ${result.plan_label} subscription is active again.`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not reactivate subscription. Please try again.");
    } finally {
      setReactivatingPlan(false);
    }
  }

  /** Called when user confirms a midcycle switch in the modal. */
  async function confirmSwitch() {
    if (!switchTarget) return;
    setSwitching(true);
    try {
      const result = await switchPlan(switchTarget.planId);
      setSwitchTarget(null);
      if (result.is_upgrade) {
        toast.success("Plan upgraded — new features are available immediately.");
      } else {
        const effectiveDate = result.effective_at
          ? new Date(result.effective_at).toLocaleDateString()
          : "your next renewal";
        toast.success(`Plan switch scheduled. Your current plan stays active until ${effectiveDate}.`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not switch plan. Please try again.");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="space-y-8 pb-16" data-testid="pricing-page">
      {/* Promo banner — admin-controlled, shows when enabled */}
      <div className="-mx-5 sm:-mx-8 -mt-8 mb-2 rounded-t-none overflow-hidden">
        <PromoBanner page="pricing" onPromo={handlePromo} />
      </div>

      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-8 sm:p-12">
        <div className="absolute right-[-80px] top-[-80px] h-[280px] w-[280px] rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="absolute left-[-80px] bottom-[-80px] h-[240px] w-[240px] rounded-full bg-[#556045]/25 blur-3xl" />

        <div className="relative z-10 max-w-3xl">
          <div className="eyebrow text-[#E6AE2E] mb-4">Plans</div>

          <h1 className="font-serif-display text-5xl sm:text-6xl tracking-tight leading-[0.95]">
            Peace of mind for{" "}
            <span className="italic text-[#D26D53]">pet care costs.</span>
          </h1>

          <p className="mt-5 text-sm sm:text-base text-white/70 max-w-2xl leading-relaxed">
            PetBill Shield helps you understand vet bills, track care costs,
            prepare better conversations, and stay ahead of every reminder.
          </p>
        </div>

        {isSubscribed && (
          <div className="relative z-10 mt-8 rounded-2xl border border-white/10 bg-white/8 p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <Sparkles size={18} className="text-[#E6AE2E] shrink-0" />

              <div className="flex-1 min-w-[180px]">
                <span className="font-semibold text-sm">{billing.plan_label}</span>
                {billing.entitlement_expires_at && (
                  <span className={`text-sm ml-2 ${billing?.cancel_at_period_end ? "text-[#F2C17A]" : "text-white/60"}`}>
                    {billing?.cancel_at_period_end ? "· Ends" : "· Renews"}{" "}
                    {new Date(billing.entitlement_expires_at).toLocaleDateString()}
                  </span>
                )}
                {/* Pending downgrade notice */}
                {pendingDownId && !billing?.cancel_at_period_end && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-[#E6AE2E] flex-wrap">
                    <Clock size={12} />
                    Switching to <strong>{pendingDownLbl}</strong>
                    {pendingDownAt && <> on {new Date(pendingDownAt).toLocaleDateString()}</>}
                    <button
                      onClick={handleCancelSwitch}
                      disabled={cancellingSwitch}
                      className="ml-1 text-white/50 hover:text-white underline underline-offset-2 transition-colors disabled:opacity-50"
                    >
                      {cancellingSwitch ? "Cancelling…" : "Undo"}
                    </button>
                  </div>
                )}
              </div>

              {/* Right-side actions */}
              {billing?.cancel_at_period_end ? (
                <button
                  onClick={handleReactivatePlan}
                  disabled={reactivatingPlan}
                  className="rounded-xl border border-[#E6AE2E]/40 bg-[#E6AE2E]/15 hover:bg-[#E6AE2E]/25 text-[#F2C17A] px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 transition disabled:opacity-60"
                  data-testid="reactivate-btn"
                >
                  {reactivatingPlan ? <Loader2 size={13} className="animate-spin" /> : null}
                  {reactivatingPlan ? "Reactivating…" : "Reactivate subscription"}
                </button>
              ) : (
                <button
                  onClick={refresh}
                  className="text-sm text-white/50 hover:text-white transition"
                  data-testid="refresh-billing"
                >
                  Refresh status
                </button>
              )}
            </div>

            {/* Cancel plan — subtle secondary action, only when not already cancelling */}
            {!billing?.cancel_at_period_end && (
              <div className="pt-1 border-t border-white/8 flex items-center justify-between">
                <span className="text-xs text-white/35">
                  Need to step back? Your data is always safe.
                </span>
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="text-xs text-white/35 hover:text-white/65 underline underline-offset-2 transition-colors"
                  data-testid="cancel-plan-btn"
                >
                  Cancel subscription
                </button>
              </div>
            )}

            {/* Ending-soon notice */}
            {billing?.cancel_at_period_end && (
              <div className="pt-1 border-t border-white/8 text-xs text-[#F2C17A]/70">
                Your account moves to the free tier automatically after the end date. No action needed.
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="inline-flex rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-1.5">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition ${
              billingCycle === "monthly"
                ? "bg-[#2D2C28] text-white shadow-sm"
                : "text-[#65635C] hover:text-[#2D2C28]"
            }`}
          >
            Monthly
          </button>

          <button
            type="button"
            onClick={() => setBillingCycle("yearly")}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition relative ${
              billingCycle === "yearly"
                ? "bg-[#2D2C28] text-white shadow-sm"
                : "text-[#65635C] hover:text-[#2D2C28]"
            }`}
          >
            Yearly
            <span className="ml-2 text-[10px] font-bold bg-[#D26D53] text-white rounded-full px-1.5 py-0.5">
              -17%
            </span>
          </button>
        </div>

        <button
          onClick={() => setShowComparison((v) => !v)}
          className="text-sm text-[#D26D53] font-semibold hover:opacity-80 transition"
        >
          {showComparison ? "Hide" : "Show"} full feature comparison
        </button>
      </div>

      {activePromoCode && (
        <div className="rounded-2xl border border-[#D26D53]/35 bg-[#3A1B12] px-4 py-3 text-sm text-[#F7D2C7]">
          <span className="font-semibold text-[#FAF9F6]">{activePromoCode}</span>{" "}
          {activePromo?.discount_display || "50% off first 3 months"} applies to eligible yearly plans at checkout.
        </div>
      )}

      {isSubscribed && currentPlanId.endsWith("_monthly") && (
        <SwitchToAnnualBanner
          currentPlanId={currentPlanId}
          working={working}
          pendingDownId={pendingDownId}
          onSwitch={(yearlyPlanId, plan) => {
            // Already pending? Just inform.
            if (pendingDownId === yearlyPlanId) {
              toast.info("Annual billing is already scheduled to start at your next renewal.");
              return;
            }
            setSwitchTarget({ plan, planId: yearlyPlanId, isUpgrade: true });
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.filter((p) => !p.wide).map((p) => {
          const isCurrent = p.tier === currentTier && (isSubscribed || p.tier === 0);
          const isPending  = pendingDownId === p.monthlyPlanId || pendingDownId === p.yearlyPlanId;

          return (
            <PriceCard
              key={p.id}
              p={p}
              working={working}
              onStart={handlePlanAction}
              onCancelPlan={isCurrent && isSubscribed ? () => setShowCancelModal(true) : null}
              isCurrent={isCurrent}
              currentTier={currentTier}
              isSubscribed={isSubscribed}
              billingCycle={billingCycle}
              isPending={isPending}
              pendingDownAt={pendingDownAt}
              onCancelSwitch={isPending ? handleCancelSwitch : null}
              cancellingSwitch={cancellingSwitch}
              activePromo={activePromo}
            />
          );
        })}
      </div>

      <div>
        {PLANS.filter((p) => p.wide).map((p) => {
          const isCurrent = p.tier === currentTier && isSubscribed;
          const isPending  = pendingDownId === p.monthlyPlanId || pendingDownId === p.yearlyPlanId;

          return (
            <PriceCard
              key={p.id}
              p={p}
              working={working}
              onStart={handlePlanAction}
              onCancelPlan={isCurrent && isSubscribed ? () => setShowCancelModal(true) : null}
              isCurrent={isCurrent}
              currentTier={currentTier}
              isSubscribed={isSubscribed}
              billingCycle={billingCycle}
              isPending={isPending}
              pendingDownAt={pendingDownAt}
              onCancelSwitch={isPending ? handleCancelSwitch : null}
              cancellingSwitch={cancellingSwitch}
              wide
              activePromo={activePromo}
            />
          );
        })}
      </div>

      {showComparison && <FeatureComparison billingCycle={billingCycle} />}

      <BillingRulesCard isSubscribed={isSubscribed} currentTier={currentTier} />

      <p className="text-xs text-[#65635C] leading-relaxed text-center">
        Powered by Stripe · Subscriptions renew automatically and can be
        cancelled anytime from your account.
      </p>

      {/* Midcycle switch confirmation modal */}
      {switchTarget && (
        <SwitchConfirmModal
          target={switchTarget}
          billing={billing}
          onConfirm={confirmSwitch}
          onCancel={() => setSwitchTarget(null)}
          busy={switching}
        />
      )}

      {/* ── Cancel subscription modal ────────────────────────────── */}
      {showCancelModal && (
        <CancelPlanModal
          billing={billing}
          busy={cancellingPlan}
          onConfirm={handleCancelPlan}
          onClose={() => !cancellingPlan && setShowCancelModal(false)}
        />
      )}
    </div>
  );
}

function SwitchToAnnualBanner({ currentPlanId, working, pendingDownId, onSwitch }) {
  const plan = PLANS.find((p) => p.monthlyPlanId === currentPlanId);
  if (!plan || !plan.yearlyPlanId) return null;

  const monthlyNum  = parseFloat(plan.monthlyPrice.replace("$", ""));
  const yearlyNum   = parseFloat(plan.yearlyPrice.replace("$", ""));
  const savings     = (monthlyNum * 12 - yearlyNum).toFixed(2);
  const isBusy      = working === plan.yearlyPlanId;
  const isPending   = pendingDownId === plan.yearlyPlanId;

  return (
    <div
      className="relative overflow-hidden rounded-[24px] bg-gradient-to-r from-[#3A4B30] to-[#556045] text-white p-5 flex flex-col sm:flex-row sm:items-center gap-4"
      data-testid="switch-to-annual-banner"
    >
      {/* background glow */}
      <div className="absolute right-[-60px] top-[-60px] w-[200px] h-[200px] rounded-full bg-white/5 blur-2xl pointer-events-none" />

      <div className="flex items-center gap-3 flex-1">
        <span className="w-10 h-10 rounded-2xl bg-white/15 inline-flex items-center justify-center shrink-0">
          <Calendar size={18} className="text-[#E6AE2E]" />
        </span>
        <div>
          <p className="font-semibold text-sm leading-tight">
            Switch to annual and save{" "}
            <span className="text-[#E6AE2E]">${savings}/year</span>
          </p>
          <p className="text-xs text-white/65 mt-0.5">
            You're on <strong className="text-white/90">{plan.name} monthly</strong> — lock in annual billing and get 2 months free.
          </p>
        </div>
      </div>

      <button
        onClick={() => onSwitch(plan.yearlyPlanId, plan)}
        disabled={isBusy || isPending}
        className="relative z-10 shrink-0 rounded-xl bg-white text-[#2D2C28] hover:bg-[#FAF9F6] px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 transition disabled:opacity-60"
        data-testid="switch-annual-btn"
      >
        {isBusy ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Opening…
          </>
        ) : isPending ? (
          <>
            <Clock size={14} />
            Scheduled
          </>
        ) : (
          <>
            Switch to annual
            <ArrowRight size={14} />
          </>
        )}
      </button>
    </div>
  );
}

function PriceCard({
  p,
  working,
  onStart,
  onCancelPlan,
  isCurrent,
  currentTier,
  isSubscribed,
  billingCycle,
  wide,
  isPending       = false,
  pendingDownAt   = null,
  onCancelSwitch  = null,
  cancellingSwitch = false,
  activePromo = null,
}) {
  const isFree = !p.monthlyPlanId;

  const price =
    billingCycle === "yearly" ? p.yearlyPrice || p.monthlyPrice : p.monthlyPrice;
  const sub =
    billingCycle === "yearly" ? p.yearlySub || p.sub : p.monthlySub || p.sub;
  const currentPlanId =
    billingCycle === "yearly" ? p.yearlyPlanId : p.monthlyPlanId;
  const activePromoCode = activePromo?.promo_code || "";
  const promoScope = (activePromo?.plan_scope || "all").toLowerCase();
  const promoAllowedPlans = activePromo?.allowed_plan_ids || [];
  const promoApplies =
    Boolean(activePromoCode && currentPlanId) &&
    (promoScope !== "yearly" || currentPlanId.endsWith("_yearly")) &&
    (promoScope !== "monthly" || currentPlanId.endsWith("_monthly")) &&
    (promoAllowedPlans.length === 0 || promoAllowedPlans.includes(currentPlanId));

  const isHigher = p.tier > currentTier;
  const isLower = p.tier < currentTier && p.tier > 0;

  const colorSchemes = {
    neutral: {
      card: "border-[#E5E2D9] bg-[#FAF9F6]",
      eyebrow: "text-[#65635C]",
      icon: "bg-[#F2F0E9] text-[#65635C]",
      btn: "btn-ghost",
      check: "text-[#556045]",
      price: "text-[#2D2C28]",
      sub: "text-[#65635C]",
    },
    terracotta: {
      card: "border-[#D26D53]/25 bg-[#2D2C28] text-[#FAF9F6]",
      eyebrow: "text-[#E4A834]",
      icon: "bg-white/10 text-[#E4A834]",
      btn: "bg-[#D26D53] hover:bg-[#BD5D44] text-white",
      check: "text-[#E4A834]",
      price: "text-[#FAF9F6]",
      sub: "text-[#FAF9F6]/60",
    },
    sage: {
      card: "border-[#B7C3A4] bg-[#E7EBDD]",
      eyebrow: "text-[#556045]",
      icon: "bg-[#556045] text-white",
      btn: "bg-[#556045] hover:bg-[#445035] text-white",
      check: "text-[#556045]",
      price: "text-[#2D2C28]",
      sub: "text-[#65635C]",
    },
    dark: {
      card: "border-[#E5E2D9] bg-[#FAF9F6]",
      eyebrow: "text-[#D26D53]",
      icon: "bg-[#F2E5DE] text-[#D26D53]",
      btn: "btn-primary",
      check: "text-[#D26D53]",
      price: "text-[#2D2C28]",
      sub: "text-[#65635C]",
    },
  };

  const cs = colorSchemes[p.color] || colorSchemes.neutral;

  function renderCTA() {
    // Plan is scheduled to become active at next renewal
    if (isPending && !isCurrent) {
      const dateLabel = pendingDownAt
        ? `Starting ${new Date(pendingDownAt).toLocaleDateString()}`
        : "Starting at renewal";
      return (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs text-[#8A5A24] font-semibold bg-[#FEF6E4] border border-[#E6AE2E]/30 rounded-xl px-3 py-2">
            <Clock size={13} />
            {dateLabel}
          </span>
          {onCancelSwitch && (
            <button
              onClick={onCancelSwitch}
              disabled={cancellingSwitch}
              className="text-xs text-[#65635C] hover:text-[#D26D53] underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              {cancellingSwitch ? "Cancelling…" : "Undo"}
            </button>
          )}
        </div>
      );
    }

    if (isCurrent) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-[#556045] font-semibold bg-[#E7EBDD] rounded-xl px-3 py-2">
            <Check size={14} />
            Current plan
          </span>
          {onCancelPlan && (
            <button
              onClick={onCancelPlan}
              className="text-xs text-[#65635C] hover:text-[#D26D53] underline underline-offset-2 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      );
    }

    if (isFree) {
      return (
        <span className="text-xs text-[#65635C]">
          Included — no checkout needed.
        </span>
      );
    }

    if (!isSubscribed || currentTier === 0) {
      return (
        <button
          onClick={() => onStart(p)}
          disabled={working === currentPlanId}
          className={`rounded-xl px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70 transition ${cs.btn}`}
          data-testid={`checkout-${p.id}`}
        >
          {working === currentPlanId ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Opening…
            </>
          ) : (
            <>
              <Zap size={14} />
              Subscribe
            </>
          )}
        </button>
      );
    }

    if (isHigher) {
      return (
        <button
          onClick={() => onStart(p)}
          disabled={working === currentPlanId}
          className={`rounded-xl px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70 transition ${cs.btn}`}
          data-testid={`checkout-${p.id}`}
        >
          {working === currentPlanId ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Opening…
            </>
          ) : (
            <>
              <ArrowUp size={14} />
              Upgrade
            </>
          )}
        </button>
      );
    }

    if (isLower) {
      return (
        <button
          onClick={() => onStart(p)}
          className={`rounded-xl px-5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 transition ${cs.btn}`}
          data-testid={`downgrade-${p.id}`}
        >
          <ArrowDown size={14} />
          Downgrade
        </button>
      );
    }

    return null;
  }

  return (
    <div
      className={`rounded-[28px] border p-7 flex flex-col ${cs.card} ${
        wide ? "" : ""
      } ${p.featured ? "shadow-xl shadow-[#2D2C28]/20" : ""}`}
      data-testid={`plan-${p.id}`}
    >
      {wide && (
        <div
          className={`flex items-center gap-2 mb-5 px-3 py-1.5 rounded-xl w-fit border ${
            cs.icon
          } border-current/20`}
        >
          <p.icon size={16} />
          <span className="text-xs font-bold uppercase tracking-wider">{p.name}</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 mb-2">
        {!wide && (
          <span
            className={`w-11 h-11 rounded-2xl inline-flex items-center justify-center shrink-0 ${cs.icon}`}
          >
            <p.icon size={18} />
          </span>
        )}

        <div className="flex-1">
          {!wide && (
            <div className={`eyebrow mb-1 ${cs.eyebrow}`}>{p.name}</div>
          )}
        </div>

        {isCurrent && (
          <span className="chip bg-[#556045] text-white border-[#556045] shrink-0 text-[10px]">
            Current
          </span>
        )}

        {p.featured && !isCurrent && (
          <span className="chip chip-warning shrink-0 text-[10px]">
            Best value
          </span>
        )}

        {p.tier === 3 && !isCurrent && (
          <span
            className={`text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0 ${
              p.color === "dark"
                ? "bg-[#D26D53]/15 text-[#D26D53] border border-[#D26D53]/25"
                : "bg-[#FAF9F6]/10 text-[#FAF9F6] border border-[#FAF9F6]/15"
            }`}
          >
            Premium
          </span>
        )}
      </div>

      <div className="flex items-end gap-2 mt-3">
        <span
          className={`font-serif-display leading-none ${
            wide ? "text-5xl" : "text-5xl"
          } ${cs.price}`}
        >
          {price}
        </span>
        <span className={`text-sm mb-1 ${cs.sub}`}>{sub}</span>
      </div>

      {!isFree && billingCycle === "yearly" && (
        <p className={`text-xs mt-1.5 font-semibold ${cs.eyebrow}`}>
          Save 2 months with annual billing
        </p>
      )}

      {!isFree && promoApplies && (
        <p className="mt-2 inline-flex w-fit rounded-full border border-[#D26D53]/35 bg-[#3A1B12] px-3 py-1 text-[11px] font-bold text-[#F7D2C7]">
          {activePromo.discount_display || "50% off first 3 months"} · {activePromoCode}
        </p>
      )}

      {!isFree && billingCycle === "monthly" && (
        <p className={`text-xs mt-1.5 ${cs.sub}`}>
          Save 17% with annual billing
        </p>
      )}

      <ul
        className={`mt-5 space-y-2.5 text-sm flex-1 ${
          p.color === "terracotta" ? "text-[#FAF9F6]/80" : "text-[#65635C]"
        } ${wide ? "grid grid-cols-1 sm:grid-cols-2 gap-x-6 space-y-0 gap-y-2.5" : ""}`}
      >
        {p.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check size={14} className={`mt-0.5 shrink-0 ${cs.check}`} />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-6">{renderCTA()}</div>
    </div>
  );
}

// ── Midcycle switch confirmation modal ─────────────────────────────────────
function SwitchConfirmModal({ target, billing, onConfirm, onCancel, busy }) {
  if (!target) return null;

  const { plan, isUpgrade } = target;
  const currentLabel = billing?.plan_label || "your current plan";
  const renewsAt     = billing?.entitlement_expires_at
    ? new Date(billing.entitlement_expires_at).toLocaleDateString()
    : null;

  const price = plan.monthlyPrice; // show the monthly equivalent in the modal

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div className="bg-[#FAF9F6] rounded-[28px] border border-[#E5E2D9] shadow-2xl p-7 w-full max-w-md">

        {/* Header */}
        <div className="mb-5">
          <div className="eyebrow text-[#D26D53] mb-2">
            {isUpgrade ? "Upgrade plan" : "Switch plan"}
          </div>
          <h2 className="font-serif-display text-2xl">
            {isUpgrade ? "Upgrade to" : "Switch to"}{" "}
            <span className="italic">{plan.name}</span>
          </h2>
        </div>

        {/* Info box */}
        <div
          className={`rounded-2xl p-4 mb-6 text-sm leading-relaxed ${
            isUpgrade ? "bg-[#E7EBDD] text-[#2D2C28]" : "bg-[#FEF6E4] text-[#2D2C28]"
          }`}
        >
          {isUpgrade ? (
            <>
              You'll get <strong>immediate access</strong> to all {plan.name} features.
              A prorated charge for the remaining days in your current billing period
              will appear on your next invoice.
            </>
          ) : (
            <>
              You'll keep <strong>{currentLabel}</strong> access until your billing
              period ends{renewsAt ? ` on ${renewsAt}` : ""}.{" "}
              After that, you'll move to {plan.name}.{" "}
              No refund for unused time on the current plan.
            </>
          )}
        </div>

        {/* What changes */}
        <div className="rounded-xl border border-[#E5E2D9] bg-white/60 p-4 mb-6 flex gap-3">
          <AlertCircle size={16} className="text-[#65635C] shrink-0 mt-0.5" />
          <p className="text-xs text-[#65635C] leading-relaxed">
            {isUpgrade
              ? "Proration is handled automatically by Stripe. You won't be double-charged."
              : "Your subscription will renew at the new rate when your current period ends."}
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 btn-ghost rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 transition disabled:opacity-60 ${
              isUpgrade
                ? "bg-[#556045] hover:bg-[#445035] text-white"
                : "bg-[#2D2C28] hover:bg-[#1A1A18] text-white"
            }`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {isUpgrade ? "Confirm upgrade" : "Confirm switch"}
            {!busy && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function BillingRulesCard({ isSubscribed, currentTier }) {
  const rules = [
    {
      scenario: "Upgrade mid-cycle",
      icon: ArrowUp,
      color: "bg-[#556045] text-white",
      dot: "bg-[#556045]",
      detail: "You're charged a prorated amount for the remaining days in your current billing period. New plan features are unlocked immediately.",
    },
    {
      scenario: "Downgrade mid-cycle",
      icon: ArrowDown,
      color: "bg-[#E6AE2E] text-[#2D2C28]",
      dot: "bg-[#E6AE2E]",
      detail: "Your current plan stays active until the end of the billing period. The new (lower) plan takes effect at renewal. No refund for unused time.",
    },
    {
      scenario: "Cancel anytime",
      icon: Check,
      color: "bg-[#65635C] text-white",
      dot: "bg-[#65635C]",
      detail: "You keep full access to your current plan until the billing period ends. No charge after cancellation. Your data stays safe.",
    },
    {
      scenario: "Switch to annual",
      icon: Zap,
      color: "bg-[#D26D53] text-white",
      dot: "bg-[#D26D53]",
      detail: "Switching from monthly to annual starts a new 12-month period. Switching from annual back to monthly takes effect when the current annual period expires.",
    },
  ];

  return (
    <div className="cream-card rounded-[28px] overflow-hidden">
      <div className="p-6 border-b border-[#E5E2D9]">
        <div className="eyebrow text-[#D26D53] mb-2">Billing rules</div>
        <h2 className="font-serif-display text-3xl">What happens when you change plans</h2>
        <p className="text-sm text-[#65635C] mt-2 max-w-xl">
          We use Stripe for all billing. Here's exactly what to expect mid-subscription.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
        {rules.map((r, i) => (
          <div key={r.scenario} className={`p-6 flex items-start gap-4 ${i < 2 ? "border-b border-[#E5E2D9]" : ""} ${i % 2 === 0 ? "md:border-r md:border-[#E5E2D9]" : ""}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${r.color}`}>
              <r.icon size={15} />
            </div>
            <div>
              <div className="font-semibold text-sm text-[#2D2C28]">{r.scenario}</div>
              <p className="text-xs text-[#65635C] mt-1.5 leading-relaxed">{r.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 py-4 bg-[#FAF9F6] border-t border-[#E5E2D9]">
        <p className="text-xs text-[#8A887F] leading-relaxed">
          No hidden fees. Prorations are calculated automatically. Upgrade, downgrade, and cancel directly on this page — no third-party portals.
          {isSubscribed && currentTier > 0 && (
            <> · Billing is secured and processed by Stripe.</>
          )}
        </p>
      </div>
    </div>
  );
}

function FeatureComparison() {
  return (
    <div className="cream-card rounded-[28px] overflow-hidden">
      <div className="p-6 border-b border-[#E5E2D9]">
        <div className="eyebrow text-[#D26D53] mb-2">Full comparison</div>
        <h2 className="font-serif-display text-3xl">Everything side by side</h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E5E2D9]">
              <th className="text-left px-6 py-4 text-[#65635C] font-medium w-[30%]">
                Feature
              </th>
              {["Free", "Vault", "Family", "Rescue"].map((h) => (
                <th key={h} className="px-4 py-4 text-center font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_COMPARISON.map((row, i) => (
              <tr
                key={row.label}
                className={`border-b border-[#E5E2D9] ${
                  i % 2 === 0 ? "bg-[#FAF9F6]" : "bg-white"
                }`}
              >
                <td className="px-6 py-3 text-[#2D2C28] font-medium">
                  {row.label}
                </td>
                {[row.free, row.vault, row.family, row.rescue].map((val, j) => (
                  <td key={j} className="px-4 py-3 text-center text-[#65635C]">
                    {val === "✓" ? (
                      <Check
                        size={16}
                        className="text-[#556045] mx-auto"
                      />
                    ) : val === "—" ? (
                      <span className="text-[#C9C6BD]">—</span>
                    ) : (
                      val
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cancel subscription confirmation modal ─────────────────────────────────────
function CancelPlanModal({ billing, busy, onConfirm, onClose }) {
  const planLabel = billing?.plan_label || "your current plan";
  const endsAt    = billing?.entitlement_expires_at
    ? new Date(billing.entitlement_expires_at).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2D2C28]/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-[28px] bg-[#FAF9F6] border border-[#E5E2D9] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-7 pb-5">
          <div className="eyebrow text-[#D26D53] mb-2">Cancel subscription</div>
          <h2 className="font-serif-display text-2xl leading-tight">
            Before you go…
          </h2>
        </div>

        {/* Body */}
        <div className="px-7 pb-6 space-y-4">
          {/* What happens */}
          <p className="text-sm text-[#2D2C28] leading-relaxed">
            {endsAt ? (
              <>
                Your <strong>{planLabel}</strong> access continues until{" "}
                <strong>{endsAt}</strong>. After that, your account moves to the
                free tier automatically — no extra steps needed.
              </>
            ) : (
              <>
                Your <strong>{planLabel}</strong> access continues until the end
                of your current billing period. After that, your account moves to
                the free tier automatically.
              </>
            )}
          </p>

          {/* Free tier reminder */}
          <div className="rounded-2xl bg-[#F2F0E9] border border-[#E5E2D9] p-4 text-sm text-[#65635C] leading-relaxed">
            On the free tier you'll keep: 1 pet profile, 1 bill analysis per
            month, basic health timeline, and care reminders. Your existing data
            is never deleted.
          </div>

          {/* Stripe reassurance */}
          <div className="rounded-2xl bg-[#FFF7F2] border border-[#F2C5B7]/50 p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-[#D26D53] shrink-0 mt-0.5" />
            <div className="text-xs text-[#65635C] leading-relaxed">
              <span className="font-semibold text-[#2D2C28]">Processed securely by Stripe.</span>{" "}
              Cancellation takes effect at the end of your billing period — you
              won't be charged again. Stripe will send a confirmation to your
              email. You can reactivate at any time before the end date.
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-7 pb-7 flex flex-col sm:flex-row gap-3">
          {/* Primary = Keep plan (safe default) */}
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl bg-[#2D2C28] text-[#FAF9F6] py-3 text-sm font-semibold
                       hover:bg-[#3F3E39] transition-colors disabled:opacity-50"
          >
            Keep my plan
          </button>

          {/* Destructive = Confirm cancel */}
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-xl border border-[#E5E2D9] bg-transparent text-[#65635C] py-3
                       text-sm font-semibold hover:border-[#D26D53] hover:text-[#D26D53]
                       transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="confirm-cancel-btn"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "Cancelling…" : "Yes, cancel subscription"}
          </button>
        </div>
      </div>
    </div>
  );
}
