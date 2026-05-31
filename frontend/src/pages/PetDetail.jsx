import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { BACKEND_ORIGIN } from "../lib/api";
import CsvImportButton from "../components/CsvImportButton";
import PetAskBox from "../components/PetAskBox";

import {
  ArrowLeft, Bell, Sparkles, Heart, ShieldCheck, Syringe, Pill,
  Receipt, Stethoscope, FlaskConical, StickyNote, Upload, Camera,
  Pencil, Plus, Trash2, Loader2, ChevronRight, Activity, Wallet,
  Clock3, Brain, AlertTriangle, CheckCircle2,
} from "lucide-react";

import { toast } from "sonner";

// ── Constants ─────────────────────────────────────────────────────────────────
const RECORD_TYPES = [
  { v: "vaccine",    label: "Vaccine",    icon: Syringe },
  { v: "medication", label: "Medication", icon: Pill },
  { v: "invoice",    label: "Invoice",    icon: Receipt },
  { v: "visit",      label: "Visit",      icon: Stethoscope },
  { v: "lab",        label: "Lab",        icon: FlaskConical },
  { v: "policy",     label: "Policy",     icon: ShieldCheck },
  { v: "note",       label: "Note",       icon: StickyNote },
];

const RECORD_COLORS = {
  vaccine:    { accent: "#2F6B45", soft: "#E8F5EC" },
  medication: { accent: "#245EA8", soft: "#EDF5FF" },
  invoice:    { accent: "#9B6500", soft: "#FFF4E6" },
  visit:      { accent: "#6B3FA0", soft: "#F3ECFF" },
  lab:        { accent: "#0F7474", soft: "#E6F9F9" },
  policy:     { accent: "#556045", soft: "#EEF2E6" },
  note:       { accent: "#65635C", soft: "#F2F0E9" },
  reminder:   { accent: "#D26D53", soft: "#FFF4EE" },
};

const BACKEND = BACKEND_ORIGIN;

function getImageUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  if (path.startsWith("/uploads")) return `${BACKEND}${path}`;
  const base = api.defaults.baseURL?.replace("/api", "") || BACKEND;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// ── Skeleton helper ───────────────────────────────────────────────────────────
