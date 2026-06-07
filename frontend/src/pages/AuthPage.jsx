import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Loader2, Eye, EyeOff, Check, ExternalLink, Mail, KeyRound } from "lucide-react";
import { PetVaultWordmark, PetVaultIcon } from "../components/PetVaultLogo";
import { useTranslation } from "react-i18next";
import api, { BACKEND_ORIGIN } from "../lib/api";

// ── Google colour SVG inline ──────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
      <path d="M47.5 24.6c0-1.6-.1-3.1-.4-4.6H24v8.7h13.2c-.6 3-2.3 5.5-4.9 7.2v6h7.9c4.6-4.2 7.3-10.5 7.3-17.3z" fill="#4285F4"/>
      <path d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.9-6C29.9 38 27.1 39 24 39c-6.3 0-11.6-4.2-13.5-9.9H2.3v6.2C6.3 42.8 14.6 48 24 48z" fill="#34A853"/>
      <path d="M10.5 29.1A14.9 14.9 0 0 1 9 24c0-1.8.3-3.5.5-5.1V12.7H2.3A23.8 23.8 0 0 0 0 24c0 3.9.9 7.6 2.3 11l8.2-5.9z" fill="#FBBC05"/>
      <path d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.9 2.3 30.5 0 24 0 14.6 0 6.3 5.2 2.3 13l8.2 6.2C12.4 13.7 17.7 9.5 24 9.5z" fill="#EA4335"/>
    </svg>
  );
}

