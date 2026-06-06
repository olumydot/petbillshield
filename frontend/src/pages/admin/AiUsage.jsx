import { useEffect, useState } from "react";
import { Cpu, Activity, Loader2 } from "lucide-react";
import api from "@/lib/api";

const FEATURE_LABELS = {
  estimate: "Bill analyses",
  compare: "Comparisons",
  ask: "Follow-up questions",
  script: "Question scripts",
  claim: "Claim analyses",
  timeline_summary: "Timeline summaries",
  pet_question: "Pet AI insights",
  suggest_reminders: "Reminder suggestions",
  forecast: "Cost forecasts",
};

export default function AiUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/portal/ai-usage").then(({ data }) => setData(data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[#65635C] text-sm animate-pulse flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading AI usage…</div>;
  if (!data)   return <div className="text-[#8C2D14] text-sm">Failed to load AI usage.</div>;

  const maxFeature = Math.max(1, ...(data.per_feature || []).map((f) => f.count));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Cost control</div>
        <h2 className="text-2xl font-bold text-[#FAF9F6]">AI usage</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#8A887F] font-medium">AI calls this month</span>
            <span className="w-8 h-8 rounded-xl inline-flex items-center justify-center" style={{ background: "#D26D5320", color: "#D26D53" }}><Activity size={14} /></span>
          </div>
          <div className="font-mono text-2xl font-bold text-[#FAF9F6]">{data.month_total_calls.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#8A887F] font-medium">Estimated AI cost (mo)</span>
            <span className="w-8 h-8 rounded-xl inline-flex items-center justify-center" style={{ background: "#E6AE2E20", color: "#E6AE2E" }}><Cpu size={14} /></span>
          </div>
          <div className="font-mono text-2xl font-bold text-[#FAF9F6]">${data.month_total_cost_usd.toLocaleString()}</div>
        </div>
      </div>

      {/* Per-feature breakdown */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={14} className="text-[#D26D53]" />
          <div className="text-xs text-[#8A887F] font-medium">Calls by feature (this month)</div>
        </div>
        {(data.per_feature || []).length === 0
          ? <div className="text-sm text-[#65635C]">No AI calls yet this month.</div>
          : (data.per_feature || []).map((f) => (
            <div key={f.feature} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-[#8A887F]">{FEATURE_LABELS[f.feature] || f.feature}</span>
                <span className="font-mono text-[#FAF9F6]">{f.count} <span className="text-[#65635C]">· ${f.cost_usd}</span></span>
              </div>
              <div className="h-2 rounded-full bg-[#2A2924] overflow-hidden">
                <div className="h-full rounded-full bg-[#D26D53] transition-all" style={{ width: `${(f.count / maxFeature) * 100}%` }} />
              </div>
            </div>
          ))}
      </div>

      {/* Top users */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={14} className="text-[#556045]" />
          <div className="text-xs text-[#8A887F] font-medium">Top users by AI calls (30d)</div>
        </div>
        {(data.top_users || []).length === 0
          ? <div className="text-sm text-[#65635C]">No usage in the last 30 days.</div>
          : (data.top_users || []).map((u) => (
            <div key={u.user_id} className="flex items-center justify-between gap-3 py-2 border-b border-[#2A2924] last:border-0">
              <div className="min-w-0">
                <div className="text-sm text-[#FAF9F6] truncate">{u.name || u.email}</div>
                <div className="text-xs text-[#65635C] truncate">{u.email} · {u.active ? u.plan_id : "free"}</div>
              </div>
              <span className="font-mono text-sm text-[#FAF9F6] shrink-0">{u.calls_30d}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
