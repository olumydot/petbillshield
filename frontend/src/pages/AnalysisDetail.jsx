import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import api from "../lib/api";

import {
  Loader2,
  ArrowLeft,
  AlertTriangle,
  Clock,
  Stethoscope,
  Check,
  ClipboardList,
  Copy,
  Trash2,
  FileDown,
  Sparkles,
  ShieldAlert,
  CircleDollarSign,
  ChevronRight,
  FileHeart,
  Plus,
  CheckCircle2,
  Activity,
  MessageCircle,
  SendHorizontal,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

import { toast } from "sonner";

import ShareAnalysisButton from "../components/ShareAnalysisButton";
import EmailVetButton from "../components/EmailVetButton";
import ConfirmModal from "../components/ConfirmModal";

const URGENCY_CHIP = {
  urgent: "chip-urgent",
  soon: "chip-soon",
  elective: "chip-wait",
  unclear: "chip-info",
};

const SEVERITY_CHIP = {
  info: "chip-info",
  warning: "chip-warning",
  high: "chip-flag",
};

export default function AnalysisDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();

  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [script, setScript] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordSaved, setRecordSaved] = useState(false);
  const [savingLineKey, setSavingLineKey] = useState("");
  const [savedLineKeys, setSavedLineKeys] = useState({});
  const [extractingMarkers, setExtractingMarkers] = useState(false);
  const [markersResult, setMarkersResult] = useState(null); // null | { count, date }
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // #8 — follow-up question
  const [qaQuestion, setQaQuestion]   = useState("");
  const [qaAnswer,   setQaAnswer]     = useState("");
  const [qaLoading,  setQaLoading]    = useState(false);

  // #10 — inline feedback (persisted to localStorage)
  const FEEDBACK_KEY = `petbill_feedback_${id}`;
  const [feedback,        setFeedback]        = useState(() => localStorage.getItem(FEEDBACK_KEY) || "");
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Market-rate transparency comparisons
  const [marketRates, setMarketRates] = useState({}); // label → stats

  useEffect(() => {
    setLoading(true);

    api
      .get(`/estimates/${id}`)
      .then(({ data }) => {
        setA(data);
        setRecordSaved(
          data?.saved_to_pet_vault === true || Boolean(data?.saved_pet_id)
        );
        setSavedLineKeys(
          Object.fromEntries((data?.saved_line_item_keys || []).map((key) => [key, true]))
        );
        setMarkersResult(
          data?.health_markers_extracted || data?.health_markers_saved
            ? {
                count: data?.health_markers_count || 0,
                date: data?.health_markers_date || "",
                alreadySaved: true,
              }
            : null
        );
        // Fetch market comparisons if the analysis has location data
        if (data?.city && data?.state && (data?.line_items || []).length > 0) {
          const items = (data.line_items || [])
            .filter((li) => li.label && li.amount_usd != null)
            .map((li) => ({ label: li.label, amount_usd: li.amount_usd }));
          if (items.length > 0) {
            api.post("/transparency/compare-batch", {
              items,
              city:    data.city,
              state:   data.state,
              species: data.pet_species || undefined,
            })
            .then(({ data: rates }) => setMarketRates(rates || {}))
            .catch(() => {}); // non-critical
          }
        }
      })
      .catch(() => setA(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function deleteAnalysis() {
    setDeleting(true);
    try {
      await api.delete(`/estimates/${id}`);
      toast.success("Deleted");
      setShowDeleteConfirm(false);
      navigate("/dashboard");
    } catch {
      toast.error("Couldn't delete");
    } finally {
      setDeleting(false);
    }
  }

  async function downloadPacket() {
    try {
      const res = await api.get(`/estimates/${id}/packet.pdf`, {
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" })
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = `petbill_shield_packet_${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download the packet");
    }
  }

  async function saveAsPetRecord() {
    if (!a?.pet_id) {
      toast.error("This analysis is not linked to a pet.");
      return;
    }
    if (recordSaved) return;

    try {
      setSavingRecord(true);

      const fd = new FormData();
      fd.append("pet_id", a.pet_id);

      const { data } = await api.post(
        `/estimates/${a.analysis_id}/save-to-vault`,
        fd
      );

      setRecordSaved(true);
      setA((current) => ({
        ...current,
        saved_to_pet_vault: true,
        saved_pet_id: data.saved_pet_id,
        saved_record_id: data.record_id,
      }));

      toast.success("Saved to pet records.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not save to pet records.");
    } finally {
      setSavingRecord(false);
    }
  }

  async function saveLineItemToPetRecord(item, index) {
    if (!a?.pet_id) {
      toast.error("This analysis is not linked to a pet.");
      return;
    }

    const key = makeLineKey(item, index);
    if (savedLineKeys[key]) return;

    try {
      setSavingLineKey(key);

      const payload = buildRecordFromLineItem(item, a);

      await api.post(`/estimates/${a.analysis_id}/save-line-item`, {
        line_key: key,
        record: payload,
      });

      setSavedLineKeys((prev) => ({
        ...prev,
        [key]: true,
      }));

      toast.success(`${payload.title} added to ${a.pet_name || "pet"}’s record.`);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not add this item.");
    } finally {
      setSavingLineKey("");
    }
  }

  async function extractHealthMarkers() {
    if (!a?.analysis_id) return;
    if (markersResult) return;
    try {
      setExtractingMarkers(true);
      const fd = new FormData();
      if (a.pet_id) fd.append("pet_id", a.pet_id);
      const { data } = await api.post(`/estimates/${a.analysis_id}/extract-markers`, fd);
      setMarkersResult({
        count: data.markers_found,
        date: data.date,
        alreadySaved: Boolean(data.already_saved) || data.markers_found >= 0,
      });
      if (data.already_saved) {
        toast.info(data.message || "Health markers were already saved for this analysis.");
        return;
      }
      if (data.markers_found > 0) {
        toast.success(`${data.markers_found} health marker${data.markers_found !== 1 ? "s" : ""} saved to the health graph.`);
      } else {
        toast.info(data.message || "No numeric health markers found in this document.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not extract markers.");
    } finally {
      setExtractingMarkers(false);
    }
  }

  async function askFollowUp() {
    const q = qaQuestion.trim();
    if (!q) return;
    try {
      setQaLoading(true);
      const { data } = await api.post(`/estimates/${id}/ask`, { question: q });
      setQaAnswer(data.answer || "");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Couldn't get an answer right now.");
    } finally {
      setQaLoading(false);
    }
  }

  async function submitFeedback(rating) {
    try {
      setFeedbackLoading(true);
      await api.post(`/estimates/${id}/feedback`, { rating });
      setFeedback(rating);
      localStorage.setItem(FEEDBACK_KEY, rating);
    } catch {
      toast.error("Couldn't save feedback.");
    } finally {
      setFeedbackLoading(false);
    }
  }

  async function generateVetScript() {
    try {
      setScriptLoading(true);

      const situation = `
Pet name: ${a.pet_name || "my pet"}
Species: ${a.pet_species || "pet"}
Estimate total: ${a.estimated_total_usd || "unknown"}

Summary:
${a.summary || ""}

Items needing clarification:
${(a.red_flags || []).map((x) => `- ${x.label}: ${x.why || ""}`).join("\n")}

Questions to ask:
${(a.questions_to_ask_vet || []).map((q) => `- ${q}`).join("\n")}

Cost-saving options:
${(a.cost_saving_options || []).map((x) => `- ${x}`).join("\n")}
`;

      const { data } = await api.post("/scripts/generate", {
        situation,
        tone: "polite",
        pet_name: a.pet_name || "",
        pet_species: a.pet_species || "",
        estimated_cost_usd: a.estimated_total_usd || null,
      });

      setScript(data.script || "");
      toast.success("Vet conversation script generated");
    } catch (err) {
      console.error(err);
      toast.error("Could not generate script");
    } finally {
      setScriptLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#65635C]">
        <Loader2 className="animate-spin" size={16} />
        Loading analysis…
      </div>
    );
  }

  if (!a) {
    return (
      <div className="cream-card p-8 text-center">
        <p className="text-sm text-[#65635C]">This analysis isn't available.</p>

        <Link
          to="/dashboard/analyze"
          className="editorial-link text-sm mt-2 inline-block"
        >
          ← Start a new one
        </Link>
      </div>
    );
  }

  const total = Number(a.estimated_total_usd) || 0;
  const emergencyMode = total >= 1000 || (a.urgent_now || []).length > 0;

  return (
    <div className="space-y-6 pb-24">
      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete this analysis?"
        description="This removes the saved bill analysis from your account. This action cannot be undone."
        confirmLabel={deleting ? "Deleting..." : "Delete analysis"}
        tone="danger"
        busy={deleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={deleteAnalysis}
      />

      {emergencyMode && (
        <section className="relative overflow-hidden rounded-[34px] bg-[#1F1E1B] text-white">
          <div className="absolute inset-0 opacity-[0.08]">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full bg-[#D26D53]" />
            <div className="absolute bottom-0 left-0 w-[250px] h-[250px] rounded-full bg-[#556045]" />
          </div>

          <div className="relative z-10 p-7 sm:p-10 lg:p-14">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-4 py-2 text-xs">
              <ShieldAlert size={14} />
              Emergency support mode
            </div>

            <div className="mt-7 max-w-4xl">
              <h1 className="font-serif-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95]">
                Take a breath.
                <br />
                <span className="italic text-[#D26D53]">
                  Let’s go through this together.
                </span>
              </h1>

              <p className="mt-6 text-white/70 max-w-2xl text-sm sm:text-base leading-relaxed">
                This appears to be a larger veterinary estimate or urgent situation.
                PetBill Shield will help you understand the treatment, organize your
                questions, and reduce decision stress.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <EmergencyStep
                number="1"
                title="Understand treatment"
                text="Review procedures, diagnostics, medications, and hospitalization costs."
              />

              <EmergencyStep
                number="2"
                title="Clarify concerns"
                text="Identify unclear charges, duplicates, and urgent recommendations."
              />

              <EmergencyStep
                number="3"
                title="Ask better questions"
                text="Generate guided questions before approving treatment."
              />

              <div className="rounded-3xl bg-[#D26D53] p-6 text-white shadow-2xl">
                <div className="text-xs uppercase tracking-wide text-white/70">
                  Estimated total
                </div>

                <h2 className="mt-3 font-serif-display text-5xl">
                  ${total.toFixed(2)}
                </h2>

                <p className="mt-2 text-sm text-white/80">
                  Estimated veterinary cost
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      <header>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <button
            onClick={() => navigate(-1)}
            className="editorial-link text-xs inline-flex items-center gap-1"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <ShareAnalysisButton analysisId={id} />
            <EmailVetButton analysisId={id} />

            <button
              onClick={generateVetScript}
              disabled={scriptLoading}
              className="btn-primary rounded-xl px-4 py-2 text-xs font-semibold inline-flex items-center gap-2"
            >
              {scriptLoading ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Writing...
                </>
              ) : (
                <>
                  <ClipboardList size={13} />
                  Generate vet script
                </>
              )}
            </button>

            <button
              onClick={downloadPacket}
              className="btn-primary rounded-xl px-4 py-2 text-xs font-semibold inline-flex items-center gap-2"
            >
              <FileDown size={13} />
              Download packet
            </button>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-ghost rounded-xl px-4 py-2 text-xs inline-flex items-center gap-2"
            >
              <Trash2 size={13} />
              Delete
            </button>
          </div>
        </div>

        <div className="mt-7">
          <div className="eyebrow mb-2">
            {a.pet_name ? `${a.pet_name} · ${a.pet_species}` : "Analysis"}
          </div>

          <h1 className="font-serif-display text-4xl sm:text-5xl leading-tight max-w-5xl">
            {a.summary || "Your estimate, explained simply."}
          </h1>

          <div className="mt-5 flex flex-wrap gap-3 text-xs text-[#65635C]">
            <Pill>
              <CircleDollarSign size={13} />
              Total ≈ ${total.toFixed(2)}
            </Pill>

            <Pill>
              <Sparkles size={13} />
              {a.source_type}
            </Pill>

            <Pill>{new Date(a.created_at).toLocaleDateString()}</Pill>

            {recordSaved && <Pill green>✓ Saved to timeline</Pill>}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-5">
          <section className="cream-card p-6 rounded-[30px]">
            <div className="flex items-center justify-between">
              <div>
                <div className="eyebrow text-[#D26D53] mb-2">
                  Estimate breakdown
                </div>

                <h2 className="font-serif-display text-3xl">Line items</h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {(a.line_items || []).map((li, i) => {
                const key = makeLineKey(li, i);
                const canAdd = a.pet_id && canSaveLineItem(li);
                const isSaving = savingLineKey === key;
                const isSaved = savedLineKeys[key];

                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-5 hover:border-[#D26D53] transition-all"
                  >
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-semibold text-lg">{li.label}</div>

                        {li.notes && (
                          <p className="mt-2 text-sm text-[#65635C] leading-relaxed">
                            {li.notes}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {li.urgency && (
                            <span
                              className={`chip ${
                                URGENCY_CHIP[li.urgency] || "chip-neutral"
                              }`}
                            >
                              {li.urgency}
                            </span>
                          )}

                          {li.category && (
                            <span className="chip chip-neutral">
                              {li.category}
                            </span>
                          )}

                          {canAdd && (
                            <span className="chip chip-info">
                              Can save as {mapCategoryToRecordType(li.category)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <div className="text-xs uppercase tracking-wide text-[#65635C]">
                          Cost
                        </div>

                        <div className="mt-2 font-serif-display text-3xl">
                          {li.amount_usd != null
                            ? `$${Number(li.amount_usd).toFixed(2)}`
                            : "—"}
                        </div>

                        {/* Market rate badge */}
                        {li.label && marketRates[li.label] && li.amount_usd != null && (
                          <MarketRateBadge
                            quote={li.amount_usd}
                            market={marketRates[li.label]}
                          />
                        )}

                        {canAdd && (
                          <button
                            onClick={() => saveLineItemToPetRecord(li, i)}
	                            disabled={isSaving || isSaved}
	                            className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 transition disabled:cursor-not-allowed ${
	                              isSaved
	                                ? "bg-[#E5E2D9] text-[#8A887F]"
	                                : "btn-ghost bg-white/70"
	                            }`}
                          >
                            {isSaving ? (
                              <>
                                <Loader2 size={12} className="animate-spin" />
                                Adding...
                              </>
                            ) : isSaved ? (
                              <>
                                <CheckCircle2 size={12} />
                                Added
                              </>
                            ) : (
                              <>
                                <Plus size={12} />
                                Add to pet record
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {(a.line_items || []).length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#E5E2D9] bg-[#FAF9F6] p-8 text-center text-sm text-[#65635C]">
                  No line items were extracted from this bill.
                </div>
              )}
            </div>
          </section>

          <section className="cream-card p-6 rounded-[30px]">
            <div className="eyebrow text-[#D26D53] mb-2">Clarifications</div>

            <h2 className="font-serif-display text-3xl">
              Items worth asking about
            </h2>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {(a.red_flags || []).length === 0 && (
                <p className="text-sm text-[#65635C]">
                  No clarification flags were generated.
                </p>
              )}

              {(a.red_flags || []).map((rf, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">{rf.label}</h3>

                    <span
                      className={`chip ${
                        SEVERITY_CHIP[rf.severity] || "chip-neutral"
                      }`}
                    >
                      {rf.severity}
                    </span>
                  </div>

                  {rf.why && (
                    <p className="mt-3 text-sm text-[#65635C] leading-relaxed">
                      {rf.why}
                    </p>
                  )}

                  {rf.ask_the_vet && (
                    <div className="mt-4 rounded-xl border border-[#E5E2D9] bg-white p-4">
                      <div className="eyebrow mb-2">Ask the vet</div>

                      <p className="italic text-sm leading-relaxed">
                        “{rf.ask_the_vet}”
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="xl:col-span-4 space-y-5">
	          {a.pet_id && (
	            <section className={`rounded-[30px] border p-6 ${
	              recordSaved ? "bg-[#F2F0E9] border-[#E5E2D9]" : "bg-[#FFF7F2] border-[#D26D53]/20"
	            }`}>
	              <div className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center ${
	                recordSaved ? "bg-[#8A887F]" : "bg-[#D26D53]"
	              }`}>
	                <FileHeart size={20} />
	              </div>

	              <h2 className="mt-5 font-serif-display text-3xl leading-tight">
	                {recordSaved ? "Saved to the care timeline" : "Save this bill to the care timeline"}
	              </h2>

	              <p className="mt-3 text-sm text-[#65635C] leading-relaxed">
	                {recordSaved
	                  ? "This analysis is already in the pet record, so it cannot be added again."
	                  : "This improves forecasts, emergency history, monthly summaries, and long-term cost insights."}
	              </p>

	              <button
	                onClick={saveAsPetRecord}
	                disabled={savingRecord || recordSaved}
	                className={`mt-5 rounded-xl px-5 py-3 text-sm font-semibold w-full inline-flex items-center justify-center gap-2 ${
	                  recordSaved
	                    ? "bg-[#D9D6CE] text-[#8A887F] cursor-not-allowed"
	                    : "btn-primary disabled:opacity-60"
	                }`}
	              >
	                {recordSaved ? <><CheckCircle2 size={15} /> Saved</> : savingRecord ? "Saving..." : "Save full bill to timeline"}
	              </button>
	            </section>
	          )}

          {/* Health markers card — shown whenever a pet is linked */}
          {a.pet_id && (
            <section className="cream-card p-6 rounded-[30px]">
              <div className="w-12 h-12 rounded-2xl bg-[#556045] text-white flex items-center justify-center">
                <Activity size={20} />
              </div>

              <h2 className="mt-5 font-serif-display text-3xl leading-tight">
                Log to health graph
              </h2>

              <p className="mt-2 text-sm text-[#65635C] leading-relaxed">
                Pull lab values (CBC, kidney, liver, metabolic, etc.) from this
                document directly into the health markers timeline.
              </p>

              {markersResult ? (
                markersResult.count > 0 ? (
                  <div className="mt-4 rounded-2xl bg-[#E8F5EC] border border-[#B7D9C0] px-4 py-3 flex items-start gap-3">
                    <CheckCircle2 size={18} className="text-[#2F6B45] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-[#2F6B45]">
                        {markersResult.count} marker{markersResult.count !== 1 ? "s" : ""} saved
                        {markersResult.date ? ` for ${markersResult.date}` : ""}.
                      </p>
	                      <Link
	                        to={`/dashboard/timeline?pet=${a.pet_id}`}
	                        className="text-xs text-[#556045] font-semibold underline underline-offset-2 mt-1 inline-block"
	                      >
	                        View in health graph →
	                      </Link>
	                      <button
	                        disabled
	                        className="mt-3 w-full rounded-xl bg-[#D9D6CE] text-[#8A887F] cursor-not-allowed text-sm font-semibold py-2.5 flex items-center justify-center gap-2"
	                      >
	                        <CheckCircle2 size={14} /> Markers saved
	                      </button>
	                    </div>
	                  </div>
	                ) : (
	                  <div className="mt-4 space-y-3">
	                    <p className="text-xs text-[#8A887F]">
	                      No numeric lab values were found in this document.
	                    </p>
	                    <button
	                      disabled
	                      className="w-full rounded-xl bg-[#D9D6CE] text-[#8A887F] cursor-not-allowed text-sm font-semibold py-2.5 flex items-center justify-center gap-2"
	                    >
	                      <CheckCircle2 size={14} /> Extraction complete
	                    </button>
	                  </div>
	                )
              ) : (
                <button
                  onClick={extractHealthMarkers}
                  disabled={extractingMarkers}
                  className="mt-5 w-full rounded-xl border border-[#556045] text-[#556045] hover:bg-[#556045] hover:text-white text-sm font-semibold py-2.5 flex items-center justify-center gap-2 transition"
                >
                  {extractingMarkers ? (
                    <><Loader2 size={14} className="animate-spin" /> Extracting…</>
                  ) : (
                    <><Activity size={14} /> Extract lab markers</>
                  )}
                </button>
              )}
            </section>
          )}

          <section className="cream-card p-6 rounded-[30px]">
            <div className="eyebrow text-[#8C2D14] mb-2">Urgent today</div>

            <h2 className="font-serif-display text-3xl">Immediate care</h2>

            <div className="mt-5 space-y-3">
              {(a.urgent_now || []).length === 0 ? (
                <p className="text-sm text-[#65635C]">
                  Nothing was flagged as urgent.
                </p>
              ) : (
                (a.urgent_now || []).map((x, i) => (
                  <SidebarBullet key={i} text={x} />
                ))
              )}
            </div>
          </section>

          <section className="cream-card p-6 rounded-[30px]">
            <div className="eyebrow text-[#556045] mb-2">Questions</div>

            <h2 className="font-serif-display text-3xl">Questions to ask</h2>

            <div className="mt-5 space-y-4">
              {(a.questions_to_ask_vet || []).length === 0 && (
                <p className="text-sm text-[#65635C]">
                  No questions were generated.
                </p>
              )}

              {(a.questions_to_ask_vet || []).map((q, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#2D2C28] text-white text-xs flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>

                  <p className="text-sm leading-relaxed">{q}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      {script && (
        <section className="cream-card p-6 rounded-[30px]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="eyebrow text-[#D26D53] mb-2">
                Vet conversation script
              </div>

              <h2 className="font-serif-display text-3xl">
                A calmer conversation
              </h2>
            </div>

            <button
              onClick={() => copyText(script)}
              className="btn-ghost rounded-xl px-4 py-2 text-xs inline-flex items-center gap-2"
            >
              <Copy size={13} />
              Copy
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-5">
            <p className="text-sm leading-relaxed whitespace-pre-line">{script}</p>
          </div>
        </section>
      )}

      {/* ── #8: Follow-up question ─────────────────────────────────────────── */}
      <section className="cream-card p-6 rounded-[30px]">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-full bg-[#2D2C28] flex items-center justify-center shrink-0">
            <MessageCircle size={16} className="text-white" />
          </div>
          <div>
            <div className="eyebrow text-[#556045]">Follow-up</div>
            <h2 className="font-serif-display text-2xl leading-tight">Still have questions?</h2>
          </div>
        </div>

        <p className="text-sm text-[#65635C] mt-3 mb-5">
          Ask anything about this bill — our AI will answer based on the analysis above.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={qaQuestion}
            onChange={(e) => setQaQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !qaLoading && qaQuestion.trim()) askFollowUp();
            }}
            placeholder="e.g. Why is anesthesia listed twice?"
            className="flex-1 rounded-xl border border-[#E5E2D9] bg-white px-4 py-2.5 text-sm
                       placeholder:text-[#B0ADA6] focus:outline-none focus:ring-2 focus:ring-[#2D2C28]/20"
            disabled={qaLoading}
          />
          <button
            onClick={askFollowUp}
            disabled={!qaQuestion.trim() || qaLoading}
            className="btn-primary rounded-xl px-4 py-2.5 inline-flex items-center gap-2 text-sm font-semibold
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {qaLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <SendHorizontal size={15} />
            )}
            Ask
          </button>
        </div>

        {qaAnswer && (
          <div className="mt-5 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-5 space-y-4">
            <p className="text-sm leading-relaxed">{qaAnswer}</p>
            <button
              onClick={() => { setQaQuestion(""); setQaAnswer(""); }}
              className="editorial-link text-xs"
            >
              Ask another question →
            </button>
          </div>
        )}
      </section>

      {/* ── #10: Inline feedback ───────────────────────────────────────────── */}
      <section className="cream-card p-5 rounded-[24px]">
        {feedback ? (
          <div className="flex items-center gap-2 text-sm text-[#65635C]">
            <CheckCircle2 size={15} className="text-[#556045] shrink-0" />
            Thanks for your feedback — it helps us improve.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm text-[#65635C]">Was this analysis helpful?</span>
            <div className="flex gap-2">
              <button
                onClick={() => submitFeedback("helpful")}
                disabled={feedbackLoading}
                className="btn-ghost rounded-xl px-3 py-1.5 text-xs inline-flex items-center gap-1.5
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ThumbsUp size={13} />
                Yes, helpful
              </button>
              <button
                onClick={() => submitFeedback("not_helpful")}
                disabled={feedbackLoading}
                className="btn-ghost rounded-xl px-3 py-1.5 text-xs inline-flex items-center gap-1.5
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ThumbsDown size={13} />
                Not really
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Disclaimer ─────────────────────────────────────────────────────── */}
      <section className="cream-card p-5 rounded-[24px]">
        <p className="text-xs text-[#65635C] leading-relaxed">{a.disclaimer}</p>
      </section>
    </div>
  );
}

function canSaveLineItem(item) {
  const category = String(item?.category || "").toLowerCase();
  const label = String(item?.label || "").toLowerCase();

  const categories = [
    "medication",
    "vaccine",
    "labwork",
    "exam",
    "treatment",
    "diagnostic",
    "imaging",
    "surgery",
    "hospitalization",
    "dental",
  ];

  if (categories.includes(category)) return true;

  const keywords = [
    "vaccine",
    "vaccination",
    "rabies",
    "bordetella",
    "dhpp",
    "fvrcp",
    "medication",
    "medicine",
    "tablet",
    "capsule",
    "injection",
    "antibiotic",
    "lab",
    "bloodwork",
    "cbc",
    "x-ray",
    "radiograph",
    "exam",
  ];

  return keywords.some((word) => label.includes(word));
}

function mapCategoryToRecordType(category) {
  const c = String(category || "").toLowerCase();

  if (c === "medication") return "medication";
  if (c === "vaccine") return "vaccine";
  if (c === "labwork") return "lab";
  if (c === "exam") return "visit";
  if (c === "diagnostic") return "lab";
  if (c === "imaging") return "lab";
  if (c === "hospitalization") return "visit";
  if (c === "surgery") return "visit";
  if (c === "dental") return "visit";

  return "note";
}

function inferRecordTypeFromText(item) {
  const label = String(item?.label || "").toLowerCase();
  const notes = String(item?.notes || "").toLowerCase();
  const text = `${label} ${notes}`;

  if (
    text.includes("vaccine") ||
    text.includes("vaccination") ||
    text.includes("rabies") ||
    text.includes("bordetella") ||
    text.includes("dhpp") ||
    text.includes("fvrcp")
  ) {
    return "vaccine";
  }

  if (
    text.includes("medication") ||
    text.includes("medicine") ||
    text.includes("tablet") ||
    text.includes("capsule") ||
    text.includes("antibiotic") ||
    text.includes("injection") ||
    text.includes("dose")
  ) {
    return "medication";
  }

  if (
    text.includes("lab") ||
    text.includes("blood") ||
    text.includes("cbc") ||
    text.includes("chemistry") ||
    text.includes("urinalysis") ||
    text.includes("x-ray") ||
    text.includes("radiograph")
  ) {
    return "lab";
  }

  return mapCategoryToRecordType(item?.category);
}

function buildRecordFromLineItem(item, analysis) {
  const recordType = inferRecordTypeFromText(item);

  return {
    record_type: recordType,
    title: item?.label || "Bill line item",
    details: buildLineItemDetails(item, analysis, recordType),
    amount_usd: item?.amount_usd != null ? Number(item.amount_usd) : null,
    date: new Date().toISOString(),
    category: item?.category || recordType || "other",
  };
}

function buildLineItemDetails(item, analysis, recordType) {
  const lines = [];

  lines.push(`Saved from bill analysis${analysis?.analysis_id ? ` ${analysis.analysis_id}` : ""}.`);

  if (analysis?.pet_name) lines.push(`Pet: ${analysis.pet_name}`);
  if (item?.category) lines.push(`Category: ${item.category}`);
  if (item?.urgency) lines.push(`Urgency: ${item.urgency}`);
  if (item?.notes) lines.push(`Notes: ${item.notes}`);

  if (recordType === "vaccine") {
    lines.push("Record type: vaccine. Review and add next due date if available.");
  }

  if (recordType === "medication") {
    lines.push("Record type: medication. Review dosage, frequency, and duration if available.");
  }

  return lines.filter(Boolean).join("\n");
}

function makeLineKey(item, index) {
  return `${index}-${item?.label || "item"}-${item?.amount_usd || 0}`;
}

function EmergencyStep({ number, title, text }) {
  return (
    <div className="rounded-3xl bg-white/5 border border-white/10 p-6">
      <div className="text-xs uppercase tracking-wide text-white/50">
        Step {number}
      </div>

      <h3 className="mt-3 font-semibold text-lg">{title}</h3>

      <p className="mt-2 text-sm text-white/65 leading-relaxed">{text}</p>
    </div>
  );
}

function SidebarBullet({ text }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center shrink-0">
        <ChevronRight size={16} />
      </div>

      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}

function Pill({ children, green }) {
  return (
    <span
      className={`rounded-full px-3 py-1.5 inline-flex items-center gap-1.5 ${
        green ? "bg-[#E8F5EA] text-[#2B6A39]" : "bg-[#F2F0E9]"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Market-rate comparison badge shown under each line-item price.
 *
 * Handles two sources:
 *   source="real_data"   → verified reports from real user bills (solid badges)
 *   source="ai_estimate" → Claude-generated range when no real data exists yet (dashed, amber)
 */
function MarketRateBadge({ quote, market }) {
  if (!market?.available) return null;

  // ── AI estimate — no real data yet ────────────────────────────────────────
  if (market.source === "ai_estimate") {
    const low  = market.low_usd;
    const mid  = market.mid_usd;
    const high = market.high_usd;
    if (!low || !mid || !high) return null;

    const diff = quote - mid;
    const pct  = Math.round(Math.abs(diff / mid) * 100);

    let indicator = null;
    if (pct >= 10 && diff > 0) {
      indicator = <span className="text-[#8C2D14]">↑ {pct}% above est.</span>;
    } else if (pct >= 10 && diff < 0) {
      indicator = <span className="text-[#2B6A39]">↓ {pct}% below est.</span>;
    }

    return (
      <div className="mt-2 space-y-1 text-left sm:text-right">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFBEB] border border-dashed border-[#D97706]/50 px-2.5 py-1 text-[11px] font-semibold text-[#92400E]">
          <span className="text-[13px] leading-none">~</span>
          Est. ${low.toFixed(0)}–${high.toFixed(0)}
          {indicator && <> · {indicator}</>}
        </span>
        <div className="text-[10px] text-[#8A887F]">AI estimate · no local reports yet</div>
      </div>
    );
  }

  // ── Real user data ─────────────────────────────────────────────────────────
  const avg   = market.avg_usd;
  const diff  = quote - avg;
  const pct   = Math.round(Math.abs(diff / avg) * 100);

  const scopeLabel =
    market.scope === "city+state" ? "in your city"
    : market.scope === "state"    ? "in your state"
    : "nationally";
  const countLabel = `${market.count} report${market.count === 1 ? "" : "s"} ${scopeLabel}`;

  if (diff > 0 && pct >= 5) {
    return (
      <div className="mt-2 space-y-1 text-left sm:text-right">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF0EE] border border-[#F2C5B7] px-2.5 py-1 text-[11px] font-semibold text-[#8C2D14]">
          <span className="text-[13px] leading-none">↑</span>
          {pct}% above avg · avg ${avg.toFixed(0)}
        </span>
        <div className="text-[10px] text-[#8A887F]">{countLabel}</div>
      </div>
    );
  }

  if (diff < 0 && pct >= 5) {
    return (
      <div className="mt-2 space-y-1 text-left sm:text-right">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EA] border border-[#C8E8D4] px-2.5 py-1 text-[11px] font-semibold text-[#2B6A39]">
          <span className="text-[13px] leading-none">↓</span>
          {pct}% below avg · avg ${avg.toFixed(0)}
        </span>
        <div className="text-[10px] text-[#8A887F]">{countLabel}</div>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1 text-left sm:text-right">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF5FF] border border-[#BDD7F5] px-2.5 py-1 text-[11px] font-semibold text-[#245EA8]">
        <span className="text-[13px] leading-none">≈</span>
        Consistent with avg · ${avg.toFixed(0)}
      </span>
      <div className="text-[10px] text-[#8A887F]">{countLabel}</div>
    </div>
  );
}
