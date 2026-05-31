import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import api from "../lib/api";
import FileDropzone from "../components/FileDropzone";
import {
  Loader2, FileSearch, Sparkles, Receipt, Brain,
  AlertTriangle, CheckCircle2, ChevronRight, Lock,
  MessageSquare, ListChecks, TrendingDown, ShieldCheck,
  Clock, FileText, Upload, ArrowRight, PawPrint,
} from "lucide-react";
import { useBilling } from "../lib/billing";

const SPECIES = ["dog", "cat", "rabbit", "bird", "reptile", "horse", "exotic"];
const FREE_MONTHLY_LIMIT = 1;

function Sk({ className }) {
  return <div className={`rounded-xl bg-[#E5E2D9]/70 animate-pulse ${className}`} />;
}

// Keys only — translated at render time via t()
const ANALYSIS_STEP_KEYS = [
  { labelKey: "analyze.reading_charges",   subKey: "analyze.reading_charges_sub",   icon: FileSearch   },
  { labelKey: "analyze.identifying_items", subKey: "analyze.identifying_items_sub", icon: Receipt      },
  { labelKey: "analyze.spotting_concerns", subKey: "analyze.spotting_concerns_sub", icon: AlertTriangle },
  { labelKey: "analyze.building_report",   subKey: "analyze.building_report_sub",   icon: Brain        },
];

const WAIT_TIP_KEYS = [
  "analyze.tip1",
  "analyze.tip2",
  "analyze.tip3",
  "analyze.tip4",
  "analyze.tip5",
];

const BENEFIT_KEYS = [
  { icon: FileText,      tk: "analyze.benefit_plain",    dk: "analyze.benefit_plain_desc"    },
  { icon: AlertTriangle, tk: "analyze.benefit_flags",    dk: "analyze.benefit_flags_desc"    },
  { icon: MessageSquare, tk: "analyze.benefit_questions",dk: "analyze.benefit_questions_desc"},
  { icon: ListChecks,    tk: "analyze.benefit_checklist",dk: "analyze.benefit_checklist_desc"},
  { icon: TrendingDown,  tk: "analyze.benefit_savings",  dk: "analyze.benefit_savings_desc"  },
  { icon: ShieldCheck,   tk: "analyze.benefit_claims",   dk: "analyze.benefit_claims_desc"   },
];

