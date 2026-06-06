import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Clock, ShoppingCart, ExternalLink, Gift, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const PLAN_OPTIONS = [
  { id: "vault_monthly",  label: "Pet Cost Vault (monthly)" },
  { id: "vault_yearly",   label: "Pet Cost Vault (yearly)" },
  { id: "family_monthly", label: "Family (monthly)" },
  { id: "family_yearly",  label: "Family (yearly)" },
  { id: "rescue_monthly", label: "Rescue / Foster (monthly)" },
  { id: "rescue_yearly",  label: "Rescue / Foster (yearly)" },
];

function Section({ title, icon: Icon, count, color, children }) {
  return (
    <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={14} style={{ color }} />
        <div className="text-xs text-[#8A887F] font-medium">{title}</div>
        {count != null && <span className="ml-auto text-xs font-mono text-[#65635C]">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function CompModal({ user, onClose, onDone }) {
  const [planId, setPlanId] = useState("vault_monthly");
  const [days, setDays] = useState(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/admin/portal/users/${user.user_id}/comp`, { plan_id: planId, days: Number(days), reason });
      toast.success(`Comped ${user.email} → ${planId}`);
      onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Comp failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[#2A2924] bg-[#1A1917] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[#FAF9F6]">Comp a subscription</h3>
          <button onClick={onClose} className="text-[#65635C] hover:text-[#FAF9F6]"><X size={16} /></button>
        </div>
        <p className="text-xs text-[#8A887F] mb-4">{user.email}</p>
        <label className="block mb-3">
          <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Plan</span>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]">
            {PLAN_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block mb-3">
          <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Days of access</span>
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)}
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]" />
        </label>
        <label className="block mb-4">
          <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Reason (audit log)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. paid but activation failed"
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]" />
        </label>
        <button onClick={submit} disabled={busy}
          className="w-full rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
          Grant access
        </button>
      </div>
    </div>
  );
}

function UserRow({ u, onComp }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-[#2A2924] last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-[#FAF9F6] truncate">{u.name || u.email}</div>
        <div className="text-xs text-[#65635C] truncate">
          {u.email} · {u.plan_id || "—"} · {u.subscription_status || "—"}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {u.stripe_customer_id && (
          <a href={`https://dashboard.stripe.com/customers/${u.stripe_customer_id}`} target="_blank" rel="noreferrer"
            className="text-[#65635C] hover:text-[#FAF9F6]" title="Open in Stripe">
            <ExternalLink size={13} />
          </a>
        )}
        <button onClick={() => onComp(u)}
          className="text-xs font-semibold rounded-lg bg-[#2A2924] hover:bg-[#3A3833] text-[#E6AE2E] px-2.5 py-1 inline-flex items-center gap-1">
          <Gift size={11} /> Comp
        </button>
      </div>
    </div>
  );
}

export default function Billing() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compUser, setCompUser] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/admin/portal/billing").then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-[#65635C] text-sm animate-pulse flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading billing…</div>;
  if (!data)   return <div className="text-[#8C2D14] text-sm">Failed to load billing.</div>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Operations</div>
        <h2 className="text-2xl font-bold text-[#FAF9F6]">Billing</h2>
      </div>

      <Section title="Past due / unpaid" icon={AlertTriangle} count={data.counts.past_due} color="#F87171">
        {data.past_due.length === 0
          ? <div className="text-sm text-[#65635C]">No past-due subscriptions. 🎉</div>
          : data.past_due.map((u) => <UserRow key={u.user_id} u={u} onComp={setCompUser} />)}
      </Section>

      <Section title="Incomplete subscriptions" icon={Clock} count={data.counts.incomplete} color="#E6AE2E">
        {data.incomplete.length === 0
          ? <div className="text-sm text-[#65635C]">No incomplete subscriptions.</div>
          : data.incomplete.map((u) => <UserRow key={u.user_id} u={u} onComp={setCompUser} />)}
      </Section>

      <Section title="Abandoned checkouts (7d)" icon={ShoppingCart} count={data.counts.abandoned} color="#245EA8">
        {data.abandoned_checkouts.length === 0
          ? <div className="text-sm text-[#65635C]">No abandoned checkouts this week.</div>
          : data.abandoned_checkouts.map((t) => (
            <div key={t.session_id} className="flex items-center justify-between gap-3 py-2 border-b border-[#2A2924] last:border-0 text-sm">
              <span className="text-[#8A887F] truncate">{t.user_email || "—"}</span>
              <span className="text-xs text-[#65635C] shrink-0">{t.plan_id} · {t.payment_status} · {t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}</span>
            </div>
          ))}
      </Section>

      {compUser && <CompModal user={compUser} onClose={() => setCompUser(null)} onDone={() => { setCompUser(null); load(); }} />}
    </div>
  );
}
