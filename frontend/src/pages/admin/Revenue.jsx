import { useEffect, useState } from "react";
import { DollarSign, TrendingUp, Users, UserMinus, Percent, Cpu, Loader2 } from "lucide-react";
import api from "@/lib/api";

function Stat({ label, value, sub, icon: Icon, color = "#D26D53" }) {
  return (
    <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#8A887F] font-medium">{label}</span>
        <span className="w-8 h-8 rounded-xl inline-flex items-center justify-center" style={{ background: `${color}20`, color }}>
          <Icon size={14} />
        </span>
      </div>
      <div className="font-mono text-2xl font-bold text-[#FAF9F6]">{value}</div>
      {sub && <div className="text-xs text-[#65635C] mt-1">{sub}</div>}
    </div>
  );
}

const TIER_META = {
  vault:  { label: "Pet Cost Vault", color: "#F0A088" },
  family: { label: "Family",         color: "#A6C48A" },
  rescue: { label: "Rescue / Foster", color: "#E6AE2E" },
};

export default function Revenue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/portal/revenue").then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[#65635C] text-sm animate-pulse flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading revenue…</div>;
  if (!data)   return <div className="text-[#8C2D14] text-sm">Failed to load revenue.</div>;

  const maxTier = Math.max(1, ...Object.values(data.tiers || {}));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Business</div>
        <h2 className="text-2xl font-bold text-[#FAF9F6]">Revenue</h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="MRR"  value={`$${Number(data.mrr_usd).toLocaleString()}`} sub={`ARR $${Number(data.arr_usd).toLocaleString()}`} icon={DollarSign} color="#E6AE2E" />
        <Stat label="Active subscribers" value={data.active_subs} sub={`${data.free_users} free · ${data.total_users} total`} icon={Users} color="#556045" />
        <Stat label="Free → paid" value={`${data.conversion_pct}%`} sub="conversion rate" icon={Percent} color="#245EA8" />
        <Stat label="Gross margin" value={data.gross_margin_pct == null ? "—" : `${data.gross_margin_pct}%`} sub={`AI cost $${data.ai_cost_month_usd} / rev $${data.revenue_month_usd} (mo)`} icon={Cpu} color="#D26D53" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="New subs (30d)" value={`+${data.new_subs_30d}`} icon={TrendingUp} color="#556045" />
        <Stat label="Churned (30d)"  value={data.churn_30d} sub={`${data.churn_rate_pct}% churn rate`} icon={UserMinus} color="#F87171" />
        <Stat label="Revenue (mo)"   value={`$${Number(data.revenue_month_usd).toLocaleString()}`} icon={DollarSign} color="#E6AE2E" />
        <Stat label="AI cost (mo)"   value={`$${Number(data.ai_cost_month_usd).toLocaleString()}`} sub="Claude usage" icon={Cpu} color="#B5936A" />
      </div>

      {/* MRR by tier */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign size={14} className="text-[#E6AE2E]" />
          <div className="text-xs text-[#8A887F] font-medium">MRR by tier</div>
        </div>
        <div className="space-y-3">
          {Object.entries(TIER_META).map(([key, meta]) => {
            const mrr = data.tiers?.[key] || 0;
            const subs = data.tier_subs?.[key] || 0;
            return (
              <div key={key}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-[#8A887F]">{meta.label} <span className="text-[#65635C]">· {subs} sub{subs !== 1 ? "s" : ""}</span></span>
                  <span className="font-mono text-[#FAF9F6]">${mrr.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full bg-[#2A2924] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(mrr / maxTier) * 100}%`, background: meta.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
