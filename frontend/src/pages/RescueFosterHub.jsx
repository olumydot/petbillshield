import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { BACKEND_ORIGIN } from "../lib/api";
import { useBilling } from "../lib/billing";
import {
  PawPrint, Loader2, ShieldCheck, FileText, Download, Sparkles,
  Syringe, Home, DollarSign, CalendarDays, AlertTriangle,
  ClipboardList, Send, Lock, Check, Mail, Users, HeartHandshake,
  Stethoscope, ArrowRight, Bell, Heart, FileHeart,
  ChevronDown, ChevronUp, Clipboard, Printer, RefreshCcw,
  Activity, BarChart3, Boxes, UserCheck, Pill, X, MapPin, Search,
} from "lucide-react";
import { toast } from "sonner";

const BACKEND = BACKEND_ORIGIN;

function getImageUrl(path) {
  if (!path) return "";
  return path.startsWith("/uploads") ? `${BACKEND}${path}` : path;
}

function money(v) {
  return Number(v || 0).toFixed(2);
}

function safeDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return v;
  }
}

function todayLabel() {
  return new Date().toLocaleDateString();
}

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "animals", label: "Animals", icon: PawPrint },
  { id: "foster_ops", label: "Foster Ops", icon: Users },
  { id: "vaccines", label: "Vaccine Matrix", icon: Syringe },
  { id: "expense", label: "Expense Report", icon: DollarSign },
  { id: "adoption", label: "Transfer Packets", icon: UserCheck },
  { id: "ai", label: "AI Summary", icon: Sparkles },
  { id: "email", label: "Email Report", icon: Mail },
];

