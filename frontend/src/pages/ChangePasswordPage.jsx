import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, KeyRound, Eye, EyeOff, Check, Loader2,
  ShieldCheck, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

// ── Password visibility input ─────────────────────────────────────────────────
function PwdInput({ id, value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full border border-[#E5E2D9] bg-[#FAF9F6] rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 focus:border-[#D26D53]/60 transition-all placeholder:text-[#B5B0A8] pr-12"
        required
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8A887F] hover:text-[#2D2C28] transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ── Strength helpers ──────────────────────────────────────────────────────────
function getStrength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)            s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["", "#D26D53", "#E6AE2E", "#556045", "#2F6B45"];

const REQUIREMENTS = [
  { label: "At least 8 characters",  test: (pw) => pw.length >= 8 },
  { label: "One uppercase letter",   test: (pw) => /[A-Z]/.test(pw) },
  { label: "One number",             test: (pw) => /[0-9]/.test(pw) },
  { label: "One special character",  test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

// ── Strength meter ────────────────────────────────────────────────────────────
function StrengthMeter({ password }) {
  const score = getStrength(password);
  const color = STRENGTH_COLORS[score];
  if (!password) return null;
  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="h-1.5 flex-1 rounded-full transition-all duration-300"
              style={{ background: n <= score ? color : "#E5E2D9" }}
            />
          ))}
        </div>
        <span className="text-xs font-semibold transition-colors w-12 text-right" style={{ color: color || "#8A887F" }}>
          {STRENGTH_LABELS[score]}
        </span>
      </div>
      <ul className="space-y-1.5">
        {REQUIREMENTS.map(({ label, test }) => {
          const met = test(password);
          return (
            <li key={label} className="flex items-center gap-2 text-xs transition-colors" style={{ color: met ? "#2F6B45" : "#8A887F" }}>
              <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all ${met ? "bg-[#E8F5EC]" : "bg-[#EDEBE5]"}`}>
                {met && <Check size={9} />}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Page
// ═══════════════════════════════════════════════════════════════════════════════
export default function ChangePasswordPage() {
  const navigate = useNavigate();

  const [current,  setCurrent]  = useState("");
  const [next,     setNext]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);

  const strength        = getStrength(next);
  const passwordsMatch  = next && confirm && next === confirm;
  const confirmMismatch = confirm && next !== confirm;
  const canSubmit       = current && next && confirm && passwordsMatch && strength >= 3;

  const submit = async (e) => {
    e.preventDefault();
    if (!passwordsMatch) { setError("Passwords don't match."); return; }
    setLoading(true);
    setError("");
    try {
      await api.post("/user/change-password", {
        current_password: current,
        new_password: next,
      });
      setSuccess(true);
      toast.success("Password changed successfully.");
    } catch (err) {
      setError(err?.response?.data?.detail || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Back link */}
      <div>
        <Link
          to="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-sm text-[#65635C] hover:text-[#2D2C28] transition-colors"
        >
          <ArrowLeft size={14} /> Back to account settings
        </Link>
      </div>

      {/* Heading */}
      <div>
        <div className="eyebrow mb-2 text-[#D26D53]">Security</div>
        <h1 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight text-[#2D2C28]">
          Change password
        </h1>
        <p className="text-sm text-[#65635C] mt-2">
          Update the password you use to sign in to PetBill Shield.
        </p>
      </div>

      <div className="max-w-md">
        <div className="rounded-[28px] bg-white border border-[#E5E2D9] shadow-sm overflow-hidden">
          {/* Card header */}
          <div className="px-6 py-5 border-b border-[#F2F0E9] flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0"
              style={{ background: "#245EA818", color: "#245EA8" }}>
              <KeyRound size={16} />
            </span>
            <div>
              <p className="font-semibold text-sm text-[#2D2C28]">New password</p>
              <p className="text-xs text-[#8A887F] mt-0.5">Choose a strong, unique password</p>
            </div>
          </div>

          <div className="px-6 py-6">
            {success ? (
              /* ── Success state ─────────────────────────────────── */
              <div className="text-center space-y-5 py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-[#E8F5EC] border-2 border-[#C8E8D4] flex items-center justify-center">
                  <Check size={26} className="text-[#2F6B45]" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[#2D2C28]">Password updated</p>
                  <p className="text-sm text-[#65635C] leading-relaxed">
                    Your new password is active. Use it the next time you sign in.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/settings")}
                  className="w-full bg-[#2D2C28] hover:bg-[#1A1A17] text-white rounded-2xl py-3 font-semibold text-sm transition-colors"
                >
                  Back to account settings
                </button>
              </div>
            ) : (
              /* ── Form ─────────────────────────────────────────── */
              <form onSubmit={submit} className="space-y-5">

                {/* Current password */}
                <div className="space-y-1.5">
                  <label htmlFor="cp-current" className="text-xs font-semibold text-[#65635C] uppercase tracking-wider">
                    Current password
                  </label>
                  <PwdInput
                    id="cp-current"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="Your current password"
                    autoComplete="current-password"
                  />
                </div>

                <div className="h-px bg-[#F2F0E9]" />

                {/* New password */}
                <div className="space-y-1.5">
                  <label htmlFor="cp-new" className="text-xs font-semibold text-[#65635C] uppercase tracking-wider">
                    New password
                  </label>
                  <PwdInput
                    id="cp-new"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <StrengthMeter password={next} />
                </div>

                {/* Confirm */}
                <div className="space-y-1.5">
                  <label htmlFor="cp-confirm" className="text-xs font-semibold text-[#65635C] uppercase tracking-wider">
                    Confirm new password
                  </label>
                  <PwdInput
                    id="cp-confirm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                  />
                  {confirmMismatch && (
                    <p className="text-xs text-[#D26D53] flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={11} /> Passwords don't match
                    </p>
                  )}
                  {passwordsMatch && (
                    <p className="text-xs text-[#2F6B45] flex items-center gap-1 mt-0.5">
                      <Check size={11} /> Passwords match
                    </p>
                  )}
                </div>

                {error && (
                  <div className="text-sm text-[#8C2D14] bg-[#FFF4EE] border border-[#F2C5B7] rounded-2xl p-3.5">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !canSubmit}
                  className="w-full bg-[#D26D53] hover:bg-[#C05E45] text-white rounded-2xl py-3.5 font-semibold text-sm disabled:opacity-50 transition-all inline-flex items-center justify-center gap-2 shadow-lg shadow-[#D26D53]/20"
                >
                  {loading
                    ? <><Loader2 size={15} className="animate-spin" /> Updating…</>
                    : <><ShieldCheck size={15} /> Update password</>
                  }
                </button>

                <p className="text-xs text-[#8A887F] text-center leading-relaxed">
                  For your security, make sure your new password isn't one you use elsewhere.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
