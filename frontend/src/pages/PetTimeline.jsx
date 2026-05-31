import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { BACKEND_ORIGIN } from "../lib/api";
import { useBilling } from "../lib/billing";
import { MARKER_CONFIG, availableMarkerKeys, defaultSelectedKeys, toChartData } from "../lib/healthMarkers";
import {
  Loader2, PawPrint, CalendarDays, Bell,
  HeartPulse, Brain, Syringe, Pill,
  Stethoscope, FlaskConical, ClipboardList, ChevronDown,
  ArrowRight, CheckCircle2, Clock, AlertTriangle, Lock,
  Activity, TrendingUp, TrendingDown, Minus,
  DollarSign, BarChart3, Award, Info,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const BACKEND = BACKEND_ORIGIN;

function getImageUrl(path) {
  if (!path) return "";
  return path.startsWith("/uploads") ? `${BACKEND}${path}` : path;
}

function getEventType(event) {
  const t = (event.type || event.event_type || "").toLowerCase();
  const title = (event.title || "").toLowerCase();
  if (t.includes("vaccine") || t.includes("vaccination") || title.includes("vaccine") || title.includes("vaccination") || title.includes("booster") || title.includes("rabies") || title.includes("distemper")) return "vaccine";
  if (t.includes("medication") || t.includes("med") || title.includes("medication") || title.includes("prescription") || title.includes("refill") || title.includes("pill") || title.includes("antibiotic")) return "medication";
  if (t.includes("surgery") || t.includes("procedure") || title.includes("surgery") || title.includes("procedure") || title.includes("dental") || title.includes("spay") || title.includes("neuter") || title.includes("extraction")) return "procedure";
  if (t.includes("lab") || t.includes("blood") || title.includes("bloodwork") || title.includes("lab") || title.includes("x-ray") || title.includes("ultrasound") || title.includes("urinalysis") || title.includes("cbc")) return "lab";
  if (t.includes("visit") || t.includes("checkup") || title.includes("visit") || title.includes("exam") || title.includes("checkup") || title.includes("consultation")) return "visit";
  return "other";
}

const EVENT_CONFIG = {
  vaccine:   { icon: Syringe,      bg: "bg-[#556045]",  label: "Vaccine",     dot: "bg-[#556045]" },
  medication:{ icon: Pill,         bg: "bg-[#E6AE2E]",  label: "Medication",  dot: "bg-[#E6AE2E]" },
  procedure: { icon: Stethoscope,  bg: "bg-[#D26D53]",  label: "Procedure",   dot: "bg-[#D26D53]" },
  lab:       { icon: FlaskConical, bg: "bg-[#7B6DAB]",  label: "Diagnostics", dot: "bg-[#7B6DAB]" },
  visit:     { icon: HeartPulse,   bg: "bg-[#2D2C28]",  label: "Vet visit",   dot: "bg-[#2D2C28]" },
  other:     { icon: ClipboardList,bg: "bg-[#8A887F]",  label: "Other",       dot: "bg-[#8A887F]" },
};


export default function PetTimeline() {
  const { t } = useTranslation();
  const { billing } = useBilling();
  const [pets, setPets]               = useState([]);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [timeline, setTimeline]       = useState(null);
  const [reminders, setReminders]     = useState([]);
  const [loadingPets, setLoadingPets] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [error, setError]             = useState("");
  const [aiSummary, setAiSummary]     = useState(null);
  const [loadingAi, setLoadingAi]     = useState(false);
  const [healthMarkers, setHealthMarkers] = useState([]);
  const [petDropdownOpen, setPetDropdownOpen] = useState(false);
  const petDropdownRef = useRef(null);

  const planId = billing?.plan_id || "";
  const isUnlimited = ["rescue","rescue_monthly","rescue_yearly","foster","foster_monthly","foster_yearly"].includes(planId);
  const isFreeTier = !billing?.active || !planId || planId === "free" || planId === "free_tier";

  const allowedPets = useMemo(() => {
    if (isUnlimited) return pets;
    const active = pets.filter((p) => p.is_active === true);
    return active.length > 0 ? active : pets.slice(0, 1);
  }, [pets, isUnlimited]);

  const loadPets = useCallback(async () => {
    try {
      setLoadingPets(true);
      const { data } = await api.get("/pets");
      const all = data || [];
      setPets(all);
      const allowed = isUnlimited ? all : all.filter((p) => p.is_active === true);
      const first = allowed[0] || all[0];
      if (first) setSelectedPetId(first.pet_id);
    } catch { setError("Could not load pets."); }
    finally { setLoadingPets(false); }
  }, [isUnlimited]);

  useEffect(() => { loadPets(); }, [loadPets]);

  useEffect(() => {
    if (!selectedPetId) return;
    setAiSummary(null);
    setHealthMarkers([]);
    async function load() {
      try {
        setLoadingTimeline(true);
        setError("");
        const [tRes, rRes, mRes] = await Promise.allSettled([
          api.get(`/pets/${selectedPetId}/timeline`).catch(() => ({ data: { events: [] } })),
          api.get("/reminders"),
          api.get(`/pets/${selectedPetId}/health-markers`).catch(() => ({ data: { markers: [] } })),
        ]);
        if (tRes.status === "fulfilled") setTimeline(tRes.value.data);
        else throw tRes.reason;
        if (rRes.status === "fulfilled") {
          setReminders((rRes.value.data || []).filter((r) => r.pet_id === selectedPetId));
        }
        if (mRes.status === "fulfilled") {
          setHealthMarkers(mRes.value.data?.markers || []);
        }
      } catch (e) {
        console.error(e);
        setError("Could not load health records.");
        setTimeline(null);
        setReminders([]);
      } finally { setLoadingTimeline(false); }
    }
    load();
  }, [selectedPetId]);

  async function generateAi() {
    try {
      setLoadingAi(true);
      const { data } = await api.post(`/pets/${selectedPetId}/timeline/ai-summary`);
      setAiSummary(data);
    } catch (e) { console.error(e); }
    finally { setLoadingAi(false); }
  }

  const selectedPet = useMemo(
    () => allowedPets.find((p) => p.pet_id === selectedPetId) || allowedPets[0] || {},
    [allowedPets, selectedPetId]
  );

  const events = useMemo(() => timeline?.events || [], [timeline]);

  const upcoming = useMemo(
    () => reminders
      .filter((r) => r.scheduled_for && new Date(r.scheduled_for) >= new Date())
      .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for)),
    [reminders]
  );

  const overdue = useMemo(
    () => reminders.filter((r) => r.scheduled_for && new Date(r.scheduled_for) < new Date()),
    [reminders]
  );

  const counts = useMemo(() => {
    const c = { vaccine: 0, medication: 0, procedure: 0, lab: 0, visit: 0, other: 0 };
    events.forEach((e) => c[getEventType(e)]++);
    return c;
  }, [events]);

  // Categorised event buckets
  const currentMeds = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return events.filter(e => getEventType(e) === "medication" && (!e.date || new Date(e.date) >= cutoff))
                 .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [events]);
  const pastMeds = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    return events.filter(e => getEventType(e) === "medication" && e.date && new Date(e.date) < cutoff)
                 .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [events]);
  const upcomingProcs = useMemo(() =>
    events.filter(e => getEventType(e) === "procedure" && e.date && new Date(e.date) > new Date())
          .sort((a, b) => new Date(a.date) - new Date(b.date)),
  [events]);
  const pastProcs = useMemo(() =>
    events.filter(e => getEventType(e) === "procedure" && (!e.date || new Date(e.date) <= new Date()))
          .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  [events]);
  const vaccineEvents = useMemo(() =>
    events.filter(e => getEventType(e) === "vaccine").sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  [events]);
  const labEvents = useMemo(() =>
    events.filter(e => getEventType(e) === "lab").sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  [events]);
  const visitEvents = useMemo(() =>
    events.filter(e => getEventType(e) === "visit").sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  [events]);
  const otherEvents = useMemo(() =>
    events.filter(e => getEventType(e) === "other").sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
  [events]);

  if (loadingPets) return (
    <div className="cream-card p-10 rounded-[30px] inline-flex items-center gap-3 text-sm text-[#65635C]">
      <Loader2 size={17} className="animate-spin" /> Loading health records…
    </div>
  );

  if (pets.length === 0) return (
    <div className="cream-card p-14 rounded-[30px] text-center">
      <PawPrint className="mx-auto text-[#D26D53] mb-5" size={40} />
      <h2 className="font-serif-display text-4xl">No pets yet.</h2>
      <p className="text-sm text-[#65635C] mt-3 max-w-sm mx-auto">Add a pet to start building a beautiful, organised health record.</p>
      <Link to="/dashboard/pets" className="mt-6 btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2">
        Add your first pet <ArrowRight size={15} />
      </Link>
    </div>
  );

  const imageUrl = getImageUrl(selectedPet.picture);

  return (
    <div className="space-y-6 pb-16">

      {/* Pet hero banner */}
      <section className="overflow-hidden rounded-[30px] bg-[#2D2C28] relative min-h-[360px]">
        {imageUrl && (
          <>
            <div className="absolute inset-0">
              <img src={imageUrl} alt={selectedPet.name} className="w-full h-full object-cover" />
            </div>
            {/* Strong layered contrast — keeps text readable on any photo brightness */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/25" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
          </>
        )}
        {!imageUrl && (
          <div className="absolute inset-0 overflow-hidden opacity-[0.04]">
            <PawPrint size={440} className="absolute -right-16 -bottom-16" />
          </div>
        )}

        <div className="relative p-8 lg:p-12 flex flex-col justify-between h-full min-h-[360px]">
          {/* Top bar: label + pet switcher */}
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-4 py-2 text-white/80 text-xs backdrop-blur-sm">
              <HeartPulse size={13} />
              Health timeline
            </div>

            {/* Pet switcher dropdown — works for any number of pets */}
            {allowedPets.length > 1 && (
              <div ref={petDropdownRef} className="relative z-20">
                <button
                  onClick={() => {
                    const next = !petDropdownOpen;
                    setPetDropdownOpen(next);
                    if (next) {
                      // close on outside click
                      const handler = (e) => {
                        if (petDropdownRef.current && !petDropdownRef.current.contains(e.target)) {
                          setPetDropdownOpen(false);
                          document.removeEventListener("mousedown", handler);
                        }
                      };
                      document.addEventListener("mousedown", handler);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 backdrop-blur-md px-4 py-2 text-sm font-medium text-white hover:bg-white/25 transition-all"
                >
                  {selectedPet.picture && (
                    <img src={getImageUrl(selectedPet.picture)} alt="" className="w-5 h-5 rounded-full object-cover" />
                  )}
                  <span className="max-w-[120px] truncate">{selectedPet.name}</span>
                  <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${petDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {petDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-[18px] border border-white/20 bg-[#1E1D1A]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
                    <div className="p-1.5 max-h-72 overflow-y-auto space-y-0.5">
                      {allowedPets.map((p) => {
                        const img = getImageUrl(p.picture);
                        const active = p.pet_id === selectedPetId;
                        return (
                          <button
                            key={p.pet_id}
                            onClick={() => {
                              setSelectedPetId(p.pet_id);
                              setAiSummary(null);
                              setPetDropdownOpen(false);
                            }}
                            className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                              active
                                ? "bg-white/20 text-white font-semibold"
                                : "text-white/75 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 overflow-hidden flex items-center justify-center border border-white/10">
                              {img
                                ? <img src={img} alt={p.name} className="w-full h-full object-cover" />
                                : <PawPrint size={12} className="text-white/50" />
                              }
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium leading-tight">{p.name}</div>
                              {p.species && <div className="text-[10px] capitalize text-white/50 leading-tight mt-0.5">{p.species}</div>}
                            </div>
                            {active && <CheckCircle2 size={13} className="shrink-0 text-white/70" />}
                          </button>
                        );
                      })}
                    </div>
                    {pets.length > allowedPets.length && (
                      <div className="border-t border-white/10 px-1.5 py-1.5">
                        <Link
                          to="/dashboard/pricing"
                          className="flex items-center gap-1.5 w-full px-3 py-2 rounded-xl text-xs text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
                          onClick={() => setPetDropdownOpen(false)}
                        >
                          <Lock size={11} />
                          Upgrade to unlock more pets
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h1 className="font-serif-display text-7xl lg:text-[6rem] text-white leading-none">
              {selectedPet.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selectedPet.species && (
                <span className="rounded-full bg-white/10 border border-white/15 px-3 py-1 text-sm text-white/75 capitalize">
                  {selectedPet.species}
                </span>
              )}
              {selectedPet.breed && (
                <span className="rounded-full bg-white/10 border border-white/15 px-3 py-1 text-sm text-white/75">
                  {selectedPet.breed}
                </span>
              )}
              {selectedPet.age_years && (
                <span className="rounded-full bg-white/10 border border-white/15 px-3 py-1 text-sm text-white/75">
                  {selectedPet.age_years} {selectedPet.age_years === 1 ? "year" : "years"} old
                </span>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl">
              <StatPill label="Vet visits" value={counts.visit + counts.procedure} />
              <StatPill label="Vaccines" value={counts.vaccine} />
              <StatPill label="Medications" value={counts.medication} />
              <StatPill label="Coming up" value={upcoming.length} alert={upcoming.length > 0 || overdue.length > 0} />
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700 text-sm">{error}</div>
      )}

      {loadingTimeline ? (
        <div className="cream-card p-10 rounded-[28px] flex items-center gap-3 text-sm text-[#65635C]">
          <Loader2 size={17} className="animate-spin" /> Loading health records…
        </div>
      ) : timeline ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* ── Main timeline column ── */}
          <div className="lg:col-span-8 space-y-5">

            {/* AI health summary */}
            <div className="cream-card rounded-[28px] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow mb-1">{t("timeline.ai_summary")}</div>
                  <h2 className="font-serif-display text-3xl leading-tight">
                    {selectedPet.name}
                  </h2>
                </div>
                {isFreeTier ? (
                <Link
                  to="/dashboard/pricing"
                  className="shrink-0 rounded-xl border border-[#E5E2D9] bg-[#F2F0E9] text-[#65635C] px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 hover:border-[#D26D53] hover:text-[#D26D53] transition"
                >
                  <Lock size={13} /> Upgrade
                </Link>
              ) : (
                <button
                  onClick={generateAi}
                  disabled={loadingAi}
                  className="shrink-0 bg-[#2D2C28] hover:bg-[#3F3E39] text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-all inline-flex items-center gap-2"
                >
                  {loadingAi
                    ? <><Loader2 size={14} className="animate-spin" /> {t("timeline.generating")}</>
                    : <><Brain size={14} /> {t("timeline.generate_summary")}</>
                  }
                </button>
              )}
              </div>

              {isFreeTier && !aiSummary && (
                <p className="mt-4 text-xs text-[#65635C] leading-relaxed">
                  {t("timeline.requires_paid")}
                </p>
              )}
              {!isFreeTier && !aiSummary ? (
                <p className="mt-4 text-sm text-[#65635C] leading-relaxed">
                  Get a plain-English health summary for {selectedPet.name} — patterns, concerns,
                  and care notes drawn from all recorded events.
                </p>
              ) : aiSummary ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-5">
                    <p className="text-sm leading-relaxed text-[#2D2C28]">{aiSummary.summary}</p>
                  </div>
                  {aiSummary.key_points?.length > 0 && (
                    <div className="space-y-2.5">
                      {aiSummary.key_points.map((pt, i) => (
                        <div key={i} className="rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 flex items-start gap-3">
                          <CheckCircle2 size={15} className="text-[#556045] shrink-0 mt-0.5" />
                          <p className="text-sm leading-relaxed text-[#2D2C28]">{pt}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* ── Health markers graph — always visible ── */}
            <HealthMarkersGraph markers={healthMarkers} petName={selectedPet.name} />

            {/* ── Latest readings snapshot ── */}
            <LatestMarkersSnapshot markers={healthMarkers} petSpecies={selectedPet?.species} />

            {/* ── Organised health sections ── */}
            {events.length === 0 ? (
              <div className="cream-card rounded-[28px] p-12 text-center">
                <CalendarDays size={32} className="mx-auto text-[#C5C2BB] mb-3" />
                <p className="text-sm font-semibold text-[#65635C]">No health events yet.</p>
                <p className="text-xs text-[#8A887F] mt-1 max-w-xs mx-auto">
                  Analyze a bill or add records to start building {selectedPet.name}'s care history.
                </p>
              </div>
            ) : (
              <>
                {currentMeds.length > 0 && (
                  <HighlightSection title="Current Medications" icon={Pill} events={currentMeds} variant="current" />
                )}
                {upcomingProcs.length > 0 && (
                  <HighlightSection title="Upcoming Procedures" icon={Stethoscope} events={upcomingProcs} variant="upcoming" />
                )}
                {vaccineEvents.length > 0 && (
                  <HealthSection title="Vaccination History" icon={Syringe} color="bg-[#556045]" events={vaccineEvents} />
                )}
                {pastProcs.length > 0 && (
                  <HealthSection title="Procedures" icon={Stethoscope} color="bg-[#D26D53]" events={pastProcs} />
                )}
                {pastMeds.length > 0 && (
                  <HealthSection title="Medication History" icon={Pill} color="bg-[#E6AE2E]" events={pastMeds} defaultOpen={false} />
                )}
                {labEvents.length > 0 && (
                  <HealthSection title="Lab & Diagnostics" icon={FlaskConical} color="bg-[#7B6DAB]" events={labEvents} />
                )}
                {visitEvents.length > 0 && (
                  <HealthSection title="Vet Visits & Checkups" icon={HeartPulse} color="bg-[#2D2C28]" events={visitEvents} />
                )}
                {otherEvents.length > 0 && (
                  <HealthSection title="Other Records" icon={ClipboardList} color="bg-[#8A887F]" events={otherEvents} defaultOpen={false} />
                )}
              </>
            )}
          </div>

          {/* ── Sidebar column ── */}
          <div className="lg:col-span-4 space-y-5">

            {/* Overdue alert */}
            {overdue.length > 0 && (
              <div className="rounded-[24px] bg-[#FFF4EE] border border-[#F2C5B7] p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-[#D26D53] shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-sm text-[#2D2C28]">
                      {overdue.length} overdue {overdue.length === 1 ? "reminder" : "reminders"}
                    </div>
                    <p className="text-xs text-[#65635C] mt-1 leading-relaxed">
                      {overdue[0].title} was due {formatRelative(overdue[0].scheduled_for)}.
                    </p>
                    <Link to="/dashboard/reminders" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#D26D53]">
                      Review reminders <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming reminders */}
            <div className="cream-card rounded-[28px] p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="eyebrow mb-1">Upcoming</div>
                  <h3 className="font-serif-display text-2xl">Care reminders</h3>
                </div>
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${upcoming.length > 0 ? "bg-[#D26D53] text-white" : "bg-[#F2E5DE] text-[#D26D53]"}`}>
                  <Bell size={17} />
                </span>
              </div>

              {upcoming.length === 0 ? (
                <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4 text-center">
                  <p className="text-xs text-[#8A887F] leading-relaxed">
                    No upcoming care reminders for {selectedPet.name}.
                  </p>
                  <Link to="/dashboard/reminders" className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-[#D26D53]">
                    Add reminder <ArrowRight size={11} />
                  </Link>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {upcoming.slice(0, 5).map((r) => (
                    <div key={r.reminder_id || r.title} className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-3.5">
                      <div className="flex items-start gap-2.5">
                        <Clock size={13} className="text-[#D26D53] mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold leading-snug">{r.title}</div>
                          <div className="text-xs text-[#65635C] mt-0.5">{formatRelative(r.scheduled_for)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {upcoming.length > 5 && (
                    <Link to="/dashboard/reminders" className="block text-center text-xs font-semibold text-[#D26D53] pt-1 hover:underline">
                      +{upcoming.length - 5} more reminders
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Cost analytics */}
            <CostAnalyticsCard
              analytics={timeline?.analytics}
              monthly_spend={timeline?.monthly_spend}
            />

            {/* Record type breakdown */}
            <div className="rounded-[28px] bg-[#2D2C28] text-white p-5">
              <div className="eyebrow text-[#E6AE2E] mb-1">Health snapshot</div>
              <h3 className="font-serif-display text-2xl mb-4">Record types</h3>

              <div className="space-y-2.5">
                {Object.entries(EVENT_CONFIG)
                  .filter(([key]) => counts[key] > 0)
                  .map(([key, cfg]) => (
                    <div key={key} className="flex items-center justify-between rounded-xl bg-white/8 border border-white/10 px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 ${cfg.bg}`}>
                          <cfg.icon size={13} />
                        </div>
                        <span className="text-sm text-white/75">{cfg.label}</span>
                      </div>
                      <span className="font-serif-display text-2xl">{counts[key]}</span>
                    </div>
                  ))}
                {Object.values(counts).every((v) => v === 0) && (
                  <p className="text-sm text-white/40 text-center py-4">No events recorded yet.</p>
                )}
              </div>
            </div>

            {/* Link to full profile */}
            <Link
              to={`/dashboard/pets/${selectedPet.pet_id}`}
              className="block rounded-[28px] bg-[#556045] text-white p-5 hover:opacity-90 transition-opacity"
            >
              <div className="eyebrow text-[#E6AE2E] mb-1">Full profile</div>
              <h3 className="font-serif-display text-2xl leading-snug">{selectedPet.name}'s complete record</h3>
              <p className="mt-2 text-sm text-white/65 leading-relaxed">
                All vaccines, medications, visit notes, and documents in one place.
              </p>
              <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#E6AE2E]">
                Open profile <ArrowRight size={14} />
              </div>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatPill({ label, value, alert }) {
  return (
    <div className={`rounded-2xl p-3.5 ${alert && value > 0 ? "bg-[#D26D53]" : "bg-white/10 border border-white/10"}`}>
      <div className="text-[11px] text-white/55 mb-1">{label}</div>
      <div className="font-serif-display text-3xl text-white">{value}</div>
    </div>
  );
}

function EventCard({ event }) {
  const type = getEventType(event);
  const cfg = EVENT_CONFIG[type];
  const Icon = cfg.icon;
  const amount = event.amount_usd != null ? Number(event.amount_usd) : null;

  return (
    <div className="rounded-[20px] border border-[#E5E2D9] bg-[#FAF9F6] p-4 hover:border-[#D26D53]/40 hover:bg-white transition-all group">
      <div className="flex items-start gap-3">
        <div className={`w-1.5 rounded-full self-stretch shrink-0 ${cfg.dot}`} />
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${cfg.bg}`}>
          <Icon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold leading-snug">{event.title}</h3>
                <span className="text-[10px] rounded-full px-2 py-0.5 bg-[#F2F0E9] text-[#65635C] font-medium shrink-0">
                  {cfg.label}
                </span>
              </div>
              <p className="text-xs text-[#8A887F] mt-0.5">{formatDate(event.date)}</p>
            </div>
            {amount != null && (
              <span className="shrink-0 text-xs font-semibold text-[#556045] bg-[#E8F5EC] rounded-lg px-2.5 py-1">
                ${money(amount)}
              </span>
            )}
          </div>
          {event.details && (
            <p className="text-xs text-[#65635C] mt-2 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all">
              {event.details}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MarkerDropdown ────────────────────────────────────────────────────────────
function MarkerDropdown({ availableKeys, value, onChange, placeholder = "Select a marker", exclude = [] }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filteredKeys = availableKeys.filter(k => {
    if (exclude.includes(k)) return false;
    return (MARKER_CONFIG[k]?.label || "").toLowerCase().includes(search.toLowerCase());
  });

  const groups = {};
  filteredKeys.forEach(k => {
    const grp = MARKER_CONFIG[k]?.group || "Other";
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push(k);
  });

  const cfg = value ? MARKER_CONFIG[value] : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#E5E2D9] bg-white hover:border-[#C5C2BB] text-sm transition-all min-w-[164px] max-w-[220px]"
      >
        {cfg ? (
          <>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
            <span className="font-semibold text-[#2D2C28] flex-1 text-left truncate">{cfg.label}</span>
          </>
        ) : (
          <span className="text-[#8A887F] flex-1 text-left">{placeholder}</span>
        )}
        <ChevronDown
          size={13}
          className={`text-[#8A887F] shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-0 z-50 w-60 rounded-[18px] border border-[#E5E2D9] bg-white shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="p-2.5 border-b border-[#F0EDE6]">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search markers…"
              className="w-full text-xs px-3 py-1.5 rounded-lg bg-[#F5F2EB] border-0 outline-none placeholder-[#C5C2BB] text-[#2D2C28]"
            />
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto p-1.5">
            {filteredKeys.length === 0 ? (
              <p className="text-xs text-[#C5C2BB] py-4 text-center">
                {search ? `No results for "${search}"` : "No markers available"}
              </p>
            ) : (
              Object.entries(groups).map(([grp, keys]) => (
                <div key={grp}>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[#C5C2BB] px-2.5 pt-2.5 pb-1">
                    {grp}
                  </p>
                  {keys.map(k => {
                    const c      = MARKER_CONFIG[k];
                    const active = k === value;
                    return (
                      <button
                        key={k}
                        onClick={() => { onChange(k); setOpen(false); setSearch(""); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-colors ${
                          active
                            ? "bg-[#F2F0E9] text-[#2D2C28] font-semibold"
                            : "text-[#65635C] hover:bg-[#F5F2EB] hover:text-[#2D2C28]"
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="flex-1 text-left">{c.label}</span>
                        {active && <CheckCircle2 size={11} className="text-[#8A887F] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── HealthMarkersGraph ────────────────────────────────────────────────────────
function HealthMarkersGraph({ markers = [], petName }) {
  const availableKeys               = useMemo(() => availableMarkerKeys(markers), [markers]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [compareKey, setCompareKey] = useState(null);
  const [showCompare, setShowCompare] = useState(false);

  // Reset selections when the pet changes
  useEffect(() => {
    const defaults = defaultSelectedKeys(availableKeys);
    setPrimaryKey(prev => (prev && availableKeys.includes(prev) ? prev : (defaults[0] || null)));
    setCompareKey(null);
    setShowCompare(false);
  }, [availableKeys]);

  const chartData  = useMemo(() => toChartData(markers), [markers]);
  const latest     = useMemo(() => computeLatestMarkers(markers), [markers]);
  const hasData    = availableKeys.length > 0;
  const activeLines = [primaryKey, showCompare ? compareKey : null].filter(Boolean);

  if (!hasData) {
    return (
      <div className="cream-card rounded-[28px] p-6">
        <div className="eyebrow mb-1">Health markers</div>
        <h2 className="font-serif-display text-2xl mb-5">Track over time</h2>
        <div className="rounded-2xl bg-[#F5F2EB] py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#EAE7E0] flex items-center justify-center mx-auto mb-3">
            <Activity size={20} className="text-[#C5C2BB]" />
          </div>
          <p className="text-sm font-semibold text-[#2D2C28]">No markers tracked yet</p>
          <p className="text-xs text-[#8A887F] mt-1.5 max-w-[280px] mx-auto leading-relaxed">
            Upload a vet bill or lab report — our AI automatically pulls weight,
            bloodwork values, vitals, and more.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cream-card rounded-[28px] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow mb-1">Health markers</div>
          <h2 className="font-serif-display text-2xl leading-tight">Track over time</h2>
          <p className="text-xs text-[#65635C] mt-1">
            {availableKeys.length} marker{availableKeys.length !== 1 ? "s" : ""} · {markers.length} data point{markers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <span className="w-10 h-10 rounded-xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center shrink-0 mt-1">
          <Activity size={17} />
        </span>
      </div>

      <div className="mx-6 border-t border-[#E5E2D9]" />

      {/* ── Picker row ── */}
      <div className="px-6 pt-5">
        <div className="flex items-end gap-4 flex-wrap">

          {/* Primary dropdown */}
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-[#8A887F] mb-1.5">Marker</p>
            <MarkerDropdown
              availableKeys={availableKeys}
              value={primaryKey}
              onChange={(k) => {
                setPrimaryKey(k);
                if (compareKey === k) setCompareKey(null);
              }}
              exclude={compareKey ? [compareKey] : []}
            />
          </div>

          {/* Compare */}
          {showCompare ? (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-[#8A887F]">Compare with</p>
                <button
                  onClick={() => { setShowCompare(false); setCompareKey(null); }}
                  className="text-[10px] font-semibold text-[#C5C2BB] hover:text-[#D26D53] transition"
                >
                  Remove
                </button>
              </div>
              <MarkerDropdown
                availableKeys={availableKeys}
                value={compareKey}
                onChange={setCompareKey}
                placeholder="Choose marker…"
                exclude={primaryKey ? [primaryKey] : []}
              />
            </div>
          ) : (
            availableKeys.length > 1 && (
              <button
                onClick={() => setShowCompare(true)}
                className="mb-0.5 text-xs font-semibold text-[#8A887F] hover:text-[#D26D53] transition"
              >
                + Compare
              </button>
            )
          )}
        </div>

        {/* ── Value badges ── */}
        {activeLines.length > 0 && (
          <div className="mt-4 mb-1 flex items-center gap-2 flex-wrap">
            {activeLines.map(k => {
              const info = latest[k];
              const c    = MARKER_CONFIG[k];
              if (!info || !c) return null;
              const val  = info.value % 1 === 0 ? info.value : Number(info.value).toFixed(1);
              return (
                <div
                  key={k}
                  className="inline-flex items-center gap-2.5 rounded-xl px-3.5 py-2 border"
                  style={{ borderColor: c.color + "30", background: c.color + "10" }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-xs font-semibold" style={{ color: c.color }}>{c.label}</span>
                  <span
                    className="font-serif-display text-xl leading-none tabular-nums"
                    style={{ color: c.color }}
                  >
                    {val}
                  </span>
                  {info.trend && <TrendIcon direction={info.trend} size={13} />}
                  <span className="text-[10px] text-[#8A887F]">
                    {info.count} reading{info.count !== 1 ? "s" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Chart ── */}
      <div className="px-3 pt-4 pb-6 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 16, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#E5E2D9" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#8A887F" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#8A887F" }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <Tooltip
              contentStyle={{
                background: "#FDFCF9",
                border: "1px solid #E5E2D9",
                borderRadius: 12,
                fontSize: 12,
                boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              }}
              labelStyle={{ color: "#2D2C28", fontWeight: 600, marginBottom: 4 }}
            />
            {activeLines.length > 1 && (
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
            )}
            {activeLines.map(key => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={MARKER_CONFIG[key]?.label || key}
                stroke={MARKER_CONFIG[key]?.color || "#D26D53"}
                strokeWidth={2.5}
                dot={{ r: 4, fill: MARKER_CONFIG[key]?.color || "#D26D53", strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── HighlightSection ──────────────────────────────────────────────────────────
function HighlightSection({ title, icon: Icon, events, variant }) {
  const s = variant === "current"
    ? { wrap: "bg-[#E8F5EC] border-[#C8E8D4]", iconBg: "bg-[#556045]", badge: "bg-[#C8E8D4] text-[#2F6B45]", label: "Active",   item: "bg-white/70 border border-[#C8E8D4]/60" }
    : { wrap: "bg-[#FEF6E4] border-[#F5D993]", iconBg: "bg-[#E6AE2E]", badge: "bg-[#F5D993] text-[#8A5A24]", label: "Upcoming", item: "bg-white/70 border border-[#F5D993]/60" };
  return (
    <div className={`rounded-[24px] border p-5 ${s.wrap}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${s.iconBg}`}>
          <Icon size={15} />
        </span>
        <span className="font-semibold text-[#2D2C28]">{title}</span>
        <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-semibold ${s.badge}`}>{s.label}</span>
        <span className="ml-auto text-[11px] text-[#65635C] font-medium">{events.length} record{events.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="space-y-2">
        {events.map((event, i) => (
          <div key={i} className={`rounded-xl p-3.5 flex items-start gap-3 ${s.item}`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#2D2C28]">{event.title}</div>
              <p className="text-xs text-[#65635C] mt-0.5">{formatDate(event.date)}</p>
              {event.details && (
                <p className="text-xs text-[#65635C] mt-1.5 leading-relaxed line-clamp-2">{event.details}</p>
              )}
            </div>
            {event.amount_usd > 0 && (
              <span className="shrink-0 text-xs font-semibold text-[#556045] bg-white/80 rounded-lg px-2.5 py-1">
                ${money(event.amount_usd)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── HealthSection ─────────────────────────────────────────────────────────────
function HealthSection({ title, icon: Icon, color, events, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? events : events.slice(0, 5);
  return (
    <div className="cream-card rounded-[24px] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-5 hover:bg-[#F5F2EB] transition"
      >
        <div className="flex items-center gap-3">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${color}`}>
            <Icon size={15} />
          </span>
          <span className="font-semibold text-[#2D2C28]">{title}</span>
          <span className="text-[11px] rounded-full bg-[#F2F0E9] text-[#65635C] px-2 py-0.5 font-medium">{events.length}</span>
        </div>
        <ChevronDown size={15} className={`text-[#8A887F] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-[#F0EDE6]">
          <div className="p-4 space-y-2.5">
            {shown.map((event, i) => <EventCard key={i} event={event} />)}
          </div>
          {events.length > 5 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="w-full py-2.5 text-xs font-semibold text-[#65635C] hover:text-[#D26D53] border-t border-[#F0EDE6] transition flex items-center justify-center gap-1.5"
            >
              {showAll ? "Show less" : `See all ${events.length}`}
              <ChevronDown size={11} className={`transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** For each marker key, get the most-recent value + date + trend direction. */
function computeLatestMarkers(markers = []) {
  const byKey = {};
  // markers come sorted asc by date — last write wins = most recent
  markers.forEach(entry => {
    Object.entries(entry.markers || {}).forEach(([key, val]) => {
      if (val == null || !MARKER_CONFIG[key]) return;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push({ value: Number(val), date: entry.date });
    });
  });

  const result = {};
  Object.entries(byKey).forEach(([key, pts]) => {
    pts.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = pts[pts.length - 1];
    let trend = null;
    if (pts.length >= 2) {
      const prev = pts[pts.length - 2].value;
      const curr = pts[pts.length - 1].value;
      const pct = prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0;
      trend = pct >  5 ? "up"
            : pct < -5 ? "down"
            : "stable";
    }
    result[key] = { value: latest.value, date: latest.date, trend, count: pts.length };
  });
  return result;
}

/** Trend icon for a given direction. */
function TrendIcon({ direction, size = 12 }) {
  if (direction === "up")     return <TrendingUp   size={size} className="text-[#D26D53]" />;
  if (direction === "down")   return <TrendingDown size={size} className="text-[#556045]" />;
  if (direction === "stable") return <Minus        size={size} className="text-[#8A887F]" />;
  return null;
}

// ── Status config for interpretation tooltip ──────────────────────────────────
const INTERP_STATUS = {
  normal:          { label: "Normal",          pill: "bg-[#E8F5EC] text-[#2F6B45]" },
  low:             { label: "Below range",     pill: "bg-[#EDF4FF] text-[#2952A3]" },
  borderline_low:  { label: "Borderline low",  pill: "bg-[#FEF6E4] text-[#8A5A24]" },
  borderline_high: { label: "Borderline high", pill: "bg-[#FEF6E4] text-[#8A5A24]" },
  elevated:        { label: "Elevated",        pill: "bg-[#FFF4EE] text-[#D26D53]" },
  unknown:         { label: "See vet",         pill: "bg-[#F2F0E9] text-[#65635C]" },
};

// ── LatestMarkersSnapshot ─────────────────────────────────────────────────────
function LatestMarkersSnapshot({ markers = [], petSpecies = "dog" }) {
  const latest = useMemo(() => computeLatestMarkers(markers), [markers]);

  const groups = useMemo(() => {
    const g = {};
    Object.keys(latest).forEach(k => {
      const grp = MARKER_CONFIG[k]?.group;
      if (!grp) return;
      if (!g[grp]) g[grp] = [];
      g[grp].push(k);
    });
    return g;
  }, [latest]);

  const groupNames = Object.keys(groups);
  const [activeGroup, setActiveGroup] = useState(null);

  useEffect(() => {
    setActiveGroup(prev => (prev && groups[prev] ? prev : (groupNames[0] || null)));
  }, [groupNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Interpretation tooltip state ─────────────────────────────────────────
  const [tooltip, setTooltip]       = useState(null); // { key, pos, data, loading }
  const hideTimer                   = useRef(null);
  const interpCache                 = useRef({});      // keyed by `${key}:${value}`

  function tooltipPos(anchorEl) {
    const r  = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const TW = 288;
    let left = r.left + r.width / 2 - TW / 2;
    left = Math.max(12, Math.min(left, vw - TW - 12));
    const above = r.top > 220;
    return { left, above, rect: r };
  }

  async function openTooltip(key, value, anchorEl) {
    clearTimeout(hideTimer.current);
    const pos      = tooltipPos(anchorEl);
    const cacheKey = `${key}:${value}`;

    if (interpCache.current[cacheKey]) {
      setTooltip({ key, pos, data: interpCache.current[cacheKey], loading: false });
      return;
    }

    setTooltip({ key, pos, data: null, loading: true });

    try {
      const { data } = await api.post("/health-markers/interpret", {
        marker_key:  key,
        value,
        pet_species: petSpecies || "dog",
      });
      interpCache.current[cacheKey] = data;
      setTooltip(prev => prev?.key === key ? { ...prev, data, loading: false } : prev);
    } catch {
      const fallback = { status: "unknown", range_note: "", interpretation: "Couldn't load interpretation right now. Please try again." };
      setTooltip(prev => prev?.key === key ? { ...prev, data: fallback, loading: false } : prev);
    }
  }

  function scheduleHide() {
    hideTimer.current = setTimeout(() => setTooltip(null), 180);
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (groupNames.length === 0) return null;
  const activeKeys = (activeGroup && groups[activeGroup]) || [];

  return (
    <div className="cream-card rounded-[28px] overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div>
          <div className="eyebrow mb-1">Latest readings</div>
          <h2 className="font-serif-display text-2xl leading-tight">Health snapshot</h2>
          <p className="text-xs text-[#65635C] mt-1">
            {Object.keys(latest).length} marker{Object.keys(latest).length !== 1 ? "s" : ""} on record
          </p>
        </div>
        <span className="w-10 h-10 rounded-xl bg-[#E8F5EC] text-[#556045] flex items-center justify-center shrink-0 mt-1">
          <Award size={17} />
        </span>
      </div>

      {/* Group tab strip */}
      <div className="px-6 pb-4 flex gap-1.5 flex-wrap">
        {groupNames.map(grp => {
          const active = grp === activeGroup;
          return (
            <button
              key={grp}
              onClick={() => setActiveGroup(grp)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all duration-150 ${
                active
                  ? "bg-[#2D2C28] text-white"
                  : "bg-[#F2F0E9] text-[#65635C] hover:bg-[#E5E2D9] hover:text-[#2D2C28]"
              }`}
            >
              {grp}
              <span className={`tabular-nums text-[10px] ${active ? "text-white/50" : "text-[#C5C2BB]"}`}>
                {groups[grp].length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mx-6 border-t border-[#E5E2D9]" />

      {/* Marker rows */}
      <div className="px-4 py-3">
        {activeKeys.map((key, i) => {
          const cfg       = MARKER_CONFIG[key];
          const { value, date, trend, count } = latest[key];
          const formatted = value % 1 === 0 ? value : Number(value).toFixed(1);
          const isLast    = i === activeKeys.length - 1;
          const isActive  = tooltip?.key === key;

          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                isActive ? "bg-[#F5F2EB]" : "hover:bg-[#F5F2EB]"
              } ${!isLast ? "border-b border-[#F5F2EB]" : ""}`}
            >
              {/* Colour dot */}
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cfg.color }} />

              {/* Label */}
              <span className="text-sm text-[#65635C] flex-1 min-w-0 truncate">{cfg.label}</span>

              {/* Trend icon */}
              <div className="w-5 flex items-center justify-center shrink-0">
                {trend && <TrendIcon direction={trend} size={13} />}
              </div>

              {/* Value */}
              <span
                className="font-serif-display text-xl leading-none tabular-nums shrink-0"
                style={{ color: cfg.color }}
              >
                {formatted}
              </span>

              {/* Date + reading count */}
              <div className="text-right shrink-0 w-[70px]">
                <div className="text-xs text-[#8A887F] leading-tight">{formatDate(date)}</div>
                {count > 1 && (
                  <div className="text-[9px] text-[#C5C2BB] font-medium leading-tight mt-0.5">
                    {count} readings
                  </div>
                )}
              </div>

              {/* ℹ button */}
              <button
                onMouseEnter={e => openTooltip(key, value, e.currentTarget)}
                onMouseLeave={scheduleHide}
                onClick={e => {
                  if (isActive) { clearTimeout(hideTimer.current); setTooltip(null); }
                  else openTooltip(key, value, e.currentTarget);
                }}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                  isActive
                    ? "bg-[#2D2C28] text-white"
                    : "bg-[#F2F0E9] text-[#8A887F] hover:bg-[#2D2C28] hover:text-white"
                }`}
                aria-label={`What does ${cfg.label} mean?`}
              >
                <Info size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Floating interpretation tooltip ── */}
      {tooltip && (
        <InterpTooltip
          tooltip={tooltip}
          onMouseEnter={() => clearTimeout(hideTimer.current)}
          onMouseLeave={scheduleHide}
        />
      )}
    </div>
  );
}

// ── InterpTooltip ─────────────────────────────────────────────────────────────
function InterpTooltip({ tooltip, onMouseEnter, onMouseLeave }) {
  const { pos, data, loading } = tooltip;
  const statusCfg = INTERP_STATUS[data?.status] || INTERP_STATUS.unknown;

  const style = {
    position:  "fixed",
    left:      pos.left,
    width:     288,
    zIndex:    9999,
    ...(pos.above
      ? { bottom: window.innerHeight - pos.rect.top + 10 }
      : { top:    pos.rect.bottom + 10 }),
  };

  return (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="pointer-events-auto"
    >
      {/* Arrow */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 ${
          pos.above
            ? "bottom-[-6px] border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#1A1917]"
            : "top-[-6px] border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#1A1917]"
        }`}
      />

      {/* Card */}
      <div className="rounded-[18px] bg-[#1A1917] border border-[#2A2924] shadow-2xl overflow-hidden">
        {/* Top accent */}
        <div className="h-px bg-gradient-to-r from-transparent via-[#D26D53]/40 to-transparent" />

        <div className="p-4">
          {loading ? (
            <div className="flex items-center gap-2.5 py-2">
              <Loader2 size={14} className="animate-spin text-[#D26D53]" />
              <span className="text-xs text-[#65635C]">Reading the values…</span>
            </div>
          ) : (
            <>
              {/* Status pill + range */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${statusCfg.pill}`}>
                  {statusCfg.label}
                </span>
                {data?.range_note && (
                  <span className="text-[10px] text-[#3D3C38]">{data.range_note}</span>
                )}
              </div>

              {/* Interpretation */}
              <p className="text-xs text-[#C9C6BD] leading-relaxed">
                {data?.interpretation}
              </p>

              {/* Footer */}
              <div className="mt-3 pt-3 border-t border-[#2A2924] flex items-center gap-1.5">
                <Stethoscope size={11} className="text-[#D26D53] shrink-0" />
                <span className="text-[10px] text-[#65635C] font-medium">
                  This is educational only — always confirm with your vet.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CostAnalyticsCard ─────────────────────────────────────────────────────────
function CostAnalyticsCard({ analytics, monthly_spend = [] }) {
  if (!analytics) return null;

  const {
    average_monthly_spend_usd,
    predicted_annual_cost_usd,
    reimbursement_rate_percent,
    trend_direction,
    top_category,
  } = analytics;

  const totalSpent = monthly_spend.reduce((s, m) => s + (m.amount_usd || 0), 0);
  if (totalSpent === 0) return null;

  const trendLabel = trend_direction === "increasing" ? "Rising"
    : trend_direction === "decreasing" ? "Falling"
    : "Stable";
  const TrendIco = trend_direction === "increasing" ? TrendingUp
    : trend_direction === "decreasing" ? TrendingDown
    : Minus;
  const trendColor = trend_direction === "increasing" ? "text-[#D26D53]"
    : trend_direction === "decreasing" ? "text-[#556045]"
    : "text-[#8A887F]";

  return (
    <div className="rounded-[28px] bg-[#2D2C28] text-white p-5">
      <div className="eyebrow text-[#E6AE2E] mb-1">Cost overview</div>
      <h3 className="font-serif-display text-2xl mb-4">Spending summary</h3>

      <div className="space-y-2.5">
        {/* Avg monthly */}
        <div className="flex items-center justify-between rounded-xl bg-white/8 border border-white/10 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#E6AE2E]/20 flex items-center justify-center shrink-0">
              <DollarSign size={13} className="text-[#E6AE2E]" />
            </div>
            <span className="text-sm text-white/75">Avg / month</span>
          </div>
          <span className="font-serif-display text-xl">${money(average_monthly_spend_usd)}</span>
        </div>

        {/* Projected annual */}
        <div className="flex items-center justify-between rounded-xl bg-white/8 border border-white/10 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#556045]/40 flex items-center justify-center shrink-0">
              <BarChart3 size={13} className="text-[#8EB87E]" />
            </div>
            <span className="text-sm text-white/75">Est. annual</span>
          </div>
          <span className="font-serif-display text-xl">${money(predicted_annual_cost_usd)}</span>
        </div>

        {/* Spend trend */}
        <div className="flex items-center justify-between rounded-xl bg-white/8 border border-white/10 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <TrendIco size={13} className={trendColor} />
            </div>
            <span className="text-sm text-white/75">Spend trend</span>
          </div>
          <span className={`text-sm font-semibold ${trendColor}`}>{trendLabel}</span>
        </div>

        {/* Reimbursement */}
        {reimbursement_rate_percent > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-white/8 border border-white/10 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#D26D53]/20 flex items-center justify-center shrink-0">
                <Award size={13} className="text-[#D26D53]" />
              </div>
              <span className="text-sm text-white/75">Reimbursed</span>
            </div>
            <span className="font-serif-display text-xl">{reimbursement_rate_percent}%</span>
          </div>
        )}

        {/* Top category */}
        {top_category && (
          <div className="mt-1 rounded-xl bg-white/5 border border-white/8 px-3.5 py-3">
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Top spend category</p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">{top_category.category}</span>
              <span className="text-sm text-white/60">{top_category.percent_of_total}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function money(v) { return Number(v || 0).toFixed(2); }

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return value; }
}

function formatRelative(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const diffDays = Math.round((date - now) / 86400000);
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
  if (diffDays === -1) return "yesterday";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
