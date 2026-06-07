import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { BACKEND_ORIGIN } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  FileSearch, PawPrint, Receipt, MessagesSquare,
  ArrowRight, ShieldCheck, Bell, Sparkles,
  HeartPulse, AlertTriangle, Clock,
  Wallet, Loader2, BadgeCheck, CalendarDays, CheckCircle2, X,
  PiggyBank, Stethoscope, ClipboardCheck, Scale, Save, RotateCcw,
  ChevronDown,
} from "lucide-react";
import SpendTrendsCard from "../components/SpendTrendsCard";
import { useBilling } from "../lib/billing";

const BACKEND = BACKEND_ORIGIN;

function getImageUrl(path) {
  if (!path) return "";
  return path.startsWith("/uploads") ? `${BACKEND}${path}` : path;
}

function sinceLabel(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const months = Math.round((Date.now() - d) / (1000 * 60 * 60 * 24 * 30.4));
  if (months < 1) return "Just joined";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} in your care`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} year${years === 1 ? "" : "s"} in your care`;
  return `${years}y ${rem}mo in your care`;
}

// ── Savings / value tracker banner ─────────────────────────────────────────────
function SavingsBanner() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/stats/savings").then(({ data }) => setData(data)).catch(() => {});
  }, []);
  if (!data || data.bills_reviewed === 0) return null;

  const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const headline = data.total_value_usd > 0
    ? `You've saved ${usd(data.total_value_usd)} with PetBill Shield`
    : `${usd(data.total_reviewed_usd)} in vet bills reviewed`;

  const stats = [
    { label: "Bills reviewed",     value: data.bills_reviewed,                 icon: FileSearch },
    { label: "Total reviewed",     value: usd(data.total_reviewed_usd),        icon: Wallet },
    { label: "Items flagged",      value: data.items_flagged,                  icon: ShieldCheck },
    ...(data.confirmed_savings_usd > 0
      ? [{ label: "Confirmed savings", value: usd(data.confirmed_savings_usd), icon: PiggyBank }]
      : []),
    ...(data.reimbursements_usd > 0
      ? [{ label: "Reimbursed", value: usd(data.reimbursements_usd), icon: BadgeCheck }]
      : []),
  ];

  return (
    <section className="rounded-[26px] border border-[#3A4142] bg-gradient-to-br from-[#1B231C] to-[#171C1C] p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <PiggyBank size={16} className="text-[#6FA56B]" />
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#6FA56B]">Your value</span>
      </div>
      <h3 className="font-serif-display text-2xl sm:text-3xl text-[#EFE8DA] leading-tight">
        {headline}
      </h3>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-[#3A4142] bg-[#11140F]/40 p-3">
            <Icon size={14} className="text-[#A6C48A] mb-1.5" />
            <div className="font-mono text-lg font-bold text-[#EFE8DA]">{value}</div>
            <div className="text-[11px] text-[#A8A196]">{label}</div>
          </div>
        ))}
      </div>
      {data.confirmed_savings_usd === 0 && (
        <p className="mt-3 text-xs text-[#A8A196]">
          Tip: open any analyzed bill and log what you actually paid — we'll track your real savings here.
        </p>
      )}
    </section>
  );
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date) ? null : date;
}

function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((target - start) / 86400000);
}

