import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import api from "../lib/api";
import {
  Loader2, Mail, Send, CheckCircle2, MessageSquare, Clock, Shield,
} from "lucide-react";

const SUBJECTS = [
  "Question about my vet bill analysis",
  "Account or billing help",
  "Technical issue / bug report",
  "Partnership or press inquiry",
  "Feedback or feature request",
  "Something else",
];

export default function Contact() {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "", email: "", subject: SUBJECTS[0], message: "", website: "",
  });
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setError("Please fill in your name, email, and message.");
      return;
    }
    setSending(true);
    try {
      await api.post("/contact", form);
      setSent(true);
    } catch (err) {
      setError(err?.response?.data?.detail || "Couldn't send the message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="paper-grain min-h-screen flex flex-col">
      <Header variant="marketing" />

      <main className="flex-1 max-w-[1120px] mx-auto w-full px-5 sm:px-8 pt-14 pb-20" data-testid="contact-page">

        {/* Hero */}
        <div className="mb-14">
          <div className="eyebrow mb-3 text-[#D26D53]">{t("contact.eyebrow")}</div>
          <h1 className="font-serif-display text-5xl sm:text-6xl tracking-tight leading-[0.93] text-[#2D2C28] max-w-2xl">
            We'd love to{" "}
            <span className="italic text-[#D26D53]">hear</span>{" "}
            from you.
          </h1>
          <p className="mt-5 text-[#65635C] leading-relaxed max-w-lg">
            Questions about a vet bill, your subscription, a feature request, or a partnership?
            Send a note and a real human will get back to you within one business day.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

          {/* Left — info */}
          <div className="lg:col-span-4 space-y-6">

            {/* Direct email card */}
            <div className="rounded-[24px] bg-[#2D2C28] text-[#FAF9F6] p-6 relative overflow-hidden">
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-[#D26D53]/20 blur-2xl" />
              <div className="relative z-10">
                <div className="w-10 h-10 rounded-2xl bg-[#D26D53] flex items-center justify-center mb-4">
                  <Mail size={18} />
                </div>
                <div className="eyebrow text-[#E6AE2E] mb-1">Direct email</div>
                <a
                  href="mailto:hello@petbillshield.com"
                  className="font-semibold text-base text-[#FAF9F6] hover:text-[#D26D53] transition break-all"
                >
                  hello@petbillshield.com
                </a>
                <p className="mt-2 text-sm text-[#FAF9F6]/60">
                  For anything urgent or sensitive — reach us directly.
                </p>
              </div>
            </div>

            {/* Info tiles */}
            {[
              {
                icon: Clock,
                title: t("contact.response_time"),
                desc: "We reply within one business day, Monday to Friday.",
                color: "bg-[#FFF4EE] text-[#D26D53]",
              },
              {
                icon: MessageSquare,
                title: "What to include",
                desc: "Your account email (if applicable) and a clear description. Screenshots welcome.",
                color: "bg-[#E8F5EC] text-[#2F6B45]",
              },
              {
                icon: Shield,
                title: "Data & privacy",
                desc: "We never share your contact details or use them for marketing without your consent.",
                color: "bg-[#EDF5FF] text-[#245EA8]",
              },
            ].map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="rounded-[20px] border border-[#E5E2D9] bg-white p-5 flex items-start gap-4">
                <span className={`w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0 ${color}`}>
                  <Icon size={15} />
                </span>
                <div>
                  <div className="font-semibold text-sm text-[#2D2C28]">{title}</div>
                  <p className="text-xs text-[#65635C] mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Right — form */}
          <div className="lg:col-span-8">
            <div className="rounded-[28px] border border-[#E5E2D9] bg-white p-7 sm:p-9">

              {sent ? (
                /* ── Success state ── */
                <div className="text-center py-12" data-testid="contact-success">
                  <div className="w-14 h-14 rounded-full bg-[#E8F5EC] flex items-center justify-center mx-auto mb-5">
                    <CheckCircle2 size={28} className="text-[#556045]" strokeWidth={1.5} />
                  </div>
                  <h2 className="font-serif-display text-3xl text-[#2D2C28]">Message received.</h2>
                  <p className="text-sm text-[#65635C] mt-3 max-w-sm mx-auto leading-relaxed">
                    We'll reply to <strong>{form.email}</strong> from{" "}
                    <span className="font-mono text-[#2D2C28]">hello@petbillshield.com</span>{" "}
                    within one business day.
                  </p>
                  <Link
                    to="/"
                    className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53] hover:opacity-80 transition"
                  >
                    ← Back to home
                  </Link>
                </div>
              ) : (
                /* ── Form ── */
                <form onSubmit={submit} className="space-y-5" data-testid="contact-form">
                  {/* Honeypot */}
                  <input
                    type="text" name="website" tabIndex={-1} autoComplete="off"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    className="absolute -left-[9999px] w-px h-px opacity-0"
                    aria-hidden="true"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={t("contact.your_name")} required>
                      <input
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition"
                        placeholder="Alex Johnson"
                        data-testid="contact-name"
                      />
                    </Field>
                    <Field label={t("contact.your_email")} required>
                      <input
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        type="email"
                        className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition"
                        placeholder="you@example.com"
                        data-testid="contact-email"
                      />
                    </Field>
                  </div>

                  <Field label={t("contact.subject")}>
                    <select
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition appearance-none"
                      data-testid="contact-subject"
                    >
                      {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>

                  <Field label={t("contact.message")} required>
                    <textarea
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      rows={7}
                      className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition resize-none"
                      placeholder="Tell us what's on your mind. Include as much context as helpful."
                      data-testid="contact-message"
                    />
                  </Field>

                  {error && (
                    <p className="text-sm text-[#8C2D14]" data-testid="contact-error">{error}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="submit"
                      disabled={sending}
                      className="btn-primary rounded-xl px-6 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
                      data-testid="contact-submit"
                    >
                      {sending
                        ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
                        : <><Send size={15} /> Send message</>
                      }
                    </button>
                    <span className="text-xs text-[#8A887F]">
                      We'll reply to your email within 1 business day.
                    </span>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1.5">
        {label}{required && <span className="text-[#D26D53] ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