// ── Client-side image compression ────────────────────────────────────────────
// Resizes large phone photos before upload — saves bandwidth, storage, and
// speeds up AI vision processing. Skips non-images and files already < 800 KB.
async function compressImage(file, maxPx = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/") || file.size < 800 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) { height = Math.round(height * maxPx / width); width = maxPx; }
        else                 { width  = Math.round(width  * maxPx / height); height = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) { resolve(file); return; }
        resolve(new File(
          [blob],
          file.name.replace(/\.[^.]+$/, ".jpg"),
          { type: "image/jpeg", lastModified: Date.now() }
        ));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export default function Analyze() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { billing } = useBilling();

  const [file,        setFile]        = useState(null);
  const [typedText,   setTypedText]   = useState("");
  const [petName,     setPetName]     = useState("");
  const [petSpecies,  setPetSpecies]  = useState("dog");
  const [petId,       setPetId]       = useState("");
  const [city,        setCity]        = useState("");
  const [state,       setState]       = useState("");
  const [pets,        setPets]        = useState([]);
  const [petsLoading, setPetsLoading] = useState(true);
  const [previous,    setPrevious]    = useState([]);
  const [prevLoading, setPrevLoading] = useState(true);
  const [previousExpanded, setPreviousExpanded] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [stepIdx,     setStepIdx]     = useState(0);
  const [elapsed,     setElapsed]     = useState(0);
  const [tipIdx,      setTipIdx]      = useState(0);
  const [error,       setError]       = useState("");
  const [mode,        setMode]        = useState("upload");
  const stepTimer    = useRef(null);
  const elapsedTimer = useRef(null);
  const tipTimer     = useRef(null);

  const isFreeTier = !billing?.active || !billing?.plan_id || billing?.plan_id === "free" || billing?.plan_id === "free_tier";
  const usedThisMonth = isFreeTier
    ? previous.filter((a) => a.created_at && new Date(a.created_at) >= new Date(monthStart())).length
    : 0;
  const limitReached = isFreeTier && usedThisMonth >= FREE_MONTHLY_LIMIT;

  useEffect(() => {
    api.get("/pets")
      .then(({ data }) => setPets(data || []))
      .catch(() => {})
      .finally(() => setPetsLoading(false));
    api.get("/estimates")
      .then(({ data }) => setPrevious(data || []))
      .catch(() => {})
      .finally(() => setPrevLoading(false));
  }, []);

  function onPetSelect(id) {
    setPetId(id);
    const p = pets.find((x) => x.pet_id === id);
    if (p) { setPetName(p.name); setPetSpecies(p.species); }
    else   { setPetName(""); setPetSpecies("dog"); }
  }

  function startSteps() {
    setStepIdx(0);
    setElapsed(0);
    setTipIdx(0);
    let idx = 0;
    stepTimer.current = setInterval(() => {
      idx = Math.min(idx + 1, ANALYSIS_STEP_KEYS.length - 1);
      setStepIdx(idx);
    }, 3500);
    elapsedTimer.current = setInterval(() => {
      setElapsed((n) => n + 1);
    }, 1000);
    tipTimer.current = setInterval(() => {
      setTipIdx((n) => (n + 1) % WAIT_TIP_KEYS.length);
    }, 7000);
  }

  function stopSteps() {
    if (stepTimer.current)    { clearInterval(stepTimer.current);    stepTimer.current    = null; }
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
    if (tipTimer.current)     { clearInterval(tipTimer.current);     tipTimer.current     = null; }
  }

  async function submit() {
    if (limitReached) return;
    setError("");
    if (!file && !typedText.trim()) {
      setError("Please upload a file or paste your estimate text.");
      return;
    }
    if (!isFreeTier && !petId) {
      setError("Please select a pet from your vault before analyzing.");
      return;
    }
    setLoading(true);
    startSteps();
    try {
      // Compress large images client-side before sending (saves ~80% on phone photos)
      const uploadFile = file ? await compressImage(file) : null;

      const fd = new FormData();
      if (uploadFile)       fd.append("file", uploadFile);
      if (typedText.trim()) fd.append("typed_text", typedText.trim());
      if (petId)            fd.append("pet_id", petId);
      if (petName)          fd.append("pet_name", petName);
      if (petSpecies)       fd.append("pet_species", petSpecies);
      if (city.trim())      fd.append("city",  city.trim());
      if (state.trim())     fd.append("state", state.trim());
      fd.append("lang", i18n.language?.startsWith("es") ? "es" : "en");
      const { data } = await api.post("/estimates/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      navigate(`/dashboard/analyze/${data.analysis_id}`);
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || "Something went wrong";
      setError(typeof msg === "string" ? msg : "Something went wrong");
    } finally {
      stopSteps();
      setLoading(false);
    }
  }

  return (
    <div className="space-y-7 pb-16" data-testid="analyze-page">

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[30px] bg-[#2D2C28] text-white p-8 sm:p-10">
        <div className="absolute inset-0 opacity-[0.04] overflow-hidden">
          <FileSearch size={380} className="absolute -right-16 -bottom-16" />
        </div>

        <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-4 py-2 text-xs text-white/75 mb-6">
              <Sparkles size={13} />
              {t("analyze.eyebrow")}
            </div>

            <h1 className="font-serif-display text-5xl sm:text-6xl leading-[0.95]">
              {t("analyze.title")}
            </h1>

            <p className="mt-5 text-white/65 text-sm sm:text-base leading-relaxed max-w-xl">
              {t("analyze.subtitle")}
            </p>
          </div>

          <div className="lg:col-span-4">
            <div className="grid grid-cols-2 gap-3">
              <HeroPill label={t("analyze.previous_analyses")} value={previous.length || 0} />
              <HeroPill label={t("analyze.analyzing")} value={`${usedThisMonth}/${isFreeTier ? FREE_MONTHLY_LIMIT : "∞"}`} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Free tier banner ───────────────────────────────────────── */}
      {isFreeTier && (
        <div className={`rounded-[24px] border p-5 ${limitReached ? "bg-[#FFF4EE] border-[#F2C5B7]" : "bg-[#FAF9F6] border-[#E5E2D9]"}`}>
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${limitReached ? "bg-[#D26D53] text-white" : "bg-[#F2F0E9] text-[#D26D53]"}`}>
              {limitReached ? <Lock size={18} /> : <Sparkles size={18} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-[#2D2C28]">
                {limitReached
                  ? t("analyze.limit_reached")
                  : `Free · ${FREE_MONTHLY_LIMIT - usedThisMonth}/${FREE_MONTHLY_LIMIT}`}
              </div>
              <p className="text-xs text-[#65635C] mt-1 leading-relaxed">
                {limitReached
                  ? t("analyze.limit_reached")
                  : t("analyze.subtitle")}
              </p>
              <Link to="/dashboard/pricing" className="inline-flex items-center gap-1 mt-2.5 text-sm font-semibold text-[#D26D53] hover:gap-2 transition-all">
                {t("common.upgrade_plan")} <ChevronRight size={14} />
              </Link>
            </div>
            {!limitReached && (
              <div className="flex items-center gap-1.5 shrink-0">
                {Array.from({ length: FREE_MONTHLY_LIMIT }).map((_, i) => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${i < usedThisMonth ? "bg-[#D26D53]" : "bg-[#E5E2D9]"}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="lg:col-span-8 space-y-5">

          {/* Upload / paste toggle */}
          <div className="cream-card rounded-[28px] p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="font-semibold text-sm text-[#2D2C28]">{t("analyze.select_pet")}</div>
              <div className="inline-flex p-1 rounded-xl bg-[#F2F0E9] border border-[#E5E2D9] gap-0.5">
                <button
                  onClick={() => setMode("upload")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${mode === "upload" ? "bg-[#2D2C28] text-[#FAF9F6] shadow-sm" : "text-[#65635C] hover:text-[#2D2C28]"}`}
                  data-testid="tab-mode-upload"
                >
                  {t("analyze.upload_tab")}
                </button>
                <button
                  onClick={() => setMode("text")}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${mode === "text" ? "bg-[#2D2C28] text-[#FAF9F6] shadow-sm" : "text-[#65635C] hover:text-[#2D2C28]"}`}
                  data-testid="tab-mode-text"
                >
                  {t("analyze.paste_tab")}
                </button>
              </div>
            </div>

            {mode === "upload" ? (
              <div>
                <FileDropzone value={file} onChange={setFile} testId="estimate-dropzone" />
                <p className="text-xs text-[#8A887F] mt-3 flex items-center gap-1.5">
                  <Upload size={11} />
                  {t("analyze.drop_file")}
                </p>
              </div>
            ) : (
              <textarea
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                rows={10}
                placeholder={"Example:\nExam fee — $85\nBloodwork (CBC + chemistry) — $215\nDigital x-ray (2 views) — $260\nAnesthesia — $190\nDental cleaning + extractions — $450\nHospitalization (24h) — $620\nMedication — $95"}
                className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 resize-none"
                data-testid="typed-text-input"
              />
            )}
          </div>

          {/* ── Optional location for price transparency ── */}
          <div className="rounded-[20px] border border-[#E5E2D9] bg-[#FAF9F6] px-5 py-4">
            <p className="text-xs font-semibold text-[#65635C] mb-3 flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-[#E6AE2E]/20 text-[#8A5A24] inline-flex items-center justify-center text-[9px] font-bold shrink-0">✦</span>
              {t("analyze.transparency_title")}
            </p>
            <p className="text-[11px] text-[#8A887F] mb-3 leading-relaxed">
              {t("analyze.transparency_desc")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="eyebrow block mb-1 text-[#65635C]">{t("common.city")}</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder={t("analyze.city_placeholder")}
                  className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition"
                  data-testid="analyze-city"
                />
              </div>
              <div>
                <label className="eyebrow block mb-1 text-[#65635C]">{t("common.state")}</label>
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder={t("analyze.state_placeholder")}
                  maxLength={2}
                  className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#D26D53]/25 focus:border-[#D26D53] transition"
                  data-testid="analyze-state"
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-[20px] bg-[#FFF4EE] border border-[#F2C5B7] p-4 text-sm text-[#8C2D14] flex items-start gap-3" data-testid="analyze-error">
              <AlertTriangle size={16} className="text-[#D26D53] shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Loading state / Submit */}
          {loading ? (
            <div className="cream-card rounded-[28px] p-8 sm:p-10">
              <div className="flex flex-col items-center text-center gap-6">

                {/* Animated icon */}
                <div className="relative">
                  <div className="w-16 h-16 rounded-[22px] bg-[#FFF4EE] border border-[#F2C5B7] flex items-center justify-center">
                    <Sparkles size={26} className="text-[#D26D53] animate-pulse" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#2D2C28] flex items-center justify-center">
                    <Loader2 size={13} className="text-white animate-spin" />
                  </div>
                </div>

                {/* Title + live elapsed */}
                <div>
                  <div className="font-serif-display text-2xl">{t("analyze.analyzing")}</div>
                  <p className="text-sm text-[#65635C] mt-1.5 tabular-nums">
                    {elapsed < 4  ? "…"
                    : `${elapsed}s`}
                  </p>
                </div>

                {/* Steps */}
                <div className="w-full max-w-sm space-y-2">
                  {ANALYSIS_STEP_KEYS.map(({ labelKey, subKey, icon: Icon }, i) => {
                    const label = t(labelKey); const sub = t(subKey);
                    const done   = i < stepIdx;
                    const active = i === stepIdx;
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-500 ${
                          active ? "bg-[#FFF4EE] border border-[#F2C5B7]" :
                          done   ? "bg-[#F0FBF4] border border-[#C8E8D4]" :
                                   "bg-[#FAF9F6] border border-[#E5E2D9] opacity-40"
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          active ? "bg-[#D26D53] text-white" :
                          done   ? "bg-[#2F6B45] text-white" :
                                   "bg-[#E5E2D9] text-[#8A887F]"
                        }`}>
                          {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium leading-snug ${active ? "text-[#2D2C28]" : done ? "text-[#2F6B45]" : "text-[#8A887F]"}`}>
                            {label}
                          </p>
                          {active && (
                            <p className="text-xs text-[#8A887F] mt-0.5 leading-relaxed">{sub}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Rotating tip */}
                <div className="rounded-2xl bg-[#F2F0E9] border border-[#E5E2D9] px-4 py-3 max-w-sm w-full text-left">
                  <p className="text-xs text-[#65635C] leading-relaxed">
                    <span className="font-semibold text-[#2D2C28]">{t("analyze.tip_did_you_know")}</span>{" "}
                    {t(WAIT_TIP_KEYS[tipIdx])}
                  </p>
                </div>

              </div>
            </div>
          ) : (
            <button
              onClick={submit}
              disabled={loading || limitReached}
              className="btn-primary w-full rounded-[20px] px-6 py-4 text-sm font-semibold inline-flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
              data-testid="analyze-submit"
            >
              {limitReached
                ? <><Lock size={16} /> {t("analyze.limit_reached")}</>
                : <><Sparkles size={16} /> {t("analyze.analyze_btn")}</>
              }
            </button>
          )}

          {/* Previous analyses */}
          <div className="cream-card rounded-[28px] p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <div className="eyebrow">{t("analyze.previous_analyses")}</div>
                {previous.length > 0 && (
                  <span className="text-xs text-[#65635C]">{previous.length} total</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviousExpanded((v) => !v)}
                className="w-full sm:w-auto rounded-xl border border-[#E5E2D9] px-3 py-2 text-xs font-semibold text-[#65635C] inline-flex items-center justify-center gap-2 hover:border-[#D26D53] hover:text-[#D26D53] transition"
                aria-expanded={previousExpanded}
              >
                {previousExpanded ? "Hide" : "Show"}
                <ChevronRight size={13} className={`transition-transform ${previousExpanded ? "rotate-90" : ""}`} />
              </button>
            </div>

            {!previousExpanded ? null : prevLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-2xl border border-[#E5E2D9] p-4 space-y-2">
                    <Sk className="h-4 w-40" />
                    <Sk className="h-3 w-28" />
                    <Sk className="h-3 w-full mt-1" />
                  </div>
                ))}
              </div>
            ) : previous.length === 0 ? (
              <div className="rounded-2xl bg-[#F8F5EE] border border-[#E5E2D9] p-8 text-center">
                <FileSearch size={28} className="text-[#C5C2BB] mx-auto mb-3" />
                <p className="text-sm font-semibold text-[#65635C]">{t("analyze.no_previous")}</p>
                <p className="text-xs text-[#8A887F] mt-1">{t("analyze.subtitle")}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {previous.map((a) => (
                  <button
                    key={a.analysis_id}
                    onClick={() => navigate(`/dashboard/analyze/${a.analysis_id}`)}
                    className="w-full text-left rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 hover:border-[#D26D53]/50 hover:bg-white transition-all group"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {a.pet_name ? `${a.pet_name}'s bill analysis` : "Pet bill analysis"}
                        </div>
                        <div className="text-xs text-[#8A887F] mt-0.5 flex items-center gap-1.5">
                          <Clock size={10} />
                          {a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          <span className="capitalize">· {a.source_type || "file"}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {a.estimated_total_usd != null && (
                          <div className="rounded-xl bg-[#E8F5EC] text-[#2F6B45] text-xs font-semibold px-3 py-1.5">
                            ${Number(a.estimated_total_usd).toFixed(2)}
                          </div>
                        )}
                        <ChevronRight size={15} className="text-[#C5C2BB] group-hover:text-[#D26D53] transition-colors" />
                      </div>
                    </div>
                    {a.summary && (
                      <p className="text-xs text-[#65635C] mt-2.5 line-clamp-2 leading-relaxed">{a.summary}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-5">

          {/* Pet selector */}
          <div className="cream-card rounded-[28px] p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-7 h-7 rounded-xl bg-[#F2E5DE] flex items-center justify-center text-[#D26D53]">
                <PawPrint size={13} />
              </span>
              <div className="eyebrow">{t("analyze.select_pet")}</div>
            </div>

            {petsLoading ? (
              <div className="space-y-3">
                <Sk className="h-9 w-full" />
                <Sk className="h-9 w-full" />
              </div>
            ) : pets.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[#8A887F] uppercase tracking-wide">{t("pets.title")}</label>
                  <select
                    value={petId}
                    onChange={(e) => onPetSelect(e.target.value)}
                    className="w-full mt-1.5 rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40"
                    data-testid="pet-select"
                  >
                    <option value="">{t("analyze.select_pet_placeholder")}</option>
                    {pets.map((p) => (
                      <option key={p.pet_id} value={p.pet_id}>{p.name} ({p.species})</option>
                    ))}
                  </select>
                </div>
                {petId && (
                  <div className="rounded-2xl bg-[#F0FBF4] border border-[#C8E8D4] px-4 py-3 flex items-center gap-3">
                    <CheckCircle2 size={16} className="text-[#2F6B45] shrink-0" />
                    <div>
                      <div className="text-xs font-semibold text-[#2F6B45]">{petName}</div>
                      <div className="text-[11px] text-[#4A8A63] capitalize">{petSpecies}</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-5 text-center">
                <PawPrint size={22} className="mx-auto text-[#C5C2BB] mb-2" />
                <p className="text-xs text-[#8A887F] leading-relaxed">
                  {t("analyze.no_pets_paid")}{" "}
                  <Link to="/dashboard/pets" className="text-[#D26D53] font-medium hover:underline">{t("analyze.add_pet_first")}</Link>
                </p>
              </div>
            )}
          </div>

          {/* What you'll get */}
          <div className="rounded-[28px] bg-[#2D2C28] text-white p-6">
            <div className="eyebrow text-[#E6AE2E] mb-1">{t("analysis.summary")}</div>
            <h3 className="font-serif-display text-2xl mb-5">{t("analysis.analysis_complete")}</h3>
            <div className="space-y-4">
              {BENEFIT_KEYS.map(({ icon: Icon, tk, dk }) => (
                <div key={tk} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center shrink-0 text-[#E6AE2E]">
                    <Icon size={13} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{t(tk)}</div>
                    <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">{t(dk)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trust signal */}
          <div className="rounded-[20px] bg-[#FAF9F6] border border-[#E5E2D9] p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck size={16} className="text-[#556045] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#65635C] leading-relaxed">
                {t("safety.disclaimer_short")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroPill({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/10 border border-white/10 p-4">
      <div className="text-[11px] text-white/50 mb-1">{label}</div>
      <div className="font-serif-display text-3xl text-white">{value}</div>
    </div>
  );
}
