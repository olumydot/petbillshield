import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Loader2, ShieldAlert, Star, Mail, Bell, CreditCard, MessageSquareHeart, Users, PawPrint, FileSearch } from "lucide-react";

export default function Admin() {
  const { user } = useAuth();
  const [allowed, setAllowed] = useState(null); // null = checking, false = no, true = yes
  const [tab, setTab] = useState("metrics");
  const [metrics, setMetrics] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [contact, setContact] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/admin/check")
      .then(({ data }) => { if (!cancelled) setAllowed(!!data?.is_admin); })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([
      api.get("/admin/metrics").then((r) => setMetrics(r.data)).catch(() => {}),
      api.get("/admin/feedback").then((r) => setFeedback(r.data || [])).catch(() => {}),
      api.get("/admin/contact-messages").then((r) => setContact(r.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [allowed]);

  if (allowed === null) {
    return <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Checking access…</div>;
  }
  if (allowed === false) {
    return (
      <div className="cream-card p-12 text-center" data-testid="admin-forbidden">
        <ShieldAlert className="mx-auto text-[#D26D53]" size={28} strokeWidth={1.5}/>
        <h2 className="font-serif-display text-3xl mt-4">Admin only.</h2>
        <p className="text-sm text-[#65635C] mt-2 max-w-md mx-auto">Your account ({user?.email}) is not on the admin allowlist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="admin-page">
      <header>
        <div className="eyebrow mb-2">Admin</div>
        <h1 className="font-serif-display text-4xl sm:text-5xl tracking-tight leading-none">
          Behind the <span className="italic text-[#D26D53]">shield.</span>
        </h1>
        <p className="mt-3 text-sm text-[#65635C] max-w-xl">
          Real-time signals — usage, feedback, contact inquiries, and the reminder dispatcher.
        </p>
      </header>

      <div className="inline-flex p-1 rounded-md bg-[#F2F0E9] border border-[#E5E2D9]">
        {[
          { id: "metrics", label: "Metrics" },
          { id: "feedback", label: `Feedback ${feedback.length ? `(${feedback.length})` : ""}` },
          { id: "contact", label: `Contact ${contact.length ? `(${contact.length})` : ""}` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-xs font-semibold rounded ${tab === t.id ? "bg-[#2D2C28] text-[#FAF9F6]" : "text-[#65635C]"}`}
            data-testid={`admin-tab-${t.id}`}
          >{t.label}</button>
        ))}
      </div>

      {loading && <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Loading…</div>}

      {tab === "metrics" && metrics && (
        <div className="space-y-4 fade-up delay-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Users" value={metrics.users} icon={Users} testid="metric-users"/>
            <Stat label="Pets" value={metrics.pets} icon={PawPrint} testid="metric-pets"/>
            <Stat label="Estimates analyzed" value={metrics.estimates} icon={FileSearch} testid="metric-estimates"/>
            <Stat label="Claims drafted" value={metrics.claims} icon={Mail} testid="metric-claims"/>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="cream-card p-5">
              <div className="eyebrow text-[#D26D53] mb-2 inline-flex items-center gap-1.5"><CreditCard size={13}/> Payments</div>
              <div className="font-serif-display text-3xl">${Number(metrics.payments?.revenue_usd || 0).toLocaleString()}</div>
              <div className="text-xs text-[#65635C] mt-1">{metrics.payments?.paid || 0} paid / {metrics.payments?.total || 0} attempted</div>
            </div>
            <div className="cream-card p-5">
              <div className="eyebrow text-[#556045] mb-2 inline-flex items-center gap-1.5"><Bell size={13}/> Reminder dispatcher</div>
              <div className="text-sm space-y-1">
                <Row k="Pending" v={metrics.reminders?.pending}/>
                <Row k="Sent" v={metrics.reminders?.sent}/>
                <Row k="Failed" v={metrics.reminders?.failed}/>
                <Row k="Every (min)" v={metrics.dispatcher?.scheduled_every_minutes}/>
                <Row k="Sender" v={metrics.dispatcher?.sender}/>
                <Row k="Resend ready" v={metrics.dispatcher?.resend_configured ? "yes" : "no"}/>
              </div>
            </div>
            <div className="cream-card p-5">
              <div className="eyebrow text-[#D26D53] mb-2 inline-flex items-center gap-1.5"><MessageSquareHeart size={13}/> Feedback</div>
              <div className="font-serif-display text-3xl inline-flex items-center gap-2">
                {metrics.feedback?.avg_rating || "—"}
                <Star size={20} className="fill-[#E4A834] text-[#E4A834]"/>
              </div>
              <div className="text-xs text-[#65635C] mt-1">{metrics.feedback?.count_rated || 0} ratings · {metrics.feedback?.total || 0} total entries</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="cream-card p-5">
              <div className="eyebrow mb-2">Shareable links</div>
              <div className="text-sm space-y-1">
                <Row k="Active" v={metrics.shares?.active}/>
                <Row k="Total ever" v={metrics.shares?.total}/>
              </div>
            </div>
            <div className="cream-card p-5">
              <div className="eyebrow mb-2">Contact inbox</div>
              <div className="text-sm space-y-1">
                <Row k="Total" v={metrics.contact_messages?.total}/>
                <Row k="Delivered" v={metrics.contact_messages?.delivered}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "feedback" && (
        <div className="cream-card p-3 fade-up delay-0" data-testid="admin-feedback-list">
          {feedback.length === 0 ? (
            <p className="text-sm text-[#65635C] py-6 text-center">No feedback yet.</p>
          ) : (
            <ul className="divide-y divide-[#E5E2D9]">
              {feedback.map((f) => (
                <li key={f.feedback_id} className="py-4 px-3" data-testid={`fb-${f.feedback_id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={14} className={i < f.rating ? "fill-[#E4A834] text-[#E4A834]" : "text-[#A2AA92]"}/>
                      ))}
                    </span>
                    <span className="chip chip-neutral capitalize">{f.category || "general"}</span>
                    {f.page && <span className="text-xs text-[#65635C] font-mono-clean">{f.page}</span>}
                    <span className="text-xs text-[#65635C] ml-auto">{new Date(f.created_at).toLocaleString()}</span>
                  </div>
                  {f.comment && <p className="text-sm mt-2 leading-relaxed">{f.comment}</p>}
                  <p className="text-xs text-[#65635C] mt-1">{f.user_email || "anonymous"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "contact" && (
        <div className="cream-card p-3 fade-up delay-0" data-testid="admin-contact-list">
          {contact.length === 0 ? (
            <p className="text-sm text-[#65635C] py-6 text-center">No contact messages yet.</p>
          ) : (
            <ul className="divide-y divide-[#E5E2D9]">
              {contact.map((c) => (
                <li key={c.contact_id} className="py-4 px-3" data-testid={`ctc-${c.contact_id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{c.name}</span>
                    <a href={`mailto:${c.email}`} className="editorial-link text-xs text-[#D26D53]">{c.email}</a>
                    {c.delivered ? <span className="chip chip-wait">delivered</span> : <span className="chip chip-flag">undelivered</span>}
                    <span className="text-xs text-[#65635C] ml-auto">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  {c.subject && <div className="text-sm font-semibold mt-1">{c.subject}</div>}
                  {c.message && <p className="text-sm mt-1 leading-relaxed whitespace-pre-wrap">{c.message}</p>}
                  {c.delivery_error && <p className="text-xs text-[#8C2D14] mt-1">Delivery error: {c.delivery_error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, testid }) {
  return (
    <div className="cream-card p-5" data-testid={testid}>
      <div className="eyebrow inline-flex items-center gap-1.5"><Icon size={12}/> {label}</div>
      <div className="font-serif-display text-3xl mt-1 tabular-nums">{value ?? 0}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-[#65635C]">{k}</span>
      <span className="font-mono-clean text-sm tabular-nums">{v ?? "—"}</span>
    </div>
  );
}
