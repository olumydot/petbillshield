import { useEffect, useState } from "react";
import { Users, PawPrint, FileSearch, DollarSign, MessageSquare, Star, TrendingUp, Mail, Tag, Activity, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

function StatCard({ label, value, icon: Icon, color = "#D26D53", sub }) {
  return (
    <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#8A887F] font-medium">{label}</span>
        <span className="w-8 h-8 rounded-xl inline-flex items-center justify-center" style={{ background: `${color}20`, color }}>
          <Icon size={14} />
        </span>
      </div>
      <div className="font-mono text-2xl font-bold text-[#FAF9F6]">{value ?? "—"}</div>
      {sub && <div className="text-xs text-[#65635C] mt-1">{sub}</div>}
    </div>
  );
}

export default function Overview() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weeklyEmail, setWeeklyEmail] = useState("");
  const [weeklySending, setWeeklySending] = useState(false);
  const [weeklyResult, setWeeklyResult] = useState(null);

  useEffect(() => {
    api.get("/admin/portal/stats").then(({ data }) => setStats(data)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user?.email && !weeklyEmail) {
      setWeeklyEmail(user.email);
    }
  }, [user, weeklyEmail]);

  const sendWeeklyTest = async () => {
    const targetEmail = weeklyEmail.trim();
    if (!targetEmail) {
      toast.error("Enter an email address first.");
      return;
    }

    setWeeklySending(true);
    setWeeklyResult(null);
    try {
      const { data } = await api.post(
        `/admin/weekly-reports/dispatch-now?target_email=${encodeURIComponent(targetEmail)}&force=true&immediate=true`
      );
      setWeeklyResult(data);
      toast.success("Weekly report test triggered.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't trigger weekly report test.");
    } finally {
      setWeeklySending(false);
    }
  };

  if (loading) return <div className="text-[#65635C] text-sm animate-pulse">Loading stats…</div>;
  if (!stats)  return <div className="text-[#8C2D14] text-sm">Failed to load stats.</div>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Overview</div>
        <h2 className="text-2xl font-bold text-[#FAF9F6]">Dashboard</h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total users"    value={stats.users?.total}   icon={Users}       color="#556045" sub={`+${stats.users?.new_7d ?? 0} this week · +${stats.users?.new_30d ?? 0} 30d`} />
        <StatCard label="MRR"  value={`$${Number(stats.revenue?.mrr_usd || 0).toLocaleString()}`} icon={DollarSign} color="#E6AE2E" sub={`ARR $${Number(stats.revenue?.arr_usd || 0).toLocaleString()}`} />
        <StatCard label="Month revenue" value={`$${Number(stats.revenue?.this_month_usd || 0).toLocaleString()}`} icon={TrendingUp} color="#D26D53" sub={`All time $${Number(stats.revenue?.all_time_usd || 0).toLocaleString()}`} />
        <StatCard label="Unread inbox"   value={stats.inbox?.unread}  icon={Mail}        color="#245EA8" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Pets"     value={stats.content?.pets}     icon={PawPrint}    color="#B5936A" />
        <StatCard label="Claims"   value={stats.content?.claims}   icon={MessageSquare} color="#556045" sub={`${stats.content?.claims_month ?? 0} this month`} />
        <StatCard label="Estimates" value={stats.content?.estimates} icon={FileSearch} color="#D26D53" sub={`${stats.content?.estimates_month ?? 0} this month`} />
        <StatCard label="Feedback" value={stats.feedback?.total}   icon={Star}        color="#E6AE2E" />
        <StatCard label="Active subs" value={stats.users?.active_subs} icon={Activity} color="#D26D53" sub={`${stats.cancellations_30d ?? 0} cancels 30d`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-[#D26D53]" />
            <div className="text-xs text-[#8A887F] font-medium">Plan mix</div>
          </div>
          <div className="space-y-2">
            {Object.entries(stats.plans || {}).length === 0 ? (
              <div className="text-sm text-[#65635C]">No active subscribers yet.</div>
            ) : Object.entries(stats.plans || {}).map(([plan, count]) => (
              <div key={plan} className="flex items-center justify-between text-sm">
                <span className="text-[#8A887F]">{plan.replace(/_/g, " ")}</span>
                <span className="font-mono text-[#FAF9F6]">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Tag size={14} className="text-[#E6AE2E]" />
            <div className="text-xs text-[#8A887F] font-medium">Published promo</div>
          </div>
          <div className="text-lg font-bold text-[#FAF9F6]">
            {stats.promo?.enabled ? stats.promo?.code || "Enabled" : "No public promo"}
          </div>
          <div className="text-xs text-[#65635C] mt-1">
            {stats.promo?.enabled
              ? `${stats.promo?.title || "Banner is live"}${stats.promo?.expires_at ? ` · ends ${new Date(stats.promo.expires_at).toLocaleDateString()}` : ""}`
              : "Enable a banner from Sales & Promos to show it on public billing surfaces."}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#2A2924] bg-[#1E1D1A] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={14} className="text-[#556045]" />
          <div className="text-xs text-[#8A887F] font-medium">Weekly report test</div>
        </div>
        <p className="text-sm text-[#8A887F] leading-relaxed max-w-2xl">
          Trigger one immediate Sunday-style AI weekly report for a paid subscriber. This uses the same queue-based
          backend flow, but runs it right away for the email you provide.
        </p>
        <div className="mt-4 flex flex-col xl:flex-row gap-3 xl:items-end">
          <label className="flex-1">
            <div className="text-xs text-[#65635C] mb-1">Target email</div>
            <input
              type="email"
              value={weeklyEmail}
              onChange={(e) => setWeeklyEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-[#2A2924] bg-[#111] px-4 py-3 text-sm text-[#FAF9F6] placeholder:text-[#65635C] outline-none focus:ring-1 focus:ring-[#D26D53]"
            />
          </label>
          <button
            onClick={sendWeeklyTest}
            disabled={weeklySending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D2C28] hover:bg-[#3A3934] px-4 py-3 text-sm font-semibold text-[#FAF9F6] disabled:opacity-60 transition"
          >
            {weeklySending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
            Send test report
          </button>
        </div>
        {weeklyResult && (
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-[#2A2924] bg-[#161513] p-4 text-xs text-[#8A887F]">
            {JSON.stringify(weeklyResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