function Sk({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-[#E8E4DB] ${className}`} />;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [pet, setPet] = useState(null);
  const [records, setRecords] = useState([]);
  const [loadingPrimary, setLoadingPrimary] = useState(true);
  const [loadingSecondary, setLoadingSecondary] = useState(true);
  const [uploadingBill, setUploadingBill] = useState(false);
  const [careScore, setCareScore] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [spending, setSpending] = useState(null);
  const [upcomingReminders, setUpcomingReminders] = useState([]);
  const [showEditPet, setShowEditPet] = useState(false);
  const [showAddRecord, setShowAddRecord] = useState(false);

  const load = useCallback(async () => {
    setLoadingPrimary(true);
    setLoadingSecondary(true);

    try {
      const [petRes, recordsRes] = await Promise.all([
        api.get(`/pets/${id}`),
        api.get(`/pets/${id}/records`),
      ]);
      setPet(petRes.data);
      setRecords(recordsRes.data || []);
    } catch (err) {
      console.error(err);
      toast.error("Could not load pet profile.");
    } finally {
      setLoadingPrimary(false);
    }

    Promise.allSettled([
      api.get(`/pets/${id}/care-score`),
      api.get(`/pets/${id}/ai-insights`),
      api.get(`/pets/${id}/spending-analytics`),
      api.get("/reminders"),
    ]).then(([scoreRes, insightRes, spendingRes, remindersRes]) => {
      if (scoreRes.status === "fulfilled")    setCareScore(scoreRes.value.data);
      if (insightRes.status === "fulfilled")  setAiInsights(insightRes.value.data);
      if (spendingRes.status === "fulfilled") setSpending(spendingRes.value.data);
      if (remindersRes.status === "fulfilled") {
        setUpcomingReminders(
          (remindersRes.value.data || [])
            .filter((r) => r.pet_id === id && new Date(r.scheduled_for) >= new Date())
            .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))
        );
      }
      setLoadingSecondary(false);
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const totalSpend = useMemo(() =>
    records
      .filter((r) => r.record_type === "invoice")
      .reduce((sum, r) => sum + (Number(r.amount_usd) || 0), 0),
  [records]);

  const vaccines = useMemo(() => records.filter((r) => r.record_type === "vaccine"), [records]);
  const meds     = useMemo(() => records.filter((r) => r.record_type === "medication"), [records]);

  async function uploadBillForPet(file) {
    if (!file) return;
    try {
      setUploadingBill(true);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("pet_id", id);
      fd.append("pet_name", pet?.name || "");
      fd.append("pet_species", pet?.species || "");

      const { data } = await api.post("/estimates/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      toast.success("Bill analyzed successfully.");

      try {
        const extraction = await api.post(`/pets/${id}/bill-intelligence/extract`, { analysis_id: data.analysis_id });
        await api.post(`/pets/${id}/bill-intelligence/save`, {
          records: extraction.data.extracted_records || [],
          reminders: extraction.data.suggested_reminders || [],
        });
        toast.success("Vaccines, medications, and reminders extracted.");
      } catch (err) {
        toast.error(err?.response?.data?.detail || "Bill analyzed, but extraction failed.");
      }

      await load();
      navigate(`/dashboard/analyze/${data.analysis_id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not analyze bill.");
    } finally {
      setUploadingBill(false);
    }
  }

  async function deleteRecord(recordId) {
    try {
      await api.delete(`/pets/${id}/records/${recordId}`);
      setRecords((prev) => prev.filter((r) => r.record_id !== recordId));
      toast.success("Record deleted.");
    } catch {
      toast.error("Could not delete record.");
    }
  }

  // ── Skeleton while primary data loads ──────────────────────────────────────
  if (loadingPrimary) {
    return (
      <div className="space-y-6 pb-24">
        <section className="rounded-[36px] border border-[#E5E2D9] min-h-[460px] bg-[#F6F1E8] p-8 lg:p-10 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <Sk className="h-8 w-32 rounded-full" />
            <div className="flex gap-2">
              <Sk className="h-9 w-28 rounded-xl" />
              <Sk className="h-9 w-16 rounded-xl" />
            </div>
          </div>
          <div className="space-y-4">
            <Sk className="h-4 w-44" />
            <Sk className="h-20 w-[380px] max-w-full rounded-2xl" />
            <Sk className="h-3 w-64" />
            <div className="flex gap-2 mt-2">
              <Sk className="h-8 w-28 rounded-full" />
              <Sk className="h-8 w-36 rounded-full" />
              <Sk className="h-8 w-32 rounded-full" />
            </div>
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-4">
          {[0,1,2].map(i => (
            <div key={i} className="rounded-[24px] p-5 border bg-[#FAF9F6] border-[#E5E2D9] space-y-3">
              <Sk className="h-3 w-20" /><Sk className="h-8 w-28" /><Sk className="h-3 w-36" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className="cream-card p-5 rounded-[24px] space-y-3">
              <Sk className="h-3 w-20" /><Sk className="h-10 w-16" /><Sk className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!pet) return <div className="cream-card p-8">Pet not found.</div>;

  const petImage = getImageUrl(pet.picture);

  return (
    <div className="relative space-y-6 pb-24">
      {petImage && (
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <img src={petImage} alt="" className="h-full w-full object-cover opacity-[0.06] blur-sm scale-110" />
          <div className="absolute inset-0 bg-[#FAF9F6]/92" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#FAF9F6]/60 via-[#FAF9F6]/96 to-[#FAF9F6]" />
        </div>
      )}

      <HeroSection
        pet={pet}
        petImage={petImage}
        totalSpend={totalSpend}
        uploadingBill={uploadingBill}
        uploadBillForPet={uploadBillForPet}
        aiInsights={aiInsights}
        onEdit={() => setShowEditPet(true)}
      />

      <TodayStrip
        reminders={upcomingReminders}
        meds={meds}
        totalSpend={totalSpend}
        loading={loadingSecondary}
      />

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <PremiumStat
          icon={Activity} label="Care score"
          value={loadingSecondary ? "—" : `${careScore?.score ?? 0}%`}
          subtitle={loadingSecondary ? "" : (careScore?.label || "Building profile")}
          loading={loadingSecondary}
        />
        <PremiumStat icon={Wallet}  label="Lifetime spend"      value={`$${totalSpend.toLocaleString()}`} subtitle="Across all records" />
        <PremiumStat icon={Pill}    label="Active medications"  value={meds.length}     subtitle="Currently tracked" />
        <PremiumStat icon={Syringe} label="Vaccines"            value={vaccines.length} subtitle="Stored in vault" />
      </section>

      <section className="grid xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-6">
          <AIInsightCard pet={pet} aiInsights={aiInsights} loading={loadingSecondary} />
          <HealthJourney spending={spending} loading={loadingSecondary} />
          <RecordsTimeline
            records={records}
            onDeleteRecord={deleteRecord}
            onAddRecord={() => setShowAddRecord(true)}
          />
          <PetAskBox petId={id} />
        </div>

        <div className="xl:col-span-4 space-y-6">
          <WellnessSidebar pet={pet} onEdit={() => setShowEditPet(true)} />
          <UpcomingCareCard reminders={upcomingReminders} loading={loadingSecondary} />
          <InsuranceCard pet={pet} />
        </div>
      </section>

      {showEditPet && (
        <EditPetModal
          pet={pet}
          onClose={() => setShowEditPet(false)}
          onSaved={() => { setShowEditPet(false); load(); }}
        />
      )}

      {showAddRecord && (
        <AddRecordModal
          petId={id}
          onClose={() => setShowAddRecord(false)}
          onSaved={() => { setShowAddRecord(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Hero section ──────────────────────────────────────────────────────────────
function HeroSection({ pet, petImage, totalSpend, uploadingBill, uploadBillForPet, aiInsights, onEdit }) {
  return (
    <section className="relative overflow-hidden rounded-[36px] border border-[#E5E2D9] min-h-[460px] bg-[#F6F1E8] shadow-sm">
      {petImage ? (
        <>
          <img src={petImage} alt={pet.name} className="absolute inset-0 w-full h-full object-cover scale-[1.02] opacity-20 blur-[1px]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#FAF9F6]/98 via-[#FAF9F6]/85 to-[#2D2C28]/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#2D2C28]/25 via-transparent to-transparent" />
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#D26D53]/20 blur-3xl" />
          <div className="absolute -bottom-24 left-20 h-80 w-80 rounded-full bg-[#556045]/20 blur-3xl" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-[#F7F1E8] via-[#FAF9F6] to-[#E7EBDD]" />
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#D26D53]/15 blur-3xl" />
          <div className="absolute -bottom-20 left-16 h-72 w-72 rounded-full bg-[#556045]/15 blur-3xl" />
        </>
      )}

      <div className="relative z-10 p-6 sm:p-8 lg:p-10 flex flex-col justify-between min-h-[460px]">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/dashboard/pets"
            className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 backdrop-blur px-4 py-2 text-xs text-[#65635C] hover:text-[#D26D53] transition-colors"
          >
            <ArrowLeft size={14} />
            Back to vault
          </Link>

          <div className="flex items-center gap-2">
            <label className="btn-primary rounded-xl px-4 py-2 text-sm inline-flex items-center gap-2 cursor-pointer shadow-sm">
              {uploadingBill
                ? <><Loader2 size={15} className="animate-spin" /> Analyzing…</>
                : <><Upload size={15} /> Upload bill</>
              }
              <input
                type="file"
                className="hidden"
                accept=".pdf,image/*"
                disabled={uploadingBill}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBillForPet(f); e.target.value = ""; }}
              />
            </label>

            <button
              onClick={onEdit}
              className="btn-ghost rounded-xl px-4 py-2 text-sm inline-flex items-center gap-2 bg-white/70 backdrop-blur"
            >
              <Pencil size={15} />
              Edit
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_290px] gap-8 items-end mt-10">
          <div className="max-w-3xl">
            <div className="eyebrow mb-3 capitalize">{pet.species} · {pet.breed || "Companion"}</div>

            <h1 className="font-serif-display text-6xl lg:text-7xl tracking-tight leading-none text-[#2D2C28] drop-shadow-sm">
              {pet.name}
            </h1>

            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[#2D2C28]/80">
              A calm, intelligent space for records, care tracking, reminders,
              insurance, medications, wellness trends, and long-term health insights.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <StatusPill color="green" label="Vaccines tracked" />
              <StatusPill color="amber" label="Follow-ups monitored" />
              <StatusPill color="blue"  label={`$${totalSpend.toLocaleString()} lifetime spend`} />
            </div>

            <div className="mt-7 max-w-2xl rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-2xl bg-[#D26D53] text-white flex items-center justify-center shrink-0">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-[#8A887F]">AI Care Insight</div>
                  <p className="mt-3 text-sm leading-relaxed text-[#65635C] max-w-3xl">
                    {aiInsights?.summary || "Add more records to unlock stronger AI care insights."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="rounded-[28px] border border-white/70 bg-white/65 backdrop-blur-xl p-4 shadow-sm">
              <div className="aspect-square overflow-hidden rounded-[24px] bg-[#F2F0E9] border border-[#E5E2D9]">
                {petImage ? (
                  <img src={petImage} alt={pet.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-[#D26D53]">
                    <Heart size={42} />
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <MiniInfo label="Weight"    value={pet.weight_lbs ? `${pet.weight_lbs} lbs` : "—"} />
                <MiniInfo label="Insurance" value={pet.insurance_provider || "None"} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Today strip ───────────────────────────────────────────────────────────────
function TodayStrip({ reminders, meds, totalSpend, loading }) {
  const nextReminder = reminders?.[0];
  const nextMed      = meds?.[0];

  return (
    <section className="grid lg:grid-cols-3 gap-4">
      <TodayCard
        icon={Bell}
        title="Next reminder"
        value={loading ? "—" : (nextReminder?.title || "No reminder")}
        subtitle={loading ? "" : (nextReminder?.scheduled_for ? formatDate(nextReminder.scheduled_for) : "Nothing urgent right now")}
        urgent={!loading && !!nextReminder}
        loading={loading}
      />
      <TodayCard
        icon={Pill}
        title="Medication"
        value={loading ? "—" : (nextMed?.title || "No active med")}
        subtitle={loading ? "" : (nextMed?.date || "Add medications from records or bill extraction")}
        loading={loading}
      />
      <TodayCard
        icon={Receipt}
        title="Care spend"
        value={`$${Number(totalSpend || 0).toLocaleString()}`}
        subtitle="Tracked from saved invoices"
      />
    </section>
  );
}

// ── AI insight card ───────────────────────────────────────────────────────────
function AIInsightCard({ pet, aiInsights, loading }) {
  return (
    <section className="cream-card p-7 rounded-[28px]">
      <div className="flex items-center gap-2 text-[#D26D53]">
        <Brain size={17} />
        <div className="eyebrow">AI wellness summary</div>
      </div>

      <h2 className="font-serif-display text-3xl mt-3">{pet.name}'s health story</h2>

      {loading ? (
        <div className="space-y-2 mt-5">
          <Sk className="h-4 w-full" />
          <Sk className="h-4 w-5/6" />
          <Sk className="h-4 w-3/4" />
        </div>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-[#65635C] max-w-3xl">
          {aiInsights?.summary || "No AI insights yet. Upload bills or add records to generate health insights."}
        </p>
      )}

      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <InsightMiniCard title="Skin irritation trend"   subtitle="Observed when records support it" icon={AlertTriangle} />
        <InsightMiniCard title="Healthy visit cadence"   subtitle="Preventive care is tracked here"  icon={CheckCircle2} />
        <InsightMiniCard title="Projected monthly spend" subtitle="Improves as invoices are added"   icon={Wallet} />
      </div>
    </section>
  );
}

// ── Health journey ────────────────────────────────────────────────────────────
function HealthJourney({ spending, loading }) {
  return (
    <section className="cream-card p-7 rounded-[28px]">
      <div className="eyebrow mb-2 text-[#D26D53]">Health journey</div>
      <h2 className="font-serif-display text-3xl">Care trends over time</h2>
      <div className="mt-7 grid lg:grid-cols-3 gap-4">
        <JourneyCard title="Weight trend"        value="—"  subtitle="Weight history coming soon" />
        <JourneyCard title="Urgent visits"       value="—"  subtitle="Based on visit and invoice history" />
        <JourneyCard
          title="Monthly care spend"
          value={loading ? "—" : `$${Number(spending?.average_monthly_spend_usd || 0).toFixed(0)}/mo`}
          subtitle="Mostly preventive care"
        />
      </div>
    </section>
  );
}

function JourneyCard({ title, value, subtitle }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-5">
      <div className="text-sm text-[#8A887F]">{title}</div>
      <div className="font-serif-display text-4xl mt-3">{value}</div>
      <div className="text-xs text-[#65635C] mt-2 leading-relaxed">{subtitle}</div>
    </div>
  );
}

// ── Records timeline ──────────────────────────────────────────────────────────
const RECORDS_PAGE = 5;

function RecordsTimeline({ records, onDeleteRecord, onAddRecord }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? records : records.slice(0, RECORDS_PAGE);
  const hidden = records.length - RECORDS_PAGE;

  return (
    <section className="cream-card rounded-[28px] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-7 pt-7 pb-5">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Timeline</div>
          <h2 className="font-serif-display text-3xl">Care history</h2>
        </div>
        <button
          onClick={onAddRecord}
          className="btn-primary rounded-xl px-4 py-2 text-sm inline-flex items-center gap-2 shrink-0"
        >
          <Plus size={15} />
          Add record
        </button>
      </div>

      <div className="mx-7 border-t border-[#E5E2D9]" />

      {records.length === 0 ? (
        <div className="px-7 py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#F2F0E9] flex items-center justify-center mx-auto mb-4 text-[#B8B4AC]">
            <StickyNote size={22} />
          </div>
          <p className="text-sm font-semibold text-[#2D2C28]">No records yet</p>
          <p className="text-xs text-[#8A887F] mt-1 max-w-xs mx-auto">
            Upload a bill or click "Add record" to start building the care timeline.
          </p>
        </div>
      ) : (
        <>
          <div className="px-7 py-5 space-y-3">
            {shown.map((record) => {
              const Icon   = RECORD_TYPES.find((x) => x.v === record.record_type)?.icon || StickyNote;
              const colors = RECORD_COLORS[record.record_type] || RECORD_COLORS.note;
              return (
                <div
                  key={record.record_id}
                  className="group rounded-2xl border border-[#E5E2D9] bg-white/70 overflow-hidden hover:shadow-md hover:-translate-y-px transition-all duration-200"
                >
                  <div className="flex">
                    <div className="w-1 shrink-0" style={{ background: colors.accent }} />
                    <div className="flex-1 p-4 flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: colors.soft, color: colors.accent }}
                        >
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-2">
                            <h3 className="font-semibold text-sm text-[#2D2C28]">{record.title}</h3>
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{ background: colors.soft, color: colors.accent }}
                            >
                              {record.record_type}
                            </span>
                          </div>
                          {record.details && (
                            <p className="mt-1.5 text-sm leading-relaxed text-[#65635C] line-clamp-2">
                              {record.details}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-3 text-xs text-[#8A887F]">
                            {record.date && <span>{formatDate(record.date)}</span>}
                            {record.amount_usd != null && (
                              <span className="font-semibold text-[#2D2C28]">
                                ${Number(record.amount_usd).toFixed(2)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => onDeleteRecord?.(record.record_id)}
                        className="opacity-0 group-hover:opacity-100 mt-0.5 text-[#B8B4AC] hover:text-[#8C2D14] transition-all"
                        title="Delete record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show more / show less */}
          {records.length > RECORDS_PAGE && (
            <div className="border-t border-[#E5E2D9] px-7 py-3">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="w-full flex items-center justify-center gap-2 text-sm font-medium text-[#65635C] hover:text-[#2D2C28] transition-colors py-1"
              >
                {showAll ? (
                  <>Show less <ChevronRight size={14} className="-rotate-90" /></>
                ) : (
                  <>See all {records.length} records <ChevronRight size={14} className="rotate-90" /></>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Wellness sidebar ──────────────────────────────────────────────────────────
function WellnessSidebar({ pet, onEdit }) {
  return (
    <div className="space-y-5">
      <section className="cream-card p-6 rounded-[28px]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Heart size={16} className="text-[#D26D53]" />
            <div className="eyebrow">Wellness snapshot</div>
          </div>
          <button
            onClick={onEdit}
            className="text-xs text-[#8A887F] hover:text-[#D26D53] inline-flex items-center gap-1 transition-colors"
          >
            <Pencil size={12} />
            Edit
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <SidebarRow label="Species"    value={pet.species || "Unknown"} />
          <SidebarRow label="Breed"      value={pet.breed || "Unknown"} />
          <SidebarRow label="Insurance"  value={pet.insurance_provider || "None"} />
          <SidebarRow label="Vet clinic" value={pet.vet_clinic_name || "Not added"} />
          <SidebarRow label="Weight"     value={pet.weight_lbs ? `${pet.weight_lbs} lbs` : "Unknown"} />
          {pet.sex      && <SidebarRow label="Sex"      value={pet.sex} />}
          {pet.birthday && <SidebarRow label="Birthday" value={formatDate(pet.birthday)} />}
        </div>
      </section>
    </div>
  );
}

// ── Upcoming care card ────────────────────────────────────────────────────────
function UpcomingCareCard({ reminders, loading }) {
  return (
    <section className="cream-card p-6 rounded-[28px]">
      <div className="flex items-center gap-2 mb-4">
        <Clock3 size={16} className="text-[#D26D53]" />
        <div className="eyebrow">Upcoming care</div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <><Sk className="h-16 rounded-2xl" /><Sk className="h-16 rounded-2xl" /></>
        ) : reminders?.length ? (
          reminders.slice(0, 4).map((r) => (
            <ReminderRow
              key={r.reminder_id || r.title}
              title={r.title || "Care reminder"}
              subtitle={r.scheduled_for ? formatDate(r.scheduled_for) : "No date"}
            />
          ))
        ) : (
          <ReminderRow title="No upcoming care" subtitle="Generated reminders will appear here" />
        )}
      </div>
    </section>
  );
}

// ── Insurance card ────────────────────────────────────────────────────────────
function InsuranceCard({ pet }) {
  const navigate = useNavigate();
  return (
    <section className="cream-card p-6 rounded-[28px]">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={16} className="text-[#556045]" />
        <div className="eyebrow">Insurance intelligence</div>
      </div>

      <div className="rounded-2xl bg-[#F8F5EE] border border-[#E5E2D9] p-4">
        <div className="text-sm font-semibold">
          {pet.insurance_provider || "No insurance connected"}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[#65635C]">
          Track reimbursements, analyze invoices, and generate AI-powered appeal drafts.
        </p>
        <button
          onClick={() => navigate("/dashboard/claims")}
          className="mt-4 text-sm font-semibold text-[#D26D53] inline-flex items-center gap-1.5 hover:gap-2.5 transition-all"
        >
          Open claims
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}

// ── Primitive components ──────────────────────────────────────────────────────
function PremiumStat({ icon: Icon, label, value, subtitle, loading }) {
  return (
    <div className="cream-card p-5 rounded-[24px] hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">{label}</div>
          {loading
            ? <Sk className="h-10 w-16 mt-2" />
            : <div className="font-serif-display text-4xl mt-2">{value}</div>
          }
          <div className="text-xs text-[#8A887F] mt-2">
            {loading ? <Sk className="h-3 w-20 mt-1" /> : subtitle}
          </div>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-[#FAF7F1] border border-[#E5E2D9] flex items-center justify-center text-[#556045] shrink-0">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function TodayCard({ icon: Icon, title, value, subtitle, urgent, loading }) {
  return (
    <div className={`rounded-[24px] p-5 border transition-shadow hover:shadow-md ${urgent ? "bg-[#FFF4EE] border-[#F2C5B7]" : "bg-[#FAF9F6] border-[#E5E2D9]"}`}>
      <div className="flex items-center gap-2 text-[#D26D53]">
        <Icon size={16} />
        <div className="eyebrow">{title}</div>
      </div>
      {loading
        ? <Sk className="h-8 w-32 mt-4" />
        : <div className="font-serif-display text-3xl mt-4 leading-tight line-clamp-2">{value}</div>
      }
      <div className="text-sm text-[#65635C] mt-2 line-clamp-2">
        {loading ? <Sk className="h-3 w-40 mt-1" /> : subtitle}
      </div>
    </div>
  );
}

function StatusPill({ label, color }) {
  const styles = {
    green: "bg-[#E8F5EC] text-[#2F6B45]",
    amber: "bg-[#FFF4E6] text-[#9B6500]",
    blue:  "bg-[#EDF5FF] text-[#245EA8]",
  };
  return (
    <span className={`px-4 py-2 rounded-full text-xs font-medium ${styles[color]}`}>{label}</span>
  );
}

function InsightMiniCard({ icon: Icon, title, subtitle }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-4 hover:bg-white/80 transition-colors">
      <Icon size={16} className="text-[#D26D53]" />
      <div className="font-semibold text-sm mt-3">{title}</div>
      <div className="text-xs text-[#65635C] mt-1 leading-relaxed">{subtitle}</div>
    </div>
  );
}

function SidebarRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#ECE7DD] pb-3 last:border-0 last:pb-0">
      <span className="text-[#8A887F] shrink-0">{label}</span>
      <span className="font-medium text-right truncate">{value}</span>
    </div>
  );
}

function ReminderRow({ title, subtitle }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-4 hover:bg-white/80 transition-colors">
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-[#65635C] mt-1">{subtitle}</div>
    </div>
  );
}

function MiniInfo({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#8A887F]">{label}</div>
      <div className="mt-1 text-xs font-semibold text-[#2D2C28] truncate">{value}</div>
    </div>
  );
}

// ── Edit pet modal ────────────────────────────────────────────────────────────
function EditPetModal({ pet, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:                    pet.name || "",
    species:                 pet.species || "dog",
    breed:                   pet.breed || "",
    age_years:               pet.age_years ?? "",
    weight_lbs:              pet.weight_lbs ?? "",
    sex:                     pet.sex || "",
    insurance_provider:      pet.insurance_provider || "",
    insurance_policy_number: pet.insurance_policy_number || "",
    vet_clinic_name:         pet.vet_clinic_name || "",
    vet_clinic_phone:        pet.vet_clinic_phone || "",
    notes:                   pet.notes || "",
    birthday:                pet.birthday || "",
  });
  const [saving, setSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(getImageUrl(pet.picture));
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentPicture, setCurrentPicture] = useState(pet.picture || "");

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setUploadingPhoto(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post(`/pets/${pet.pet_id}/picture`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (data?.picture) setCurrentPicture(data.picture);
      toast.success("Photo updated.");
    } catch {
      toast.error("Could not upload photo.");
      setPhotoPreview(getImageUrl(pet.picture));
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required."); return; }
    setSaving(true);
    try {
      await api.put(`/pets/${pet.pet_id}`, {
        ...form,
        picture:    currentPicture,
        age_years:  form.age_years  !== "" ? Number(form.age_years)  : null,
        weight_lbs: form.weight_lbs !== "" ? Number(form.weight_lbs) : null,
        chronic_conditions: pet.chronic_conditions || [],
      });
      toast.success("Pet updated.");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40";
  const labelCls = "text-xs text-[#8A887F] uppercase tracking-wide";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-[28px] bg-[#FAF9F6] border border-[#E5E2D9] shadow-2xl overflow-y-auto max-h-[90vh]">
        <form onSubmit={handleSubmit} className="p-7 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif-display text-2xl">Edit {pet.name}</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#F2F0E9] hover:bg-[#E5E2D9] flex items-center justify-center text-[#65635C] transition-colors text-sm"
            >
              ✕
            </button>
          </div>

          {/* Photo upload */}
          <div className="flex flex-col items-center gap-2 py-1">
            <label className="relative group cursor-pointer">
              <div className="w-24 h-24 rounded-[22px] overflow-hidden border-2 border-[#E5E2D9] bg-[#F2F0E9] ring-2 ring-offset-2 ring-transparent group-hover:ring-[#D26D53]/50 transition-all duration-200">
                {photoPreview ? (
                  <img src={photoPreview} alt={pet.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#D26D53]">
                    <Heart size={28} />
                  </div>
                )}
                <div className="absolute inset-0 rounded-[22px] bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  {uploadingPhoto
                    ? <Loader2 size={18} className="text-white animate-spin" />
                    : <Camera size={18} className="text-white" />
                  }
                </div>
              </div>
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={handlePhotoChange}
                disabled={uploadingPhoto}
              />
            </label>
            <p className="text-xs text-[#8A887F]">Click photo to change</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Name *</label>
              <input value={form.name} onChange={set("name")} required className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Species</label>
              <select value={form.species} onChange={set("species")} className={inputCls}>
                {["dog","cat","rabbit","bird","reptile","horse","exotic"].map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Breed</label>
              <input value={form.breed} onChange={set("breed")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Age (years)</label>
              <input type="number" min="0" step="0.1" value={form.age_years} onChange={set("age_years")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Weight (lbs)</label>
              <input type="number" min="0" step="0.1" value={form.weight_lbs} onChange={set("weight_lbs")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Sex</label>
              <input value={form.sex} onChange={set("sex")} placeholder="M / F / Neutered…" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Birthday</label>
              <input type="date" value={form.birthday} onChange={set("birthday")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Insurance provider</label>
              <input value={form.insurance_provider} onChange={set("insurance_provider")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Policy number</label>
              <input value={form.insurance_policy_number} onChange={set("insurance_policy_number")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Vet clinic</label>
              <input value={form.vet_clinic_name} onChange={set("vet_clinic_name")} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Vet phone</label>
              <input value={form.vet_clinic_phone} onChange={set("vet_clinic_phone")} className={inputCls} />
            </div>

            <div className="col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea value={form.notes} onChange={set("notes")} rows={3} className={`${inputCls} resize-none`} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-2">
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Helpers for AddRecordModal ────────────────────────────────────────────────

/**
 * Infer the best record_type from an analyze response.
 * Looks at summary text + line_item labels/categories.
 */
function guessRecordType(data) {
  const text = [
    data.summary || "",
    ...(data.line_items || []).map(li =>
      [li.label, li.description, li.category, li.notes].filter(Boolean).join(" ")
    ),
  ].join(" ").toLowerCase();

  if (/\b(vaccine|vaccination|booster|rabies|distemper|bordetella|lepto|feline|core vaccine)\b/.test(text))
    return "vaccine";
  if (/\b(cbc|blood panel|bloodwork|blood work|urinalysis|x-ray|xray|radiograph|ultrasound|cytolog|biopsy|histopath|heartworm test|fecal|pcr|culture|titer|chemistry panel|thyroid|t4|idexx|antech)\b/.test(text))
    return "lab";
  if (/\b(prescription|medication|tablet|capsule|antibiotic|prednisone|metronidazole|apoquel|rimadyl|gabapentin|amoxicillin|fluoxetine|onsior|refill|dispense|dosage|dose|mg|ml)\b/.test(text))
    return "medication";
  if (/\b(exam|wellness|checkup|check-up|annual|physical|consult|office visit|follow.?up|recheck|appointment)\b/.test(text))
    return "visit";
  if (data.estimated_total_usd != null || /\b(invoice|total due|balance|payment|charge)\b/.test(text))
    return "invoice";
  return "note";
}

/**
 * Try to extract type-specific detail fields from line_items.
 * Returns an extras object compatible with EXTRA_FIELDS keys.
 */
function guessExtras(data, recordType) {
  const items = data.line_items || [];
  const allText = items.map(li =>
    [li.label, li.description, li.notes].filter(Boolean).join(" ")
  ).join(" ");

  const extras = {};

  if (recordType === "medication") {
    const dosageMatch = allText.match(/(\d+\s*mg|\d+\s*ml|\d+\s*mcg|\d+\s*µg)/i);
    if (dosageMatch) extras.dosage = dosageMatch[0];
    const freqMatch = allText.match(/\b(once|twice|every \d+ hours?|daily|bid|sid|tid|qid)\b/i);
    if (freqMatch) extras.frequency = freqMatch[0];
  }

  if (recordType === "vaccine") {
    const byMatch = allText.match(/(?:by|administered by|given by)[:\s]+([A-Z][a-zA-Z.\s]{2,30})/i);
    if (byMatch) extras.administered_by = byMatch[1].trim();
  }

  if (recordType === "lab") {
    // Pull first result-like phrase
    const resultMatch = allText.match(/\b(normal|abnormal|negative|positive|within (reference )?range|elevated|low|high)\b/i);
    if (resultMatch) extras.result = resultMatch[0];
  }

  if (recordType === "visit") {
    const clinicItem = items.find(li => /clinic|hospital|vet|dr\b|doctor/i.test([li.label, li.notes].join(" ")));
    if (clinicItem) extras.vet_name = clinicItem.label;
    const reasonMatch = allText.match(/(?:for|reason)[:\s]+([A-Za-z\s,]{4,60})/i);
    if (reasonMatch) extras.reason = reasonMatch[1].trim();
  }

  return extras;
}

// ── Add record modal ──────────────────────────────────────────────────────────
const EXTRA_FIELDS = {
  vaccine:    [{ k: "administered_by", label: "Administered by", ph: "Dr. Smith" }, { k: "next_due_date", label: "Next due date", type: "date" }],
  medication: [{ k: "dosage", label: "Dosage", ph: "10mg once daily" }, { k: "frequency", label: "Frequency", ph: "Every 24 hours" }],
  visit:      [{ k: "vet_name", label: "Vet / Clinic", ph: "City Animal Hospital" }, { k: "reason", label: "Reason for visit", ph: "Annual wellness" }],
  lab:        [{ k: "result", label: "Result", ph: "Normal / Abnormal" }, { k: "reference_range", label: "Reference range", ph: "3.5–5.0 mg/dL" }],
  policy:     [{ k: "provider", label: "Insurer", ph: "Trupanion" }, { k: "policy_type", label: "Coverage type", ph: "Accident + illness" }],
  invoice:    [{ k: "provider", label: "Provider / Clinic", ph: "City Vet Clinic" }],
};

function AddRecordModal({ petId, onClose, onSaved }) {
  const [form, setForm] = useState({
    record_type: "note",
    title:       "",
    date:        "",
    amount_usd:  "",
    details:     "",
    category:    "other",
  });
  const [extras, setExtras] = useState({});
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [policyFile, setPolicyFile] = useState(null);
  const [policyText, setPolicyText] = useState("");
  const [analyzingPolicy, setAnalyzingPolicy] = useState(false);

  const set       = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const setExtra  = (k) => (e) => setExtras((p) => ({ ...p, [k]: e.target.value }));
  const colors    = RECORD_COLORS[form.record_type] || RECORD_COLORS.note;
  const TypeIcon  = RECORD_TYPES.find((t) => t.v === form.record_type)?.icon || StickyNote;
  const typeFields = EXTRA_FIELDS[form.record_type] || [];

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    const fd = new FormData();
    fd.append("file", file);
    if (petId) fd.append("pet_id", petId);
    try {
      const { data } = await api.post("/estimates/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const detectedType = guessRecordType(data);
      const detectedExtras = guessExtras(data, detectedType);

      // Build details from line items
      const lineDetails = (data.line_items || [])
        .map((li) => {
          const label = li.label || li.description || li.name || "";
          const amt   = li.amount_usd ?? li.amount ?? li.price;
          return amt != null ? `• ${label}: $${Number(amt).toFixed(2)}` : `• ${label}`;
        })
        .filter(Boolean)
        .join("\n");

      setForm((p) => ({
        ...p,
        record_type: detectedType,
        title:       !p.title && data.summary ? data.summary.slice(0, 120) : p.title,
        amount_usd:  data.estimated_total_usd != null ? String(data.estimated_total_usd) : p.amount_usd,
        details:     lineDetails || p.details,
        category:    detectedType === "invoice" ? "medical" : p.category,
      }));

      if (Object.keys(detectedExtras).length > 0) {
        setExtras((p) => ({ ...p, ...detectedExtras }));
      }

      const typeLabel = RECORD_TYPES.find((t) => t.v === detectedType)?.label || detectedType;
      toast.success(`Detected as ${typeLabel} — review and save.`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not extract from document.");
    } finally {
      setExtracting(false);
      e.target.value = "";
    }
  }

  async function analyzeAndSavePolicy() {
    if (!policyText.trim() && !policyFile) {
      toast.error("Add policy text or upload a PDF policy first.");
      return;
    }
    setAnalyzingPolicy(true);
    try {
      const fd = new FormData();
      if (form.title.trim()) fd.append("title", form.title.trim());
      if (extras.provider?.trim()) fd.append("insurer", extras.provider.trim());
      if (policyText.trim()) fd.append("policy_text", policyText.trim());
      if (policyFile) fd.append("policy_file", policyFile);

      await api.post(`/pets/${petId}/policy/analyze`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      toast.success("Policy analyzed and saved to pet records.");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not analyze policy.");
    } finally {
      setAnalyzingPolicy(false);
    }
  }

  function buildDetails() {
    const parts = [];
    typeFields.forEach(({ k, label }) => {
      if (extras[k]?.trim()) parts.push(`${label}: ${extras[k].trim()}`);
    });
    if (form.details.trim()) parts.push(form.details.trim());
    return parts.join("\n");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required."); return; }
    setSaving(true);
    try {
      await api.post(`/pets/${petId}/records`, {
        ...form,
        details:    buildDetails(),
        amount_usd: form.amount_usd !== "" ? Number(form.amount_usd) : null,
        metadata: form.record_type === "policy" ? { provider: extras.provider || "", policy_type: extras.policy_type || "" } : {},
      });
      toast.success("Record added.");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not add record.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "mt-1 w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40";
  const labelCls = "text-xs text-[#8A887F] uppercase tracking-wide";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-[28px] bg-[#FAF9F6] border border-[#E5E2D9] shadow-2xl overflow-y-auto max-h-[90vh]">
        <form onSubmit={handleSubmit} className="p-7 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200"
                style={{ background: colors.soft, color: colors.accent }}
              >
                <TypeIcon size={18} />
              </div>
              <h2 className="font-serif-display text-2xl">Add record</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#F2F0E9] hover:bg-[#E5E2D9] flex items-center justify-center text-[#65635C] transition-colors text-sm"
            >
              ✕
            </button>
          </div>

          {/* AI document upload */}
          <label className={`flex items-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${extracting ? "border-[#D26D53]/40 bg-[#FFF4EE]" : "border-[#E5E2D9] hover:border-[#D26D53]/50 bg-white"}`}>
            <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleFileUpload} disabled={extracting} />
            <div className="flex items-center gap-3 w-full px-4 py-3.5">
              {extracting
                ? <Loader2 size={18} className="text-[#D26D53] animate-spin shrink-0" />
                : <Upload size={18} className="text-[#D26D53] shrink-0" />
              }
              <div>
                <div className="text-sm font-semibold text-[#2D2C28]">
                  {extracting ? "Extracting details…" : form.record_type === "policy" ? "Upload invoice or medical document" : "Upload invoice or document"}
                </div>
                <div className="text-xs text-[#8A887F]">
                  {extracting ? "AI is reading your document" : "PDF or image — AI auto-fills the form"}
                </div>
              </div>
            </div>
          </label>

          <div className="space-y-4">
            <div>
              <label className={labelCls}>Type</label>
              <select value={form.record_type} onChange={(e) => { set("record_type")(e); setExtras({}); }} className={inputCls}>
                {RECORD_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </div>

            {form.record_type === "policy" && (
              <div className="rounded-2xl border border-[#DDE5D1] bg-[#EEF2E6] p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={17} className="text-[#556045] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-[#2D2C28]">AI policy analyzer</div>
                    <p className="text-xs text-[#65635C] mt-0.5">
                      Save this policy once, then choose it on the claims page when analyzing bills.
                    </p>
                  </div>
                </div>
                <label className="block">
                  <span className={labelCls}>Policy PDF or text file</span>
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,text/plain,application/pdf"
                    onChange={(e) => setPolicyFile(e.target.files?.[0] || null)}
                    className="mt-1 block w-full text-xs text-[#65635C] file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#556045]"
                  />
                  {policyFile && <span className="mt-1 block text-[11px] text-[#65635C]">{policyFile.name}</span>}
                </label>
                <div>
                  <label className={labelCls}>Policy text</label>
                  <textarea
                    value={policyText}
                    onChange={(e) => setPolicyText(e.target.value)}
                    rows={4}
                    placeholder="Paste policy terms, benefits, exclusions, or the declaration page text."
                    className={`${inputCls} resize-none`}
                  />
                </div>
                <button
                  type="button"
                  onClick={analyzeAndSavePolicy}
                  disabled={analyzingPolicy}
                  className="w-full rounded-xl bg-[#556045] px-4 py-2.5 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {analyzingPolicy ? <><Loader2 size={14} className="animate-spin" /> Analyzing policy…</> : <><Sparkles size={14} /> Analyze and save policy</>}
                </button>
              </div>
            )}

            <div>
              <label className={labelCls}>Title *</label>
              <input value={form.title} onChange={set("title")} required placeholder="e.g. Rabies vaccine" className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={form.date} onChange={set("date")} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Amount ($)</label>
                <input type="number" min="0" step="0.01" value={form.amount_usd} onChange={set("amount_usd")} placeholder="0.00" className={inputCls} />
              </div>
            </div>

            {/* Type-specific fields */}
            {typeFields.length > 0 && (
              <div className="rounded-2xl border border-[#E5E2D9] bg-white/70 p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[#8A887F] font-medium">
                  {form.record_type.charAt(0).toUpperCase() + form.record_type.slice(1)} details
                </div>
                {typeFields.map(({ k, label, ph, type }) => (
                  <div key={k}>
                    <label className={labelCls}>{label}</label>
                    <input
                      type={type || "text"}
                      value={extras[k] || ""}
                      onChange={setExtra(k)}
                      placeholder={ph || ""}
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className={labelCls}>Notes</label>
              <textarea value={form.details} onChange={set("details")} rows={3} placeholder="Additional notes…" className={`${inputCls} resize-none`} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 rounded-xl py-2.5 text-sm">Cancel</button>
            <button type="submit" disabled={saving || extracting || analyzingPolicy} className="btn-primary flex-1 rounded-xl py-2.5 text-sm inline-flex items-center justify-center gap-2">
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(value) {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