export default function RescueFosterHub() {
  const { billing } = useBilling();

  const isRescuePlan =
    billing?.plan_id === "rescue_monthly" ||
    billing?.plan_id === "rescue_yearly";

  const [activeTab, setActiveTab] = useState("overview");
  const [pets, setPets] = useState([]);
  const [records, setRecords] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [timelines, setTimelines] = useState({});
  const [loading, setLoading] = useState(true);

  const [selectedAnimalIds, setSelectedAnimalIds] = useState([]);
  const [generatedReport, setGeneratedReport] = useState("");
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [expandedPet, setExpandedPet] = useState(null);
  const [fosterOps, setFosterOps] = useState({
    assignments: [],
    weekly_updates: [],
    supply_requests: [],
    bios: [],
  });
  const [loadingFosterOps, setLoadingFosterOps] = useState(false);

  const selectedPets =
    selectedAnimalIds.length === 0
      ? pets
      : pets.filter((p) => selectedAnimalIds.includes(p.pet_id));

  const selectedRecords = records.filter((r) =>
    selectedPets.some((p) => p.pet_id === r.pet_id)
  );

  const selectedReminders = reminders.filter(
    (r) => !r.pet_id || selectedPets.some((p) => p.pet_id === r.pet_id)
  );

  const loadFosterOps = useCallback(async () => {
    setLoadingFosterOps(true);
    try {
      const { data } = await api.get("/rescue/foster-ops");
      setFosterOps({
        assignments: data.assignments || [],
        weekly_updates: data.weekly_updates || [],
        supply_requests: data.supply_requests || [],
        bios: data.bios || [],
      });
    } catch {
      setFosterOps({ assignments: [], weekly_updates: [], supply_requests: [], bios: [] });
    } finally {
      setLoadingFosterOps(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [petsRes, remindersRes] = await Promise.allSettled([
        api.get("/pets"),
        api.get("/reminders"),
      ]);

      const loadedPets =
        petsRes.status === "fulfilled" ? petsRes.value.data || [] : [];

      setPets(loadedPets);
      setSelectedAnimalIds(loadedPets.map((p) => p.pet_id));

      if (remindersRes.status === "fulfilled") {
        setReminders(remindersRes.value.data || []);
      }

      const allRecords = [];
      const timelineMap = {};

      for (const pet of loadedPets) {
        try {
          const { data } = await api.get(`/pets/${pet.pet_id}/records`);
          allRecords.push(
            ...(data || []).map((r) => ({
              ...r,
              pet_id: pet.pet_id,
              pet_name: pet.name,
              pet_species: pet.species,
            }))
          );
        } catch {}
        try {
          const { data } = await api.get(`/pets/${pet.pet_id}/timeline`);
          timelineMap[pet.pet_id] = data;
        } catch {
          timelineMap[pet.pet_id] = null;
        }
      }

      setRecords(allRecords);
      setTimelines(timelineMap);
      await loadFosterOps();
    } catch {
      toast.error("Could not load Rescue/Foster Hub.");
    } finally {
      setLoading(false);
    }
  }, [loadFosterOps]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const totalSpend = selectedRecords.reduce(
      (s, r) => s + (Number(r.amount_usd) || 0), 0
    );
    const vaccineCount = selectedRecords.filter((r) => r.record_type === "vaccine").length;
    const medCount = selectedRecords.filter((r) => r.record_type === "medication").length;
    const invoiceCount = selectedRecords.filter((r) => r.record_type === "invoice").length;
    const upcomingReminders = selectedReminders.filter(
      (r) => r.scheduled_for && new Date(r.scheduled_for) >= new Date()
    ).length;
    const overdueReminders = selectedReminders.filter(
      (r) => r.scheduled_for && r.status === "pending" && new Date(r.scheduled_for) < new Date()
    ).length;
    return { totalPets: selectedPets.length, totalSpend, vaccineCount, medCount, invoiceCount, upcomingReminders, overdueReminders };
  }, [selectedPets, selectedRecords, selectedReminders]);

  const reportForDownload = generatedReport || buildReportText({ pets: selectedPets, records: selectedRecords, reminders: selectedReminders, timelines, stats, aiSummary });

  function toggleAnimal(petId) {
    setSelectedAnimalIds((prev) =>
      prev.includes(petId) ? prev.filter((id) => id !== petId) : [...prev, petId]
    );
    setGeneratedReport("");
  }

  async function generateAiSummary() {
    setGeneratingAi(true);
    try {
      const { data } = await api.post("/rescue/ai-summary", {
        report_type: "care_summary",
        title: "Detailed Rescue / Foster Care Summary",
        pets: selectedPets, records: selectedRecords,
        reminders: selectedReminders, timelines,
        instruction: "Create a comprehensive field-ready foster care summary with animal-by-animal history, care priorities, cost/resource pressure, record gaps, handoff notes, and next 7/30/60/90 day actions. Do not diagnose.",
      });
      setAiSummary(data.summary || "");
      setGeneratedReport(data.summary || "");
      setGeneratedTitle("AI Rescue / Foster Summary");
      toast.success("AI summary generated.");
    } catch {
      const fallback = buildLocalAiSummary({ pets: selectedPets, records: selectedRecords, reminders: selectedReminders, timelines, stats });
      setAiSummary(fallback);
      setGeneratedReport(fallback);
      setGeneratedTitle("AI Rescue / Foster Summary");
      toast.success("Summary generated.");
    } finally {
      setGeneratingAi(false);
    }
  }

  async function generateReport(type) {
    if (selectedPets.length === 0) { toast.error("Select at least one animal first."); return; }
    setGeneratingReport(true);
    const localDraft = type === "expense"
      ? buildExpenseReport(selectedRecords, selectedPets, timelines)
      : type === "adoption"
      ? buildAdoptionPacket(selectedPets, selectedRecords, timelines)
      : buildVaccineLog(selectedRecords, selectedPets);
    const title = type === "expense" ? "Detailed Expense Report" : type === "adoption" ? "Adoption / Foster Transfer Packet" : "Vaccine Log";
    try {
      const { data } = await api.post("/rescue/ai-summary", {
        report_type: type, title, pets: selectedPets,
        records: selectedRecords, reminders: selectedReminders,
        timelines, local_draft: localDraft,
        instruction: type === "expense"
          ? "Create a comprehensive donor-ready and board-ready expense report with executive financial snapshot, animal-by-animal invoice details, spending categories, cost drivers, reimbursement/donor documentation checklist, narrative explanation, and next finance actions. Do not diagnose."
          : type === "adoption"
            ? "Create a comprehensive adoption/foster transfer packet with transfer readiness snapshot, animal-by-animal care packet, medications/vaccines/labs/visits/invoices, foster/adopter instructions, vet/partner rescue handoff, missing documents, and first 7/30/60 day follow-up plan. Do not diagnose."
            : "Create a comprehensive vaccine log with animal-by-animal vaccine history, missing proof, due/overdue reminders, and confirmation questions. Do not diagnose.",
      });
      setGeneratedTitle(title);
      setGeneratedReport(data.summary || localDraft);
      toast.success(`${title} generated.`);
    } catch {
      setGeneratedTitle(title);
      setGeneratedReport(localDraft);
      toast.success(`${title} generated.`);
    } finally {
      setGeneratingReport(false);
    }
  }

  function downloadPdf() {
    import("jspdf").then(({ default: jsPDF }) => {
    const doc = new jsPDF();
    const title = generatedTitle || "Rescue / Foster Report";
    doc.setFontSize(18);
    doc.text(title, 14, 18);
    doc.setFontSize(10);
    doc.text(`Generated: ${todayLabel()} · PetBill Shield`, 14, 26);
    const lines = doc.splitTextToSize(reportForDownload, 180);
    doc.setFontSize(11);
    doc.text(lines, 14, 38);
    doc.save(`${title.toLowerCase().replaceAll(" ", "-")}-${Date.now()}.pdf`);
    });
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportForDownload);
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function emailReport() {
    if (!emailTo.trim()) { toast.error("Enter an email address."); return; }
    setSendingEmail(true);
    try {
      await api.post("/rescue/email-report", { to: emailTo, note: emailNote, report: reportForDownload, title: generatedTitle });
      toast.success("Report emailed successfully.");
      setEmailTo(""); setEmailNote("");
    } catch {
      toast.error("Could not email report. Check backend configuration.");
    } finally {
      setSendingEmail(false);
    }
  }

  if (!isRescuePlan) {
    return <UpgradeGate />;
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-52 rounded-[34px] bg-[#2D2C28] animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((x) => (
            <div key={x} className="cream-card h-20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16" data-testid="rescue-foster-hub">
      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-7 sm:p-10 lg:p-12">
        <div className="absolute right-[-80px] top-[-80px] h-[300px] w-[300px] rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="absolute left-[-80px] bottom-[-80px] h-[260px] w-[260px] rounded-full bg-[#556045]/25 blur-3xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75">
              <Heart size={14} />
              Rescue / Foster Command Center
            </div>

            <h1 className="mt-5 font-serif-display text-5xl sm:text-6xl lg:text-7xl leading-[0.93]">
              Every animal,{" "}
              <span className="italic text-[#D26D53]">perfectly documented.</span>
            </h1>

            <p className="mt-5 text-sm sm:text-base text-white/70 max-w-2xl leading-relaxed">
              Generate donor-ready expense reports, adoption packets, vaccine
              logs, and AI care summaries. Track unlimited animals. Email
              polished reports to fosters, adopters, vets, and donors.
            </p>

            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <HeroStat label="Animals" value={stats.totalPets} icon={PawPrint} />
              <HeroStat label="Vaccines" value={stats.vaccineCount} icon={Syringe} />
              <HeroStat label="Tracked spend" value={`$${Number(stats.totalSpend).toFixed(0)}`} icon={DollarSign} />
              <HeroStat label="Reminders" value={stats.upcomingReminders} icon={Bell} alert={stats.overdueReminders > 0} />
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:min-w-[220px]">
            <button
              onClick={generateAiSummary}
              disabled={generatingAi}
              className="w-full rounded-2xl bg-[#D26D53] hover:bg-[#BD5D44] text-white px-5 py-3.5 text-sm font-semibold inline-flex items-center justify-center gap-2 transition shadow-lg disabled:opacity-60"
            >
              {generatingAi ? <><Loader2 size={15} className="animate-spin" />Generating…</> : <><Sparkles size={15} />Generate AI summary</>}
            </button>

            <button
              onClick={downloadPdf}
              className="w-full rounded-2xl border border-white/15 bg-white/10 hover:bg-white/15 text-white px-5 py-3.5 text-sm font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <Download size={15} />
              Download PDF
            </button>

            <button
              onClick={load}
              className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 px-5 py-2.5 text-xs font-medium inline-flex items-center justify-center gap-2 transition"
            >
              <RefreshCcw size={13} />
              Refresh data
            </button>
          </div>
        </div>
      </section>

      <AnimalSelector
        pets={pets}
        selectedAnimalIds={selectedAnimalIds}
        toggleAnimal={toggleAnimal}
        onSelectAll={() => { setSelectedAnimalIds(pets.map((p) => p.pet_id)); setGeneratedReport(""); }}
        onClear={() => { setSelectedAnimalIds([]); setGeneratedReport(""); }}
      />

      <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setGeneratedReport(""); }}
            className={`flex-shrink-0 rounded-2xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 transition ${
              activeTab === tab.id
                ? "bg-[#2D2C28] text-white"
                : "border border-[#E5E2D9] bg-[#FAF9F6] text-[#65635C] hover:border-[#D26D53]/40 hover:text-[#2D2C28]"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <OverviewTab
          stats={stats}
          pets={selectedPets}
          records={selectedRecords}
          reminders={selectedReminders}
          timelines={timelines}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === "animals" && (
        <AnimalsTab
          pets={selectedPets}
          records={records}
          timelines={timelines}
          reminders={reminders}
          expandedPet={expandedPet}
          setExpandedPet={setExpandedPet}
        />
      )}

      {activeTab === "vaccines" && (
        <VaccineMatrix pets={selectedPets} records={selectedRecords} />
      )}

      {activeTab === "foster_ops" && (
        <FosterOpsTab
          pets={selectedPets}
          records={selectedRecords}
          reminders={selectedReminders}
          ops={fosterOps}
          loading={loadingFosterOps}
          onRefresh={loadFosterOps}
        />
      )}

      {activeTab === "expense" && (
        <div className="space-y-5">
          <ExpenseExport />
          <ReportTab
            title="Narrative Expense Report"
            description="AI-written per-animal expense summary for donors, boards, or reimbursement tracking."
            generatedReport={generatedReport}
            generatedTitle={generatedTitle}
            fallback={buildExpenseReport(selectedRecords, selectedPets, timelines)}
            loading={generatingReport}
            onGenerate={() => generateReport("expense")}
            onDownload={downloadPdf}
            onCopy={copyReport}
          />
        </div>
      )}

      {activeTab === "adoption" && (
        <ReportTab
          title="Adoption / Transfer Packet"
          description="Complete handoff records for adopters, foster parents, partner rescues, and vets."
          generatedReport={generatedReport}
          generatedTitle={generatedTitle}
          fallback={buildAdoptionPacket(selectedPets, selectedRecords, timelines)}
          loading={generatingReport}
          onGenerate={() => generateReport("adoption")}
          onDownload={downloadPdf}
          onCopy={copyReport}
        />
      )}

      {activeTab === "ai" && (
        <AITab
          aiSummary={aiSummary}
          generatingAi={generatingAi}
          onGenerate={generateAiSummary}
          onDownload={downloadPdf}
          onCopy={copyReport}
        />
      )}

      {activeTab === "email" && (
        <EmailTab
          emailTo={emailTo}
          setEmailTo={setEmailTo}
          emailNote={emailNote}
          setEmailNote={setEmailNote}
          sendingEmail={sendingEmail}
          onSend={emailReport}
          reportPreview={reportForDownload}
        />
      )}
    </div>
  );
}

// Accountant-grade expense export: year filter, breakdowns, CSV download.
function ExpenseExport() {
  const nowYear = new Date().getFullYear();
  const YEARS = ["all", nowYear, nowYear - 1, nowYear - 2];
  const [year, setYear]       = useState(nowYear);
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const load = useCallback(async (yr) => {
    setLoading(true);
    try {
      const params = yr === "all" ? {} : { year: yr };
      const { data } = await api.get("/rescue/expense-report", { params });
      setReport(data);
    } catch (_) {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const params = year === "all" ? {} : { year };
      const { data } = await api.get("/rescue/expense-report.csv", { params, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `petbill-expense-report-${year === "all" ? "all-time" : year}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (_) {
      toast.error("Couldn't download the report.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="cream-card rounded-[28px] p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#556045]" />
            <h3 className="font-serif-display text-2xl text-[#2D2C28]">Tax &amp; donor expense report</h3>
          </div>
          <p className="text-sm text-[#65635C] mt-1">
            Itemized, accountant-ready totals across every animal — perfect for grant reports, board packets, and tax filings.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={year} onChange={(e) => setYear(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#556045]/40">
            {YEARS.map((y) => <option key={y} value={y}>{y === "all" ? "All time" : y}</option>)}
          </select>
          <button onClick={downloadCsv} disabled={downloading || !report?.count}
            className="rounded-xl bg-[#556045] hover:bg-[#465038] text-white px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 size={22} className="animate-spin text-[#556045]" /></div>
      ) : !report || report.count === 0 ? (
        <p className="text-sm text-[#8A887F] py-4">No priced records found for this period. Add invoice amounts to your animals' records and they'll roll up here.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="rounded-2xl border border-[#E5E2D9] bg-white/50 p-3">
              <div className="font-serif-display text-2xl text-[#2D2C28]">{usd(report.total_usd)}</div>
              <div className="text-[11px] text-[#8A887F] uppercase tracking-wider">Total spend</div>
            </div>
            <div className="rounded-2xl border border-[#E5E2D9] bg-white/50 p-3">
              <div className="font-serif-display text-2xl text-[#2D2C28]">{report.count}</div>
              <div className="text-[11px] text-[#8A887F] uppercase tracking-wider">Line items</div>
            </div>
            <div className="rounded-2xl border border-[#E5E2D9] bg-white/50 p-3">
              <div className="font-serif-display text-2xl text-[#2D2C28]">{report.by_pet.length}</div>
              <div className="text-[11px] text-[#8A887F] uppercase tracking-wider">Animals</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] mb-2">By animal</div>
              <div className="space-y-1">
                {report.by_pet.slice(0, 8).map((r) => (
                  <div key={r.pet_name} className="flex justify-between text-sm border-b border-[#EFECE3] py-1">
                    <span className="text-[#2D2C28]">{r.pet_name}</span>
                    <span className="font-mono text-[#556045]">{usd(r.total_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] mb-2">By category</div>
              <div className="space-y-1">
                {report.by_category.slice(0, 8).map((r) => (
                  <div key={r.category} className="flex justify-between text-sm border-b border-[#EFECE3] py-1">
                    <span className="text-[#2D2C28] capitalize">{r.category}</span>
                    <span className="font-mono text-[#556045]">{usd(r.total_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function UpgradeGate() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-10 sm:p-14">
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="relative z-10 max-w-2xl">
          <span className="w-14 h-14 rounded-3xl bg-[#D26D53] inline-flex items-center justify-center mb-5">
            <Lock size={24} />
          </span>
          <div className="eyebrow text-[#E6AE2E] mb-3">Rescue / Foster plan only</div>
          <h1 className="font-serif-display text-5xl leading-[0.95]">
            The command center for rescue homes.
          </h1>
          <p className="mt-5 text-white/70 max-w-xl leading-relaxed">
            Upgrade to the Rescue / Foster plan to unlock unlimited animal
            profiles, donation-ready expense reports, adoption packets, vaccine
            matrix, AI summaries, and email reports for donors and fosters.
          </p>
          <Link
            to="/dashboard/pricing"
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-[#D26D53] hover:bg-[#BD5D44] text-white px-6 py-3.5 text-sm font-semibold transition shadow-lg"
          >
            View Rescue / Foster plan <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Boxes, t: "Unlimited animals", d: "No pet caps. Track every animal in your rescue." },
          { icon: FileText, t: "Donor-ready reports", d: "Turn messy records into clean expense reports." },
          { icon: UserCheck, t: "Adoption packets", d: "Complete transfer records for every adoption." },
          { icon: Syringe, t: "Vaccine matrix", d: "See all animals' vaccine status at a glance." },
        ].map((f) => (
          <div key={f.t} className="cream-card p-6 rounded-[24px]">
            <span className="w-10 h-10 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center mb-4">
              <f.icon size={18} />
            </span>
            <h3 className="font-serif-display text-2xl">{f.t}</h3>
            <p className="text-sm text-[#65635C] mt-2">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroStat({ label, value, icon: Icon, alert }) {
  return (
    <div className={`rounded-2xl border border-white/10 p-4 backdrop-blur ${alert ? "bg-[#D26D53]/20 border-[#D26D53]/30" : "bg-white/10"}`}>
      <div className="flex items-center gap-2 text-white/60 text-xs">
        <Icon size={13} />
        {label}
      </div>
      <div className="font-serif-display text-3xl mt-2 text-white">{value}</div>
    </div>
  );
}

function AnimalSelector({ pets, selectedAnimalIds, toggleAnimal, onSelectAll, onClear }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 4;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPets = useMemo(() => {
    if (!normalizedQuery) return pets;
    return pets.filter((pet) => {
      const haystack = [
        pet.name,
        pet.species,
        pet.breed,
        pet.vet_clinic_name,
        pet.insurance_provider,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [pets, normalizedQuery]);
  const selectedInSearch = filteredPets.filter((pet) => selectedAnimalIds.includes(pet.pet_id)).length;
  const totalPages = Math.max(1, Math.ceil(filteredPets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPets = filteredPets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = filteredPets.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredPets.length);

  useEffect(() => {
    setPage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="cream-card p-5 rounded-[26px]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Report scope</div>
          <h2 className="font-serif-display text-2xl">Choose animals for this workspace</h2>
          <p className="text-xs text-[#65635C] mt-1">
            All reports, summaries, and emails use only the selected animals below.
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onSelectAll} className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold">
            Select all ({pets.length})
          </button>
          <button onClick={onClear} className="btn-ghost rounded-xl px-3 py-2 text-xs font-semibold">
            Clear
          </button>
        </div>
      </div>

      {pets.length === 0 ? (
        <div className="text-center py-8">
          <PawPrint size={32} className="mx-auto text-[#D26D53] mb-3" />
          <p className="text-sm text-[#65635C]">No pet profiles yet. Add animals from the Pet Vault.</p>
          <Link to="/dashboard/pets" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53]">
            Go to Pet Vault <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <label className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search animals by name, species, breed, clinic, or insurer"
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white px-9 py-2.5 text-sm outline-none focus:border-[#D26D53]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg inline-flex items-center justify-center text-[#8A887F] hover:bg-[#F2F0E9] hover:text-[#2D2C28]"
                  aria-label="Clear animal search"
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="text-xs text-[#65635C] shrink-0">
              {selectedAnimalIds.length} selected · {filteredPets.length} found
              {normalizedQuery ? ` · ${selectedInSearch} selected here` : ""}
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5E2D9] bg-white overflow-hidden">
            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-4 py-2.5 bg-[#F8F5EF] border-b border-[#E5E2D9] text-[11px] font-semibold uppercase tracking-wide text-[#8A887F]">
              <span>Animal</span>
              <span>Species / breed</span>
              <span>Clinic / insurer</span>
              <span>Status</span>
            </div>
            <div className="divide-y divide-[#F2F0E9]">
              {filteredPets.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Search size={22} className="mx-auto text-[#D26D53] mb-2" />
                  <p className="text-sm font-semibold text-[#2D2C28]">No animals match that search.</p>
                  <p className="text-xs text-[#65635C] mt-1">Try a pet name, breed, species, clinic, or insurer.</p>
                </div>
              ) : (
                pagedPets.map((pet) => {
                  const selected = selectedAnimalIds.includes(pet.pet_id);
                  const img = getImageUrl(pet.picture);
                  const checkboxId = `rescue-animal-${pet.pet_id}`;
                  return (
                    <label
                      key={pet.pet_id}
                      htmlFor={checkboxId}
                      className={`grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-center px-3 sm:px-4 py-2 cursor-pointer transition ${
                        selected ? "bg-[#FFF7F2]" : "hover:bg-[#FAF9F6]"
                      }`}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAnimal(pet.pet_id)}
                        className="h-4 w-4 rounded border-[#D26D53] text-[#D26D53] focus:ring-[#D26D53]"
                      />
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0 bg-[#2D2C28]">
                          {img ? (
                            <img src={img} alt={pet.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/50">
                              <PawPrint size={16} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{pet.name}</div>
                          <div className="text-[11px] text-[#8A887F] sm:hidden truncate">
                            {pet.species || "pet"}{pet.breed ? ` · ${pet.breed}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="hidden sm:block text-xs text-[#65635C] capitalize truncate">
                        {pet.species || "pet"}{pet.breed ? ` · ${pet.breed}` : ""}
                      </div>
                      <div className="hidden sm:block text-xs text-[#65635C] truncate">
                        {pet.vet_clinic_name || pet.insurance_provider || "Not listed"}
                      </div>
                      <span className={`hidden sm:inline-flex text-[11px] font-semibold rounded-full px-2.5 py-1 justify-center ${
                        selected ? "bg-[#D26D53] text-white" : "bg-[#F2F0E9] text-[#65635C]"
                      }`}>
                        {selected ? "Selected" : "Available"}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {filteredPets.length > pageSize && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-[#E5E2D9] bg-[#F8F5EF] px-4 py-2.5">
                <div className="text-xs text-[#65635C]">
                  Showing {rangeStart}-{rangeEnd} of {filteredPets.length}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] disabled:opacity-40 hover:text-[#2D2C28]"
                  >
                    Previous
                  </button>
                  <span className="text-xs font-semibold text-[#65635C]">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] disabled:opacity-40 hover:text-[#2D2C28]"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ stats, pets, records, reminders, timelines, setActiveTab }) {
  const topSpender = useMemo(() => {
    return pets
      .map((p) => {
        const petRecords = records.filter((r) => r.pet_id === p.pet_id);
        const spend = petRecords.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
        return { ...p, spend };
      })
      .sort((a, b) => b.spend - a.spend)[0];
  }, [pets, records]);

  const overdueReminders = reminders.filter(
    (r) => r.status === "pending" && new Date(r.scheduled_for) < new Date()
  );

  const missingVaccines = pets.filter((p) => {
    const petVaccines = records.filter((r) => r.pet_id === p.pet_id && r.record_type === "vaccine");
    return petVaccines.length === 0;
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <OverviewCard icon={PawPrint} title="Animal workspace" accent="bg-[#D26D53]"
          onClick={() => setActiveTab("animals")}
          text={`${stats.totalPets} animal${stats.totalPets === 1 ? "" : "s"} selected. Reports and exports use only this group.`} />

        <OverviewCard icon={DollarSign} title="Total tracked spend" accent="bg-[#556045]"
          onClick={() => setActiveTab("expense")}
          text={`$${money(stats.totalSpend)} across all selected animals.${topSpender ? ` Highest: ${topSpender.name} at $${money(topSpender.spend)}.` : ""}`} />

        <OverviewCard icon={AlertTriangle} title="Needs attention" accent={overdueReminders.length > 0 ? "bg-[#D26D53]" : "bg-[#8A5A22]"}
          to="/dashboard/reminders"
          text={overdueReminders.length > 0
            ? `${overdueReminders.length} overdue reminder${overdueReminders.length > 1 ? "s" : ""}. Go to Reminders to dispatch.`
            : "No overdue reminders right now."} />

        <OverviewCard icon={Syringe} title="Vaccine coverage" accent="bg-[#8A5A22]"
          onClick={() => setActiveTab("vaccines")}
          text={missingVaccines.length > 0
            ? `${missingVaccines.length} animal${missingVaccines.length > 1 ? "s" : ""} (${missingVaccines.map((p) => p.name).join(", ")}) have no vaccine records yet.`
            : "All selected animals have at least one vaccine record."} />

        <OverviewCard icon={HeartHandshake} title="Transfer-ready" accent="bg-[#556045]"
          onClick={() => setActiveTab("adoption")}
          text="Generate adoption packets and foster transfer records from the Transfer Packets tab." />

        <OverviewCard icon={FileText} title="Donor reports" accent="bg-[#2D2C28]"
          onClick={() => setActiveTab("expense")}
          text="Create donation-ready expense reports from the Expense Report tab. Download as PDF or email directly." />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="cream-card p-6 rounded-[26px]">
          <div className="eyebrow text-[#D26D53] mb-3">Quick actions</div>
          <h2 className="font-serif-display text-3xl mb-5">Get started fast</h2>
          <div className="space-y-2">
            {[
              { icon: PawPrint, label: "Add a new animal", sub: "Create a pet profile in the vault", to: "/dashboard/pets" },
              { icon: Bell, label: "Schedule reminders", sub: "Set up vaccine and care dates", to: "/dashboard/reminders" },
              { icon: ClipboardList, label: "Analyze a vet bill", sub: "Upload or paste an estimate", to: "/dashboard/analyze" },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="flex items-center gap-4 rounded-2xl border border-[#E5E2D9] bg-white/50 p-4 hover:border-[#D26D53] transition group">
                <span className="w-10 h-10 rounded-xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center shrink-0">
                  <a.icon size={17} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{a.label}</div>
                  <p className="text-xs text-[#65635C] mt-0.5">{a.sub}</p>
                </div>
                <ArrowRight size={15} className="text-[#D26D53] transition-transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-[26px] bg-[#556045] text-white p-6 relative overflow-hidden">
          <div className="absolute right-0 bottom-0 opacity-10">
            <Heart size={200} />
          </div>
          <div className="relative">
            <div className="eyebrow text-[#E6AE2E] mb-3">Rescue mission</div>
            <h2 className="font-serif-display text-3xl leading-tight">
              Every record is a story worth keeping.
            </h2>
            <p className="mt-4 text-sm text-white/75 leading-relaxed max-w-lg">
              From intake to forever home, PetBill Shield keeps the full care
              history. Generate adoption packets with one click. Show donors
              exactly where every dollar went.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { n: stats.vaccineCount, l: "Vaccines" },
                { n: stats.medCount, l: "Medications" },
                { n: stats.invoiceCount, l: "Invoices" },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl bg-white/10 border border-white/10 p-3 text-center">
                  <div className="font-serif-display text-3xl">{s.n}</div>
                  <div className="text-xs text-white/60 mt-1">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ icon: Icon, title, text, accent, onClick, to }) {
  const content = (
    <>
      <div className="flex items-start gap-4">
        <span className={`w-11 h-11 rounded-2xl text-white inline-flex items-center justify-center shrink-0 ${accent}`}>
          <Icon size={18} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif-display text-xl leading-tight">{title}</h3>
          <p className="text-sm text-[#65635C] mt-1.5 leading-relaxed">{text}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#D26D53]">
            Open <ArrowRight size={12} />
          </span>
        </div>
      </div>
    </>
  );

  const className = "cream-card p-5 rounded-[22px] hover:shadow-md hover:border-[#D26D53]/40 transition-all text-left group";

  if (to) {
    return (
      <Link to={to} className={`block ${className}`}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`w-full ${className}`}>
      {content}
    </button>
  );
}

function AnimalsTab({ pets, records, timelines, reminders, expandedPet, setExpandedPet }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 4;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPets = useMemo(() => {
    if (!normalizedQuery) return pets;
    return pets.filter((pet) => {
      const haystack = [
        pet.name,
        pet.species,
        pet.breed,
        pet.vet_clinic_name,
        pet.insurance_provider,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [pets, normalizedQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredPets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedPets = filteredPets.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = filteredPets.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredPets.length);

  useEffect(() => {
    setPage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (pets.length === 0) {
    return (
      <div className="cream-card p-12 rounded-[28px] text-center">
        <PawPrint size={32} className="mx-auto text-[#D26D53] mb-4" />
        <h3 className="font-serif-display text-3xl">No animals selected.</h3>
        <p className="text-sm text-[#65635C] mt-2">Select at least one animal above.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="font-serif-display text-3xl">Animal profiles</h2>
          <p className="text-xs text-[#65635C] mt-1">
            Search selected animals and page through profiles 4 at a time.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="relative min-w-0 sm:w-80">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search animal profiles"
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white px-9 py-2.5 text-sm outline-none focus:border-[#D26D53]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg inline-flex items-center justify-center text-[#8A887F] hover:bg-[#F2F0E9] hover:text-[#2D2C28]"
                aria-label="Clear animal profile search"
              >
                <X size={13} />
              </button>
            )}
          </label>
          <span className="chip chip-neutral">{filteredPets.length} of {pets.length} animals</span>
        </div>
      </div>

      {filteredPets.length === 0 ? (
        <div className="cream-card p-10 rounded-[24px] text-center">
          <Search size={26} className="mx-auto text-[#D26D53] mb-3" />
          <h3 className="font-serif-display text-2xl">No matching animals.</h3>
          <p className="text-sm text-[#65635C] mt-1">Try searching by name, species, breed, clinic, or insurer.</p>
        </div>
      ) : pagedPets.map((pet) => {
        const petRecords = records.filter((r) => r.pet_id === pet.pet_id);
        const petReminders = reminders.filter((r) => r.pet_id === pet.pet_id);
        const spend = petRecords.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
        const vaccines = petRecords.filter((r) => r.record_type === "vaccine");
        const meds = petRecords.filter((r) => r.record_type === "medication");
        const visits = petRecords.filter((r) => r.record_type === "visit");
        const img = getImageUrl(pet.picture);
        const isOpen = expandedPet === pet.pet_id;
        const timeline = timelines[pet.pet_id];

        return (
          <div key={pet.pet_id} className="cream-card rounded-[24px] overflow-hidden">
            <button
              onClick={() => setExpandedPet(isOpen ? null : pet.pet_id)}
              className="w-full text-left p-5 flex items-center gap-4 hover:bg-[#F5F2EC] transition"
            >
              <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-[#2D2C28]">
                {img ? (
                  <img src={img} alt={pet.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/50">
                    <PawPrint size={24} />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-base">{pet.name}</span>
                  <span className="chip chip-neutral capitalize">{pet.species || "pet"}</span>
                  {pet.breed && <span className="text-xs text-[#65635C]">{pet.breed}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-[#65635C]">
                  {pet.age_years && <span>{pet.age_years}y old</span>}
                  <span>{petRecords.length} records</span>
                  <span className="font-semibold text-[#D26D53]">${money(spend)}</span>
                  {vaccines.length > 0 && <span>{vaccines.length} vaccines</span>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  to={`/dashboard/pets/${pet.pet_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-semibold text-[#D26D53] hover:underline"
                >
                  Open profile
                </Link>
                {isOpen ? <ChevronUp size={16} className="text-[#65635C]" /> : <ChevronDown size={16} className="text-[#65635C]" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-[#E5E2D9] p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                  <InfoBlock label="Insurance" value={pet.insurance_provider || "None"} />
                  <InfoBlock label="Weight" value={pet.weight_lbs ? `${pet.weight_lbs} lbs` : "Unknown"} />
                  <InfoBlock label="Sex" value={pet.sex || "Unknown"} />
                  <InfoBlock label="Vet clinic" value={pet.vet_clinic_name || "Not listed"} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <RecordSection title="Vaccines" items={vaccines} color="text-[#556045]" />
                  <RecordSection title="Medications" items={meds} color="text-[#8A5A22]" />
                  <RecordSection title="Visits" items={visits} color="text-[#D26D53]" />
                </div>

                {petReminders.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4">
                    <div className="eyebrow mb-2">Reminders</div>
                    <div className="space-y-1.5">
                      {petReminders.slice(0, 3).map((r) => (
                        <div key={r.reminder_id} className="flex items-center gap-2 text-xs">
                          <Bell size={12} className="text-[#D26D53]" />
                          <span className="font-medium">{r.title}</span>
                          <span className="text-[#65635C]">· {safeDate(r.scheduled_for)}</span>
                          <span className={`ml-auto chip capitalize text-[10px] ${r.status === "sent" ? "chip-wait" : "chip-neutral"}`}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {timeline?.summary && (
                  <div className="mt-4 rounded-2xl bg-[#2D2C28] text-white p-4">
                    <div className="eyebrow text-[#E6AE2E] mb-2">Health timeline summary</div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <div className="font-serif-display text-2xl">${money(timeline.summary.total_spent_usd)}</div>
                        <div className="text-xs text-white/60">Total spent</div>
                      </div>
                      <div>
                        <div className="font-serif-display text-2xl">${money(timeline.summary.total_reimbursement_usd)}</div>
                        <div className="text-xs text-white/60">Reimbursed</div>
                      </div>
                      <div>
                        <div className="font-serif-display text-2xl">{timeline.summary.event_count || 0}</div>
                        <div className="text-xs text-white/60">Events</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {filteredPets.length > pageSize && (
        <div className="cream-card rounded-[20px] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-[#65635C]">
            Showing {rangeStart}-{rangeEnd} of {filteredPets.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] disabled:opacity-40 hover:text-[#2D2C28]"
            >
              Previous
            </button>
            <span className="text-xs font-semibold text-[#65635C]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] disabled:opacity-40 hover:text-[#2D2C28]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordSection({ title, items, color }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4">
      <div className={`eyebrow mb-2 ${color}`}>{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-[#8A887F]">No {title.toLowerCase()} records.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 4).map((r, i) => (
            <li key={i} className="text-xs">
              <span className="font-medium">{r.title || r.record_type}</span>
              <span className="text-[#65635C]"> · {safeDate(r.date || r.created_at)}</span>
            </li>
          ))}
          {items.length > 4 && (
            <li className="text-xs text-[#D26D53] font-semibold">+{items.length - 4} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="rounded-xl border border-[#E5E2D9] bg-white/50 p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-[#8A887F]">{label}</div>
      <div className="font-semibold text-sm mt-1 truncate">{value}</div>
    </div>
  );
}

function FosterOpsTab({ pets, records, reminders, ops, loading, onRefresh }) {
  const firstPetId = pets[0]?.pet_id || "";
  const [saving, setSaving] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({
    pet_id: firstPetId,
    foster_name: "",
    foster_email: "",
    start_date: new Date().toISOString().slice(0, 10),
    location: "",
    comfort_level: "routine",
    capacity_notes: "",
    notes: "",
  });
  const [updateForm, setUpdateForm] = useState({
    pet_id: firstPetId,
    week_of: new Date().toISOString().slice(0, 10),
    appetite: "",
    energy: "",
    behavior: "",
    meds_given: "",
    concerns: "",
    wins: "",
    supplies_needed: "",
    notes: "",
  });
  const [supplyForm, setSupplyForm] = useState({
    pet_id: firstPetId,
    item: "",
    quantity: "",
    urgency: "normal",
    notes: "",
  });
  const [bioForm, setBioForm] = useState({
    pet_id: firstPetId,
    tone: "warm",
    notes: "",
  });

  useEffect(() => {
    if (!firstPetId) return;
    setAssignmentForm((f) => ({ ...f, pet_id: f.pet_id || firstPetId }));
    setUpdateForm((f) => ({ ...f, pet_id: f.pet_id || firstPetId }));
    setSupplyForm((f) => ({ ...f, pet_id: f.pet_id || firstPetId }));
    setBioForm((f) => ({ ...f, pet_id: f.pet_id || firstPetId }));
  }, [firstPetId]);

  const activeAssignments = useMemo(
    () => (ops.assignments || []).filter((a) => a.status === "active"),
    [ops.assignments]
  );
  const recentUpdates = useMemo(
    () => (ops.weekly_updates || []).slice(0, 6),
    [ops.weekly_updates]
  );
  const supplyRequests = useMemo(
    () => ops.supply_requests || [],
    [ops.supply_requests]
  );
  const bios = useMemo(
    () => ops.bios || [],
    [ops.bios]
  );

  const readiness = useMemo(() => {
    return pets.map((pet) => {
      const petRecords = records.filter((r) => r.pet_id === pet.pet_id);
      const petReminders = reminders.filter((r) => r.pet_id === pet.pet_id);
      const overdue = petReminders.filter(
        (r) => r.status === "pending" && r.scheduled_for && new Date(r.scheduled_for) < new Date()
      );
      const hasActiveAssignment = activeAssignments.some((a) => a.pet_id === pet.pet_id);
      const hasBio = bios.some((b) => b.pet_id === pet.pet_id);
      const checks = [
        { label: "Profile basics", done: Boolean(pet.name && pet.species) },
        { label: "Vaccine record", done: petRecords.some((r) => r.record_type === "vaccine") },
        { label: "Care records", done: petRecords.some((r) => ["visit", "lab", "medication", "note"].includes(r.record_type)) },
        { label: "Foster assigned", done: hasActiveAssignment },
        { label: "Public bio", done: hasBio },
        { label: "No overdue reminders", done: overdue.length === 0 },
      ];
      const done = checks.filter((c) => c.done).length;
      return {
        pet,
        checks,
        score: Math.round((done / checks.length) * 100),
        blockers: checks.filter((c) => !c.done).map((c) => c.label),
      };
    }).sort((a, b) => a.score - b.score);
  }, [pets, records, reminders, activeAssignments, bios]);

  function updatePetScopedForms(petId) {
    setAssignmentForm((f) => ({ ...f, pet_id: petId }));
    setUpdateForm((f) => ({ ...f, pet_id: petId }));
    setSupplyForm((f) => ({ ...f, pet_id: petId }));
    setBioForm((f) => ({ ...f, pet_id: petId }));
  }

  async function saveAssignment(e) {
    e.preventDefault();
    if (!assignmentForm.pet_id || !assignmentForm.foster_name.trim()) {
      toast.error("Choose an animal and enter a foster name.");
      return;
    }
    setSaving("assignment");
    try {
      await api.post("/rescue/foster-assignments", assignmentForm);
      toast.success("Foster assignment saved.");
      setAssignmentForm((f) => ({ ...f, foster_name: "", foster_email: "", location: "", capacity_notes: "", notes: "" }));
      await onRefresh();
    } catch {
      toast.error("Could not save foster assignment.");
    } finally {
      setSaving("");
    }
  }

  async function saveWeeklyUpdate(e) {
    e.preventDefault();
    if (!updateForm.pet_id) {
      toast.error("Choose an animal for the update.");
      return;
    }
    setSaving("update");
    try {
      await api.post("/rescue/weekly-updates", updateForm);
      toast.success("Weekly foster update saved.");
      setUpdateForm((f) => ({
        ...f,
        appetite: "",
        energy: "",
        behavior: "",
        meds_given: "",
        concerns: "",
        wins: "",
        supplies_needed: "",
        notes: "",
      }));
      await onRefresh();
    } catch {
      toast.error("Could not save weekly update.");
    } finally {
      setSaving("");
    }
  }

  async function saveSupplyRequest(e) {
    e.preventDefault();
    if (!supplyForm.item.trim()) {
      toast.error("Enter the supply item.");
      return;
    }
    setSaving("supply");
    try {
      await api.post("/rescue/supply-requests", supplyForm);
      toast.success("Supply request added.");
      setSupplyForm((f) => ({ ...f, item: "", quantity: "", notes: "" }));
      await onRefresh();
    } catch {
      toast.error("Could not add supply request.");
    } finally {
      setSaving("");
    }
  }

  async function generateBio(e) {
    e.preventDefault();
    if (!bioForm.pet_id) {
      toast.error("Choose an animal for the bio.");
      return;
    }
    setSaving("bio");
    try {
      await api.post("/rescue/public-bio", bioForm);
      toast.success("Public bio generated.");
      setBioForm((f) => ({ ...f, notes: "" }));
      await onRefresh();
    } catch {
      toast.error("Could not generate public bio.");
    } finally {
      setSaving("");
    }
  }

  async function updateAssignmentStatus(assignmentId, status) {
    setSaving(`assignment-${assignmentId}`);
    try {
      await api.patch(`/rescue/foster-assignments/${assignmentId}`, { status });
      toast.success("Assignment updated.");
      await onRefresh();
    } catch {
      toast.error("Could not update assignment.");
    } finally {
      setSaving("");
    }
  }

  async function updateSupplyStatus(requestId, status) {
    setSaving(`supply-${requestId}`);
    try {
      await api.patch(`/rescue/supply-requests/${requestId}`, { status });
      toast.success("Supply request updated.");
      await onRefresh();
    } catch {
      toast.error("Could not update supply request.");
    } finally {
      setSaving("");
    }
  }

  async function copyBio(bio) {
    const goodFit = Array.isArray(bio.good_fit) ? bio.good_fit : bio.good_fit ? [bio.good_fit] : [];
    const text = `${bio.headline || ""}\n\n${bio.bio || ""}\n\nGood fit:\n${goodFit.map((x) => `- ${x}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(text.trim());
      toast.success("Bio copied.");
    } catch {
      toast.error("Copy failed.");
    }
  }

  if (pets.length === 0) {
    return (
      <div className="cream-card p-12 rounded-[28px] text-center">
        <Users size={32} className="mx-auto text-[#D26D53] mb-4" />
        <h3 className="font-serif-display text-3xl">No animals selected.</h3>
        <p className="text-sm text-[#65635C] mt-2">Select animals above to manage foster operations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Foster operations</div>
          <h2 className="font-serif-display text-4xl">Foster Ops</h2>
          <p className="text-sm text-[#65635C] mt-2 max-w-2xl">
            Track placements, collect weekly updates, score adoption readiness, draft public bios, and manage supply requests.
          </p>
        </div>
        <button onClick={onRefresh} disabled={loading} className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
          Refresh
        </button>
      </div>

      <div className="cream-card p-4 rounded-[24px] flex flex-col md:flex-row md:items-center gap-3">
        <div className="text-sm font-semibold text-[#2D2C28] shrink-0">Working animal</div>
        <select
          value={assignmentForm.pet_id || firstPetId}
          onChange={(e) => updatePetScopedForms(e.target.value)}
          className="w-full md:max-w-sm rounded-2xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
        >
          {pets.map((pet) => (
            <option key={pet.pet_id} value={pet.pet_id}>{pet.name}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          <MiniStat label="Active fosters" value={activeAssignments.length} />
          <MiniStat label="Weekly updates" value={ops.weekly_updates?.length || 0} />
          <MiniStat label="Open supplies" value={supplyRequests.filter((r) => r.status !== "fulfilled").length} />
          <MiniStat label="Public bios" value={bios.length} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <form onSubmit={saveAssignment} className="cream-card p-6 rounded-[24px] space-y-4">
          <SectionTitle icon={Home} title="Foster Assignment Tracker" sub="Log who has each animal and keep placement status current." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Animal">
              <PetSelect value={assignmentForm.pet_id} pets={pets} onChange={(pet_id) => setAssignmentForm((f) => ({ ...f, pet_id }))} />
            </Field>
            <Field label="Foster name">
              <TextInput value={assignmentForm.foster_name} onChange={(foster_name) => setAssignmentForm((f) => ({ ...f, foster_name }))} placeholder="Name" />
            </Field>
            <Field label="Foster email">
              <TextInput value={assignmentForm.foster_email} onChange={(foster_email) => setAssignmentForm((f) => ({ ...f, foster_email }))} placeholder="name@example.com" type="email" />
            </Field>
            <Field label="Start date">
              <TextInput value={assignmentForm.start_date} onChange={(start_date) => setAssignmentForm((f) => ({ ...f, start_date }))} type="date" />
            </Field>
            <Field label="Location">
              <TextInput value={assignmentForm.location} onChange={(location) => setAssignmentForm((f) => ({ ...f, location }))} placeholder="City, area, or foster home" />
            </Field>
            <Field label="Care load">
              <select value={assignmentForm.comfort_level} onChange={(e) => setAssignmentForm((f) => ({ ...f, comfort_level: e.target.value }))} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]">
                <option value="routine">Routine</option>
                <option value="medical">Medical foster</option>
                <option value="behavior">Behavior support</option>
                <option value="bottle">Bottle babies</option>
                <option value="quarantine">Quarantine</option>
              </select>
            </Field>
          </div>
          <Field label="Placement notes">
            <textarea value={assignmentForm.notes} onChange={(e) => setAssignmentForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" placeholder="Restrictions, handoff context, pickup notes, supplies sent." />
          </Field>
          <button disabled={saving === "assignment"} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {saving === "assignment" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save assignment
          </button>
        </form>

        <form onSubmit={saveWeeklyUpdate} className="cream-card p-6 rounded-[24px] space-y-4">
          <SectionTitle icon={ClipboardList} title="Foster Weekly Update Form" sub="Capture the weekly check-in without needing a separate spreadsheet." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Animal">
              <PetSelect value={updateForm.pet_id} pets={pets} onChange={(pet_id) => setUpdateForm((f) => ({ ...f, pet_id }))} />
            </Field>
            <Field label="Week of">
              <TextInput value={updateForm.week_of} onChange={(week_of) => setUpdateForm((f) => ({ ...f, week_of }))} type="date" />
            </Field>
            <Field label="Appetite">
              <TextInput value={updateForm.appetite} onChange={(appetite) => setUpdateForm((f) => ({ ...f, appetite }))} placeholder="Normal, picky, changed..." />
            </Field>
            <Field label="Energy">
              <TextInput value={updateForm.energy} onChange={(energy) => setUpdateForm((f) => ({ ...f, energy }))} placeholder="Low, normal, high..." />
            </Field>
          </div>
          <Field label="Behavior and wins">
            <textarea value={updateForm.behavior} onChange={(e) => setUpdateForm((f) => ({ ...f, behavior: e.target.value }))} rows={3} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" placeholder="House manners, social notes, routines, progress." />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Meds given">
              <TextInput value={updateForm.meds_given} onChange={(meds_given) => setUpdateForm((f) => ({ ...f, meds_given }))} placeholder="As documented by rescue or vet" />
            </Field>
            <Field label="Supplies needed">
              <TextInput value={updateForm.supplies_needed} onChange={(supplies_needed) => setUpdateForm((f) => ({ ...f, supplies_needed }))} placeholder="Food, litter, meds, crate..." />
            </Field>
          </div>
          <Field label="Concerns or notes">
            <textarea value={updateForm.concerns || updateForm.notes} onChange={(e) => setUpdateForm((f) => ({ ...f, concerns: e.target.value }))} rows={3} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" placeholder="Anything coordinator should review." />
          </Field>
          <button disabled={saving === "update"} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {saving === "update" ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
            Save weekly update
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-5">
        <div className="cream-card p-6 rounded-[24px]">
          <SectionTitle icon={ShieldCheck} title="Adoption Readiness Score" sub="A quick operational checklist based on records, assignment, reminders, and public bio status." />
          <div className="mt-4 space-y-3">
            {readiness.map(({ pet, score, blockers }) => (
              <div key={pet.pet_id} className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#2D2C28] text-white inline-flex items-center justify-center font-serif-display text-xl">
                    {score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{pet.name}</div>
                    <div className="mt-1 h-2 rounded-full bg-[#ECE8DF] overflow-hidden">
                      <div className={`h-full ${score >= 80 ? "bg-[#556045]" : score >= 50 ? "bg-[#E6AE2E]" : "bg-[#D26D53]"}`} style={{ width: `${score}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#65635C]">{score}%</span>
                </div>
                <p className="mt-3 text-xs text-[#65635C]">
                  {blockers.length ? `Still needs: ${blockers.slice(0, 4).join(", ")}${blockers.length > 4 ? "..." : ""}` : "Ready from the documented checklist."}
                </p>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={saveSupplyRequest} className="cream-card p-6 rounded-[24px] space-y-4">
          <SectionTitle icon={Boxes} title="Supply Request Tracker" sub="Track food, meds, crates, litter, and foster support needs." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Animal">
              <PetSelect value={supplyForm.pet_id} pets={pets} onChange={(pet_id) => setSupplyForm((f) => ({ ...f, pet_id }))} allowBlank />
            </Field>
            <Field label="Urgency">
              <select value={supplyForm.urgency} onChange={(e) => setSupplyForm((f) => ({ ...f, urgency: e.target.value }))} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]">
                <option value="normal">Normal</option>
                <option value="soon">Needed soon</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Item">
              <TextInput value={supplyForm.item} onChange={(item) => setSupplyForm((f) => ({ ...f, item }))} placeholder="Food, medication, crate..." />
            </Field>
            <Field label="Quantity">
              <TextInput value={supplyForm.quantity} onChange={(quantity) => setSupplyForm((f) => ({ ...f, quantity }))} placeholder="1 bag, 2 weeks, etc." />
            </Field>
          </div>
          <Field label="Request notes">
            <textarea value={supplyForm.notes} onChange={(e) => setSupplyForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" placeholder="Drop-off details, brand, size, restrictions." />
          </Field>
          <button disabled={saving === "supply"} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {saving === "supply" ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />}
            Add request
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <form onSubmit={generateBio} className="cream-card p-6 rounded-[24px] space-y-4">
          <SectionTitle icon={FileHeart} title="Public Bio Generator" sub="Draft adopter-friendly listing copy from safe, documented details." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Animal">
              <PetSelect value={bioForm.pet_id} pets={pets} onChange={(pet_id) => setBioForm((f) => ({ ...f, pet_id }))} />
            </Field>
            <Field label="Tone">
              <select value={bioForm.tone} onChange={(e) => setBioForm((f) => ({ ...f, tone: e.target.value }))} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]">
                <option value="warm">Warm</option>
                <option value="playful">Playful</option>
                <option value="calm">Calm and gentle</option>
                <option value="direct">Direct and practical</option>
              </select>
            </Field>
          </div>
          <Field label="Coordinator notes">
            <textarea value={bioForm.notes} onChange={(e) => setBioForm((f) => ({ ...f, notes: e.target.value }))} rows={4} className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" placeholder="Personality, ideal home, confirmed adoption notes, anything to avoid." />
          </Field>
          <button disabled={saving === "bio"} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {saving === "bio" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate bio
          </button>
        </form>

        <div className="cream-card p-6 rounded-[24px]">
          <SectionTitle icon={Clipboard} title="Recent foster activity" sub="Latest assignments, updates, supply requests, and bios." />
          <div className="mt-4 space-y-4">
            <ActivityList title="Active assignments" empty="No active foster assignments yet.">
              {activeAssignments.slice(0, 4).map((item) => (
                <div key={item.assignment_id} className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-3 text-sm">
                  <div className="font-semibold">{item.pet_name} with {item.foster_name}</div>
                  <div className="text-xs text-[#65635C] mt-1">{item.location || "Location not listed"} · {safeDate(item.start_date)}</div>
                  <button
                    type="button"
                    onClick={() => updateAssignmentStatus(item.assignment_id, "ended")}
                    disabled={saving === `assignment-${item.assignment_id}`}
                    className="mt-2 text-xs font-semibold text-[#D26D53] disabled:opacity-60"
                  >
                    Mark ended
                  </button>
                </div>
              ))}
            </ActivityList>

            <ActivityList title="Weekly updates" empty="No weekly updates yet.">
              {recentUpdates.map((item) => (
                <div key={item.update_id} className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-3 text-sm">
                  <div className="font-semibold">{item.pet_name} · {safeDate(item.week_of || item.created_at)}</div>
                  <p className="text-xs text-[#65635C] mt-1 line-clamp-2">{item.behavior || item.concerns || item.notes || "Update saved."}</p>
                </div>
              ))}
            </ActivityList>

            <ActivityList title="Supply requests" empty="No supply requests yet.">
              {supplyRequests.slice(0, 5).map((item) => (
                <div key={item.request_id} className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{item.item}</div>
                      <div className="text-xs text-[#65635C] mt-1">{item.pet_name || "General"} · {item.quantity || "Quantity not listed"} · {item.urgency}</div>
                    </div>
                    <span className="chip chip-neutral capitalize">{item.status}</span>
                  </div>
                  {item.status !== "fulfilled" && (
                    <button
                      type="button"
                      onClick={() => updateSupplyStatus(item.request_id, "fulfilled")}
                      disabled={saving === `supply-${item.request_id}`}
                      className="mt-2 text-xs font-semibold text-[#D26D53] disabled:opacity-60"
                    >
                      Mark fulfilled
                    </button>
                  )}
                </div>
              ))}
            </ActivityList>

            <ActivityList title="Public bios" empty="No generated bios yet.">
              {bios.slice(0, 3).map((bio) => (
                <div key={bio.bio_id} className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-3 text-sm">
                  <div className="font-semibold">{bio.headline || bio.pet_name}</div>
                  <p className="text-xs text-[#65635C] mt-1 line-clamp-3">{bio.bio}</p>
                  <button type="button" onClick={() => copyBio(bio)} className="mt-2 text-xs font-semibold text-[#D26D53]">
                    Copy bio
                  </button>
                </div>
              ))}
            </ActivityList>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-10 h-10 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center shrink-0">
        <Icon size={17} />
      </span>
      <div>
        <h3 className="font-serif-display text-2xl leading-tight">{title}</h3>
        <p className="text-xs text-[#65635C] mt-1 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 px-3 py-2">
      <div className="font-serif-display text-2xl leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[#8A887F] mt-1">{label}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      placeholder={placeholder}
      className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
    />
  );
}

function PetSelect({ value, pets, onChange, allowBlank = false }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
    >
      {allowBlank && <option value="">General request</option>}
      {pets.map((pet) => (
        <option key={pet.pet_id} value={pet.pet_id}>{pet.name}</option>
      ))}
    </select>
  );
}

function ActivityList({ title, empty, children }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8A887F] mb-2">{title}</div>
      {items.length ? <div className="space-y-2">{items}</div> : <p className="text-xs text-[#65635C]">{empty}</p>}
    </div>
  );
}

function VaccineMatrix({ pets, records }) {
  const vaccineNames = useMemo(() => {
    const names = new Set();
    records.filter((r) => r.record_type === "vaccine").forEach((r) => names.add(r.title || "Vaccine"));
    return Array.from(names);
  }, [records]);

  const matrix = useMemo(() => {
    return pets.map((pet) => {
      const petVaccines = records.filter((r) => r.pet_id === pet.pet_id && r.record_type === "vaccine");
      const byName = {};
      petVaccines.forEach((r) => {
        byName[r.title || "Vaccine"] = r;
      });
      return { pet, byName };
    });
  }, [pets, records]);

  if (pets.length === 0) {
    return (
      <div className="cream-card p-10 rounded-[28px] text-center">
        <Syringe size={28} className="mx-auto text-[#D26D53] mb-3" />
        <h3 className="font-serif-display text-3xl">No animals selected.</h3>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Vaccine status</div>
          <h2 className="font-serif-display text-3xl">Vaccine matrix</h2>
          <p className="text-sm text-[#65635C] mt-1">All animals × all vaccine types at a glance.</p>
        </div>
        <span className="chip chip-neutral">{vaccineNames.length} vaccine types</span>
      </div>

      {vaccineNames.length === 0 ? (
        <div className="cream-card p-10 rounded-[28px] text-center">
          <p className="text-[#65635C] text-sm">No vaccine records found. Add vaccine records to pet profiles to see them here.</p>
          <Link to="/dashboard/pets" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53]">
            Go to Pet Vault <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="cream-card rounded-[28px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E2D9] bg-[#F5F2EC]">
                  <th className="text-left px-5 py-3.5 font-semibold text-[#2D2C28] w-[160px]">Animal</th>
                  {vaccineNames.map((name) => (
                    <th key={name} className="px-4 py-3.5 text-center font-semibold text-[#65635C] text-xs max-w-[120px]">
                      <span className="block truncate">{name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map(({ pet, byName }, i) => (
                  <tr key={pet.pet_id} className={`border-b border-[#E5E2D9] ${i % 2 === 0 ? "bg-[#FAF9F6]" : "bg-white"}`}>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold">{pet.name}</div>
                      <div className="text-xs text-[#65635C] capitalize">{pet.species}</div>
                    </td>
                    {vaccineNames.map((name) => {
                      const record = byName[name];
                      return (
                        <td key={name} className="px-4 py-3.5 text-center">
                          {record ? (
                            <div className="inline-flex flex-col items-center gap-1">
                              <span className="w-7 h-7 rounded-full bg-[#E7EBDD] text-[#556045] inline-flex items-center justify-center">
                                <Check size={14} />
                              </span>
                              <span className="text-[10px] text-[#65635C]">{safeDate(record.date || record.created_at)}</span>
                            </div>
                          ) : (
                            <span className="w-7 h-7 rounded-full bg-[#F4DAD3] text-[#8C2D14] inline-flex items-center justify-center mx-auto">
                              <X size={12} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-[#E5E2D9] flex items-center gap-6 text-xs text-[#65635C]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-[#E7EBDD] inline-flex items-center justify-center"><Check size={10} className="text-[#556045]" /></span>
              Vaccine recorded
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-[#F4DAD3] inline-flex items-center justify-center"><X size={9} className="text-[#8C2D14]" /></span>
              No record
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTab({ title, description, generatedReport, fallback, loading, onGenerate, onDownload, onCopy }) {
  const content = generatedReport || fallback;
  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">Rescue / Foster</div>
          <h2 className="font-serif-display text-4xl">{title}</h2>
          <p className="text-sm text-[#65635C] mt-2 max-w-2xl">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={onGenerate} disabled={loading} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {loading ? <><Loader2 size={14} className="animate-spin" />Generating…</> : <><Sparkles size={14} />Generate with AI</>}
          </button>
          <button onClick={onDownload} className="btn-ghost rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2">
            <Download size={14} />PDF
          </button>
          <button onClick={onCopy} className="btn-ghost rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2">
            <Clipboard size={14} />Copy
          </button>
        </div>
      </div>

      <div className="cream-card rounded-[24px] overflow-hidden">
        <div className="p-5 border-b border-[#E5E2D9] flex items-center gap-3">
          <FileText size={16} className="text-[#D26D53]" />
          <span className="font-semibold text-sm">Report preview</span>
        </div>
        <div className="p-5 max-h-[600px] overflow-y-auto text-sm whitespace-pre-wrap leading-relaxed text-[#2D2C28] font-mono text-xs">
          {content}
        </div>
      </div>
    </div>
  );
}

function AITab({ aiSummary, generatingAi, onGenerate, onDownload, onCopy }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">AI powered</div>
          <h2 className="font-serif-display text-4xl">Care summary</h2>
          <p className="text-sm text-[#65635C] mt-2 max-w-2xl">
            Generate a plain-English summary of care load, cost pressure, records, reminders, and next steps for the selected animals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onGenerate} disabled={generatingAi} className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
            {generatingAi ? <><Loader2 size={14} className="animate-spin" />Generating…</> : <><Sparkles size={14} />Generate AI summary</>}
          </button>
          {aiSummary && <>
            <button onClick={onDownload} className="btn-ghost rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2"><Download size={14} />PDF</button>
            <button onClick={onCopy} className="btn-ghost rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2"><Clipboard size={14} />Copy</button>
          </>}
        </div>
      </div>

      <div className="cream-card rounded-[24px] p-6">
        {!aiSummary ? (
          <div className="text-center py-8">
            <Sparkles size={28} className="mx-auto text-[#D26D53] mb-4" />
            <h3 className="font-serif-display text-3xl">Ready when you are.</h3>
            <p className="text-sm text-[#65635C] mt-2 max-w-md mx-auto">
              Click "Generate AI summary" to create a care overview for the selected animals.
            </p>
          </div>
        ) : (
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-[#2D2C28]">
            {aiSummary}
          </div>
        )}
      </div>
    </div>
  );
}

function EmailTab({ emailTo, setEmailTo, emailNote, setEmailNote, sendingEmail, onSend, reportPreview }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow text-[#D26D53] mb-1">Email report</div>
        <h2 className="font-serif-display text-4xl">Send to donors, fosters & vets</h2>
        <p className="text-sm text-[#65635C] mt-2 max-w-2xl">
          Email the current generated report to a donor, foster parent, veterinarian, adopter, board member, or partner rescue.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="cream-card p-6 rounded-[24px] space-y-4">
          <Field label="Recipient email">
            <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} type="email" placeholder="name@example.com"
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]" />
          </Field>

          <Field label="Optional note">
            <textarea value={emailNote} onChange={(e) => setEmailNote(e.target.value)} rows={3}
              placeholder="e.g. Please review the attached care summary for Oscar and Luna."
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none" />
          </Field>

          <button onClick={onSend} disabled={sendingEmail} className="w-full btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
            {sendingEmail ? <><Loader2 size={14} className="animate-spin" />Sending…</> : <><Send size={14} />Send report</>}
          </button>

          <p className="text-xs text-[#65635C] leading-relaxed">
            In test mode, emails only deliver to the address registered in your Resend account. After domain verification, reports deliver to any inbox.
          </p>
        </div>

        <div className="cream-card rounded-[24px] overflow-hidden">
          <div className="p-4 border-b border-[#E5E2D9] flex items-center gap-2">
            <Mail size={15} className="text-[#D26D53]" />
            <span className="font-semibold text-sm">Report preview</span>
          </div>
          <div className="p-4 max-h-[350px] overflow-y-auto text-xs whitespace-pre-wrap text-[#65635C] leading-relaxed">
            {reportPreview || "Generate a report first, then send it here."}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function buildLocalAiSummary({ pets, records, reminders, timelines, stats }) {
  const petProfiles = pets.map((p) => {
    const petRecords = records.filter((r) => r.pet_id === p.pet_id);
    const petReminders = reminders.filter((r) => r.pet_id === p.pet_id);
    const pending = petReminders.filter((r) => r.status === "pending");
    const overdue = pending.filter((r) => r.scheduled_for && new Date(r.scheduled_for) < new Date());
    const spend = petRecords.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
    const byType = petRecords.reduce((acc, r) => {
      const type = r.record_type || "note";
      acc[type] = acc[type] || [];
      acc[type].push(r);
      return acc;
    }, {});
    return { ...p, petRecords, petReminders, pending, overdue, spend, byType, timeline: timelines[p.pet_id] };
  });

  const topSpendPet = [...petProfiles].sort((a, b) => b.spend - a.spend)[0];
  const highAttention = petProfiles.filter((p) => p.overdue.length || p.pending.length >= 3 || p.spend >= 500);
  const recordGapLines = petProfiles.map((p) => {
    const gaps = [];
    if (!p.byType.vaccine?.length) gaps.push("vaccine history");
    if (!p.byType.medication?.length) gaps.push("medication list");
    if (!p.byType.invoice?.length) gaps.push("invoice history");
    if (!p.byType.visit?.length) gaps.push("visit notes");
    return `- ${p.name}: ${gaps.length ? gaps.join(", ") : "core records present in selected data"}`;
  });

  const animalSections = petProfiles.map((p) => {
    const recentRecords = [...p.petRecords]
      .sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0))
      .slice(0, 6);
    const nextReminders = [...p.pending]
      .sort((a, b) => new Date(a.scheduled_for || 0) - new Date(b.scheduled_for || 0))
      .slice(0, 4);
    return `${p.name}
Profile: ${p.species || "pet"}${p.breed ? ` · ${p.breed}` : ""}${p.age_years ? ` · ${p.age_years}y` : ""}${p.weight_lbs ? ` · ${p.weight_lbs} lb` : ""}
Tracked spend: $${money(p.spend)} · Records: ${p.petRecords.length} · Pending reminders: ${p.pending.length}${p.overdue.length ? ` · Overdue: ${p.overdue.length}` : ""}
Recent care history:
${recentRecords.length ? recentRecords.map((r) => `- ${r.date || (r.created_at || "").slice(0, 10) || "No date"} · ${r.record_type || "record"} · ${r.title || "Untitled record"}${r.amount_usd ? ` · $${money(r.amount_usd)}` : ""}`).join("\n") : "- Not documented in selected records."}
Upcoming follow-ups:
${nextReminders.length ? nextReminders.map((r) => `- ${r.title}${r.scheduled_for ? ` · ${new Date(r.scheduled_for).toLocaleDateString()}` : ""}${r.message ? ` · ${r.message}` : ""}`).join("\n") : "- No pending reminders documented."}
Handoff notes:
- Confirm current medications, vaccine status, microchip/spay-neuter status, diet, behavior notes, and restrictions before transfer.
- Share invoices and visit notes with adopter, foster, partner vet, or coordinator as appropriate.`;
  }).join("\n\n");

  return `Detailed Rescue / Foster Care Summary
Generated: ${todayLabel()}

EXECUTIVE SNAPSHOT
- Animals selected: ${stats.totalPets}
- Tracked spend: $${money(stats.totalSpend)}
- Records: ${stats.vaccineCount} vaccine · ${stats.medCount} medication · ${stats.invoiceCount} invoice
- Reminders: ${stats.upcomingReminders} upcoming · ${stats.overdueReminders} overdue
- Highest tracked spend: ${topSpendPet ? `${topSpendPet.name} at $${money(topSpendPet.spend)}` : "Not documented"}

ANIMAL-BY-ANIMAL CARE SUMMARY
${animalSections || "No animals selected."}

CARE LOAD AND PRIORITY REVIEW
${highAttention.length ? highAttention.map((p) => `- Higher admin attention: ${p.name} (${p.overdue.length} overdue reminders, ${p.pending.length} pending reminders, $${money(p.spend)} tracked spend).`).join("\n") : "- No high-pressure care load signals in the selected data."}
- Routine attention: review animals with no current reminders and add annual wellness, vaccine, medication, dental, and follow-up tasks where appropriate.

COST AND RESOURCE PRESSURE
- Total selected spend: $${money(stats.totalSpend)}
- Invoice count: ${stats.invoiceCount}
- Use invoices and claim notes for reimbursement, donor reporting, and board updates.
- Review any high-cost animal before placement or transfer so expected ongoing costs are clear.

RECORD COMPLETENESS AND MISSING DOCUMENTS
${recordGapLines.join("\n") || "- No record gaps found."}

NEXT 7 / 30 / 60 / 90 DAY PLAN
Next 7 days:
- Clear overdue reminders, confirm urgent transfer documents, and gather missing invoice or vet visit notes.
Next 30 days:
- Update vaccine, medication, microchip, spay/neuter, dental, and behavior records for each active foster animal.
Next 60 days:
- Prepare adoption or foster transfer packets for animals nearing placement.
Next 90 days:
- Review recurring costs, reimbursement status, preventive care schedules, and donor-ready expense reports.

QUESTIONS TO CONFIRM
- Which animals are closest to adoption, transfer, or vet recheck?
- Which records are required by the receiving foster, adopter, partner rescue, or clinic?
- Are any reimbursement or donor documentation packets missing invoices or decisions?
- Do any animals need updated medication, vaccine, dental, behavior, diet, or restriction notes?

SHAREABLE HANDOFF SUMMARY
This selected group includes ${stats.totalPets} animal(s), $${money(stats.totalSpend)} in tracked spend, ${stats.invoiceCount} invoice record(s), and ${stats.upcomingReminders} upcoming reminder(s). Review the animal-by-animal sections before sharing with fosters, adopters, vets, donors, or partner rescues.`;
}

function buildReportText({ pets, records, reminders, timelines, stats, aiSummary }) {
  return `RESCUE / FOSTER REPORT
Generated: ${todayLabel()} · PetBill Shield

SUMMARY
Animals: ${stats.totalPets} · Spend: $${money(stats.totalSpend)} · Vaccines: ${stats.vaccineCount} · Invoices: ${stats.invoiceCount} · Upcoming reminders: ${stats.upcomingReminders}

ANIMALS
${pets.length ? pets.map((p) => `- ${p.name} (${p.species || "pet"}${p.breed ? `, ${p.breed}` : ""})`).join("\n") : "No animals selected."}

EXPENSE REPORT
${buildExpenseReport(records, pets, timelines)}

ADOPTION / FOSTER TRANSFER PACKET
${buildAdoptionPacket(pets, records, timelines)}

VACCINE LOG
${buildVaccineLog(records, pets)}

UPCOMING REMINDERS
${reminders.length ? reminders.map((r) => `- ${r.title} — ${r.scheduled_for ? new Date(r.scheduled_for).toLocaleString() : "No date"}`).join("\n") : "No reminders scheduled."}

AI SUMMARY
${aiSummary || "No AI summary generated yet."}`;
}

function buildExpenseReport(records, pets, timelines = {}) {
  if (!pets.length) return "No animals selected.";
  const invoices = records.filter((r) => r.record_type === "invoice");
  const total = invoices.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
  const categoryTotals = invoices.reduce((acc, r) => {
    const key = r.category || "other";
    acc[key] = (acc[key] || 0) + (Number(r.amount_usd) || 0);
    return acc;
  }, {});
  const categoryLines = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => `- ${category}: $${money(amount)}`)
    .join("\n");
  const animalSpend = pets.map((pet) => {
    const petInvoices = invoices.filter((r) => r.pet_id === pet.pet_id);
    const spend = petInvoices.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
    return { pet, spend, invoiceCount: petInvoices.length };
  }).sort((a, b) => b.spend - a.spend);
  const highest = animalSpend[0];

  return `Comprehensive Expense Report — Generated: ${todayLabel()}

EXECUTIVE FINANCIAL SNAPSHOT
- Selected animals: ${pets.length}
- Total tracked invoice spend: $${money(total)}
- Invoice count: ${invoices.length}
- Highest-cost animal: ${highest ? `${highest.pet.name} at $${money(highest.spend)} across ${highest.invoiceCount} invoice(s)` : "Not documented"}
- Category breakdown:
${categoryLines || "- Not enough categorized invoices yet."}

ANIMAL-BY-ANIMAL EXPENSE DETAIL
${pets.map((pet) => {
    const petRecords = records.filter((r) => r.pet_id === pet.pet_id);
    const petInvoices = petRecords.filter((r) => r.record_type === "invoice");
    const petSpend = petInvoices.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0);
    const timeline = timelines[pet.pet_id];
    const categories = petInvoices.reduce((acc, r) => {
      const key = r.category || "other";
      acc[key] = (acc[key] || 0) + (Number(r.amount_usd) || 0);
      return acc;
    }, {});
    return `${pet.name} (${pet.species || "pet"}${pet.breed ? ` · ${pet.breed}` : ""})
Tracked invoice spend: $${money(petSpend)}
Invoice count: ${petInvoices.length}
Timeline net cost: ${timeline?.summary?.net_cost_usd != null ? `$${money(timeline.summary.net_cost_usd)}` : "Not documented"}
Category totals:
${Object.entries(categories).map(([category, amount]) => `- ${category}: $${money(amount)}`).join("\n") || "- No categorized invoices."}
Invoices:
${petInvoices.length ? petInvoices.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Invoice"} | ${r.category || "other"} | $${money(r.amount_usd)}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No invoice records documented."}
Documentation gaps:
- Confirm original receipt/invoice files are attached for reimbursement or donor records.
- Confirm whether any claim, grant, or donor reimbursement is pending for this animal.`;
  }).join("\n\n")}

COST DRIVERS AND CATEGORY REVIEW
${categoryLines || "- Add invoice categories to identify cost drivers."}

REIMBURSEMENT / DONOR DOCUMENTATION CHECKLIST
- Attach original invoices and receipts where available.
- Confirm claim IDs, insurer decisions, appeal letters, and reimbursement amounts.
- Mark whether costs are medical, preventive, foster supplies, medication, lab work, dental, surgery/procedure, or other.
- Flag high-cost animals for board, donor, grant, or reimbursement review.
- Keep proof of payment with each invoice record when possible.

BOARD / DONOR NARRATIVE
The selected animals account for $${money(total)} in tracked invoice spending across ${invoices.length} invoice record(s). Costs should be reviewed alongside each animal's timeline, placement plan, and reimbursement status before sharing with donors, board members, or partner rescues.

NEXT FINANCE ACTIONS
- Add missing invoice records and upload supporting receipts.
- Review high-cost animals for reimbursement or donor reporting opportunities.
- Generate transfer packets for animals with recent expensive care so adopters or fosters understand ongoing administrative needs.
- Reconcile claim decisions against actual reimbursement received.
- Export this report for donor updates, board review, or rescue bookkeeping.`;
}

function buildAdoptionPacket(pets, records, timelines = {}) {
  if (!pets.length) return "No animals selected.";
  return `Comprehensive Adoption / Foster Transfer Packet — Generated: ${todayLabel()}

TRANSFER READINESS SNAPSHOT
- Selected animals: ${pets.length}
- Purpose: adoption, foster transfer, clinic coordination, or partner rescue handoff.
- Confirm all vaccine, medication, microchip, spay/neuter, dental, lab, invoice, behavior, and restriction records before transfer.

ANIMAL-BY-ANIMAL TRANSFER PACKET
${pets.map((pet) => {
    const petRecords = records.filter((r) => r.pet_id === pet.pet_id);
    const vaccines = petRecords.filter((r) => r.record_type === "vaccine");
    const meds = petRecords.filter((r) => r.record_type === "medication");
    const visits = petRecords.filter((r) => r.record_type === "visit");
    const labs = petRecords.filter((r) => r.record_type === "lab");
    const invoices = petRecords.filter((r) => r.record_type === "invoice");
    const notes = petRecords.filter((r) => r.record_type === "note");
    const timeline = timelines[pet.pet_id];
    return `${pet.name}
Profile:
- Species: ${pet.species || "Unknown"}
- Breed: ${pet.breed || "Unknown"}
- Age: ${pet.age_years || "Needs confirmation"}
- Weight: ${pet.weight_lbs ? `${pet.weight_lbs} lbs` : "Needs confirmation"}
- Insurance: ${pet.insurance_provider || "Not documented"}
- Vet clinic: ${pet.vet_clinic_name || "Not documented"}
- Timeline events: ${timeline?.summary?.event_count || 0}
- Tracked spend: $${money(timeline?.summary?.total_spent_usd || 0)}

Vaccines:
${vaccines.length ? vaccines.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Vaccine"}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No vaccine records documented."}

Medications:
${meds.length ? meds.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Medication"}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No medication records documented."}

Visits and procedures:
${visits.length ? visits.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Visit"}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No visit records documented."}

Labs:
${labs.length ? labs.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Lab record"}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No lab records documented."}

Invoices and financial notes:
${invoices.length ? invoices.map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Invoice"} | $${money(r.amount_usd)}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No invoice records documented."}

General notes:
${notes.length ? notes.slice(0, 8).map((r) => `- ${safeDate(r.date || r.created_at)} | ${r.title || "Note"}${r.details ? ` | ${r.details}` : ""}`).join("\n") : "- No general notes documented."}

Transfer gaps to confirm:
- Vaccine proof, microchip, spay/neuter status, current medication instructions, diet, behavior notes, restrictions, and next vet follow-up.
- Confirm original medical records and invoices are available before handoff.`;
  }).join("\n\n==============================\n\n")}

FOSTER / ADOPTER INSTRUCTIONS
- Bring this packet and any original clinic records to the first vet visit.
- Confirm vaccine due dates, medication instructions, diet, activity restrictions, and follow-up schedule with the rescue coordinator or veterinarian.
- Keep receipts and invoices for any post-transfer reimbursement process.

VET / PARTNER RESCUE HANDOFF
- Review the animal-by-animal records above.
- Confirm missing medical proof, vaccine records, medication list, microchip/spay-neuter details, and follow-up needs.
- This packet is administrative and record-based; it does not diagnose or replace a veterinarian.

MISSING DOCUMENTS BEFORE TRANSFER
- Official vaccine certificates
- Microchip details
- Spay/neuter confirmation
- Current medication instructions
- Recent lab reports
- Behavior, diet, and restriction notes
- Invoices/receipts and claim documents where reimbursement may apply

FIRST 7 / 30 / 60 DAY FOLLOW-UP PLAN
First 7 days:
- Confirm records received, medication supply, diet, restrictions, and upcoming appointments.
First 30 days:
- Complete wellness check or rescue-required follow-up if not already scheduled.
First 60 days:
- Update foster/adopter notes and any reimbursement documentation.

SHAREABLE PLACEMENT SUMMARY
This transfer packet includes ${pets.length} animal(s) with available care records, invoices, vaccine/medication/visit history, and documentation gaps. Review missing items before sharing with adopters, fosters, partner rescues, or clinics.`;
}

function buildVaccineLog(records, pets) {
  if (!pets.length) return "No animals selected.";
  const vaccines = records.filter((r) => r.record_type === "vaccine");
  return `Vaccine Log — Generated: ${todayLabel()}

${pets.map((pet) => {
    const petVaccines = vaccines.filter((r) => r.pet_id === pet.pet_id);
    return `${pet.name} (${pet.species || "pet"})
${petVaccines.length ? petVaccines.map((r) => `  · ${safeDate(r.date || r.created_at)} | ${r.title || "Vaccine"} | ${r.details || ""}`).join("\n") : "  · No vaccine records."}`;
  }).join("\n\n---\n\n")}

Note: Confirm official vaccination status with veterinary records.`;
}
