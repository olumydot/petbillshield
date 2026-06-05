/**
 * /dashboard/checkout?plan=vault_monthly
 *
 * Fallback full-page checkout — reached when:
 *   • User dismissed the pricing-page modal and wants to continue
 *   • 3DS redirect lands back here after bank authentication
 *   • Direct link / mobile deep-link
 *
 * Uses Stripe Embedded Checkout (ui_mode="embedded", redirect_on_completion=
 * "never") — the same integration as the pricing-page modal. Handles cards,
 * ACH/bank, and Link inline; onComplete fires when payment is confirmed.
 * Nothing ever redirects to stripe.com.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck, Bell, TrendingUp, FolderHeart,
  Infinity, Lock, Loader2, CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import api from "../lib/api";
import { clearBillingCache, useBilling } from "../lib/billing";

let _stripePromise = null;
function getStripePromise() {
  if (!_stripePromise && process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY) {
    _stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);
  }
  return _stripePromise;
}

const PLAN_DETAILS = {
  vault_monthly: {
    name: "Pet Cost Vault",
    price: "$8.99/mo",
    description: "Unlimited analysis, claim tools, pet records, and reminders.",
    features: [
      ["Unlimited estimate reviews", "AI-powered insights on any estimate.", Infinity],
      ["Pet vault: records, meds, reminders", "Everything in one organised place.", FolderHeart],
      ["Health timeline + cost forecasting", "Track history and predict future costs.", TrendingUp],
      ["Insurance claim helper + appeals", "Guidance to submit and follow up.", ShieldCheck],
      ["Email reminders", "Never miss important care.", Bell],
    ],
  },
  vault_yearly: {
    name: "Pet Cost Vault",
    price: "$89.90/yr",
    description: "All Vault features — save 2 months with annual billing.",
    features: [
      ["Unlimited estimate reviews", "AI-powered insights on any estimate.", Infinity],
      ["Pet vault: records, meds, reminders", "Everything in one organised place.", FolderHeart],
      ["Health timeline + cost forecasting", "Track history and predict future costs.", TrendingUp],
      ["Insurance claim helper + appeals", "Guidance to submit and follow up.", ShieldCheck],
      ["Email reminders", "Never miss important care.", Bell],
    ],
  },
  family_monthly: {
    name: "Family / Multi-pet",
    price: "$19.99/mo",
    description: "For households with multiple pets and shared care records.",
    features: [
      ["Up to 5 pets", "Keep each pet organised.", FolderHeart],
      ["Unlimited estimate reviews", "Review every bill without limits.", Infinity],
      ["Care reminders across all pets", "Stay ahead of refills and visits.", Bell],
    ],
  },
  family_yearly: {
    name: "Family / Multi-pet",
    price: "$199.90/yr",
    description: "Multi-pet plan — save 2 months with annual billing.",
    features: [
      ["Up to 5 pets", "Keep each pet organised.", FolderHeart],
      ["Unlimited estimate reviews", "Review every bill without limits.", Infinity],
      ["Care reminders across all pets", "Stay ahead of refills and visits.", Bell],
    ],
  },
  rescue_monthly: {
    name: "Rescue / Foster",
    price: "$49.99/mo",
    description: "For rescue and foster households managing many animals.",
    features: [
      ["Unlimited pets", "Track every animal in one place.", Infinity],
      ["Donation-ready expense reports", "Clean cost records for donors.", FolderHeart],
      ["Vaccine logs across animals", "Stay organised across the group.", ShieldCheck],
    ],
  },
  rescue_yearly: {
    name: "Rescue / Foster",
    price: "$499.90/yr",
    description: "Rescue / Foster plan — save 2 months with annual billing.",
    features: [
      ["Unlimited pets", "Track every animal in one place.", Infinity],
      ["Donation-ready expense reports", "Clean cost records for donors.", FolderHeart],
      ["Vaccine logs across animals", "Stay organised across the group.", ShieldCheck],
    ],
  },
};

function moneyFromLabel(label = "") {
  const value = Number(String(label).replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

// Compute the discounted first-payment label from a BACKEND-VALIDATED promo.
// `info` comes from POST /billing/validate-promo — never inferred client-side,
// and NO defaults: if the validated data is missing, we show no discount.
function discountedMoneyLabel(label, info, planId = "") {
  const amount  = moneyFromLabel(label);
  const percent = Number(info?.required_percent_off);
  const months  = Number(info?.required_duration_months);
  if (!amount || !Number.isFinite(percent) || percent <= 0) return "";
  const discountMonths = planId.endsWith("_yearly")
    ? (Number.isFinite(months) && months > 0 ? months : 12)
    : 12;
  const discount = amount * (percent / 100) * (discountMonths / 12);
  return `$${Math.max(0, amount - discount).toFixed(2)}`;
}

// ── Embedded checkout completion handler ─────────────────────────────────────
// Stripe's <EmbeddedCheckout> (ui_mode="embedded", redirect_on_completion="never")
// fires onComplete when payment is confirmed — including async methods like ACH.
// We then activate the entitlement and poll billing/me until it goes active.
function EmbeddedPayment({ clientSecret, sessionId, stripePromise, onSuccess }) {
  const [completed, setCompleted] = useState(false);
  const [pollMsg,   setPollMsg]   = useState("Activating your plan…");

  const handleComplete = useCallback(async () => {
    setCompleted(true);

    try {
      if (sessionId) await api.get(`/billing/status/${sessionId}`);
    } catch (_) { /* webhook + self-heal will catch it */ }

    clearBillingCache();

    let attempts = 0;
    const poll = async () => {
      try {
        const { data } = await api.get("/billing/me");
        if (data?.active) { onSuccess(data); return; }
      } catch (_) {}
      attempts += 1;
      if (attempts < 12) {
        setTimeout(poll, 1800);
      } else {
        setPollMsg("Payment received — you'll get a confirmation email shortly.");
        setTimeout(() => onSuccess(), 2500);
      }
    };
    poll();
  }, [sessionId, onSuccess]);

  const options = useCallback(
    () => ({ fetchClientSecret: async () => clientSecret, onComplete: handleComplete }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientSecret, handleComplete]
  );

  if (completed) {
    return (
      <div className="py-12 flex flex-col items-center gap-4 text-center">
        <CheckCircle2 className="text-[#556045]" size={56} />
        <div>
          <p className="font-serif-display text-2xl">Payment confirmed!</p>
          <p className="mt-2 text-sm text-[#65635C]">{pollMsg}</p>
        </div>
        <Loader2 className="animate-spin text-[#D26D53]" size={20} />
      </div>
    );
  }

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={options()}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const [searchParams]      = useSearchParams();
  const navigate            = useNavigate();
  const { refresh }         = useBilling();
  const planId              = searchParams.get("plan") || "vault_monthly";
  const plan                = PLAN_DETAILS[planId] || PLAN_DETAILS.vault_monthly;
  const paymentStatus       = searchParams.get("payment_status");
  const checkoutStatus      = searchParams.get("checkout");
  const returnedSessionId   = searchParams.get("session_id") || "";
  const promoCode           = searchParams.get("promo") || "";
  const isReturningFromBank = paymentStatus === "success" || checkoutStatus === "success";

  const [clientSecret, setClientSecret] = useState(null);
  const [sessionId, setSessionId] = useState("");
  const [loading,      setLoading]      = useState(true);
  const [initError,    setInitError]    = useState("");
  const [resumeUrl,    setResumeUrl]    = useState("");
  const [promoInput,   setPromoInput]   = useState(promoCode.toUpperCase());
  // Promo validation — single source of truth is POST /billing/validate-promo.
  // status: "idle" | "checking" | "valid" | "invalid"
  const [promoStatus, setPromoStatus] = useState(promoCode ? "checking" : "idle");
  const [promoInfo,   setPromoInfo]   = useState(null);   // validated terms from backend
  const [promoError,  setPromoError]  = useState("");
  const promoValid = promoStatus === "valid" && Boolean(promoInfo);
  const stripePromiseRef = useRef(null);
  if (!stripePromiseRef.current) stripePromiseRef.current = getStripePromise();

  useEffect(() => {
    setPromoInput(promoCode.toUpperCase());
  }, [promoCode]);

  const handleSuccess = useCallback(() => {
    clearBillingCache();
    refresh();
    navigate("/dashboard/pricing?payment_status=success", { replace: true });
  }, [navigate, refresh]);

  // Handle bank redirect / return_url landings first.
  useEffect(() => {
    if (!isReturningFromBank || !returnedSessionId) return undefined;

    let cancelled = false;
    setClientSecret(null);
    setSessionId("");
    setInitError("");
    setResumeUrl("");
    setLoading(true);

    const finalize = async (attempt = 0) => {
      try {
        await api.get(`/billing/status/${returnedSessionId}`);
        clearBillingCache();
        const { data } = await api.get("/billing/me");
        if (cancelled) return;
        if (data?.active) {
          handleSuccess();
          return;
        }
      } catch (_) {
        // Keep retrying below.
      }

      if (attempt >= 10) {
        if (!cancelled) {
          setInitError("Payment was confirmed, but plan activation is taking longer than expected. Please refresh pricing in a moment.");
          setLoading(false);
        }
        return;
      }

      window.setTimeout(() => finalize(attempt + 1), 1500);
    };

    finalize();
    return () => { cancelled = true; };
  }, [handleSuccess, isReturningFromBank, returnedSessionId]);

  // ── Validate the promo code authoritatively BEFORE applying it ──────────────
  useEffect(() => {
    if (!promoCode) {
      setPromoStatus("idle");
      setPromoInfo(null);
      setPromoError("");
      return undefined;
    }

    let cancelled = false;
    setPromoStatus("checking");
    setPromoInfo(null);
    setPromoError("");

    api
      .post("/billing/validate-promo", { code: promoCode, plan_id: planId })
      .then(({ data }) => {
        if (cancelled) return;
        setPromoInfo(data);
        setPromoStatus("valid");
      })
      .catch((e) => {
        if (cancelled) return;
        const detail = e?.response?.data?.detail;
        setPromoError(typeof detail === "string" ? detail : "That promo code is not valid for this plan.");
        setPromoStatus("invalid");
        setPromoInfo(null);
      });

    return () => { cancelled = true; };
  }, [promoCode, planId]);

  // ── Create the checkout session — only attach the coupon once it's valid ────
  useEffect(() => {
    if (isReturningFromBank) return undefined;
    // Wait for promo validation to resolve before creating the session, so we
    // never send an unvalidated coupon (and never create two sessions).
    if (promoCode && promoStatus === "checking") return undefined;

    let cancelled = false;
    setClientSecret(null);
    setSessionId("");
    setInitError("");
    setResumeUrl("");
    setLoading(true);

    const includeCoupon = promoCode && promoStatus === "valid";

    api
      .post("/billing/checkout", {
        plan_id: planId,
        origin_url: window.location.origin,
        ...(includeCoupon ? { coupon_code: promoCode } : {}),
      })
      .then(({ data }) => {
        if (cancelled) return;
        setClientSecret(data.client_secret);
        setSessionId(data.session_id || "");
      })
      .catch((e) => {
        if (cancelled) return;
        const detail = e?.response?.data?.detail;
        const message = typeof detail === "string" ? detail : detail?.message;
        setResumeUrl(typeof detail === "object" ? detail?.resume_url || "" : "");
        setInitError(message || "Could not initialise checkout. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isReturningFromBank, planId, promoCode, promoStatus]);

  // Discount preview is shown ONLY for a backend-validated promo.
  const promoPreview = promoValid && planId.endsWith("_yearly")
    ? discountedMoneyLabel(plan.price, promoInfo, planId)
    : "";

  function applyPromoFromCheckout() {
    const code = promoInput.trim().toUpperCase();
    const params = new URLSearchParams(searchParams);
    params.delete("checkout");
    params.delete("payment_status");
    params.delete("session_id");
    if (code) {
      params.set("promo", code);
    } else {
      params.delete("promo");
    }
    navigate(`/dashboard/checkout?${params.toString()}`, { replace: true });
  }

  function removePromoFromCheckout() {
    const params = new URLSearchParams(searchParams);
    params.delete("promo");
    params.delete("checkout");
    params.delete("payment_status");
    params.delete("session_id");
    setPromoInput("");
    navigate(`/dashboard/checkout?${params.toString()}`, { replace: true });
  }

  if (isReturningFromBank && loading) {
    return (
      <div className="fixed inset-0 bg-[#FAF9F6] flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-sm">
          <CheckCircle2 className="text-[#556045] mx-auto" size={64} />
          <h1 className="font-serif-display text-3xl">Payment confirmed!</h1>
          <p className="text-sm text-[#65635C]">
            Your plan is being activated — this takes just a moment.
          </p>
          <Loader2 className="animate-spin text-[#D26D53] mx-auto" size={24} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-5xl">
        <div className="w-full overflow-hidden rounded-[28px] border border-[#E5E2D9] bg-[#FAF9F6] shadow-2xl shadow-black/20">
          <div className="grid grid-cols-1 lg:grid-cols-2">

            {/* ── Left: plan info ─────────────────────────────────── */}
            <section className="p-6 sm:p-8 lg:p-10 border-b lg:border-b-0 lg:border-r border-[#E5E2D9]">
              <Link
                to="/dashboard/pricing"
                className="inline-flex items-center gap-1.5 text-xs text-[#65635C] hover:text-[#2D2C28] transition-colors mb-8"
              >
                <ArrowLeft size={13} /> Back to plans
              </Link>

              <div className="mb-8">
                <span className="inline-flex rounded-full bg-[#D26D53] px-3 py-1 text-xs font-semibold text-white">
                  Subscribe to
                </span>
                <h1 className="font-serif-display text-4xl mt-4">{plan.name}</h1>
                <p className="text-sm text-[#65635C] mt-3 max-w-md leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <div className="space-y-4">
                {plan.features.map(([title, text, Icon]) => (
                  <div key={title} className="flex gap-4 border-t border-[#E5E2D9] pt-4">
                    <span className="w-11 h-11 rounded-full bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center shrink-0">
                      <Icon size={18} />
                    </span>
                    <div>
                      <h3 className="font-semibold text-[#2D2C28]">{title}</h3>
                      <p className="text-sm text-[#65635C] mt-0.5">{text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 rounded-xl border border-[#E5E2D9] bg-white/60 p-4 flex gap-3">
                <ShieldCheck className="text-[#D26D53] shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-semibold text-sm">Cancel anytime. No hidden fees.</p>
                  <p className="text-xs text-[#65635C] mt-0.5">
                    Manage or cancel your subscription from your account settings.
                  </p>
                </div>
              </div>
            </section>

            {/* ── Right: payment form ──────────────────────────────── */}
            <section className="p-6 sm:p-8 lg:p-10 bg-white/45">
              <div className="flex items-baseline gap-2 mb-6">
                {promoPreview ? (
                  <>
                    <span className="font-serif-display text-5xl text-[#D26D53]">
                      {promoPreview}
                    </span>
                    <span className="text-sm text-[#65635C]">first year</span>
                    <span className="text-sm text-[#8A887F] line-through">
                      {plan.price}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-serif-display text-5xl text-[#D26D53]">
                      {plan.price.split("/")[0]}
                    </span>
                    <span className="text-sm text-[#65635C]">
                      /{plan.price.split("/")[1]}
                    </span>
                  </>
                )}
              </div>

              {/* Checking */}
              {promoCode && promoStatus === "checking" && (
                <div className="mb-5 rounded-xl border border-[#D9D4C8] bg-[#FAF9F6] p-3 text-sm text-[#65635C] flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[#D26D53]" />
                  Checking promo code {promoCode.toUpperCase()}…
                </div>
              )}

              {/* Valid — only a backend-validated code reaches here */}
              {promoValid && (
                <div className="mb-5 rounded-xl border border-[#2F6B45]/40 bg-[#11271A] p-3 text-sm text-[#BFE7CB]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-[#FAF9F6] inline-flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-[#7FD89B]" />
                      Promo code {promoCode.toUpperCase()} applied
                    </p>
                    <button
                      type="button"
                      onClick={removePromoFromCheckout}
                      className="text-[11px] font-bold uppercase tracking-wider text-[#BFE7CB] hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                  {(promoInfo?.discount_display || promoPreview) && (
                    <p className="mt-1 text-xs leading-relaxed">
                      {promoInfo?.discount_display || ""}
                      {promoPreview ? ` Estimated first payment: ${promoPreview}.` : ""}
                    </p>
                  )}
                </div>
              )}

              {/* Invalid — code rejected by the server; checkout continues at full price */}
              {promoCode && promoStatus === "invalid" && (
                <div className="mb-5 rounded-xl border border-[#D26D53]/40 bg-[#3A1B12] p-3 text-sm text-[#F7D2C7]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-[#FAF9F6]">
                      {promoError || "That promo code is not valid."}
                    </p>
                    <button
                      type="button"
                      onClick={removePromoFromCheckout}
                      className="text-[11px] font-bold uppercase tracking-wider text-[#F7D2C7] hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed">
                    You can still subscribe at the regular price below.
                  </p>
                </div>
              )}

              <div className="mb-5 rounded-xl border border-[#D9D4C8] bg-[#FAF9F6] p-3">
                <label htmlFor="checkout-promo-code" className="text-[10px] uppercase tracking-[0.2em] text-[#8A887F] font-bold">
                  Have a promo code?
                </label>
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <input
                    id="checkout-promo-code"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyPromoFromCheckout();
                    }}
                    placeholder="Enter code"
                    className="min-h-[42px] flex-1 rounded-lg border border-[#D9D4C8] bg-white px-3 text-sm font-semibold text-[#2D2C28] placeholder:text-[#8A887F] outline-none focus:border-[#D26D53]"
                  />
                  <button
                    type="button"
                    onClick={applyPromoFromCheckout}
                    className="min-h-[42px] rounded-lg bg-[#2D2C28] px-4 text-sm font-bold text-[#FAF9F6] hover:bg-[#3F3E39] transition"
                  >
                    Apply
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#65635C]">
                  Codes are verified before payment. If a promo has ended or does not match this plan, we will show you here.
                </p>
              </div>

              {loading && (
                <div className="py-16 flex justify-center">
                  <Loader2 size={28} className="animate-spin text-[#D26D53]" />
                </div>
              )}

              {!loading && initError && (
                <div className="rounded-xl bg-[#FEF0EE] border border-[#F2C5B7] p-4 text-sm text-[#8C2D14] space-y-3">
                  <p>{initError}</p>
                  {promoCode && (
                    <button
                      type="button"
                      onClick={removePromoFromCheckout}
                      className="inline-flex items-center rounded-lg border border-[#D26D53]/35 px-3 py-2 text-sm font-semibold text-[#8C2D14] hover:bg-white/50 transition-colors"
                    >
                      Remove promo code
                    </button>
                  )}
                  {resumeUrl && (
                    <a
                      href={resumeUrl}
                      className="inline-flex items-center rounded-lg bg-[#2D2C28] px-3 py-2 text-sm font-semibold text-[#FAF9F6] hover:bg-[#3F3E39] transition-colors"
                    >
                      Continue existing checkout
                    </a>
                  )}
                </div>
              )}

              {!loading && clientSecret && stripePromiseRef.current && (
                <EmbeddedPayment
                  clientSecret={clientSecret}
                  sessionId={sessionId}
                  stripePromise={stripePromiseRef.current}
                  onSuccess={handleSuccess}
                />
              )}

              <div className="mt-6 flex items-center gap-2 text-xs text-[#65635C]">
                <Lock size={13} />
                Secure checkout — powered by Stripe
              </div>
            </section>
          </div>

          <footer className="border-t border-[#E5E2D9] px-6 sm:px-8 py-4 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 text-xs text-[#65635C] text-center sm:text-left">
            <span>Secure &amp; encrypted</span>
            <span>Cancel anytime</span>
            <span>Your data stays private</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
