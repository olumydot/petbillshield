import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api from "../lib/api";
import { CheckCircle2, Loader2, AlertTriangle, X } from "lucide-react";

const POLL_INTERVAL = 2500;
const MAX_ATTEMPTS  = 6;

/**
 * Handles two return-from-payment scenarios:
 *
 * 1. Legacy Stripe Checkout Session  (?session_id=...)
 *    Polls /billing/status/{session_id} until paid/expired.
 *
 * 2. PaymentElement 3DS redirect  (?payment_status=success&plan_id=...)
 *    Polls /billing/me until active — covers the case where a bank-auth
 *    redirect brought the user back before the webhook fired.
 *
 * Renders a dismissable top banner during the poll.
 */
export default function PaymentStatusWatcher({ onPaid }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status,    setStatus]    = useState(null); // 'pending'|'paid'|'expired'|'error'|null
  const [planLabel, setPlanLabel] = useState("");

  const sessionId     = searchParams.get("session_id");
  const paymentStatus = searchParams.get("payment_status"); // "success" after 3DS return

  // ── Path 1: legacy session_id poll ────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    let attempts = 0;
    let cancelled = false;
    setStatus("pending");

    const poll = async () => {
      try {
        const { data } = await api.get(`/billing/status/${sessionId}`);
        if (cancelled) return;
        const ps = data?.payment_status;
        setPlanLabel(data?.plan_id || "");
        if (ps === "paid") {
          setStatus("paid");
          if (data?.granted_now) toast.success("Plan activated");
          onPaid?.(data);
          const next = new URLSearchParams(searchParams);
          next.delete("session_id");
          next.delete("plan");
          setSearchParams(next, { replace: true });
        } else if (data?.status === "expired") {
          setStatus("expired");
        } else if (attempts++ < MAX_ATTEMPTS) {
          setTimeout(poll, POLL_INTERVAL);
        } else {
          setStatus("pending");
        }
      } catch {
        setStatus("error");
      }
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Path 2: PaymentElement 3DS return (?payment_status=success) ───────────
  useEffect(() => {
    if (paymentStatus !== "success") return;
    let attempts = 0;
    let cancelled = false;
    setStatus("pending");

    const poll = async () => {
      try {
        const { data } = await api.get("/billing/me");
        if (cancelled) return;
        if (data?.active) {
          setStatus("paid");
          toast.success("Plan activated");
          onPaid?.(data);
          const next = new URLSearchParams(searchParams);
          next.delete("payment_status");
          next.delete("plan_id");
          setSearchParams(next, { replace: true });
        } else if (attempts++ < MAX_ATTEMPTS) {
          setTimeout(poll, POLL_INTERVAL);
        } else {
          setStatus("pending");
        }
      } catch {
        setStatus("error");
      }
    };
    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentStatus]);

  if (!sessionId || !status) return null;

  const dismiss = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("session_id");
    next.delete("plan");
    setSearchParams(next, { replace: true });
    setStatus(null);
  };

  return (
    <div className="cream-card p-4 mb-4 flex items-start gap-3" data-testid="payment-status-banner">
      <span className="shrink-0 mt-0.5">
        {status === "paid" && <CheckCircle2 className="text-[#556045]" size={18} />}
        {status === "pending" && <Loader2 className="animate-spin text-[#65635C]" size={18} />}
        {(status === "expired" || status === "error") && <AlertTriangle className="text-[#8C2D14]" size={18} />}
      </span>
      <div className="flex-1 text-sm">
        {status === "paid" && <span><span className="font-semibold">Payment received.</span> Your plan is active. Thank you for supporting PetBill Shield.</span>}
        {status === "pending" && <span>Confirming your payment with Stripe…</span>}
        {status === "expired" && <span>Your checkout expired. <a href="/dashboard/pricing" className="editorial-link">Pick a plan again →</a></span>}
        {status === "error" && <span>We couldn't confirm the payment status. Please check your email for a receipt or try again.</span>}
      </div>
      <button onClick={dismiss} className="text-[#65635C] hover:text-[#2D2C28]" aria-label="Dismiss" data-testid="payment-banner-dismiss"><X size={16}/></button>
    </div>
  );
}
