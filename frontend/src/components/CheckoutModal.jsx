import { useState, useEffect, useCallback, useRef } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js/pure";
import { X, ShieldCheck, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import api from "../lib/api";
import { clearBillingCache } from "../lib/billing";

// ── Lazy Stripe initialisation ────────────────────────────────────────────────
let _stripePromise = null;
function getStripePromise() {
  if (!_stripePromise && process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY) {
    _stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);
  }
  return _stripePromise;
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function CheckoutModal({
  planId,
  planLabel,
  planPrice,
  isOpen,
  onClose,
  onSuccess,
  initialPromoCode = "",  // pre-fill from banner if available
}) {
  const [sessionId,    setSessionId]    = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [initError,    setInitError]    = useState("");
  const [resumeUrl,    setResumeUrl]    = useState("");
  const [loading,      setLoading]      = useState(false);
  const [completed,    setCompleted]    = useState(false);
  const [activating,   setActivating]   = useState(false);
  const [promoCode,    setPromoCode]    = useState(initialPromoCode);
  const [promoApplied, setPromoApplied] = useState(false); // confirmed by backend
  const stripePromise = useRef(null);

  // ── Guard against React Strict Mode double-effect ────────────────────────────
  const didFetchRef = useRef(false);

  // Initialise Stripe lazily on first open
  useEffect(() => {
    if (isOpen && !stripePromise.current) {
      stripePromise.current = getStripePromise();
    }
    if (!isOpen) {
      didFetchRef.current = false;
      setPromoCode(initialPromoCode);
      setPromoApplied(false);
    }
  }, [isOpen, initialPromoCode]);

  // Fetch exactly ONE checkout session per modal open
  // We defer until the user either submits without a code OR applies a code.
  const startCheckout = useCallback((coupon) => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;

    setClientSecret(null);
    setSessionId(null);
    setInitError("");
    setResumeUrl("");
    setCompleted(false);
    setActivating(false);
    setLoading(true);

    const body = { plan_id: planId, origin_url: window.location.origin };
    if (coupon) body.coupon_code = coupon.trim().toUpperCase();

    api
      .post("/billing/checkout", body)
      .then(({ data }) => {
        setClientSecret(data.client_secret);
        setSessionId(data.session_id);
        if (coupon) setPromoApplied(true);
      })
      .catch((e) => {
        didFetchRef.current = false; // allow retry on error
        const detail = e?.response?.data?.detail;
        const message = typeof detail === "string" ? detail : detail?.message;
        const nextResumeUrl = typeof detail === "object" ? detail?.resume_url : "";
        setResumeUrl(nextResumeUrl || "");
        setInitError(
          message ||
            "Could not initialise checkout. Please try again."
        );
      })
      .finally(() => setLoading(false));
  }, [planId]);

  // Auto-start checkout when modal opens (with pre-filled code if any)
  useEffect(() => {
    if (!isOpen || !planId) return;
    if (didFetchRef.current) return;
    startCheckout(initialPromoCode || "");
  }, [isOpen, planId, startCheckout, initialPromoCode]);

  // ── Called by EmbeddedCheckout when payment is confirmed ─────────────────────
  const handleComplete = useCallback(async () => {
    setCompleted(true);
    setActivating(true);

    try {
      // 1. Tell backend to activate the entitlement from this session
      if (sessionId) {
        await api.get(`/billing/status/${sessionId}`);
      }
    } catch (_) {
      // Non-fatal — self-heal in billing/me will catch it
    }

    // 2. Clear the stale billing cache so the next read hits the API fresh
    clearBillingCache();

    // 3. Poll billing/me until active === true (max 20 s)
    let attempts = 0;
    const poll = async () => {
      try {
        const { data } = await api.get("/billing/me");
        if (data?.active) {
          onSuccess(data);
          return;
        }
      } catch (_) {}

      attempts++;
      if (attempts < 10) {
        setTimeout(poll, 2000);
      } else {
        // Timed out — still call onSuccess so the modal closes.
        // The next page load will refresh billing state automatically.
        onSuccess();
      }
    };

    poll();
  }, [sessionId, onSuccess]);

  const options = useCallback(
    () => ({
      fetchClientSecret: async () => clientSecret,
      onComplete: handleComplete,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientSecret, handleComplete]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4
                 bg-[#2D2C28]/45 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !activating) onClose(); }}
    >
      <div
        className="w-full max-w-[500px] max-h-[94vh] rounded-[22px] bg-[#FAF9F6] border border-[#E5E2D9]
                   shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between p-4 sm:p-5 border-b border-[#E5E2D9] shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#D26D53] mb-0.5">
              Subscribe
            </div>
            <h2 className="font-serif-display text-xl sm:text-2xl leading-tight">{planLabel}</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-lg sm:text-xl font-bold text-[#2D2C28]">{planPrice}</p>
              {promoApplied && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F5EA] border border-[#C8E8D4] px-2 py-0.5 text-[10px] font-bold text-[#2F6B45] uppercase tracking-wider">
                  <CheckCircle2 size={10} /> Promo applied
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={activating}
            className="w-8 h-8 rounded-full bg-[#F2F0E9] inline-flex items-center
                       justify-center text-[#65635C] hover:bg-[#E5E2D9] transition-colors
                       disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="p-4 sm:p-5 min-h-[160px] flex-1 overflow-y-auto overscroll-contain">
          {loading && (
            <div className="py-10 flex justify-center">
              <Loader2 size={28} className="animate-spin text-[#D26D53]" />
            </div>
          )}

          {!loading && initError && (
            <div className="rounded-xl bg-[#FEF0EE] border border-[#F2C5B7] p-4 flex items-start gap-3">
              <AlertCircle size={16} className="text-[#D26D53] shrink-0 mt-0.5" />
              <div className="space-y-3">
                <p className="text-sm text-[#8C2D14]">{initError}</p>
                {resumeUrl && (
                  <a
                    href={resumeUrl}
                    className="inline-flex items-center rounded-lg bg-[#2D2C28] px-3 py-2 text-sm font-semibold text-[#FAF9F6] hover:bg-[#3F3E39] transition-colors"
                  >
                    Continue existing checkout
                  </a>
                )}
              </div>
            </div>
          )}

          {completed && (
            <div className="py-10 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="text-[#556045]" size={48} />
              <div>
                <p className="font-semibold text-[#2D2C28]">Payment confirmed!</p>
                <p className="mt-1 text-sm text-[#65635C]">Activating your plan…</p>
              </div>
              <Loader2 className="animate-spin text-[#D26D53]" size={20} />
            </div>
          )}

          {!loading && !initError && !completed && clientSecret && stripePromise.current && (
            <div className="checkout-embed-compact">
              <EmbeddedCheckoutProvider
                stripe={stripePromise.current}
                options={options()}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {!completed && (
          <div className="px-4 sm:px-5 py-3 border-t border-[#E5E2D9] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] sm:text-[11px] text-[#8A887F] shrink-0">
            <span className="flex items-center gap-1">
              <ShieldCheck size={12} /> No hidden fees
            </span>
            <span>·</span>
            <span>Cancel anytime</span>
            <span>·</span>
            <span>Your data stays private</span>
          </div>
        )}
      </div>
    </div>
  );
}
