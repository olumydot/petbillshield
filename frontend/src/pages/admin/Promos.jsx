import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Tag, Check, Eye, EyeOff, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import ConfirmModal from "@/components/ConfirmModal";

export default function Promos() {
  const [promos,      setPromos]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [promoToDeactivate, setPromoToDeactivate] = useState(null);
  const [banner,      setBanner]      = useState({
    enabled: false,
    title: "Yearly launch offer",
    body: "50% off your first 3 months on any yearly plan.",
    promo_code: "",
    discount_display: "50% off first 3 months",
    cta_text: "View yearly plans",
    cta_href: "/dashboard/pricing",
    style: "primary",
    starts_at: "",
    expires_at: "",
    display_pages: ["landing", "pricing", "billing"],
    allowed_plan_ids: ["vault_yearly", "family_yearly", "rescue_yearly"],
    plan_scope: "yearly",
    required_percent_off: 50,
    required_duration_months: 3,
  });
  const [savingBanner, setSavingBanner] = useState(false);

  const [form, setForm] = useState({
    name:            "",
    code:            "",
    discount_type:   "percent",
    discount_value:  "50",
    duration:        "repeating",
    duration_months: "3",
    max_redemptions: "",
    expires_days:    "",
  });

  const YEARLY_PLAN_IDS = ["vault_yearly", "family_yearly", "rescue_yearly"];

  const load = async () => {
    setLoading(true);
    const [promosRes, bannerRes] = await Promise.allSettled([
      api.get("/admin/portal/promos"),
      api.get("/content/promo-banner/admin"),
    ]);

    if (promosRes.status === "fulfilled") {
      const { data } = promosRes.value;
      setPromos(data.promos || []);
      if (data.note) toast.info(data.note);
    } else {
      const detail = promosRes.reason?.response?.data?.detail;
      toast.error(detail || "Couldn't load Stripe promo codes");
    }

    if (bannerRes.status === "fulfilled") {
      setBanner((prev) => ({ ...prev, ...bannerRes.value.data }));
    } else {
      const detail = bannerRes.reason?.response?.data?.detail;
      toast.error(detail || "Couldn't load promo banner settings");
    }

    setLoading(false);
  };

  const toggleArray = (field, value) => {
    setBanner((prev) => {
      const current = prev[field] || [];
      return {
        ...prev,
        [field]: current.includes(value)
          ? current.filter((x) => x !== value)
          : [...current, value],
      };
    });
  };

  const saveBanner = async (e) => {
    e.preventDefault();
    setSavingBanner(true);
    try {
      await api.put("/content/promo-banner", {
        ...banner,
        promo_code: (banner.promo_code || "").toUpperCase(),
      });
      toast.success(banner.enabled ? "Promo banner is live." : "Promo banner saved disabled.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save banner");
    } finally {
      setSavingBanner(false);
    }
  };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) { toast.error("Name and code are required."); return; }
    setSaving(true);
    try {
      await api.post("/admin/portal/promos", {
        ...form,
        discount_value:  parseFloat(form.discount_value),
        duration_months: form.duration_months ? parseInt(form.duration_months) : undefined,
        max_redemptions: form.max_redemptions  ? parseInt(form.max_redemptions) : undefined,
        expires_days:    form.expires_days     ? parseInt(form.expires_days)    : undefined,
      });
      toast.success("Promo code created!");
      setShowForm(false);
      setForm({ name: "", code: "", discount_type: "percent", discount_value: "50",
                duration: "repeating", duration_months: "3", max_redemptions: "", expires_days: "" });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't create promo");
    } finally { setSaving(false); }
  };

  const deactivate = async (id, code) => {
    setDeactivating(id);
    try {
      await api.delete(`/admin/portal/promos/${id}`);
      toast.success("Promo deactivated");
      setPromoToDeactivate(null);
      setPromos(ps => ps.filter(p => p.id !== id));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't deactivate");
    } finally { setDeactivating(null); }
  };

  const Field = ({ label, children }) => (
    <label className="block">
      <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1">{label}</span>
      {children}
    </label>
  );
  const Input = ({ ...props }) => (
    <input {...props}
      className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
    />
  );

  const configureYearlyLaunch = () => {
    setBanner((prev) => ({
      ...prev,
      enabled: true,
      title: prev.title || "Yearly launch offer",
      body: prev.body || "50% off your first 3 months on any yearly plan.",
      discount_display: prev.discount_display || "50% off first 3 months",
      cta_text: prev.cta_text || "View yearly plans",
      cta_href: prev.cta_href || "/dashboard/pricing",
      style: "primary",
      display_pages: ["landing", "pricing", "billing"],
      allowed_plan_ids: YEARLY_PLAN_IDS,
      plan_scope: "yearly",
      required_percent_off: 50,
      required_duration_months: 3,
    }));
    setForm((prev) => ({
      ...prev,
      name: prev.name || "Yearly launch 50% off first 3 months",
      discount_type: "percent",
      discount_value: "50",
      duration: "repeating",
      duration_months: "3",
    }));
    toast.info("Yearly launch settings filled in. Add your Stripe promo code, then save.");
  };

  return (
    <div className="space-y-6">
      <ConfirmModal
        open={Boolean(promoToDeactivate)}
        title="Deactivate promo?"
        description={promoToDeactivate ? `${promoToDeactivate.code} will stop being available for future redemptions.` : ""}
        confirmLabel={deactivating ? "Deactivating..." : "Deactivate promo"}
        tone="danger"
        busy={Boolean(deactivating)}
        onCancel={() => setPromoToDeactivate(null)}
        onConfirm={() => promoToDeactivate && deactivate(promoToDeactivate.id, promoToDeactivate.code)}
      />

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Sales</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6]">Promo codes</h2>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 transition"
        >
          <Plus size={13} /> New promo
        </button>
      </div>

      {/* Public banner controls */}
      <form onSubmit={saveBanner} className="rounded-2xl border border-[#2A2924] bg-[#1A1917] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Public promo banner</div>
            <h3 className="text-lg font-bold text-[#FAF9F6]">Show or hide the site-wide offer</h3>
            <p className="text-xs text-[#8A887F] mt-1 max-w-2xl">
              When enabled, this banner can show on the landing page, pricing page, and billing settings. Checkout only accepts the published code for the plan scope and plans selected here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={configureYearlyLaunch}
              className="rounded-xl border border-[#D26D53]/40 bg-[#3A1B12] px-4 py-2 text-xs font-semibold text-[#F5B29D] inline-flex items-center gap-2 transition hover:bg-[#4A2116]"
            >
              <Sparkles size={13} />
              Yearly 50% setup
            </button>
            <button
              type="button"
              onClick={() => setBanner((b) => ({ ...b, enabled: !b.enabled }))}
              className={`rounded-xl px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 transition ${
                banner.enabled ? "bg-[#556045] text-white" : "bg-[#2A2924] text-[#8A887F]"
              }`}
            >
              {banner.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
              {banner.enabled ? "Available" : "Hidden"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Field label="Banner title">
            <Input value={banner.title} onChange={e => setBanner({...banner, title: e.target.value})} placeholder="Spring savings" />
          </Field>
          <Field label="Promo code">
            <Input value={banner.promo_code} onChange={e => setBanner({...banner, promo_code: e.target.value.toUpperCase()})} placeholder="SPRING20" />
          </Field>
          <Field label="Body">
            <Input value={banner.body} onChange={e => setBanner({...banner, body: e.target.value})} placeholder="Save on your first month of Pet Cost Vault." />
          </Field>
          <Field label="Discount display">
            <Input value={banner.discount_display} onChange={e => setBanner({...banner, discount_display: e.target.value})} placeholder="20% off" />
          </Field>
          <Field label="CTA text">
            <Input value={banner.cta_text} onChange={e => setBanner({...banner, cta_text: e.target.value})} placeholder="Claim offer" />
          </Field>
          <Field label="CTA href">
            <Input value={banner.cta_href} onChange={e => setBanner({...banner, cta_href: e.target.value})} placeholder="/dashboard/pricing" />
          </Field>
          <Field label="Style">
            <select value={banner.style} onChange={e => setBanner({...banner, style: e.target.value})}
              className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]">
              <option value="warning">Gold</option>
              <option value="primary">Terracotta</option>
              <option value="success">Sage</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <Field label="Expires at">
            <Input type="datetime-local" value={(banner.expires_at || "").slice(0, 16)} onChange={e => setBanner({...banner, expires_at: e.target.value})} />
          </Field>
          <Field label="Plan scope">
            <select value={banner.plan_scope || "all"} onChange={e => setBanner({...banner, plan_scope: e.target.value})}
              className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]">
              <option value="all">All paid plans</option>
              <option value="monthly">Monthly plans only</option>
              <option value="yearly">Yearly plans only</option>
            </select>
          </Field>
          <Field label="Required percent off">
            <Input type="number" value={banner.required_percent_off || ""} onChange={e => setBanner({...banner, required_percent_off: e.target.value})} placeholder="50" min="1" max="100" />
          </Field>
          <Field label="Required duration months">
            <Input type="number" value={banner.required_duration_months || ""} onChange={e => setBanner({...banner, required_duration_months: e.target.value})} placeholder="3" min="1" />
          </Field>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Show on pages</div>
            <div className="flex flex-wrap gap-2">
              {["landing", "pricing", "billing"].map((page) => (
                <button key={page} type="button" onClick={() => toggleArray("display_pages", page)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                    (banner.display_pages || []).includes(page) ? "bg-[#D26D53] text-white" : "bg-[#111] border border-[#2A2924] text-[#8A887F]"
                  }`}>
                  {page}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Valid plans</div>
            <div className="flex flex-wrap gap-2">
              {["vault_monthly", "vault_yearly", "family_monthly", "family_yearly", "rescue_monthly", "rescue_yearly"].map((plan) => (
                <button key={plan} type="button" onClick={() => toggleArray("allowed_plan_ids", plan)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    (banner.allowed_plan_ids || []).includes(plan) ? "bg-[#556045] text-white" : "bg-[#111] border border-[#2A2924] text-[#8A887F]"
                  }`}>
                  {plan.replace("_", " ")}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#65635C] mt-2">Leave all unselected to allow every paid plan.</p>
          </div>
        </div>

        <button type="submit" disabled={savingBanner}
          className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-40 transition">
          {savingBanner ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save banner
        </button>
      </form>

      {/* Create form */}
      {showForm && (
        <form onSubmit={create} className="rounded-2xl border border-[#2A2924] bg-[#1A1917] p-5 space-y-4">
          <div className="text-sm font-semibold text-[#FAF9F6] mb-2">Create promo code</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Internal name">
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Summer Sale 20%" />
            </Field>
            <Field label="Code">
              <Input value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} placeholder="SUMMER20" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount type">
              <select value={form.discount_type} onChange={e => setForm({...form, discount_type: e.target.value})}
                className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]">
                <option value="percent">Percent off (%)</option>
                <option value="fixed">Fixed amount ($)</option>
              </select>
            </Field>
            <Field label={form.discount_type === "percent" ? "Percent off" : "Amount off ($)"}>
              <Input type="number" value={form.discount_value} onChange={e => setForm({...form, discount_value: e.target.value})} placeholder="10" min="1" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Duration">
              <select value={form.duration} onChange={e => setForm({...form, duration: e.target.value})}
                className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53]">
                <option value="once">Once</option>
                <option value="repeating">Repeating</option>
                <option value="forever">Forever</option>
              </select>
            </Field>
            {form.duration === "repeating" && (
              <Field label="Months">
                <Input type="number" value={form.duration_months} onChange={e => setForm({...form, duration_months: e.target.value})} placeholder="3" min="1" />
              </Field>
            )}
            <Field label="Max uses (blank = unlimited)">
              <Input type="number" value={form.max_redemptions} onChange={e => setForm({...form, max_redemptions: e.target.value})} placeholder="100" min="1" />
            </Field>
            <Field label="Expires in (days, blank = never)">
              <Input type="number" value={form.expires_days} onChange={e => setForm({...form, expires_days: e.target.value})} placeholder="30" min="1" />
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="rounded-xl bg-[#556045] hover:bg-[#445035] text-white text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-40 transition"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-[#65635C] hover:text-[#FAF9F6]">Cancel</button>
          </div>
        </form>
      )}

      {/* List */}
      {loading
        ? <div className="text-[#65635C] text-sm animate-pulse">Loading promos…</div>
        : promos.length === 0
        ? (
          <div className="text-center py-16 text-[#65635C]">
            <Tag size={32} className="mx-auto mb-3 opacity-30" />
            <p>No active promo codes.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {promos.map(p => (
              <div key={p.id} className="rounded-2xl border border-[#2A2924] bg-[#1A1917] px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="rounded-xl bg-[#2A2924] px-3 py-1.5">
                    <span className="font-mono text-sm font-bold text-[#E6AE2E]">{p.code}</span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#FAF9F6]">{p.name}</div>
                    <div className="text-xs text-[#8A887F] mt-0.5">
                      {p.discount} off · {p.duration}
                      {p.max_redemptions ? ` · max ${p.max_redemptions} uses` : " · unlimited uses"}
                      {` · ${p.times_redeemed} redeemed`}
                    </div>
                  </div>
                </div>
                <button onClick={() => setPromoToDeactivate({ id: p.id, code: p.code })} disabled={deactivating === p.id}
                  className="text-[#65635C] hover:text-[#F87171] transition disabled:opacity-40"
                  title="Deactivate"
                >
                  {deactivating === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}
