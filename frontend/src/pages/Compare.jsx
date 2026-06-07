import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import {
  Loader2,
  Sparkles,
  ArrowRight,
  BadgeCheck,
  AlertTriangle,
  ShieldCheck,
  MessageCircle,
  Send,
  Lock,
  Scale,
  Search,
  Stethoscope,
  DollarSign,
  TrendingDown,
  TrendingUp,
  CheckCircle2,
  XCircle,
  FileText,
  ChevronDown,
  Eye,
} from "lucide-react";
import { useBilling } from "../lib/billing";

const URGENCY_CHIP = {
  urgent: "chip-urgent",
  soon: "chip-soon",
  elective: "chip-wait",
  unclear: "chip-info",
};

export default function Compare() {
  const [estimates, setEstimates] = useState([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [loading, setLoading] = useState(true);
  const [previousComparisons, setPreviousComparisons] = useState([]);
  const [comparisonsLoading, setComparisonsLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [askingFollowUp, setAskingFollowUp] = useState(false);

  const [query, setQuery] = useState("");
  const [pets, setPets] = useState([]);

  const { billing, loading: billingLoading } = useBilling();

  const compareLocked =
    !billingLoading &&
    (!billing?.active ||
      billing?.plan_id === "free" ||
      billing?.plan_id === "free_tier");

  useEffect(() => {
    api
      .get("/estimates")
      .then(({ data }) => {
        const rows = data || [];
        setEstimates(rows);

        if (rows.length >= 2) {
          setAId(rows[1].analysis_id);
          setBId(rows[0].analysis_id);
        }
      })
      .finally(() => setLoading(false));
    loadPreviousComparisons();
    api.get("/pets").then(({ data }) => setPets(data || [])).catch(() => {});
  }, []);

  // Called when a bill is uploaded + analyzed inline; adds it and assigns a slot.
  function handleNewAnalysis(est) {
    if (!est?.analysis_id) return;
    setEstimates((prev) => {
      const next = [est, ...prev.filter((e) => e.analysis_id !== est.analysis_id)];
      return next;
    });
    // Fill the first empty slot (A, then B), else replace A.
    setAId((curA) => {
      if (!curA) return est.analysis_id;
      setBId((curB) => (curB ? curB : est.analysis_id));
      return curA;
    });
  }

  async function loadPreviousComparisons() {
    try {
      setComparisonsLoading(true);
      const { data } = await api.get("/estimate-comparisons");
      setPreviousComparisons(data || []);
    } catch {
      setPreviousComparisons([]);
    } finally {
      setComparisonsLoading(false);
    }
  }

  const filteredEstimates = useMemo(() => {
    if (!query.trim()) return estimates;

    return estimates.filter((x) => {
      const text = [
        x.pet_name,
        x.pet_species,
        x.summary,
        x.source_type,
        x.estimated_total_usd,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(query.toLowerCase());
    });
  }, [estimates, query]);

  const selectedA = estimates.find((x) => x.analysis_id === aId);
  const selectedB = estimates.find((x) => x.analysis_id === bId);

  async function runCompare() {
    setError("");
    setResult(null);
    setFollowUpAnswer("");

    if (!aId || !bId || aId === bId) {
      setError("Pick two different analyses.");
      return;
    }

    setComparing(true);

    try {
      const { data } = await api.post("/estimates/compare", {
        a_id: aId,
        b_id: bId,
      });

      setResult(data);
      await loadPreviousComparisons();
    } catch (e) {
      setError(e?.response?.data?.detail || "Compare failed.");
    } finally {
      setComparing(false);
    }
  }

  async function askFollowUp() {
    if (!followUpQuestion.trim()) return;

    setAskingFollowUp(true);
    setFollowUpAnswer("");

    try {
      const { data } = await api.post("/estimates/compare/ask", {
        a_id: result?.a_id || aId,
        b_id: result?.b_id || bId,
        question: followUpQuestion,
        comparison: result,
      });

      setFollowUpAnswer(data.answer || "");
    } catch (e) {
      setFollowUpAnswer(
        e?.response?.data?.detail || "Could not answer this question."
      );
    } finally {
      setAskingFollowUp(false);
    }
  }

  const recommendation = result ? buildRecommendation(result) : null;

  return (
    <div className="space-y-7 pb-20" data-testid="compare-page">
      <Hero
        compareLocked={compareLocked}
        billingLoading={billingLoading}
        estimateCount={estimates.length}
      />

      <section className="cream-card rounded-[30px] p-5 sm:p-6 fade-up delay-1">
        {loading || billingLoading ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-6">
            {!compareLocked && (
              <QuickUpload pets={pets} onAnalyzed={handleNewAnalysis} />
            )}
            {estimates.length < 2 ? (
              <EmptyCompare uploaded={estimates.length} />
            ) : (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <div className="eyebrow text-[#D26D53] mb-2">
                  Choose two analyses
                </div>

                <h2 className="font-serif-display text-3xl">
                  Compare care plans before you decide.
                </h2>
              </div>

              <div className="relative w-full lg:w-[320px]">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]"
                />

	                <input
	                  value={query}
	                  onChange={(e) => setQuery(e.target.value)}
	                  placeholder="Search pet, summary, amount..."
	                  className="input-premium pl-10"
	                />
	              </div>
	            </div>

	            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
              <EstimateSelectorCard
                label="Analysis A"
                eyebrow="Baseline estimate"
                value={aId}
                onChange={setAId}
                estimates={filteredEstimates}
                selected={selectedA}
              />

              <div className="xl:col-span-2 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-[#2D2C28] text-white inline-flex items-center justify-center shadow-xl">
                  <Scale size={24} />
                </div>
              </div>

              <EstimateSelectorCard
                label="Analysis B"
                eyebrow="Compare against"
                value={bId}
                onChange={setBId}
                estimates={filteredEstimates}
                selected={selectedB}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                onClick={runCompare}
                disabled={comparing || compareLocked}
                className={`btn-primary rounded-2xl px-6 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-70 ${
                  compareLocked ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {compareLocked ? (
                  <>
                    <Lock size={16} />
                    Upgrade required
                  </>
                ) : comparing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Comparing…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Compare estimates
                  </>
                )}
              </button>

              {error && (
                <span className="text-sm text-[#8C2D14]">
                  {error}
                </span>
              )}
            </div>
          </div>
            )}
          </div>
        )}
      </section>

      {result && (
        <>
          <ComparisonSnapshot result={result} />

          {recommendation && (
            <RecommendationCard
              recommendation={recommendation}
              followUpQuestion={followUpQuestion}
              setFollowUpQuestion={setFollowUpQuestion}
              followUpAnswer={followUpAnswer}
              askingFollowUp={askingFollowUp}
              askFollowUp={askFollowUp}
            />
          )}

          <LineItemDifferences result={result} />
        </>
      )}

      <PreviousComparisonsPanel
        comparisons={previousComparisons}
        loading={comparisonsLoading}
        query={query}
        setQuery={setQuery}
        onRefresh={loadPreviousComparisons}
      />
    </div>
  );
}

function Hero({ compareLocked, billingLoading, estimateCount }) {
  return (
    <section className="relative overflow-hidden rounded-[36px] bg-[#2D2C28] text-white p-7 sm:p-10 lg:p-12 fade-up delay-0">
      <div className="absolute right-[-90px] top-[-110px] h-[310px] w-[310px] rounded-full bg-[#D26D53]/25 blur-2xl" />
      <div className="absolute left-[-120px] bottom-[-120px] h-[340px] w-[340px] rounded-full bg-[#556045]/30 blur-2xl" />

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:items-end">
        <div className="lg:col-span-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75">
            <Sparkles size={14} />
            Second-opinion superpower
          </div>

          <h1 className="font-serif-display text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[0.9] mt-6">
            Compare two estimates{" "}
            <span className="italic text-[#D26D53]">
              before saying yes.
            </span>
          </h1>

          <p className="mt-6 text-sm sm:text-base text-white/70 max-w-2xl leading-relaxed">
            Place two vet bills side by side. See what changed, what costs more,
            what looks urgent, and what questions to ask before approving care.
          </p>
        </div>

        <div className="lg:col-span-4">
          <div className="rounded-[28px] border border-white/10 bg-white/10 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#D26D53] text-white inline-flex items-center justify-center">
                <FileText size={20} />
              </div>

              <div>
                <div className="text-xs text-white/55 uppercase tracking-[0.18em]">
                  Analyses ready
                </div>

                <div className="font-serif-display text-4xl">
                  {estimateCount}
                </div>
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-white/10">
              <div className="flex items-center gap-2 text-sm text-white/75">
                {billingLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Checking plan…
                  </>
                ) : compareLocked ? (
                  <>
                    <Lock size={14} />
                    Compare is locked on free plan.
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    Compare mode is unlocked.
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoadingBlock() {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-[#65635C]">
      <Loader2 size={16} className="animate-spin" />
      Loading analyses…
    </div>
  );
}

function EmptyCompare({ uploaded = 0 }) {
  return (
    <div className="text-center py-6">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center">
        <Scale size={24} />
      </div>
      <h3 className="font-serif-display text-2xl mt-4">
        {uploaded === 0 ? "Upload two bills to compare" : "One more bill to compare"}
      </h3>
      <p className="text-sm text-[#65635C] mt-2 max-w-md mx-auto">
        {uploaded === 0
          ? "Use the uploader above to add two estimates — or analyze bills from the Analyze page — then pick two here."
          : "You have 1 analysis. Upload one more above to start comparing side by side."}
      </p>
    </div>
  );
}

// ── Inline bill uploader for the compare page ──────────────────────────────────
function QuickUpload({ pets, onAnalyzed }) {
  const [file, setFile]       = useState(null);
  const [petId, setPetId]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");

  const submit = async () => {
    setErr("");
    if (!file) { setErr("Choose a PDF or image of the bill."); return; }
    if (pets.length > 0 && !petId) { setErr("Select which pet this bill is for."); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (petId) fd.append("pet_id", petId);
      const { data } = await api.post("/estimates/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });
      onAnalyzed(data);
      setFile(null);
      setErr("");
    } catch (e) {
      setErr(e?.response?.data?.detail || "Could not analyze that bill. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[22px] border border-[#E5E2D9] bg-[#FAF9F6] p-4 sm:p-5">
      <div className="eyebrow text-[#D26D53] mb-2">Add a bill to compare</div>
      <p className="text-sm text-[#65635C] mb-4">
        Upload a vet estimate (PDF or photo). We'll analyze it and add it to the list below so you can compare.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        {pets.length > 0 && (
          <select
            value={petId}
            onChange={(e) => setPetId(e.target.value)}
            className="rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm text-[#2D2C28] focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 sm:w-48"
          >
            <option value="">Select pet…</option>
            {pets.map((p) => (
              <option key={p.pet_id} value={p.pet_id}>{p.name}</option>
            ))}
          </select>
        )}
        <label className="flex-1 cursor-pointer rounded-xl border border-dashed border-[#D9D4C8] bg-white px-3 py-2.5 text-sm text-[#65635C] hover:border-[#D26D53] transition flex items-center gap-2">
          <FileText size={15} className="text-[#D26D53]" />
          <span className="truncate">{file ? file.name : "Choose PDF or image…"}</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setErr(""); }}
          />
        </label>
        <button
          onClick={submit}
          disabled={busy}
          className="btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <><Loader2 size={15} className="animate-spin" /> Analyzing…</> : <><Sparkles size={15} /> Analyze &amp; add</>}
        </button>
      </div>
      {err && <p className="text-sm text-[#8C2D14] mt-3">{err}</p>}
    </div>
  );
}

function PreviousComparisonsPanel({ comparisons, loading, query, setQuery, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const searchTerm = query.trim().toLowerCase();
  const filteredComparisons = searchTerm
    ? comparisons.filter((comparison) => {
        const text = [
          comparison.title,
          comparison.pet_name,
          comparison.a_total,
          comparison.b_total,
          comparison.total_diff_usd,
          comparison.recommendation?.title,
          comparison.recommendation?.summary,
        ].filter(Boolean).join(" ").toLowerCase();
        return text.includes(searchTerm);
      })
    : comparisons;

  useEffect(() => {
    if (searchTerm) setExpanded(true);
  }, [searchTerm]);

  async function toggleComparison(comparison) {
    if (openId === comparison.comparison_id) {
      setOpenId("");
      setDetail(null);
      setDetailError("");
      return;
    }

    setOpenId(comparison.comparison_id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);

    try {
      const { data } = await api.get(`/estimate-comparisons/${comparison.comparison_id}`);
      setDetail({
        ...data,
        a: data.a_snapshot,
        b: data.b_snapshot,
      });
    } catch (e) {
      setDetailError(e?.response?.data?.detail || "Could not open that comparison.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="cream-card rounded-[28px] overflow-hidden fade-up delay-1">
      <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="eyebrow text-[#D26D53] mb-1">Previous comparisons</div>
          <h2 className="font-serif-display text-2xl">Comparison history</h2>
	          <p className="text-xs text-[#65635C] mt-1">
	            {loading
	              ? "Loading saved comparisons..."
	              : searchTerm
	              ? `${filteredComparisons.length} of ${comparisons.length} comparison${comparisons.length === 1 ? "" : "s"} match.`
	              : `${comparisons.length} saved comparison${comparisons.length === 1 ? "" : "s"}.`}
	          </p>
        </button>

        <div className="w-full sm:w-auto shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="flex-1 sm:flex-none btn-ghost rounded-xl px-3 py-1.5 text-xs inline-flex items-center justify-center gap-1.5"
          >
            <Search size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-1 sm:flex-none rounded-xl border border-[#E5E2D9] px-3 py-2 text-xs font-semibold text-[#65635C] inline-flex items-center justify-center gap-2 hover:border-[#D26D53] hover:text-[#D26D53] transition"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Show"}
            <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[#E5E2D9] pt-5">
          {loading ? (
            <div className="text-sm text-[#65635C] inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
	          ) : comparisons.length === 0 ? (
	            <div className="rounded-2xl border border-dashed border-[#E5E2D9] p-6 text-sm text-[#65635C] text-center">
	              No previous comparisons yet.
	            </div>
	          ) : filteredComparisons.length === 0 ? (
	            <div className="rounded-2xl border border-dashed border-[#E5E2D9] p-6 text-sm text-[#65635C] text-center">
	              No previous comparisons match "{query}".
	              <button
	                type="button"
	                onClick={() => setQuery("")}
	                className="ml-2 font-semibold text-[#D26D53] hover:opacity-80"
	              >
	                Clear search
	              </button>
	            </div>
	          ) : (
	            <div className="space-y-3">
	              {filteredComparisons.map((comparison) => {
                const diff = Number(comparison.total_diff_usd || 0);
                const bCheaper = diff < 0;
                const title = comparison.title || `${comparison.pet_name || "Pet"} estimate comparison`;
                const isOpen = openId === comparison.comparison_id;
                return (
                  <div
                    key={comparison.comparison_id}
                    className={`rounded-2xl border bg-[#FAF9F6] transition ${
                      isOpen ? "border-[#D26D53]" : "border-[#E5E2D9] hover:border-[#D26D53]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleComparison(comparison)}
                      className="w-full text-left p-4 group"
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{title}</div>
                          <div className="text-xs text-[#65635C] mt-0.5">
                            {safeDate(comparison.created_at)}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                          bCheaper ? "bg-[#E8F5EC] text-[#2F6B45]" : "bg-[#FFF4EE] text-[#8C2D14]"
                        }`}>
                          {comparison.total_diff_usd != null
                            ? `${diff >= 0 ? "+" : "-"}$${Math.abs(diff).toFixed(0)}`
                            : "Diff --"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-xl bg-white/70 border border-[#E5E2D9] px-3 py-2">
                          <span className="text-[#8A887F]">A</span>{" "}
                          <strong>{comparison.a_total != null ? `$${Number(comparison.a_total).toFixed(0)}` : "--"}</strong>
                        </div>
                        <div className="rounded-xl bg-white/70 border border-[#E5E2D9] px-3 py-2">
                          <span className="text-[#8A887F]">B</span>{" "}
                          <strong>{comparison.b_total != null ? `$${Number(comparison.b_total).toFixed(0)}` : "--"}</strong>
                        </div>
                      </div>

                      {comparison.recommendation?.title && (
                        <p className="mt-3 text-xs text-[#65635C] line-clamp-2">
                          {comparison.recommendation.title}
                        </p>
                      )}

                      <div className="mt-3 text-xs font-semibold text-[#D26D53] inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                        <Eye size={12} /> {isOpen ? "Hide details" : "Open details"}
                        <ChevronDown size={12} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-[#E5E2D9] p-4 bg-white/45">
                        {detailLoading ? (
                          <div className="text-sm text-[#65635C] inline-flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" /> Loading details...
                          </div>
                        ) : detailError ? (
                          <div className="rounded-2xl bg-[#FFF4EE] border border-[#F2C5B7] p-4 text-sm text-[#8C2D14]">
                            {detailError}
                          </div>
                        ) : detail ? (
                          <PreviousComparisonDetails result={detail} />
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PreviousComparisonDetails({ result }) {
  const recommendation = buildRecommendation(result);

  return (
    <div className="space-y-4">
      <ComparisonSnapshot result={result} />

      {recommendation && (
        <div className="rounded-[24px] border border-[#C9D9BE] bg-[#EEF5EA] p-5">
          <div className="eyebrow text-[#556045] mb-2">Recommendation</div>
          <h3 className="font-serif-display text-3xl leading-tight">
            {recommendation.title}
          </h3>
          <p className="mt-3 text-sm text-[#415033] leading-relaxed">
            {recommendation.summary}
          </p>
          {(recommendation.reasons || []).length > 0 && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
              {recommendation.reasons.map((reason, i) => (
                <div key={i} className="rounded-2xl bg-white/65 border border-[#C9D9BE] p-3 text-sm font-semibold text-[#415033]">
                  {reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <LineItemDifferences result={result} />
    </div>
  );
}

function EstimateSelectorCard({
  label,
  eyebrow,
  value,
  onChange,
  estimates,
  selected,
}) {
  return (
    <div className="xl:col-span-5 rounded-[28px] border border-[#E5E2D9] bg-white/55 p-5">
      <div className="eyebrow text-[#D26D53] mb-2">{eyebrow}</div>

      <h3 className="font-serif-display text-3xl">{label}</h3>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-premium mt-5"
      >
        {estimates.map((x) => (
          <option key={x.analysis_id} value={x.analysis_id}>
            {x.pet_name || "Pet"} — {safeDate(x.created_at)}{" "}
            {x.estimated_total_usd != null
              ? `· $${Number(x.estimated_total_usd).toFixed(0)}`
              : ""}
          </option>
        ))}
      </select>

      {selected && (
        <div className="mt-5 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center shrink-0">
              <Stethoscope size={18} />
            </div>

            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">
                {selected.pet_name || "Unnamed pet"}
              </div>

              <p className="text-xs text-[#65635C] mt-1 leading-relaxed line-clamp-2">
                {selected.summary || "No summary available."}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className="chip chip-neutral">
                  {safeDate(selected.created_at)}
                </span>

                {selected.estimated_total_usd != null && (
                  <span className="chip chip-wait">
                    ${Number(selected.estimated_total_usd).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonSnapshot({ result }) {
  const diff = Number(result.total_diff_usd || 0);
  const bCheaper = diff < 0;
  const same = diff === 0;

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4 fade-up delay-2">
      <SummaryCard
        label="A total"
        amount={result.a_total}
        subtext={`${result.a?.pet_name || "Pet"} · ${safeDate(result.a?.created_at)}`}
        icon={DollarSign}
      />

      <SummaryCard
        label="B total"
        amount={result.b_total}
        subtext={`${result.b?.pet_name || "Pet"} · ${safeDate(result.b?.created_at)}`}
        icon={DollarSign}
      />

      <div
        className={`rounded-[28px] border p-5 ${
          same
            ? "bg-[#FAF9F6] border-[#E5E2D9]"
            : bCheaper
            ? "bg-[#EEF5EA] border-[#C9D9BE]"
            : "bg-[#FFF4EE] border-[#F2C5B7]"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-[#556045] mb-1">B − A</div>

            <div
              className={`font-serif-display text-4xl ${
                bCheaper ? "text-[#556045]" : "text-[#8C2D14]"
              }`}
            >
              {result.total_diff_usd != null
                ? `${diff >= 0 ? "+" : "−"}$${Math.abs(diff).toFixed(2)}`
                : "—"}
            </div>

            <p className="text-xs text-[#65635C] mt-2">
              {same
                ? "Both estimates are nearly the same total."
                : bCheaper
                ? "Estimate B is cheaper overall."
                : "Estimate B is more expensive overall."}
            </p>
          </div>

          <div className="w-12 h-12 rounded-2xl bg-white/70 inline-flex items-center justify-center">
            {bCheaper ? (
              <TrendingDown size={20} className="text-[#556045]" />
            ) : (
              <TrendingUp size={20} className="text-[#8C2D14]" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({ label, amount, subtext, icon: Icon }) {
  return (
    <div className="cream-card rounded-[28px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-[#D26D53] mb-1">{label}</div>

          <div className="font-serif-display text-4xl">
            {amount != null ? `$${Number(amount).toFixed(2)}` : "—"}
          </div>

          <div className="text-xs text-[#65635C] mt-2">{subtext}</div>
        </div>

        <div className="w-11 h-11 rounded-2xl bg-[#FAF7F1] border border-[#E5E2D9] flex items-center justify-center text-[#556045]">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({
  recommendation,
  followUpQuestion,
  setFollowUpQuestion,
  followUpAnswer,
  askingFollowUp,
  askFollowUp,
}) {
  return (
    <div className="relative overflow-hidden rounded-[32px] bg-[#556045] text-white p-6 sm:p-8 fade-up delay-3">
      <div className="absolute right-[-90px] top-[-90px] opacity-10">
        <ShieldCheck size={260} />
      </div>

      <div className="relative z-10">
        <div className="eyebrow text-[#E6AE2E] mb-2 inline-flex items-center gap-2">
          <ShieldCheck size={14} />
          PetBill recommendation
        </div>

        <h2 className="font-serif-display text-4xl sm:text-5xl tracking-tight leading-tight">
          {recommendation.title}
        </h2>

        <p className="mt-4 text-sm text-white/75 leading-relaxed max-w-3xl">
          {recommendation.summary}
        </p>

        <div className="mt-7 grid grid-cols-1 md:grid-cols-3 gap-3">
          {(recommendation.reasons || []).map((reason, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur"
            >
              <div className="w-9 h-9 rounded-full bg-white/15 text-[#E6AE2E] flex items-center justify-center shrink-0">
                <BadgeCheck size={16} />
              </div>

              <p className="text-sm font-semibold leading-snug mt-3">
                {reason}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-7 rounded-[24px] border border-white/10 bg-white/10 p-5 backdrop-blur">
          <div className="flex items-start gap-3 mb-4">
            <MessageCircle size={18} className="text-[#E6AE2E] shrink-0 mt-0.5" />

            <div>
              <div className="text-sm font-semibold">
                Ask about this comparison
              </div>

              <p className="text-xs text-white/60 mt-1">
                Ask what seems medically different, what may be optional, or what to clarify with the vet.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <textarea
              value={followUpQuestion}
              onChange={(e) => setFollowUpQuestion(e.target.value)}
              rows={2}
              placeholder="Example: Which estimate seems more necessary medically?"
              className="flex-1 rounded-2xl border border-white/10 bg-white/90 px-4 py-3 text-sm text-[#2D2C28] resize-none outline-none focus:border-[#D26D53]"
            />

            <button
              onClick={askFollowUp}
              disabled={askingFollowUp || !followUpQuestion.trim()}
              className="rounded-2xl bg-[#D26D53] px-5 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {askingFollowUp ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Asking…
                </>
              ) : (
                <>
                  <Send size={14} />
                  Ask
                </>
              )}
            </button>
          </div>

          {followUpAnswer && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/95 p-4 text-sm text-[#2D2C28] leading-relaxed whitespace-pre-wrap">
              {followUpAnswer}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-2xl border border-[#F1D9B7] bg-[#FFF8EE] p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FCE8C8] text-[#A56A00] flex items-center justify-center shrink-0">
            <AlertTriangle size={18} />
          </div>

          <div>
            <div className="text-sm font-semibold text-[#7A5310]">
              Final decision stays with you and your vet.
            </div>

            <p className="text-sm text-[#7A5310]/90 mt-1 leading-relaxed">
              This is not veterinary advice. Use it to ask better questions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineItemDifferences({ result }) {
  const rows = result.rows || [];

  return (
    <section className="cream-card rounded-[30px] p-5 sm:p-6 fade-up delay-4">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <div className="eyebrow text-[#D26D53] mb-2">
            Line-item differences
          </div>

          <h2 className="font-serif-display text-3xl">
            What changed between the two?
          </h2>
        </div>

        <div className="text-xs text-[#65635C]">
          {rows.length} matched or unique item{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <DifferenceRow key={i} row={r} />
        ))}
      </div>
    </section>
  );
}

function DifferenceRow({ row }) {
  const diff = row.diff_usd;
  const cheaperInB = diff != null && diff < 0;
  const higherInB = diff != null && diff > 0;

  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/60 p-4 hover:border-[#D26D53]/60 transition">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-center">
        <div className="lg:col-span-5">
          <div className="font-semibold text-sm">{row.label}</div>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {row.a_urgency && (
              <span className={`chip ${URGENCY_CHIP[row.a_urgency] || "chip-neutral"}`}>
                A: {row.a_urgency}
              </span>
            )}

            {row.b_urgency && (
              <span className={`chip ${URGENCY_CHIP[row.b_urgency] || "chip-neutral"}`}>
                B: {row.b_urgency}
              </span>
            )}

            <span className="chip chip-neutral">
              {row.in_both
                ? "Both"
                : row.only_in === "a"
                ? "Only A"
                : "Only B"}
            </span>
          </div>
        </div>

        <AmountBox label="A" value={row.a_amount_usd} />
        <AmountBox label="B" value={row.b_amount_usd} />

        <div className="lg:col-span-3">
          <div
            className={`rounded-2xl p-3 border ${
              cheaperInB
                ? "bg-[#EEF5EA] border-[#C9D9BE]"
                : higherInB
                ? "bg-[#FFF4EE] border-[#F2C5B7]"
                : "bg-[#FAF9F6] border-[#E5E2D9]"
            }`}
          >
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#65635C]">
              Difference
            </div>

            <div
              className={`text-lg font-semibold mt-1 ${
                cheaperInB ? "text-[#556045]" : higherInB ? "text-[#8C2D14]" : ""
              }`}
            >
              {diff != null
                ? `${diff >= 0 ? "+" : "−"}$${Math.abs(diff).toFixed(2)}`
                : "—"}
            </div>

            <div className="text-[11px] text-[#65635C] mt-1">
              {cheaperInB
                ? "B costs less"
                : higherInB
                ? "B costs more"
                : "No difference"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AmountBox({ label, value }) {
  return (
    <div className="lg:col-span-2 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#65635C]">
        {label}
      </div>

      <div className="font-semibold mt-1">
        {value != null ? `$${Number(value).toFixed(2)}` : "—"}
      </div>
    </div>
  );
}

function buildRecommendation(result) {
  if (result.recommendation) {
    return {
      recommendedSide: result.recommendation.recommended_side,
      title: result.recommendation.title,
      summary: result.recommendation.summary,
      reasons: result.recommendation.reasons || [],
    };
  }

  return {
    recommendedSide: null,
    title: "Review both estimates carefully",
    summary:
      "There is not enough information to generate a recommendation.",
    reasons: [
      "Ask the vet what is medically necessary today.",
      "Clarify whether any item can safely wait.",
      "Compare diagnostics, medication, and hospitalization lines.",
    ],
  };
}

function safeDate(value) {
  if (!value) return "No date";

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return "No date";

  return d.toLocaleDateString();
}
