/**
 * /dashboard/checkout?plan=vault_monthly
 *
 * Fallback full-page checkout — reached when:
 *   • User dismissed the pricing-page modal and wants to continue
 *   • 3DS redirect lands back here after bank authentication
 *   • Direct link / mobile deep-link
 *
 * Uses Stripe PaymentElement: the card fields are a small Stripe iframe,
 * everything else is the site's own UI. Nothing ever redirects to stripe.com.
 */
import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import {
  ShieldCheck, Bell, TrendingUp, FolderHeart,
  Infinity, Lock, Loader2, CheckCircle2, AlertCircle,
  ArrowLeft,
} from "lucide-react";
import api from "../lib/api";
import { useBilling } from "../lib/billing";

const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);

const STRIPE_APPEARANCE = {
  theme: "flat",
  variables: {
    colorPrimary:       "#D26D53",
    colorBackground:    "#FFFFFF",
    colorText:          "#2D2C28",
    colorTextSecondary: "#65635C",
    colorDanger:        "#C0392B",
    fontFamily:         "'Inter', 'ui-sans-serif', system-ui, sans-serif",
    borderRadius:       "12px",
    fontSizeBase:       "14px",
    spacingUnit:        "4px",
  },
  rules: {
    ".Input": {
      border:     "1px solid #E5E2D9",
      boxShadow:  "none",
      padding:    "10px 12px",
      background: "#FAF9F6",
    },
    ".Input:focus": {
      border:    "1px solid #D26D53",
      outline:   "none",
      boxShadow: "0 0 0 3px rgba(210,109,83,0.12)",
    },
    ".Label": {
      fontSize:      "11px",
      fontWeight:    "600",
      textTransform: "uppercase",
      letterSpacing: "0.10em",
      color:         "#65635C",
      marginBottom:  "6px",
    },
    ".Tab": {
      border:     "1px solid #E5E2D9",
      boxShadow:  "none",
      background: "#FAF9F6",
    },
    ".Tab--selected": {
      border:     "1px solid #D26D53",
      background: "#FFF7F2",
      color:      "#D26D53",
    },
  },
};

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