function monthKey(value = new Date()) {
  const date = parseDate(value) || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lineAmount(item) {
  return Number(item?.amount_usd ?? item?.cost_usd ?? item?.price_usd ?? item?.amount ?? 0) || 0;
}

function normalizeLineLabel(label = "") {
  return String(label)
    .toLowerCase()
    .replace(/\$?\d+(\.\d+)?/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(each|ea|qty|quantity|unit|total|estimate|invoice)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Onboarding checklist ──────────────────────────────────────────────────────
const ONBOARDING_KEY = "petbill_onboarding_done";

function OnboardingCard({ pets, estimates, reminders }) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === "1"
  );

  const steps = [
    {
      icon: PawPrint,
      label: "Add your first pet",
      desc:  "Create a profile in your pet vault so bills link to the right animal.",
      done:  pets.length > 0,
      to:    "/dashboard/pets",
      cta:   "Add a pet",
    },
    {
      icon: FileSearch,
      label: "Analyze your first bill",
      desc:  "Upload a vet invoice for a plain-English breakdown of every charge.",
      done:  estimates.length > 0,
      to:    "/dashboard/analyze",
      cta:   "Upload a bill",
    },
    {
      icon: Bell,
      label: "Set a care reminder",
      desc:  "Never miss a vaccination, medication refill, or annual checkup.",
      done:  reminders.length > 0,
      to:    "/dashboard/reminders",
      cta:   "Set a reminder",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone   = doneCount === 3;

  if (dismissed || allDone) return null;

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setDismissed(true);
  };

  return (
    <section>
      <div className="rounded-[28px] bg-white border border-[#E5E2D9] overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-[#D26D53] mb-1">Get started</div>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#2D2C28] leading-tight">
              3 steps to get the most out of PetBill Shield
            </h2>
            <p className="text-sm text-[#65635C] mt-1">
              {doneCount === 0
                ? "Let's set things up — it only takes a minute."
                : `${doneCount} of 3 complete — almost there.`}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-[#8A887F] hover:text-[#2D2C28] transition-colors shrink-0 p-1 -mr-1 -mt-1"
            aria-label="Dismiss guide"
          >
            <X size={16} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-6 pb-6">
          <div className="h-1.5 bg-[#F2F0E9] rounded-full mb-5">
            <div
              className="h-full bg-[#556045] rounded-full transition-all duration-700"
              style={{ width: `${(doneCount / 3) * 100}%` }}
            />
          </div>

          {/* Step cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {steps.map(({ icon: Icon, label, desc, done, to, cta }, idx) =>
              done ? (
                <div
                  key={idx}
                  className="rounded-[20px] p-4 bg-[#E8F5EC] border border-[#C8E8D4]"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-2xl bg-[#2F6B45] text-white flex items-center justify-center shrink-0">
                      <CheckCircle2 size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#2F6B45]">{label}</p>
                      <p className="text-xs text-[#556045] mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                  <p className="text-xs font-semibold text-[#2F6B45]">Done ✓</p>
                </div>
              ) : (
                <Link
                  key={idx}
                  to={to}
                  className="group rounded-[20px] p-4 bg-[#FAF9F6] border border-[#E5E2D9] hover:border-[#D26D53]/40 hover:bg-[#FFF9F7] transition-all block"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-2xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center shrink-0">
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#2D2C28]">{label}</p>
                      <p className="text-xs text-[#8A887F] mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-semibold text-[#D26D53] group-hover:gap-2 transition-all">
                    {cta} <ArrowRight size={11} />
                  </div>
                </Link>
              )
            )}
          </div>

          <p className="text-xs text-[#A7A29A] mt-4 text-center">
            You can dismiss this guide at any time — your progress is saved automatically.
          </p>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function DashboardHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { billing } = useBilling();
  const [stats, setStats]       = useState({ total_pets: 0, total_estimates: 0, total_claims: 0, annual_spent_usd: 0 });
  const [estimates, setEstimates] = useState([]);
  const [pets, setPets]           = useState([]);
  const [reminders, setReminders] = useState([]);
  const [claims, setClaims]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [expandedOverview, setExpandedOverview] = useState(null);
  const policyKey = user?.user_id ? `petbill_policy_tracker_${user.user_id}` : "petbill_policy_tracker";
  const [policyTracker, setPolicyTracker] = useState(null);
  const [policyDraft, setPolicyDraft] = useState({
    insurer: "",
    renewal_date: "",
    premium_usd: "",
    deductible_usd: "",
  });

  useEffect(() => { loadDashboard(); }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(policyKey) || "null");
      setPolicyTracker(saved);
      setPolicyDraft({
        insurer: saved?.insurer || "",
        renewal_date: saved?.renewal_date || "",
        premium_usd: saved?.premium_usd || "",
        deductible_usd: saved?.deductible_usd || "",
      });
    } catch {
      setPolicyTracker(null);
    }
  }, [policyKey]);

  async function loadDashboard() {
    try {
      setLoading(true);
      const [sR, eR, pR, rR, cR] = await Promise.allSettled([
        api.get("/stats/overview"),
        api.get("/estimates"),
        api.get("/pets"),
        api.get("/reminders"),
        api.get("/claims"),
      ]);
      if (sR.status === "fulfilled") setStats(sR.value.data || {});
      if (eR.status === "fulfilled") setEstimates(eR.value.data || []);
      if (pR.status === "fulfilled") setPets(pR.value.data || []);
      if (rR.status === "fulfilled") setReminders(rR.value.data || []);
      if (cR.status === "fulfilled") setClaims(cR.value.data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  function savePolicyTracker() {
    const next = {
      insurer: policyDraft.insurer.trim(),
      renewal_date: policyDraft.renewal_date,
      premium_usd: policyDraft.premium_usd,
      deductible_usd: policyDraft.deductible_usd,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(policyKey, JSON.stringify(next));
    setPolicyTracker(next);
  }

  function clearPolicyTracker() {
    localStorage.removeItem(policyKey);
    setPolicyTracker(null);
    setPolicyDraft({ insurer: "", renewal_date: "", premium_usd: "", deductible_usd: "" });
  }

  const firstName = (user?.name || "there").split(" ")[0];

  const upcoming = useMemo(() =>
    reminders
      .filter((r) => r.scheduled_for && new Date(r.scheduled_for) >= new Date())
      .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
      .slice(0, 4),
    [reminders]
  );

  const overdue = useMemo(() =>
    reminders.filter((r) => r.scheduled_for && new Date(r.scheduled_for) < new Date()),
    [reminders]
  );

  const recentEvents = useMemo(() => {
    const ests = estimates.map((e) => ({
      type: "analysis",
      title: e.pet_name ? `${e.pet_name}'s bill reviewed` : "Bill reviewed",
      desc: e.summary || "Analyzed by PetBill Shield.",
      date: e.created_at,
      amount: e.estimated_total_usd,
      to: `/dashboard/analyze/${e.analysis_id}`,
    }));
    const rems = upcoming.map((r) => ({
      type: "reminder",
      title: r.pet_name ? `${r.pet_name}: ${r.title}` : r.title,
      desc: r.message || "Upcoming care reminder.",
      date: r.scheduled_for,
      amount: null,
      to: "/dashboard/reminders",
    }));
    return [...rems, ...ests].filter((x) => x.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  }, [estimates, upcoming]);

  const attentionItems = useMemo(() => {
    const items = [];
    if (overdue.length > 0) {
      items.push({ icon: Bell, title: "Overdue care task", text: `${overdue[0].title} was due ${formatRelative(overdue[0].scheduled_for)}.`, tone: "alert", to: "/dashboard/reminders" });
    } else if (upcoming.length > 0) {
      items.push({ icon: Bell, title: "Reminder coming up", text: `${upcoming[0].pet_name || "A pet"}: ${upcoming[0].title} ${formatRelative(upcoming[0].scheduled_for)}.`, tone: "warm", to: "/dashboard/reminders" });
    }
    const urgent = estimates.find((e) => (e.urgent_now || []).length > 0 || (e.line_items || []).some((x) => x.urgency === "urgent"));
    if (urgent) {
      items.push({ icon: AlertTriangle, title: "Bill needs attention", text: urgent.pet_name ? `${urgent.pet_name} has urgent items to review.` : "One recent bill has urgent items.", tone: "alert", to: `/dashboard/analyze/${urgent.analysis_id}` });
    }
    if (Number(stats.annual_spent_usd || 0) > 0) {
      items.push({ icon: Wallet, title: "Spending tracked", text: `$${Number(stats.annual_spent_usd || 0).toLocaleString()} in pet care recorded this year.`, tone: "steady", to: "/dashboard/timeline" });
    }
    if (items.length === 0) {
      items.push({ icon: ShieldCheck, title: "All clear", text: "No urgent reminders or flagged bills right now.", tone: "steady", to: "/dashboard/analyze" });
    }
    return items.slice(0, 3);
  }, [upcoming, overdue, estimates, stats]);

  const claimDeadlines = useMemo(() => {
    return claims
      .filter((claim) => !claim.case_closed)
      .map((claim) => {
        const created = parseDate(claim.created_at) || new Date();
        const decision = (claim.decision?.outcome || claim.claim_status || "").toLowerCase();
        const isDenied = decision.includes("denied") || decision.includes("reject");
        const dueDate = isDenied
          ? new Date(created.getTime() + 30 * 86400000)
          : new Date(created.getTime() + 90 * 86400000);
        return {
          ...claim,
          deadline_type: isDenied ? "Appeal window" : "Claim filing",
          due_date: dueDate.toISOString(),
          days_left: daysUntil(dueDate.toISOString()),
        };
      })
      .sort((a, b) => a.days_left - b.days_left)
      .slice(0, 4);
  }, [claims]);

  const monthlySavings = useMemo(() => {
    const currentMonth = monthKey();
    const monthEstimates = estimates.filter((e) => monthKey(e.created_at) === currentMonth);
    const monthClaims = claims.filter((c) => monthKey(c.created_at) === currentMonth);
    const reimbursements = monthClaims.reduce(
      (sum, c) => sum + Number(c.actual_reimbursement_usd || c.estimated_reimbursement_usd || 0),
      0
    );
    const flaggedItems = monthEstimates.reduce(
      (sum, e) => sum + (e.red_flags || []).length + (e.cost_saving_options || []).length,
      0
    );
    const reviewedSpend = monthEstimates.reduce(
      (sum, e) => sum + Number(e.estimated_total_usd || 0),
      0
    );
    const estimatedAvoided = monthEstimates.reduce((sum, e) => {
      const lineTotal = (e.line_items || []).reduce((lineSum, item) => lineSum + lineAmount(item), 0);
      const flaggedRatio = Math.min(((e.red_flags || []).length + (e.cost_saving_options || []).length) * 0.025, 0.12);
      return sum + (lineTotal || Number(e.estimated_total_usd || 0)) * flaggedRatio;
    }, 0);
    return {
      analyses: monthEstimates.length,
      claims: monthClaims.length,
      reimbursements,
      flaggedItems,
      reviewedSpend,
      estimatedAvoided,
    };
  }, [estimates, claims]);

  const priceMemory = useMemo(() => {
    const entries = [];
    estimates.forEach((estimate) => {
      (estimate.line_items || []).forEach((item) => {
        const amount = lineAmount(item);
        const label = item.label || item.name || item.description || "";
        const normalized = normalizeLineLabel(label);
        if (!normalized || amount <= 0) return;
        entries.push({
          label,
          normalized,
          amount,
          pet_name: estimate.pet_name,
          date: estimate.created_at,
          category: item.category || "care item",
        });
      });
    });

    const grouped = entries.reduce((acc, item) => {
      acc[item.normalized] = acc[item.normalized] || [];
      acc[item.normalized].push(item);
      return acc;
    }, {});

    return Object.values(grouped)
      .map((group) => {
        const sorted = group.sort((a, b) => new Date(b.date) - new Date(a.date));
        const latest = sorted[0];
        const previous = sorted.slice(1);
        const previousAverage = previous.length
          ? previous.reduce((sum, item) => sum + item.amount, 0) / previous.length
          : null;
        const delta = previousAverage ? latest.amount - previousAverage : 0;
        return { latest, count: group.length, previousAverage, delta };
      })
      .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
      .slice(0, 5);
  }, [estimates]);

  const preventivePlan = useMemo(() => {
    const pending = reminders.filter((r) => r.status === "pending");
    return pets.slice(0, 3).map((pet) => {
      const petReminders = pending.filter((r) => r.pet_id === pet.pet_id);
      const hasWellness = petReminders.some((r) => /wellness|annual|exam/i.test(`${r.title} ${r.message}`));
      const hasDental = petReminders.some((r) => /dental|teeth|oral/i.test(`${r.title} ${r.message}`));
      const hasParasite = petReminders.some((r) => /heartworm|flea|tick|parasite/i.test(`${r.title} ${r.message}`));
      const suggestions = [
        !hasWellness && "Annual wellness exam",
        !hasDental && "Dental check",
        !hasParasite && "Flea/tick or heartworm refill",
      ].filter(Boolean);
      return { pet, reminders: petReminders.length, suggestions };
    });
  }, [pets, reminders]);

  const commandCenter = useMemo(() => {
    const renewalDays = daysUntil(policyTracker?.renewal_date);
    return [
      {
        icon: Bell,
        label: "Care due",
        value: overdue.length > 0 ? `${overdue.length} overdue` : `${upcoming.length} upcoming`,
        text: overdue.length > 0 ? "Review overdue tasks this month." : upcoming[0]?.title || "No care tasks due yet.",
        to: "/dashboard/reminders",
        tone: overdue.length > 0 ? "alert" : "steady",
      },
      {
        icon: Receipt,
        label: "Claims",
        value: `${claimDeadlines.length} active`,
        text: claimDeadlines[0]
          ? `${claimDeadlines[0].deadline_type} ${formatRelative(claimDeadlines[0].due_date)}.`
          : "No open claim deadlines.",
        to: "/dashboard/claims",
        tone: claimDeadlines.some((c) => c.days_left <= 14) ? "alert" : "steady",
      },
      {
        icon: CalendarDays,
        label: "Policy renewal",
        value: renewalDays == null ? "Not set" : renewalDays < 0 ? "Past due" : `${renewalDays} days`,
        text: policyTracker?.insurer ? `${policyTracker.insurer} renewal tracker.` : "Add your renewal date once.",
        to: "/dashboard",
        tone: renewalDays != null && renewalDays <= 30 ? "alert" : "steady",
      },
      {
        icon: PiggyBank,
        label: "This month",
        value: `$${money(monthlySavings.reimbursements + monthlySavings.estimatedAvoided)}`,
        text: `${monthlySavings.analyses} bills reviewed, ${monthlySavings.flaggedItems} savings signals.`,
        to: "/dashboard/analyze",
        tone: "steady",
      },
    ];
  }, [overdue, upcoming, claimDeadlines, policyTracker, monthlySavings]);

  if (loading) return (
    <div className="cream-card p-8 inline-flex items-center gap-3 text-sm text-[#65635C]">
      <Loader2 size={17} className="animate-spin" />
      Warming up your dashboard…
    </div>
  );

  const heroPhoto = pets.length > 0 ? getImageUrl(pets[0]?.picture) : null;

  return (
    <div className="space-y-3 pb-6" data-testid="dashboard-home">

      {/* ── Emotional hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-white min-h-[300px]">
        {heroPhoto && (
          <>
            <div className="absolute inset-0">
              <img src={heroPhoto} alt={pets[0]?.name} className="w-full h-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/20" />
          </>
        )}
        {!heroPhoto && (
          <div className="absolute inset-0 overflow-hidden opacity-[0.04]">
            <PawPrint size={380} className="absolute -right-12 -top-8" />
          </div>
        )}

        <div className="relative grid grid-cols-1 xl:grid-cols-12 gap-4 items-end p-5 sm:p-6 lg:p-8 min-h-[260px]">
          <div className="xl:col-span-8 flex flex-col justify-end">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-4 py-2 text-xs text-white/75 w-fit mb-3">
              <HeartPulse size={13} />
              {pets.length > 0 ? `${pets.length} pet${pets.length === 1 ? "" : "s"} in your care` : "Your care dashboard"}
            </div>

            <h1 className="font-serif-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95]">
              {pets.length > 0 ? (
                <>
                  {pets[0].name} and{" "}
                  {pets.length === 1
                    ? <span className="italic text-[#D26D53]">every moment</span>
                    : <span className="italic text-[#D26D53]">{pets.length - 1} other{pets.length > 2 ? "s" : ""}</span>
                  }
                  <br />are in good hands, {firstName}.
                </>
              ) : (
                <>Hi {firstName}, your{" "}
                  <span className="italic text-[#D26D53]">pet care story</span>
                  {" "}starts here.
                </>
              )}
            </h1>

            <p className="mt-3 text-white/65 max-w-2xl text-sm sm:text-base leading-relaxed">
              {upcoming.length > 0
                ? `${upcoming[0].pet_name || "A pet"} has an upcoming reminder: ${upcoming[0].title}.`
                : estimates.length > 0
                  ? "Your latest bill analyses are keeping your pets protected."
                  : "Upload your first bill or add a pet to begin."}
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/dashboard/analyze" className="bg-[#D26D53] hover:bg-[#BE5D45] text-white rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 transition-colors">
                Analyze a bill <ArrowRight size={16} />
              </Link>
              {pets.length === 0 && (
                <Link to="/dashboard/pets" className="bg-white/10 hover:bg-white/15 border border-white/15 text-white rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 transition-colors">
                  Add a pet <PawPrint size={16} />
                </Link>
              )}
              {upcoming.length > 0 && (
                <Link to="/dashboard/reminders" className="bg-white/10 hover:bg-white/15 border border-white/15 text-white rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 transition-colors">
                  View reminders <Bell size={16} />
                </Link>
              )}
            </div>
          </div>

          {attentionItems.length > 0 && (
            <div className="xl:col-span-4">
              <div className="rounded-[28px] bg-white/10 border border-white/10 backdrop-blur-md p-5">
                <div className="text-xs uppercase tracking-wide text-white/50 mb-4">Right now</div>
                <div className="space-y-3">
                  {attentionItems.map((item, i) => (
                    <Link key={i} to={item.to} className="block rounded-2xl bg-white/8 border border-white/10 p-4 hover:bg-white/12 transition">
                      <div className="flex items-start gap-3">
                        <item.icon size={15} className={item.tone === "alert" ? "text-[#D26D53]" : "text-[#E6AE2E]"} />
                        <div>
                          <div className="text-sm font-semibold">{item.title}</div>
                          <p className="text-xs text-white/55 mt-1 leading-relaxed">{item.text}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Savings / value tracker ───────────────────────────────── */}
      <SavingsBanner />

      {/* ── First-time onboarding checklist ───────────────────────── */}
      <OnboardingCard pets={pets} estimates={estimates} reminders={reminders} />

      <MonthlyCommandCenter items={commandCenter} billing={billing} />

      {pets.length > 0 && (
        <CompanionSummary pets={pets} reminders={reminders} />
      )}

      <MonthlySavingsReport report={monthlySavings} />

      <section className="space-y-2">
        <AccordionPanel
          id="insurance"
          icon={Receipt}
          title="Insurance deadlines"
          summary={
            claimDeadlines[0]
              ? `${claimDeadlines[0].deadline_type} ${formatRelative(claimDeadlines[0].due_date)}`
              : policyTracker?.renewal_date
                ? `Policy renewal ${formatRelative(policyTracker.renewal_date)}`
                : "Add a policy date or review claim windows"
          }
          openPanel={expandedOverview}
          setOpenPanel={setExpandedOverview}
        >
          <InsuranceDeadlineTracker
            policyDraft={policyDraft}
            setPolicyDraft={setPolicyDraft}
            policyTracker={policyTracker}
            onSave={savePolicyTracker}
            onClear={clearPolicyTracker}
            claimDeadlines={claimDeadlines}
          />
        </AccordionPanel>

        <AccordionPanel
          id="price-memory"
          icon={Scale}
          title="Vet price memory"
          summary={priceMemory.length ? `${priceMemory.length} repeat price signals` : "Build price history from itemized bills"}
          openPanel={expandedOverview}
          setOpenPanel={setExpandedOverview}
        >
          <VetPriceMemory items={priceMemory} />
        </AccordionPanel>

        <AccordionPanel
          id="preventive"
          icon={Stethoscope}
          title="Preventive care plan"
          summary={preventivePlan.length ? `${preventivePlan.reduce((sum, item) => sum + item.suggestions.length, 0)} routine care gaps` : "Add a pet to start a plan"}
          openPanel={expandedOverview}
          setOpenPanel={setExpandedOverview}
        >
          <PreventiveCarePlan plan={preventivePlan} />
        </AccordionPanel>

        <AccordionPanel
          id="activity"
          icon={Clock}
          title="Activity and shortcuts"
          summary={recentEvents.length ? `${recentEvents.length} recent care events` : "Quick links and spending trends"}
          openPanel={expandedOverview}
          setOpenPanel={setExpandedOverview}
        >
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:items-stretch">
            <div className="xl:col-span-7 flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <QuickAction icon={FileSearch}    title="Defend a bill"           subtitle="Upload a PDF, image, or paste line items for a plain-English breakdown."       to="/dashboard/analyze"   cta="Start analyzing" dark />
                <QuickAction icon={PawPrint}      title="Open the pet vault"      subtitle="Profiles, medications, vaccines, invoices, and complete care history."         to="/dashboard/pets"      cta="Manage pets" />
                <QuickAction icon={MessagesSquare} title="Write a vet script"     subtitle="Calm talking points for stressful conversations."                            to="/dashboard/scripts"   cta="Generate script" />
                <QuickAction icon={Receipt}       title="Insurance claim helper"  subtitle="Prepare reimbursement summaries and appeal language."                         to="/dashboard/claims"    cta="Open claims" />
              </div>
              <SpendTrendsCard className="flex-1" />
            </div>
            <div className="xl:col-span-5 flex flex-col gap-4">
              <CarePulseCard reminders={upcoming} overdue={overdue} />
              <RecentActivityCard events={recentEvents} />
              <InsightCard estimates={estimates} pets={pets} reminders={upcoming} stats={stats} className="flex-1" />
            </div>
          </section>
        </AccordionPanel>
      </section>

      {/* ── Safety disclaimer ─────────────────────────────────────── */}
      <section className="cream-card p-5 rounded-[28px]">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#556045] text-white inline-flex items-center justify-center shrink-0">
            <ShieldCheck size={16} />
          </span>
          <div>
            <h3 className="font-serif-display text-xl">A calm reminder.</h3>
            <p className="text-sm text-[#65635C] mt-0.5 leading-relaxed max-w-3xl">
              PetBill Shield helps you understand costs, organise records, and ask better questions. Your veterinarian remains your trusted medical partner.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AccordionPanel({ id, icon: Icon, title, summary, openPanel, setOpenPanel, children }) {
  const open = openPanel === id;
  return (
    <section className="rounded-[24px] border border-[#E5E2D9] bg-[#FAF9F6] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpenPanel(open ? null : id)}
        className="w-full px-4 sm:px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-white transition"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-10 h-10 rounded-2xl inline-flex items-center justify-center shrink-0 ${
            open ? "bg-[#2D2C28] text-white" : "bg-[#F2E5DE] text-[#D26D53]"
          }`}>
            <Icon size={17} />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm text-[#2D2C28]">{title}</div>
            <div className="text-xs text-[#65635C] truncate mt-0.5">{summary}</div>
          </div>
        </div>
        <ChevronDown
          size={17}
          className={`text-[#8A887F] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-[#E5E2D9] p-3 sm:p-4 bg-white/45">
          {children}
        </div>
      )}
    </section>
  );
}

function MonthlyCommandCenter({ items, billing }) {
  const planLabel = billing?.active ? billing.plan_label || "Premium" : "Free preview";
  return (
    <section className="rounded-[30px] bg-[#FAF9F6] border border-[#E5E2D9] overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-[#E5E2D9] flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Monthly command center</div>
          <h2 className="font-serif-display text-3xl leading-tight">What needs your attention this month</h2>
          <p className="text-sm text-[#65635C] mt-1 max-w-2xl">
            A premium snapshot of care tasks, claims, policy timing, and savings signals.
          </p>
        </div>
        <span className="w-fit inline-flex items-center gap-2 rounded-full bg-[#2D2C28] text-[#FAF9F6] px-3.5 py-2 text-xs font-semibold">
          <Sparkles size={13} /> {planLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4 sm:p-5">
        {items.map(({ icon: Icon, label, value, text, to, tone }) => (
          <Link
            key={label}
            to={to}
            className={`rounded-[22px] border p-4 transition hover:-translate-y-0.5 ${
              tone === "alert"
                ? "bg-[#FFF7F2] border-[#F2C5B7]"
                : "bg-white border-[#E5E2D9] hover:border-[#D26D53]/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={`w-10 h-10 rounded-2xl inline-flex items-center justify-center ${
                tone === "alert" ? "bg-[#D26D53] text-white" : "bg-[#F2E5DE] text-[#D26D53]"
              }`}>
                <Icon size={17} />
              </span>
              <ArrowRight size={14} className="text-[#C5C2BB]" />
            </div>
            <div className="eyebrow mt-4">{label}</div>
            <div className="font-serif-display text-3xl leading-tight mt-0.5">{value}</div>
            <p className="text-xs text-[#65635C] mt-1.5 leading-relaxed">{text}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function InsuranceDeadlineTracker({
  policyDraft,
  setPolicyDraft,
  policyTracker,
  onSave,
  onClear,
  claimDeadlines,
}) {
  const renewalDays = daysUntil(policyTracker?.renewal_date);
  return (
    <section className="cream-card rounded-[30px] p-5 sm:p-6 h-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Renewal and claim tracker</div>
          <h2 className="font-serif-display text-2xl leading-tight">Keep insurance deadlines visible</h2>
          <p className="text-sm text-[#65635C] mt-1 max-w-xl">
            Save the next policy renewal date and watch open claim or appeal windows from the overview.
          </p>
        </div>
        {policyTracker?.renewal_date && (
          <div className={`rounded-2xl px-4 py-3 text-sm font-semibold shrink-0 ${
            renewalDays != null && renewalDays <= 30
              ? "bg-[#FFF7F2] text-[#8C2D14] border border-[#F2C5B7]"
              : "bg-[#E7EBDD] text-[#556045] border border-[#B7C3A4]"
          }`}>
            {renewalDays < 0 ? "Renewal past due" : `${renewalDays} days to renewal`}
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <InputMini
          label="Insurer"
          value={policyDraft.insurer}
          onChange={(value) => setPolicyDraft((p) => ({ ...p, insurer: value }))}
          placeholder="Trupanion"
        />
        <InputMini
          label="Renewal"
          type="date"
          value={policyDraft.renewal_date}
          onChange={(value) => setPolicyDraft((p) => ({ ...p, renewal_date: value }))}
        />
        <InputMini
          label="Premium"
          type="number"
          value={policyDraft.premium_usd}
          onChange={(value) => setPolicyDraft((p) => ({ ...p, premium_usd: value }))}
          placeholder="42"
        />
        <InputMini
          label="Deductible"
          type="number"
          value={policyDraft.deductible_usd}
          onChange={(value) => setPolicyDraft((p) => ({ ...p, deductible_usd: value }))}
          placeholder="250"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onSave}
          className="rounded-xl bg-[#2D2C28] text-white px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#3F3E39] transition"
        >
          <Save size={13} /> Save tracker
        </button>
        {policyTracker && (
          <button
            onClick={onClear}
            className="rounded-xl border border-[#E5E2D9] bg-white px-4 py-2 text-xs font-semibold text-[#65635C] inline-flex items-center gap-2 hover:text-[#2D2C28] transition"
          >
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-[#E5E2D9] pt-4">
        <div className="text-sm font-semibold text-[#2D2C28] mb-3">Open claim windows</div>
        {claimDeadlines.length === 0 ? (
          <p className="text-sm text-[#65635C]">No active claim or appeal deadlines. New claim analyses will appear here automatically.</p>
        ) : (
          <div className="space-y-2">
            {claimDeadlines.map((claim) => (
              <Link
                key={claim.claim_id}
                to="/dashboard/claims"
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-4 py-3 hover:border-[#D26D53]/50 transition"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#2D2C28] truncate">
                    {claim.pet_name ? `${claim.pet_name} · ` : ""}{claim.insurer || "Insurance claim"}
                  </div>
                  <div className="text-xs text-[#65635C]">{claim.deadline_type} deadline</div>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 w-fit ${
                  claim.days_left <= 14 ? "bg-[#FFF4EE] text-[#D26D53]" : "bg-[#E7EBDD] text-[#556045]"
                }`}>
                  {claim.days_left < 0 ? "Past due" : `${claim.days_left} days left`}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MonthlySavingsReport({ report }) {
  const totalImpact = report.reimbursements + report.estimatedAvoided;
  const rows = [
    { label: "Bills reviewed", value: report.analyses },
    { label: "Savings signals", value: report.flaggedItems },
    { label: "Claims tracked", value: report.claims },
    { label: "Spend reviewed", value: `$${money(report.reviewedSpend)}` },
  ];

  return (
    <section className="rounded-[30px] bg-[#2D2C28] text-white p-5 sm:p-6 h-full overflow-hidden relative">
      <div className="absolute right-[-80px] bottom-[-90px] opacity-[0.06]">
        <PiggyBank size={280} />
      </div>
      <div className="relative">
        <div className="eyebrow text-[#E6AE2E] mb-1">Monthly savings report</div>
        <h2 className="font-serif-display text-2xl leading-tight">Value you can see</h2>
        <div className="mt-5">
          <div className="text-xs text-white/45">Estimated monthly impact</div>
          <div className="font-serif-display text-5xl mt-1">${money(totalImpact)}</div>
          <p className="text-sm text-white/55 mt-2 leading-relaxed">
            Includes estimated reimbursements plus potential savings signals found in analyzed bills.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {rows.map((row) => (
            <div key={row.label} className="rounded-2xl bg-white/8 border border-white/10 p-3">
              <div className="text-[11px] text-white/45">{row.label}</div>
              <div className="font-serif-display text-2xl mt-1">{row.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function VetPriceMemory({ items }) {
  return (
    <section className="cream-card rounded-[30px] p-5 sm:p-6 h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Vet price memory</div>
          <h2 className="font-serif-display text-2xl leading-tight">Know when repeat charges change</h2>
          <p className="text-sm text-[#65635C] mt-1">
            PetBill Shield remembers line-item prices from analyzed bills and surfaces changes over time.
          </p>
        </div>
        <span className="w-11 h-11 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center shrink-0">
          <Scale size={18} />
        </span>
      </div>

      <div className="mt-5 space-y-2">
        {items.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4">
            <p className="text-sm text-[#65635C]">
              Analyze a few itemized bills to build your personal price memory.
            </p>
            <Link to="/dashboard/analyze" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53]">
              Add a bill <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          items.map(({ latest, count, previousAverage, delta }) => (
            <div key={`${latest.normalized}-${latest.date}`} className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#2D2C28] truncate">{latest.label}</div>
                  <div className="text-xs text-[#65635C] mt-0.5">
                    {latest.pet_name || "Pet bill"} · seen {count} time{count === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <div className="font-serif-display text-2xl">${money(latest.amount)}</div>
                  {previousAverage ? (
                    <div className={`text-xs font-semibold ${delta > 0 ? "text-[#D26D53]" : delta < 0 ? "text-[#2F6B45]" : "text-[#65635C]"}`}>
                      {delta > 0 ? "+" : ""}${money(delta)} vs avg
                    </div>
                  ) : (
                    <div className="text-xs text-[#8A887F]">baseline saved</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PreventiveCarePlan({ plan }) {
  const openItems = plan.reduce((sum, item) => sum + item.suggestions.length, 0);
  return (
    <section className="cream-card rounded-[30px] p-5 sm:p-6 h-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Preventive care plan</div>
          <h2 className="font-serif-display text-2xl leading-tight">Keep routine care from sneaking up</h2>
          <p className="text-sm text-[#65635C] mt-1">
            Review missing wellness, dental, and refill reminders, then generate a starter plan in Reminders.
          </p>
        </div>
        <span className="w-11 h-11 rounded-2xl bg-[#E7EBDD] text-[#556045] inline-flex items-center justify-center shrink-0">
          <Stethoscope size={18} />
        </span>
      </div>

      <div className="mt-5 space-y-2">
        {plan.length === 0 ? (
          <p className="text-sm text-[#65635C]">Add a pet to create a preventive care plan.</p>
        ) : (
          plan.map(({ pet, reminders, suggestions }) => (
            <div key={pet.pet_id} className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#2D2C28]">{pet.name}</div>
                  <div className="text-xs text-[#65635C]">{reminders} pending reminder{reminders === 1 ? "" : "s"}</div>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                  suggestions.length ? "bg-[#FFF4EE] text-[#D26D53]" : "bg-[#E7EBDD] text-[#556045]"
                }`}>
                  {suggestions.length ? `${suggestions.length} gaps` : "covered"}
                </span>
              </div>
              {suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {suggestions.map((item) => (
                    <span key={item} className="rounded-full bg-white border border-[#E5E2D9] px-2.5 py-1 text-[11px] text-[#65635C]">
                      {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Link to="/dashboard/reminders" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#556045] text-white px-4 py-2.5 text-sm font-semibold hover:bg-[#49533C] transition">
        Build care plan <ClipboardCheck size={15} />
      </Link>
      {openItems > 0 && (
        <p className="mt-2 text-xs text-[#8A887F]">{openItems} starter reminder idea{openItems === 1 ? "" : "s"} found.</p>
      )}
    </section>
  );
}

function InputMini({ label, value, onChange, placeholder = "", type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8A887F]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-2xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
      />
    </label>
  );
}

function CompanionSummary({ pets, reminders }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="eyebrow mb-0.5">Your companions</div>
          <h2 className="font-serif-display text-2xl">The ones you protect</h2>
        </div>
        <Link to="/dashboard/pets" className="text-sm font-semibold text-[#D26D53] inline-flex items-center gap-1.5 hover:gap-2.5 transition-all">
          View all <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {pets.slice(0, 2).map((pet) => (
          <CompanionCard key={pet.pet_id} pet={pet} reminders={reminders} />
        ))}
        {pets.length > 2 && (
          <Link
            to="/dashboard/pets"
            className="cream-card rounded-[28px] p-5 flex flex-col items-center justify-center text-center hover:-translate-y-1 transition-all min-h-[160px]"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center mb-2">
              <PawPrint size={20} />
            </div>
            <div className="font-serif-display text-xl">+{pets.length - 2} more</div>
            <p className="text-xs text-[#65635C] mt-1">Open the pet vault</p>
          </Link>
        )}
      </div>
    </section>
  );
}

function CompanionCard({ pet, reminders }) {
  const imageUrl = getImageUrl(pet.picture);
  const since = sinceLabel(pet.created_at);
  const petReminders = reminders.filter((r) => r.pet_id === pet.pet_id && r.scheduled_for && new Date(r.scheduled_for) >= new Date());
  const overdueCount = reminders.filter((r) => r.pet_id === pet.pet_id && r.scheduled_for && new Date(r.scheduled_for) < new Date()).length;

  return (
    <Link
      to={`/dashboard/pets/${pet.pet_id}`}
      className="cream-card overflow-hidden rounded-[28px] group hover:-translate-y-1 transition-all duration-300 flex flex-col"
    >
      <div className="relative h-48 bg-[#2D2C28] overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={pet.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PawPrint size={60} className="text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="font-serif-display text-3xl text-white">{pet.name}</h3>
          <p className="text-xs text-white/65 mt-0.5 capitalize">
            {pet.species || "Pet"}{pet.breed ? ` · ${pet.breed}` : ""}
          </p>
        </div>
        {overdueCount > 0 && (
          <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[#D26D53] text-white text-xs font-bold flex items-center justify-center shadow-lg">
            {overdueCount}
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between">
        <div className="flex items-center justify-between">
          {since && (
            <span className="text-xs text-[#65635C]">{since}</span>
          )}
          {pet.age_years && (
            <span className="text-xs font-semibold text-[#2D2C28]">{pet.age_years}y old</span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            {petReminders.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] rounded-full bg-[#FFF4EE] text-[#D26D53] px-2.5 py-1 font-medium">
                <Bell size={10} /> {petReminders.length} upcoming
              </span>
            )}
            {pet.is_active !== false && (
              <span className="inline-flex items-center gap-1 text-[11px] rounded-full bg-[#E8F5EC] text-[#2F6B45] px-2.5 py-1 font-medium">
                <BadgeCheck size={10} /> Active
              </span>
            )}
          </div>
          <ArrowRight size={15} className="text-[#C5C2BB] group-hover:text-[#D26D53] transition-colors" />
        </div>
      </div>
    </Link>
  );
}

function CarePulseCard({ reminders, overdue }) {
  return (
    <section className="cream-card p-5 rounded-[30px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Care pulse</div>
          <h2 className="font-serif-display text-2xl leading-tight">What's coming up</h2>
        </div>
        <span className={`w-11 h-11 rounded-2xl inline-flex items-center justify-center ${overdue.length > 0 ? "bg-[#D26D53] text-white" : "bg-[#F2E5DE] text-[#D26D53]"}`}>
          <Bell size={19} />
        </span>
      </div>

      {overdue.length > 0 && (
        <div className="mt-3 rounded-2xl bg-[#FFF4EE] border border-[#F2C5B7] p-3 flex items-start gap-3">
          <AlertTriangle size={15} className="text-[#D26D53] shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-[#2D2C28]">{overdue.length} overdue</div>
            <p className="text-xs text-[#65635C] mt-0.5">{overdue[0].title} was due {formatRelative(overdue[0].scheduled_for)}.</p>
          </div>
          <Link to="/dashboard/reminders" className="ml-auto shrink-0 text-xs font-semibold text-[#D26D53]">Review</Link>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {reminders.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4">
            <p className="text-sm text-[#65635C] leading-relaxed">No upcoming reminders. Add vaccine, medication, or follow-up reminders to stay ahead of care.</p>
            <Link to="/dashboard/reminders" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53]">
              Add reminder <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          reminders.map((r) => (
            <Link
              key={r.reminder_id || `${r.title}-${r.scheduled_for}`}
              to="/dashboard/reminders"
              className="block rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4 hover:border-[#D26D53] transition"
            >
              <div className="flex items-start gap-3">
                <Clock size={16} className="text-[#D26D53] mt-0.5" />
                <div>
                  <div className="text-sm font-semibold">{r.title}</div>
                  <p className="text-xs text-[#65635C] mt-0.5">
                    {r.pet_name ? `${r.pet_name} · ` : ""}{formatRelative(r.scheduled_for)}
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function RecentActivityCard({ events }) {
  return (
    <section className="cream-card p-5 rounded-[30px]">
      <div className="eyebrow text-[#D26D53] mb-1">Recent movement</div>
      <h2 className="font-serif-display text-2xl leading-tight">Latest care events</h2>
      <div className="mt-3 space-y-2">
        {events.length === 0 ? (
          <p className="text-sm text-[#65635C]">No activity yet. Upload a bill or add a reminder to begin.</p>
        ) : (
          events.map((ev, i) => (
            <Link key={i} to={ev.to} className="block rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 hover:border-[#D26D53] transition">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-white border border-[#E5E2D9] inline-flex items-center justify-center shrink-0">
                  {ev.type === "reminder" ? <Bell size={14} className="text-[#D26D53]" /> : <FileSearch size={14} className="text-[#556045]" />}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{ev.title}</div>
                  <p className="text-xs text-[#65635C] mt-1 line-clamp-1">{ev.desc}</p>
                  <div className="text-[11px] text-[#8A887F] mt-1.5">
                    {ev.date ? new Date(ev.date).toLocaleDateString() : ""}
                    {ev.amount ? ` · $${Number(ev.amount).toFixed(2)}` : ""}
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function InsightCard({ estimates, pets, reminders, stats, className = "" }) {
  const insight =
    reminders.length > 0
      ? `You have ${reminders.length} upcoming care task${reminders.length === 1 ? "" : "s"}. Staying ahead keeps your pets healthier and your wallet calmer.`
      : estimates.length > 0
        ? "Your recent bill reviews are building a useful cost history — the more you add, the smarter the insights."
        : pets.length > 0
          ? "Your pet vault is ready. Add bills and reminders to unlock care patterns and spending trends."
          : "Start with one pet profile. Everything else becomes easier from there.";

  return (
    <section className={`rounded-[30px] bg-[#2D2C28] text-white p-5 relative overflow-hidden ${className}`}>
      <div className="absolute right-[-60px] top-[-60px] opacity-[0.06]">
        <Sparkles size={220} />
      </div>
      <div className="relative">
        <div className="eyebrow text-[#E6AE2E] mb-1">Smart insight</div>
        <h2 className="font-serif-display text-2xl leading-tight">A small thing worth noticing.</h2>
        <p className="mt-3 text-sm text-white/65 leading-relaxed">{insight}</p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-white/8 border border-white/10 p-4">
            <div className="text-xs text-white/45">Pets</div>
            <div className="font-serif-display text-3xl mt-1">{pets.length}</div>
          </div>
          <div className="rounded-2xl bg-white/8 border border-white/10 p-4">
            <div className="text-xs text-white/45">Spend</div>
            <div className="font-serif-display text-3xl mt-1">${Number(stats.annual_spent_usd || 0).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickAction({ icon: Icon, title, subtitle, to, cta, dark }) {
  return (
    <Link
      to={to}
      className={`rounded-[28px] p-5 flex flex-col justify-between group transition-all hover:-translate-y-1 duration-300 ${dark ? "bg-[#2D2C28] text-[#FAF9F6]" : "cream-card"}`}
    >
      <div>
        <span className={`w-11 h-11 rounded-2xl inline-flex items-center justify-center ${dark ? "bg-white/10" : "bg-[#F2E5DE]"}`}>
          <Icon size={19} strokeWidth={1.75} className={dark ? "text-white" : "text-[#D26D53]"} />
        </span>
        <h3 className="font-serif-display text-xl mt-3 leading-snug">{title}</h3>
        <p className={`text-sm mt-1.5 leading-relaxed ${dark ? "text-white/65" : "text-[#65635C]"}`}>{subtitle}</p>
      </div>
      <div className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${dark ? "text-[#E6AE2E]" : "text-[#D26D53]"}`}>
        {cta}
        <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function formatRelative(value) {
  if (!value) return "soon";
  const date = new Date(value);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (isNaN(diffMinutes)) return "soon";
  if (diffMinutes < -1440) return `${Math.round(Math.abs(diffMinutes) / 1440)} days ago`;
  if (diffMinutes < 0) return "recently";
  if (diffMinutes < 60) return `in ${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `in ${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  return `on ${date.toLocaleDateString()}`;
}