export default function AuthPage() {
  const [searchParams]   = useSearchParams();
  const resetToken       = searchParams.get("reset_token");
  const timedOut         = searchParams.get("reason") === "timeout";

  const [mode,             setMode]             = useState(resetToken ? "reset" : "login");
  const [firstName,        setFirstName]        = useState("");
  const [lastName,         setLastName]         = useState("");
  const [email,            setEmail]            = useState("");
  const [password,         setPassword]         = useState("");
  const [showPassword,     setShowPassword]     = useState(false);
  const [resetEmailSent,   setResetEmailSent]   = useState(false);
  const [signupSuggestion, setSignupSuggestion] = useState(false);
  const [loading,          setLoading]          = useState(false);
  const [googleHovered,    setGoogleHovered]    = useState(false);
  const [error,            setError]            = useState("");
  const [notice,           setNotice]           = useState("");
  const { t } = useTranslation();

  function getNextPath() {
    const params = new URLSearchParams(window.location.search);
    const next   = params.get("next") || sessionStorage.getItem("petbill_auth_next") || localStorage.getItem("petbill_auth_next");
    const allowed = [
      "/dashboard", "/dashboard/analyze", "/dashboard/compare",
      "/dashboard/pets", "/dashboard/timeline", "/dashboard/reminders",
      "/dashboard/claims", "/dashboard/scripts", "/dashboard/pricing",
    ];
    return next && allowed.includes(next) ? next : "/dashboard";
  }

  const clearMessages = () => {
    setError(""); setNotice(""); setSignupSuggestion(false); setResetEmailSent(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true); setError(""); setNotice("");

      if (mode === "forgot") {
        const { data } = await api.post("/auth/forgot-password", { email });
        if (data?.account_exists === false) { setSignupSuggestion(true); setError("No account found with this email."); return; }
        setResetEmailSent(true); setNotice("Password reset email sent. Check your inbox.");
        return;
      }

      if (mode === "reset") {
        await api.post("/auth/reset-password", { token: resetToken, password });
        setPassword(""); setMode("login"); setNotice("Password reset successful. Please sign in.");
        return;
      }

      const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
      const payload  = mode === "login"
        ? { email, password }
        : { first_name: firstName, last_name: lastName, email, password };

      const { data } = await api.post(endpoint, payload);
      localStorage.setItem("petbill_session_token", data.session_token);
      const nextPath = getNextPath();
      sessionStorage.removeItem("petbill_auth_next");
      localStorage.removeItem("petbill_auth_next");
      window.location.assign(nextPath);
    } catch (err) {
      setError(err?.response?.data?.detail || t("common.something_went_wrong"));
    } finally {
      setLoading(false);
    }
  };

  const googleLogin = () => {
    const nextPath = getNextPath();
    sessionStorage.setItem("petbill_auth_next", nextPath);
    localStorage.setItem("petbill_auth_next", nextPath);
    window.location.href = `${BACKEND_ORIGIN}/api/auth/google/login`;
  };

  const inputCls = "w-full border border-[#E5E2D9] bg-white rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 focus:border-[#D26D53]/60 transition-all placeholder:text-[#B5B0A8]";

  const titles = {
    signup: t("auth.create_account"),
    forgot: t("auth.reset_password"),
    reset:  t("auth.new_password"),
    login:  t("auth.welcome_back"),
  };
  const subtitles = {
    signup: t("auth.start_protecting"),
    forgot: t("auth.forgot_desc"),
    reset:  t("auth.reset_desc"),
    login:  t("auth.login_desc"),
  };

  return (
    <div className="min-h-screen paper-grain bg-[#FAF9F6]">
      {/* Top bar */}
      <div className="px-5 sm:px-8 pt-6 max-w-6xl mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#65635C] hover:text-[#2D2C28] transition-colors">
          <ArrowLeft size={15} /> {t("auth.return_home")}
        </Link>
      </div>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center min-h-[88vh]">
        {/* Left panel — branding */}
        <div className="hidden lg:flex flex-col gap-8">
          <div>
            <div className="mb-5">
              <PetVaultWordmark iconSize={34} textSize="text-[1.55rem]" />
            </div>
            <h1 className="font-serif-display text-5xl lg:text-[3.5rem] leading-[0.93] tracking-tight text-[#2D2C28]">
              {t("landing.hero_title_a")} {t("landing.hero_title_b")}<br />
              <span className="italic text-[#D26D53]">{t("landing.hero_title_c")}</span>
            </h1>
            <p className="mt-6 text-[#65635C] leading-relaxed max-w-md">
              {t("auth.login_desc")}
            </p>
          </div>

          {/* Feature mini-list */}
          <div className="space-y-3">
            {[
              { icon: ShieldCheck, labelKey: "auth.ai_bill_analysis" },
              { icon: Check,       labelKey: "auth.pet_vault_feature" },
              { icon: Check,       labelKey: "auth.insurance_feature" },
            ].map(({ icon: Icon, labelKey }) => (
              <div key={labelKey} className="flex items-center gap-3 text-sm text-[#65635C]">
                <div className="w-7 h-7 rounded-xl bg-[#E8F5EC] flex items-center justify-center shrink-0">
                  <Icon size={13} className="text-[#556045]" />
                </div>
                {t(labelKey)}
              </div>
            ))}
          </div>

          {/* Trust card */}
          <div className="rounded-[24px] bg-white border border-[#E5E2D9] p-6 max-w-md">
            <div className="flex gap-4">
              <div className="w-11 h-11 rounded-2xl bg-[#2D2C28] text-white flex items-center justify-center shrink-0">
                <ShieldCheck size={19} />
              </div>
              <div>
                <div className="font-semibold text-[#2D2C28]">{t("auth.safe_by_design")}</div>
                <p className="text-sm text-[#65635C] mt-1 leading-relaxed">
                  {t("auth.safe_desc")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — form */}
        <div className="w-full max-w-[420px] mx-auto lg:mx-0 lg:ml-auto">
          <div className="rounded-[28px] bg-white border border-[#E5E2D9] shadow-xl shadow-black/5 p-8">
            {/* Icon + title */}
            <div className="text-center mb-7">
              <div className="mx-auto w-14 h-14 rounded-[18px] bg-[#2D2C28] flex items-center justify-center mb-4 shadow-lg">
                {mode === "forgot" ? <Mail size={28} className="text-white" />
                  : mode === "reset" ? <KeyRound size={28} className="text-white" />
                  : <PetVaultIcon size={32} />}
              </div>
              <h2 className="font-serif-display text-3xl text-[#2D2C28]">{titles[mode]}</h2>
              <p className="text-sm text-[#8A887F] mt-1.5">{subtitles[mode]}</p>
            </div>

            {/* Inactivity timeout notice */}
            {timedOut && mode === "login" && (
              <div className="mb-6 rounded-2xl bg-[#FFF8EE] border border-[#F5D993] px-4 py-3 text-sm text-[#8A5A24] text-center">
                You were signed out after 30 minutes of inactivity. Please sign in again to continue.
              </div>
            )}

            {/* Mode tabs */}
            {!resetToken && mode !== "forgot" && mode !== "reset" && (
              <>
                <div className="flex gap-1 mb-6 bg-[#F2F0E9] p-1 rounded-2xl">
                  {["login", "signup"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { clearMessages(); setMode(m); }}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                        mode === m
                          ? "bg-[#2D2C28] text-white shadow-sm"
                          : "text-[#65635C] hover:text-[#2D2C28]"
                      }`}
                    >
                      {m === "login" ? t("auth.sign_in") : t("auth.sign_up")}
                    </button>
                  ))}
                </div>

                {/* Google button */}
                <div className="relative mb-1">
                  <button
                    type="button"
                    onClick={googleLogin}
                    onMouseEnter={() => setGoogleHovered(true)}
                    onMouseLeave={() => setGoogleHovered(false)}
                    className="w-full border border-[#E5E2D9] bg-white hover:bg-[#FAF9F6] hover:border-[#D5D0C8] rounded-2xl py-3.5 flex items-center justify-center gap-3 transition-all duration-150 shadow-sm"
                  >
                    <GoogleIcon />
                    <span className="font-semibold text-sm text-[#2D2C28]">{t("common.sign_in_google")}</span>
                    <ExternalLink size={13} className="text-[#8A887F]" />
                  </button>
                  {/* Context tooltip */}
                  {googleHovered && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-10 bg-[#2D2C28] text-white text-xs rounded-xl px-3.5 py-2.5 whitespace-nowrap shadow-lg pointer-events-none">
                      <div className="flex items-center gap-1.5">
                        <ExternalLink size={11} />
                        {t("auth.google_redirect")}
                      </div>
                      {/* Arrow */}
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#2D2C28] rotate-45 rounded-sm" />
                    </div>
                  )}
                </div>
                <p className="text-center text-[10px] text-[#A7A29A] mt-1.5 mb-5">
                  {t("auth.google_note")}
                </p>

                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px bg-[#E5E2D9]" />
                  <span className="text-xs text-[#A7A29A] tracking-widest font-medium">{t("common.or").toUpperCase()}</span>
                  <div className="flex-1 h-px bg-[#E5E2D9]" />
                </div>
              </>
            )}

            {/* Forgot-sent success state */}
            {mode === "forgot" && resetEmailSent ? (
              <div className="text-center space-y-5 py-2">
                <div className="mx-auto w-16 h-16 rounded-full bg-[#E8F5EC] border-2 border-[#C8E8D4] flex items-center justify-center">
                  <Check size={26} className="text-[#2F6B45]" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[#2D2C28]">{t("auth.check_inbox")}</p>
                  <p className="text-sm text-[#65635C]">
                    {t("auth.reset_sent_to")}{" "}
                    <span className="font-medium text-[#2D2C28]">{email}</span>.
                  </p>
                  <p className="text-xs text-[#8A887F] leading-relaxed mt-1">
                    {t("auth.link_expires")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { clearMessages(); setEmail(""); }}
                  className="text-sm text-[#D26D53] font-semibold hover:opacity-80 transition-opacity"
                >
                  {t("auth.try_different_email")}
                </button>
                <div className="border-t border-[#F2F0E9] pt-4">
                  <button
                    type="button"
                    onClick={() => { clearMessages(); setMode("login"); }}
                    className="w-full text-sm text-[#8A887F] hover:text-[#D26D53] font-medium transition-colors"
                  >
                    {t("auth.back_to_sign_in")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Form */}
                <form onSubmit={submit} className="space-y-3.5">
                  {mode === "signup" && (
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder={t("auth.first_name")}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className={inputCls}
                        required
                      />
                      <input
                        type="text"
                        placeholder={t("auth.last_name")}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className={inputCls}
                        required
                      />
                    </div>
                  )}

                  {mode !== "reset" && (
                    <input
                      type="email"
                      placeholder={t("auth.email_address")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                      required
                    />
                  )}

                  {mode !== "forgot" && (
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder={mode === "reset" ? t("auth.new_password_placeholder") : t("auth.password")}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${inputCls} pr-12`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8A887F] hover:text-[#2D2C28] transition-colors"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  )}

                  {mode === "forgot" && (
                    <p className="text-xs text-[#8A887F] leading-relaxed -mt-0.5">
                      {t("auth.will_only_send")}
                      {" "}{t("auth.expires_in")} <strong className="text-[#65635C]">{t("auth.24_hours")}</strong>.
                    </p>
                  )}

                  {mode === "reset" && (
                    <div className="rounded-2xl bg-[#F8F5EE] border border-[#E5E2D9] p-3.5 space-y-2">
                      <p className="text-xs font-semibold text-[#65635C]">{t("auth.password_requirements")}</p>
                      <ul className="space-y-1.5">
                        {[
                          { key: "auth.req_8_chars",  met: password.length >= 8 },
                          { key: "auth.req_uppercase", met: /[A-Z]/.test(password) },
                          { key: "auth.req_number",    met: /[0-9]/.test(password) },
                          { key: "auth.req_special",   met: /[^A-Za-z0-9]/.test(password) },
                        ].map(({ key, met }) => (
                          <li key={key} className="flex items-center gap-2 text-xs transition-colors" style={{ color: met ? "#2F6B45" : "#8A887F" }}>
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all ${met ? "bg-[#E8F5EC]" : "bg-[#EDEBE5]"}`}>
                              {met && <Check size={9} />}
                            </span>
                            {t(key)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {notice && (
                    <div className="flex items-start gap-3 text-sm text-[#2F6B45] bg-[#E8F5EC] border border-[#C8E8D4] rounded-2xl p-3.5">
                      <Check size={15} className="mt-0.5 shrink-0" /> {notice}
                    </div>
                  )}

                  {error && (
                    <div className="text-sm text-[#8C2D14] bg-[#FFF4EE] border border-[#F2C5B7] rounded-2xl p-3.5">
                      {error}
                      {signupSuggestion && (
                        <button
                          type="button"
                          onClick={() => { clearMessages(); setMode("signup"); }}
                          className="block mt-2 text-[#D26D53] font-semibold"
                        >
                          {t("auth.create_account_instead")}
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#D26D53] hover:bg-[#C05E45] text-white rounded-2xl py-3.5 font-semibold text-sm disabled:opacity-70 transition-all duration-150 inline-flex items-center justify-center gap-2 shadow-lg shadow-[#D26D53]/20"
                  >
                    {loading
                      ? <><Loader2 size={15} className="animate-spin" /> {t("auth.please_wait")}</>
                      : mode === "signup"  ? t("auth.create_account")
                      : mode === "forgot"  ? t("auth.send_reset_email")
                      : mode === "reset"   ? t("auth.set_new_password")
                      : t("auth.sign_in")
                    }
                  </button>
                </form>

                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => { clearMessages(); setMode("forgot"); }}
                    className="w-full mt-3.5 text-sm text-[#8A887F] hover:text-[#D26D53] font-medium transition-colors"
                  >
                    {t("auth.forgot_password")}
                  </button>
                )}

                {(mode === "forgot" || mode === "reset") && (
                  <button
                    type="button"
                    onClick={() => { clearMessages(); setMode("login"); }}
                    className="w-full mt-3.5 text-sm text-[#D26D53] font-semibold"
                  >
                    {t("auth.back_to_sign_in")}
                  </button>
                )}
              </>
            )}

            <p className="text-xs text-[#A7A29A] text-center mt-6">
              {t("auth.not_ready")}{" "}
              <Link to="/" className="text-[#D26D53] font-semibold hover:underline">
                {t("auth.return_home")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