// ── Inner form (must be inside <Elements>) ────────────────────────────────────
function PaymentForm({ planId, planPrice, subscriptionId, paymentIntentId, onSuccess }) {
  const stripe   = useStripe();
  const elements = useElements();

  const [confirming, setConfirming] = useState(false);
  const [errorMsg,   setErrorMsg]   = useState("");
  const [succeeded,  setSucceeded]  = useState(false);
  const [pollMsg,    setPollMsg]    = useState("Activating your plan…");

  const pollUntilActive = useCallback(
    async (attempts = 0) => {
      if (attempts > 10) {
        setPollMsg("Taking a moment — you'll get a confirmation email shortly.");
        setTimeout(() => onSuccess(), 3000);
        return;
      }
      try {
        const { data } = await api.get("/billing/me");
        if (data?.active) { onSuccess(data); return; }
      } catch (_) { /* ignore transient */ }
      setTimeout(() => pollUntilActive(attempts + 1), 1500);
    },
    [onSuccess]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setConfirming(true);
    setErrorMsg("");

    const returnUrl = `${window.location.origin}/dashboard/pricing?payment_status=success&plan_id=${planId}`;

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (error) {
      setErrorMsg(error.message || "Payment failed. Please try again.");
      setConfirming(false);
      return;
    }

    const resolvedPaymentIntentId = paymentIntent?.id || paymentIntentId;

    if (paymentIntent?.status === "succeeded" && resolvedPaymentIntentId && subscriptionId) {
      setSucceeded(true);
      setPollMsg("Activating your plan…");
      try {
        const { data } = await api.post("/billing/confirm-payment", {
          payment_intent_id: resolvedPaymentIntentId,
          subscription_id: subscriptionId,
        });
        onSuccess(data);
        return;
      } catch {
        setPollMsg("Payment confirmed. Finalizing your plan…");
        pollUntilActive();
        return;
      }
    }

    if (paymentIntent?.status === "processing") {
      setSucceeded(true);
      setPollMsg("Payment is processing. We’ll activate your plan in just a moment.");
      pollUntilActive();
    } else {
      setErrorMsg("Unexpected status. Please contact support.");
      setConfirming(false);
    }
  };

  if (succeeded) {
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
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: "tabs" }} />

      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl bg-[#FEF0EE] border border-[#F2C5B7] p-3">
          <AlertCircle size={15} className="text-[#D26D53] shrink-0 mt-0.5" />
          <p className="text-sm text-[#8C2D14]">{errorMsg}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || confirming}
        className="w-full rounded-xl bg-[#2D2C28] text-[#FAF9F6] py-3.5 text-sm font-semibold
                   flex items-center justify-center gap-2 hover:bg-[#3F3E39] transition-colors
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {confirming && <Loader2 size={16} className="animate-spin" />}
        {confirming ? "Processing…" : `Subscribe — ${planPrice}`}
      </button>

      <p className="text-center text-xs text-[#8A887F] flex items-center justify-center gap-1.5">
        <Lock size={11} />
        Secured by Stripe · Cancel anytime
      </p>
    </form>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const [searchParams]      = useSearchParams();
  const navigate            = useNavigate();
  const { refresh }         = useBilling();
  const planId              = searchParams.get("plan") || "vault_monthly";
  const plan                = PLAN_DETAILS[planId] || PLAN_DETAILS.vault_monthly;
  const paymentStatus       = searchParams.get("payment_status");  // 3DS return

  const [clientSecret, setClientSecret] = useState(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [paymentIntentId, setPaymentIntentId] = useState("");
  const [loading,      setLoading]      = useState(true);
  const [initError,    setInitError]    = useState("");

  // Fetch client_secret on mount (or when planId changes)
  useEffect(() => {
    setClientSecret(null);
    setSubscriptionId("");
    setPaymentIntentId("");
    setInitError("");
    setLoading(true);

    api
      .post("/billing/subscribe", { plan_id: planId })
      .then(({ data }) => {
        if (data?.already_active) {
          refresh();
          navigate("/dashboard/pricing?payment_status=success", { replace: true });
          return;
        }
        setClientSecret(data.client_secret);
        setSubscriptionId(data.subscription_id || "");
        setPaymentIntentId(data.payment_intent_id || "");
      })
      .catch((e) =>
        setInitError(
          e?.response?.data?.detail ||
          "Could not initialise checkout. Please try again."
        )
      )
      .finally(() => setLoading(false));
  }, [planId, navigate, refresh]);

  function handleSuccess() {
    refresh();
    navigate("/dashboard/pricing?payment_status=success");
  }

  // ── 3DS return: payment_status=success landed back from bank auth ──────────
  if (paymentStatus === "success") {
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

  const elementsOptions = clientSecret
    ? { clientSecret, appearance: STRIPE_APPEARANCE }
    : null;

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
                <span className="font-serif-display text-5xl text-[#D26D53]">
                  {plan.price.split("/")[0]}
                </span>
                <span className="text-sm text-[#65635C]">
                  /{plan.price.split("/")[1]}
                </span>
              </div>

              {loading && (
                <div className="py-16 flex justify-center">
                  <Loader2 size={28} className="animate-spin text-[#D26D53]" />
                </div>
              )}

              {!loading && initError && (
                <div className="rounded-xl bg-[#FEF0EE] border border-[#F2C5B7] p-4 text-sm text-[#8C2D14]">
                  {initError}
                </div>
              )}

              {!loading && clientSecret && elementsOptions && (
                <Elements stripe={stripePromise} options={elementsOptions}>
                  <PaymentForm
                    planId={planId}
                    planPrice={plan.price}
                    subscriptionId={subscriptionId}
                    paymentIntentId={paymentIntentId}
                    onSuccess={handleSuccess}
                  />
                </Elements>
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
