import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  User as UserIcon, Mail, Lock, Bell, Trash2, Check, Loader2,
  AlertTriangle, ShieldCheck, LogOut, ExternalLink, ChevronRight,
  Eye, EyeOff, Chrome, Pencil, X, CreditCard, Tag, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useBilling } from "../lib/billing";
import api from "@/lib/api";
import PromoBanner from "../components/PromoBanner";
import ConfirmModal from "../components/ConfirmModal";
// Import from /pure so Stripe.js is NOT side-loaded on module import.
// It only loads when loadStripe() is explicitly called (i.e. when the
// user clicks "Update card"). This stops the dev banner appearing on
// every page just because ProfileSettings is in the route tree.
import { loadStripe } from "@stripe/stripe-js/pure";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

// Lazy-load Stripe only when the update-card modal opens
let _stripePromise = null;
function getStripePromise() {
  if (!_stripePromise && process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY) {
    _stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY);
  }
  return _stripePromise;
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#556045] ${
        checked ? "bg-[#556045]" : "bg-[#D9D6CD]"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Password input ─────────────────────────────────────────────────────────────
function PasswordInput({ value, onChange, placeholder = "Password", name, autoComplete = "current-password" }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        name={name}
        autoComplete={autoComplete}
        className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm pr-9 focus:outline-none focus:ring-2 focus:ring-[#D26D53]/30 focus:border-[#D26D53]"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8A887F] hover:text-[#2D2C28]"
        tabIndex={-1}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ icon: Icon, title, subtitle, children, accent = "#D26D53" }) {
  return (
    <div className="rounded-[24px] border border-[#E5E2D9] bg-white overflow-hidden">
      <div className="px-6 py-5 border-b border-[#F2F0E9] flex items-center gap-3">
        <span
          className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon size={16} />
        </span>
        <div>
          <h2 className="font-semibold text-sm text-[#2D2C28]">{title}</h2>
          {subtitle && <p className="text-xs text-[#8A887F] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────
function FieldRow({ label, value, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-3 border-b border-[#F2F0E9] last:border-0">
      <span className="text-xs text-[#8A887F] font-medium sm:w-36 sm:pt-2.5 shrink-0">{label}</span>
      <div className="flex-1">{children || <span className="text-sm text-[#2D2C28]">{value}</span>}</div>
    </div>
  );
}

// ── Pref row ──────────────────────────────────────────────────────────────────
function PrefRow({ label, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 border-b border-[#F2F0E9] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#2D2C28]">{label}</div>
        <div className="text-xs text-[#8A887F] mt-0.5 leading-relaxed">{description}</div>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main component
// ═══════════════════════════════════════════════════════════════════════════════
export default function ProfileSettings() {
  const { t } = useTranslation();
  const { user, logout, refresh: refreshAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  // Email-verify state (driven by ?verify_email= URL param)
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { ok, message }

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await api.get("/user/settings");
      setSettings(data);
    } catch {
      toast.error("Couldn't load account settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Auto-scroll to billing section when ?tab=billing is in the URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "billing") {
      // Give the page a beat to render before scrolling
      setTimeout(() => {
        const el = document.getElementById("billing");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [location.search]);

  // Handle verify_email token in URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token  = params.get("verify_email");
    if (!token || verifying || verifyResult) return;

    setVerifying(true);
    api.get(`/user/verify-email?token=${token}`)
      .then(({ data }) => {
        setVerifyResult({ ok: true, message: data.message });
        toast.success("Email verified! Please sign in again.");
        // Strip token from URL
        navigate("/dashboard/settings", { replace: true });
        // Force logout — session is now invalidated server-side
        setTimeout(() => logout(), 2000);
      })
      .catch((e) => {
        const msg = e?.response?.data?.detail || "Verification failed. The link may have expired.";
        setVerifyResult({ ok: false, message: msg });
        navigate("/dashboard/settings", { replace: true });
      })
      .finally(() => setVerifying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const isExternal = settings ? !settings.has_password : false;

  if (loading) {
    return (
      <div className="space-y-4 pb-10">
        <div className="h-8 bg-[#F2F0E9] rounded-xl w-48 animate-pulse" />
        <div className="h-4 bg-[#F2F0E9] rounded-xl w-80 animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-[#F2F0E9] rounded-[24px] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" data-testid="profile-settings">

      {/* Verify email banner */}
      {verifying && (
        <div className="rounded-[20px] bg-[#EDF5FF] border border-[#C5D8F5] p-4 flex items-center gap-3">
          <Loader2 size={16} className="animate-spin text-[#245EA8]" />
          <span className="text-sm text-[#245EA8] font-medium">Verifying your new email address…</span>
        </div>
      )}
      {verifyResult && (
        <div className={`rounded-[20px] border p-4 flex items-start gap-3 ${
          verifyResult.ok
            ? "bg-[#E8F5EC] border-[#C8E8D4] text-[#2F6B45]"
            : "bg-[#FFF4EE] border-[#F2C5B7] text-[#8C2D14]"
        }`}>
          {verifyResult.ok
            ? <Check size={16} className="shrink-0 mt-0.5" />
            : <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          }
          <span className="text-sm font-medium">{verifyResult.message}</span>
        </div>
      )}

      {/* Page heading */}
      <div>
        <div className="eyebrow mb-2 text-[#D26D53]">Your account</div>
        <h1 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight text-[#2D2C28]">
          Profile & settings
        </h1>
        <p className="text-sm text-[#65635C] mt-2">
          Manage your profile, email, notifications, and account security.
        </p>
      </div>

      {/* Auth provider badge */}
      {isExternal && (
        <div className="flex items-center gap-2 text-xs text-[#65635C] bg-[#F2F0E9] border border-[#E5E2D9] rounded-2xl px-4 py-2.5 w-fit">
          <Chrome size={13} />
          Signed in via {settings?.auth_provider === "google" ? "Google" : "external provider"} —
          some settings are managed by your sign-in provider.
        </div>
      )}

      {/* ── Profile ── */}
      <ProfileSection settings={settings} onUpdate={loadSettings} refreshAuth={refreshAuth} />

      {/* ── Billing & subscription ── */}
      <BillingSection />

      {/* ── Sign-in & security ── */}
      <SecuritySection settings={settings} onUpdate={loadSettings} isExternal={isExternal} />

      {/* ── Notifications ── */}
      <NotificationsSection settings={settings} onUpdate={loadSettings} />

      {/* ── Account control ── */}
      <AccountSection settings={settings} isExternal={isExternal} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Billing & subscription section
// ═══════════════════════════════════════════════════════════════════════════════
function UpdateCardForm({ onSuccess, onCancel }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setErr("");
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (error) { setErr(error.message || "Card update failed."); setBusy(false); return; }
    if (setupIntent?.status === "succeeded") {
      try {
        await api.post("/billing/update-payment-method", { setup_intent_id: setupIntent.id });
        toast.success("Payment method updated successfully.");
        onSuccess();
      } catch (e) {
        setErr(e?.response?.data?.detail || "Could not save the new card.");
        setBusy(false);
      }
    } else {
      setErr("Setup incomplete — please try again."); setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {err && <p className="text-sm text-[#8C2D14] bg-[#FEF0EE] border border-[#F2C5B7] rounded-xl p-3">{err}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="flex-1 btn-ghost rounded-xl py-2.5 text-sm font-semibold">Cancel</button>
        <button type="submit" disabled={!stripe || busy} className="flex-1 rounded-xl bg-[#2D2C28] text-white py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 hover:bg-[#3F3E39] transition-colors">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "Saving…" : "Save new card"}
        </button>
      </div>
    </form>
  );
}

function BillingSection() {
  const { billing, refresh, cancelPlan, reactivatePlan } = useBilling();
  const [methods,     setMethods]     = useState([]);
  const [showUpdate,  setShowUpdate]  = useState(false);
  const [clientSecret,setClientSecret]= useState(null);
  const [loadingSetup,setLoadingSetup]= useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const [reactivating,setReactivating]= useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const stripeRef = useRef(null);

  // Load saved payment methods
  useEffect(() => {
    api.get("/billing/payment-methods")
      .then(({ data }) => setMethods(data?.methods || []))
      .catch(() => {});
  }, []);

  async function openUpdateCard() {
    setLoadingSetup(true);
    try {
      if (!stripeRef.current) stripeRef.current = getStripePromise();
      const { data } = await api.post("/billing/setup-intent");
      setClientSecret(data.client_secret);
      setShowUpdate(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not initialise card update.");
    } finally { setLoadingSetup(false); }
  }

  async function handleCancelPlan() {
    setCancelling(true);
    try {
      const res = await cancelPlan();
      const endsAt = res.ends_at ? new Date(res.ends_at).toLocaleDateString() : "renewal date";
      setShowCancelConfirm(false);
      toast.success(`Subscription cancelled. Access continues until ${endsAt}.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not cancel."); }
    finally { setCancelling(false); }
  }

  async function handleReactivate() {
    setReactivating(true);
    try {
      const res = await reactivatePlan();
      toast.success(`${res.plan_label} reactivated — you're all set.`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not reactivate."); }
    finally { setReactivating(false); }
  }

  const isActive    = billing?.active;
  const planLabel   = billing?.plan_label || "Free";
  const renewsAt    = billing?.entitlement_expires_at
    ? new Date(billing.entitlement_expires_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;
  const isCancelling = billing?.cancel_at_period_end;
  const primaryCard  = methods[0];

  return (
    <div id="billing" className="cream-card rounded-[28px] overflow-hidden">
      <PromoBanner page="billing" />
      {/* Header */}
      <div className="p-6 border-b border-[#E5E2D9] flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center shrink-0">
          <CreditCard size={18} />
        </div>
        <div>
          <div className="eyebrow text-[#D26D53]">Billing &amp; subscription</div>
          <h2 className="font-serif-display text-2xl leading-tight">Manage your plan &amp; payment</h2>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Current plan */}
        <div className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 flex items-start gap-4">
          <div className="w-9 h-9 rounded-xl bg-[#2D2C28] flex items-center justify-center shrink-0">
            <Sparkles size={15} className="text-[#E6AE2E]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[#2D2C28]">{planLabel}</div>
            {renewsAt && (
              <p className="text-xs text-[#65635C] mt-0.5">
                {isCancelling ? "Access ends" : "Renews"} {renewsAt}
              </p>
            )}
            {!isActive && <p className="text-xs text-[#65635C] mt-0.5">Free tier — no active subscription.</p>}
          </div>
          <Link to="/dashboard/pricing" className="text-xs font-semibold text-[#D26D53] hover:underline shrink-0">
            Change plan
          </Link>
        </div>

        {/* Payment method */}
        {isActive && (
          <div className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-[#F2F0E9] flex items-center justify-center shrink-0">
              <CreditCard size={15} className="text-[#65635C]" />
            </div>
            <div className="flex-1 min-w-0">
              {primaryCard ? (
                <>
                  <div className="font-semibold text-sm text-[#2D2C28] capitalize">
                    {primaryCard.brand} ···· {primaryCard.last4}
                  </div>
                  <div className="text-xs text-[#8A887F] mt-0.5">
                    Expires {primaryCard.exp_month}/{primaryCard.exp_year}
                  </div>
                </>
              ) : (
                <div className="text-sm text-[#65635C]">No card on file</div>
              )}
            </div>
            <button
              onClick={openUpdateCard}
              disabled={loadingSetup}
              className="text-xs font-semibold text-[#D26D53] hover:underline shrink-0 inline-flex items-center gap-1 disabled:opacity-50"
            >
              {loadingSetup ? <Loader2 size={12} className="animate-spin" /> : null}
              Update card
            </button>
          </div>
        )}

        {/* Update card form (Stripe Elements) */}
        {showUpdate && clientSecret && stripeRef.current && (
          <div className="rounded-2xl border border-[#E5E2D9] bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm text-[#2D2C28]">New payment method</div>
              <button onClick={() => { setShowUpdate(false); setClientSecret(null); }}
                className="text-[#8A887F] hover:text-[#2D2C28]"><X size={16} /></button>
            </div>
            <Elements stripe={stripeRef.current} options={{ clientSecret, appearance: { theme: "flat", variables: { colorPrimary: "#D26D53" } } }}>
              <UpdateCardForm
                onSuccess={() => {
                  setShowUpdate(false); setClientSecret(null);
                  api.get("/billing/payment-methods").then(({ data }) => setMethods(data?.methods || []));
                }}
                onCancel={() => { setShowUpdate(false); setClientSecret(null); }}
              />
            </Elements>
          </div>
        )}

        {/* Cancel / reactivate */}
        {isActive && (
          <div className="border-t border-[#E5E2D9] pt-4 flex items-center justify-between">
            <p className="text-xs text-[#8A887F] leading-relaxed max-w-sm">
              {isCancelling
                ? "Your subscription is set to cancel. Reactivate to keep access."
                : "Cancel anytime. Your data is never deleted."}
            </p>
            {isCancelling ? (
              <button onClick={handleReactivate} disabled={reactivating}
                className="text-xs font-semibold text-[#556045] hover:underline disabled:opacity-50 shrink-0">
                {reactivating ? "Reactivating…" : "Reactivate subscription"}
              </button>
            ) : (
              <button onClick={() => setShowCancelConfirm(true)} disabled={cancelling}
                className="text-xs text-[#8A887F] hover:text-[#D26D53] underline underline-offset-2 transition-colors disabled:opacity-50 shrink-0">
                {cancelling ? "Cancelling…" : "Cancel subscription"}
              </button>
            )}
          </div>
        )}
      </div>
      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel subscription?"
        description="You will keep premium access until the end of your current billing period. Your pet records and saved analyses stay in your account."
        confirmLabel={cancelling ? "Cancelling..." : "Cancel subscription"}
        tone="danger"
        busy={cancelling}
        onCancel={() => setShowCancelConfirm(false)}
        onConfirm={handleCancelPlan}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Profile section
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSection({ settings, onUpdate, refreshAuth }) {
  const [editing, setEditing]   = useState(false);
  const [name,    setName]      = useState(settings?.name || "");
  const [saving,  setSaving]    = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.patch("/user/settings", { name: name.trim() });
      await onUpdate();
      await refreshAuth();
      setEditing(false);
      toast.success("Name updated.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section icon={UserIcon} title="Profile" subtitle="Your display name and avatar" accent="#556045">
      <FieldRow label="Display name">
        {editing ? (
          <div className="flex items-center gap-2 max-w-sm">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-xl border border-[#D26D53] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/30"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            />
            <button
              onClick={save}
              disabled={saving || !name.trim()}
              className="rounded-xl bg-[#2D2C28] text-white px-4 py-2 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setName(settings?.name || ""); }}
              className="text-[#8A887F] hover:text-[#2D2C28] p-1.5"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#2D2C28]">{settings?.name || "—"}</span>
            <button
              onClick={() => { setName(settings?.name || ""); setEditing(true); }}
              className="text-xs text-[#D26D53] font-semibold hover:opacity-80 inline-flex items-center gap-1"
            >
              <Pencil size={11} /> Edit
            </button>
          </div>
        )}
      </FieldRow>

      <FieldRow label="Email"   value={settings?.email} />
      <FieldRow label="Member since">
        <span className="text-sm text-[#65635C]">
          {settings?.created_at
            ? new Date(settings.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
            : "—"}
        </span>
      </FieldRow>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Security section
// ═══════════════════════════════════════════════════════════════════════════════
function SecuritySection({ settings, onUpdate, isExternal }) {
  // Email change form
  const [showEmailForm,  setShowEmailForm]  = useState(false);
  const [newEmail,       setNewEmail]       = useState("");
  const [emailPassword,  setEmailPassword]  = useState("");
  const [emailSending,   setEmailSending]   = useState(false);
  const [emailSent,      setEmailSent]      = useState(false);

  // Cancel pending email change
  const [cancelling, setCancelling] = useState(false);

  const requestEmailChange = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setEmailSending(true);
    try {
      const { data } = await api.post("/user/change-email", {
        new_email: newEmail.trim(),
        password: emailPassword || undefined,
      });
      setEmailSent(true);
      setShowEmailForm(false);
      setNewEmail("");
      setEmailPassword("");
      toast.success(data.message);
      onUpdate();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't send verification email.");
    } finally {
      setEmailSending(false);
    }
  };

  const cancelPendingChange = async () => {
    setCancelling(true);
    try {
      // Invalidate pending tokens via a new (empty) change request that immediately replaces them
      // Simpler: just call change-email with current email — but that would fail validation.
      // Instead, we expose a cancel endpoint pattern via a no-op PATCH:
      await api.patch("/user/settings", {}); // no-op to confirm session is alive
      // Invalidate via DELETE tokens — we'll add a lightweight endpoint for this
      await api.delete("/user/change-email");
      toast.success("Pending email change cancelled.");
      onUpdate();
    } catch {
      toast.error("Couldn't cancel. Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Section
      icon={Lock}
      title="Sign-in & security"
      subtitle={isExternal ? "Managed by your sign-in provider" : "Email address and password"}
      accent="#245EA8"
    >
      {/* Current email */}
      <FieldRow label="Email address">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-[#2D2C28] font-medium">{settings?.email}</span>
            {isExternal ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-[#F2F0E9] text-[#65635C] rounded-full px-2.5 py-0.5 border border-[#E5E2D9]">
                <ShieldCheck size={10} /> Managed by provider
              </span>
            ) : (
              !showEmailForm && !emailSent && (
                <button
                  onClick={() => setShowEmailForm(true)}
                  className="text-xs text-[#D26D53] font-semibold hover:opacity-80 inline-flex items-center gap-1"
                >
                  <Pencil size={11} /> Change email
                </button>
              )
            )}
          </div>

          {/* Pending email change notice */}
          {settings?.pending_email && (
            <div className="flex flex-wrap items-center gap-2 text-xs rounded-xl bg-[#FFF4EE] border border-[#F2C5B7] px-3 py-2">
              <Mail size={12} className="text-[#D26D53] shrink-0" />
              <span className="text-[#8C2D14]">
                Verification pending for <strong>{settings.pending_email}</strong>
              </span>
              <span className="text-[#8A887F]">· Check that inbox and click the link.</span>
              <button
                onClick={cancelPendingChange}
                disabled={cancelling}
                className="text-[#8A887F] hover:text-[#D26D53] font-semibold ml-auto inline-flex items-center gap-1"
              >
                {cancelling ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                Cancel
              </button>
            </div>
          )}

          {/* Email change form */}
          {showEmailForm && !isExternal && (
            <form onSubmit={requestEmailChange} className="mt-3 space-y-3 max-w-sm">
              <div>
                <label className="eyebrow block mb-1">New email address</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@example.com"
                  className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/30 focus:border-[#D26D53]"
                />
              </div>
              {settings?.has_password && (
                <div>
                  <label className="eyebrow block mb-1">Confirm with current password</label>
                  <PasswordInput
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Current password"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={emailSending || !newEmail.trim()}
                  className="rounded-xl bg-[#2D2C28] text-white px-4 py-2 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {emailSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                  Send verification
                </button>
                <button
                  type="button"
                  onClick={() => { setShowEmailForm(false); setNewEmail(""); setEmailPassword(""); }}
                  className="text-xs text-[#65635C] hover:text-[#2D2C28] font-medium"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-[#8A887F] leading-relaxed">
                A verification link will be sent to your new email. You must click it to confirm the change.
                Your current email stays active until you verify.
              </p>
            </form>
          )}
        </div>
      </FieldRow>

      {/* Password — only for email-auth users */}
      {!isExternal && settings?.has_password && (
        <FieldRow label="Password">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[#65635C]">••••••••••••</span>
            <Link
              to="/dashboard/change-password"
              className="text-xs text-[#D26D53] font-semibold hover:opacity-80 inline-flex items-center gap-1"
            >
              <ChevronRight size={11} /> Change password
            </Link>
          </div>
        </FieldRow>
      )}

      {/* Google sign-in note */}
      {isExternal && settings?.auth_provider === "google" && (
        <div className="mt-1 flex items-start gap-3 text-sm text-[#65635C] bg-[#F8F5EE] rounded-2xl p-4">
          <Chrome size={16} className="shrink-0 mt-0.5 text-[#4285F4]" />
          <p className="leading-relaxed text-xs">
            Your account is linked to Google. To change your email or password, visit your
            <a href="https://myaccount.google.com" target="_blank" rel="noreferrer"
               className="text-[#4285F4] font-semibold mx-1 hover:underline">
              Google account settings
            </a>
            and sign back in. Your PetBill Shield profile will update automatically.
          </p>
        </div>
      )}
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Notifications section
// ═══════════════════════════════════════════════════════════════════════════════
const PREF_ITEMS = [
  {
    key:   "reminder_emails",
    label: "Care reminder emails",
    desc:  "Get an email when a pet vaccination, medication refill, or appointment reminder is due. Recommended.",
  },
  {
    key:   "newsletter",
    label: "Monthly newsletter",
    desc:  "A once-a-month roundup of product updates and pet care guides from the PetBill Shield team.",
  },
  {
    key:   "tips_guides",
    label: "Weekly tips & guides",
    desc:  "Short, practical tips on understanding vet bills, managing pet care costs, and working with insurers.",
  },
  {
    key:   "offers",
    label: "Special offers & announcements",
    desc:  "Occasional emails about new features, promotions, and partner discounts.",
  },
];

function NotificationsSection({ settings, onUpdate }) {
  const [saving, setSaving] = useState(null); // key being saved

  const toggle = async (key, value) => {
    setSaving(key);
    try {
      await api.patch("/user/prefs", { [key]: value });
      await onUpdate();
    } catch {
      toast.error("Couldn't save preference.");
    } finally {
      setSaving(null);
    }
  };

  const prefs = settings?.prefs || {};

  return (
    <Section
      icon={Bell}
      title="Communication preferences"
      subtitle="Choose which emails you receive from PetBill Shield"
      accent="#E6AE2E"
    >
      {PREF_ITEMS.map(({ key, label, desc }) => (
        <PrefRow
          key={key}
          label={label}
          description={desc}
          checked={!!prefs[key]}
          onChange={(v) => toggle(key, v)}
          disabled={saving === key}
        />
      ))}
      <p className="text-[11px] text-[#8A887F] mt-4 leading-relaxed">
        We never sell your email address. Transactional emails (password resets, email verification) are
        always sent regardless of these settings. You can unsubscribe from any email at any time.
      </p>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Account control section
// ═══════════════════════════════════════════════════════════════════════════════
function AccountSection({ settings, isExternal }) {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  const [showDelete, setShowDelete] = useState(false);
  const [confirm,    setConfirm]    = useState("");
  const [password,   setPassword]   = useState("");
  const [deleting,   setDeleting]   = useState(false);

  const canDelete = confirm === "DELETE" && (isExternal || !settings?.has_password || password.trim());

  const deleteAccount = async (e) => {
    e.preventDefault();
    setDeleting(true);
    try {
      await api.delete("/user/account", {
        data: {
          confirm: confirm,
          password: password || undefined,
        },
      });
      toast.success("Account deleted. We're sorry to see you go.");
      await logout();
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't delete account. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Section
      icon={Trash2}
      title="Account"
      subtitle="Export data or permanently close your account"
      accent="#D26D53"
    >
      <FieldRow label="Export data">
        <div>
          <p className="text-xs text-[#65635C] mb-2">
            Download a copy of your pet records, estimates, and account data.
          </p>
          <button
            className="text-xs text-[#65635C] border border-[#E5E2D9] rounded-xl px-3 py-2 hover:border-[#2D2C28]/30 hover:text-[#2D2C28] transition inline-flex items-center gap-1.5"
            onClick={() => toast.info("Data export coming soon — we'll email a download link.")}
          >
            <ExternalLink size={11} /> Request data export
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Delete account">
        {!showDelete ? (
          <div>
            <p className="text-xs text-[#65635C] mb-3 leading-relaxed">
              Permanently deletes your account, all pets, estimates, records, and billing data.
              <strong className="text-[#8C2D14]"> This cannot be undone.</strong>
            </p>
            <button
              onClick={() => setShowDelete(true)}
              className="text-xs font-semibold text-[#8C2D14] border border-[#F2C5B7] rounded-xl px-3 py-2 hover:bg-[#FFF4EE] transition inline-flex items-center gap-1.5"
            >
              <Trash2 size={11} /> Delete my account
            </button>
          </div>
        ) : (
          <form onSubmit={deleteAccount} className="space-y-4 max-w-sm">
            <div className="rounded-2xl bg-[#FFF4EE] border border-[#F2C5B7] p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertTriangle size={14} className="text-[#D26D53] shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-[#8C2D14] leading-relaxed">
                  This will permanently delete all your pets, records, estimates, and subscription data.
                  You will lose access immediately.
                </p>
              </div>
            </div>

            <div>
              <label className="eyebrow block mb-1.5">
                Type <strong>DELETE</strong> to confirm
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/30 focus:border-[#D26D53] font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {!isExternal && settings?.has_password && (
              <div>
                <label className="eyebrow block mb-1.5">Confirm with your password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!canDelete || deleting}
                className="rounded-xl bg-[#8C2D14] hover:bg-[#7A2512] text-white px-4 py-2.5 text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1.5 transition"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Delete account permanently
              </button>
              <button
                type="button"
                onClick={() => { setShowDelete(false); setConfirm(""); setPassword(""); }}
                className="text-xs text-[#65635C] hover:text-[#2D2C28] font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </FieldRow>
    </Section>
  );
}
