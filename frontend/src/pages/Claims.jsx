import { useTranslation } from "react-i18next";
import { useEffect, useState, useCallback, memo } from "react";
import api from "../lib/api";
import FileDropzone from "../components/FileDropzone";
import {
  Loader2, Sparkles, Copy, Check, Info, FolderPlus,
  ChevronDown, UploadCloud, Lock, FileCheck2, Eye, Send,
	  DollarSign, RefreshCcw, CalendarCheck, AlertCircle,
	  ArrowRight, X, CheckCircle2, XCircle, AlertTriangle,
	  PawPrint, Receipt, Zap, Search,
	} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useBilling } from "../lib/billing";

// ── Decision outcome config ───────────────────────────────────────────────────
const OUTCOMES = {
  approved:           { label: "Approved",            color: "bg-[#E8F5EC] border-[#C8E8D4] text-[#2F6B45]", dot: "bg-[#556045]", icon: CheckCircle2 },
  fully_approved:     { label: "Fully Approved",      color: "bg-[#E8F5EC] border-[#C8E8D4] text-[#2F6B45]", dot: "bg-[#556045]", icon: CheckCircle2 },
  accepted:           { label: "Accepted",            color: "bg-[#E8F5EC] border-[#C8E8D4] text-[#2F6B45]", dot: "bg-[#556045]", icon: CheckCircle2 },
  partial:            { label: "Partially Approved",  color: "bg-[#FEF6E4] border-[#F5D993] text-[#8A5A24]", dot: "bg-[#E6AE2E]", icon: AlertCircle },
  partially_approved: { label: "Partially Approved",  color: "bg-[#FEF6E4] border-[#F5D993] text-[#8A5A24]", dot: "bg-[#E6AE2E]", icon: AlertCircle },
  denied:             { label: "Denied",              color: "bg-[#FEF0EE] border-[#F2C5B7] text-[#8C2D14]", dot: "bg-[#D26D53]", icon: XCircle },
  rejected:           { label: "Rejected",            color: "bg-[#FEF0EE] border-[#F2C5B7] text-[#8C2D14]", dot: "bg-[#D26D53]", icon: XCircle },
};

function getOutcome(result) {
  const status = (result?.claim_status || "").toLowerCase();
  const decisionOutcome = (
    result?.decision?.outcome ||
    result?.decision?.decision_status ||
    ""
  ).toLowerCase();
  const key = decisionOutcome || status;
  return OUTCOMES[key] || null;
}

export default function Claims() {
  const { t } = useTranslation();
  const [insurer, setInsurer]             = useState("");
  const [policyText, setPolicyText]       = useState("");
  const [invoiceText, setInvoiceText]     = useState("");
  const [policyFile, setPolicyFile]       = useState(null);
  const [invoiceFile, setInvoiceFile]     = useState(null);
  const [loading, setLoading]             = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [previousClaims, setPreviousClaims] = useState([]);
  const [claimSearch, setClaimSearch]     = useState("");
  const [result, setResult]               = useState(null);
  const [error, setError]                 = useState("");
  const [activeTab, setActiveTab]         = useState("reimbursable");

  const [followupQuestion, setFollowupQuestion]   = useState("");
  const [followupAnswer, setFollowupAnswer]       = useState("");
  const [askingFollowup, setAskingFollowup]       = useState(false);

  const [generatingAppeal, setGeneratingAppeal]   = useState(false);
  const [appealLetter, setAppealLetter]           = useState("");
  const [appealExpanded, setAppealExpanded]       = useState(false);
  const [showAppealModal, setShowAppealModal]     = useState(false);

  const [generatingNegotiation, setGeneratingNegotiation] = useState(false);
  const [negotiationPoints, setNegotiationPoints]         = useState("");
  const [showNegotiationModal, setShowNegotiationModal]   = useState(false);

  const [showInsurerResponseModal, setShowInsurerResponseModal] = useState(false);
  const [insurerResponseText, setInsurerResponseText]           = useState("");
  const [insurerResponseFile, setInsurerResponseFile]           = useState(null);
  const [savingDecision, setSavingDecision]                     = useState(false);
  const [closingCase, setClosingCase]                           = useState(false);

  const [pets, setPets]                   = useState([]);
  const [selectedPetId, setSelectedPetId] = useState("");
  const [policyRecords, setPolicyRecords] = useState([]);
  const [selectedPolicyRecordId, setSelectedPolicyRecordId] = useState("");
  const [loadingPolicyRecords, setLoadingPolicyRecords] = useState(false);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [savingToVault, setSavingToVault]   = useState(false);

  // ── Policy parameter fields ─────────────────────────────────────────────────
  const [deductibleUsd,          setDeductibleUsd]          = useState("");
  const [deductibleModel,        setDeductibleModel]        = useState("annual"); // annual | per_incident
  const [deductibleMetUsd,       setDeductibleMetUsd]       = useState("");       // annual: already met
  const [deductibleStatus,       setDeductibleStatus]       = useState("unmet");
  const [reimbursementRatePct,   setReimbursementRatePct]   = useState("");
  const [benefitLimitUsd,        setBenefitLimitUsd]        = useState("");
  const [benefitUsedUsd,         setBenefitUsedUsd]         = useState("");       // limit already consumed
  const [policyType,             setPolicyType]             = useState("");
  const [waitingPeriodNotes,     setWaitingPeriodNotes]     = useState("");
  const [showPolicyParams,       setShowPolicyParams]       = useState(false);

  const { billing } = useBilling();
  const isFreeTier = !billing?.active || billing?.plan_id === "free" || billing?.plan_id === "free_tier";

  const ACTIVE_CLAIM_KEY = "petbill_active_claim";

  useEffect(() => {
    loadPets();
    loadPreviousClaims();
    // Restore last-viewed claim on refresh
    const savedId = sessionStorage.getItem(ACTIVE_CLAIM_KEY);
    if (savedId) {
      api.get(`/claims/${savedId}`)
        .then(({ data }) => {
          setResult(data);
          setActiveTab("reimbursable");
          setAppealLetter(data.appeal_draft || "");
          setAppealExpanded(Boolean(data.appeal_draft));
        })
        .catch(() => sessionStorage.removeItem(ACTIVE_CLAIM_KEY));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPets() {
    try {
      const { data } = await api.get("/pets");
      setPets(data || []);
      if (data?.length) setSelectedPetId(data[0].pet_id);
    } catch {}
  }

  const loadPolicyRecords = useCallback(async (petId) => {
    if (!petId) {
      setPolicyRecords([]);
      setSelectedPolicyRecordId("");
      return;
    }
    try {
      setLoadingPolicyRecords(true);
      const { data } = await api.get(`/pets/${petId}/records`);
      const policies = (data || []).filter((record) => record.record_type === "policy");
      setPolicyRecords(policies);
      setSelectedPolicyRecordId((current) =>
        current && policies.some((record) => record.record_id === current) ? current : ""
      );
    } catch {
      setPolicyRecords([]);
      setSelectedPolicyRecordId("");
    } finally {
      setLoadingPolicyRecords(false);
    }
  }, []);

  useEffect(() => {
    loadPolicyRecords(selectedPetId);
  }, [selectedPetId, loadPolicyRecords]);

  async function loadPreviousClaims() {
    try {
      setLoadingClaims(true);
      const { data } = await api.get("/claims");
      setPreviousClaims(data || []);
    } catch { setPreviousClaims([]); }
    finally { setLoadingClaims(false); }
  }

  function resetResultArea() {
    setAppealLetter(""); setNegotiationPoints(""); setFollowupAnswer("");
    setInsurerResponseText(""); setInsurerResponseFile(null);
    setAppealExpanded(false);
  }

  async function submit() {
    setError(""); setResult(null); resetResultArea();
    if (!selectedPolicyRecordId && !policyText && !policyFile && !invoiceText && !invoiceFile) {
      setError("Provide at least a policy document and/or a vet invoice."); return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      if (insurer)        fd.append("insurer",      insurer);
      if (selectedPetId)  fd.append("pet_id",        selectedPetId);
      if (selectedPolicyRecordId) fd.append("policy_record_id", selectedPolicyRecordId);
      if (policyText)     fd.append("policy_text",   policyText);
      if (invoiceText)    fd.append("invoice_text",  invoiceText);
      if (policyFile)     fd.append("policy_file",   policyFile);
      if (invoiceFile)    fd.append("invoice_file",  invoiceFile);

      // ── Policy intelligence params — these drive the pointed questions ───
      if (deductibleUsd)         fd.append("deductible_usd",           deductibleUsd);
      if (deductibleModel)       fd.append("deductible_model",         deductibleModel);
      if (deductibleMetUsd)      fd.append("deductible_met_usd",       deductibleMetUsd);
      if (deductibleStatus)      fd.append("deductible_status",        deductibleStatus);
      if (reimbursementRatePct)  fd.append("reimbursement_rate_pct",   reimbursementRatePct);
      if (benefitLimitUsd)       fd.append("benefit_limit_usd",        benefitLimitUsd);
      if (benefitUsedUsd)        fd.append("benefit_used_usd",         benefitUsedUsd);
      if (policyType)            fd.append("policy_type",              policyType);
      if (waitingPeriodNotes)    fd.append("waiting_period_notes",     waitingPeriodNotes);

      const { data } = await api.post("/claims/analyze", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      setResult(data);
      setActiveTab("reimbursable");

      // ── Persist so refresh restores the exact claim ──────────────────────
      if (data.claim_id) sessionStorage.setItem(ACTIVE_CLAIM_KEY, data.claim_id);

      await loadPreviousClaims();
      toast.success("Claim analyzed.");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not analyze the claim.");
    } finally { setLoading(false); }
  }

  async function openPreviousClaim(claim) {
    try {
      const { data } = await api.get(`/claims/${claim.claim_id}`);
      setResult(data); setActiveTab("reimbursable");
      setAppealLetter(data.appeal_draft || "");
      setAppealExpanded(Boolean(data.appeal_draft));
      // Persist so refresh restores this claim
      if (data.claim_id) sessionStorage.setItem(ACTIVE_CLAIM_KEY, data.claim_id);
    } catch { toast.error("Could not open saved claim"); }
  }

  async function askFollowupQuestion() {
    if (!followupQuestion.trim() || !result?.claim_id) return;
    try {
      setAskingFollowup(true);
      const { data } = await api.post("/claims/ask", { claim_id: result.claim_id, question: followupQuestion });
      setFollowupAnswer(data.answer);
    } catch { toast.error("Could not ask follow-up question"); }
    finally { setAskingFollowup(false); }
  }

  async function generateAppealLetter() {
    if (!result?.claim_id) return;
    setGeneratingAppeal(true);
    try {
      const { data } = await api.post("/claims/generate-appeal", { claim_id: result.claim_id, tone: "polite" });
      const letter = data.appeal_letter || "";
      setAppealLetter(letter);
      setResult((prev) => ({ ...prev, appeal_draft: letter }));
      setAppealExpanded(true); // auto-expand inline
      await loadPreviousClaims();
      toast.success("Appeal letter generated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not generate appeal letter");
    } finally { setGeneratingAppeal(false); }
  }

  async function generateNegotiationPoints() {
    if (!result?.claim_id) return;
    setGeneratingNegotiation(true);
    try {
      const { data } = await api.post("/claims/ask", {
        claim_id: result.claim_id,
        question: "Generate concise vet and insurer negotiation points based only on this claim. Give practical talking points, what to ask for, and what documents to mention.",
      });
      setNegotiationPoints(data.answer || "");
      setShowNegotiationModal(true);
      toast.success("Negotiation points generated");
    } catch { toast.error("Could not generate negotiation points"); }
    finally { setGeneratingNegotiation(false); }
  }

  async function saveToPetVault() {
    if (!result || !selectedPetId) { toast.error("Please select a pet first."); return; }
    if (result.saved_to_pet_vault) return;
    setSavingToVault(true);
    try {
      const { data } = await api.post("/claims/save-to-vault", {
        claim_id: result.claim_id,
        pet_id: selectedPetId,
      });
      setResult((prev) => ({
        ...prev,
        saved_to_pet_vault: true,
        saved_pet_id: data.pet_id || selectedPetId,
        saved_record_id: data.record_id || prev?.saved_record_id,
      }));
      await loadPreviousClaims();
      toast.success(data.already_saved ? "Already saved to Pet Vault." : "Saved to Pet Vault");
      setShowVaultModal(false);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save to Pet Vault"); }
    finally { setSavingToVault(false); }
  }

  async function copy(t) {
    try { await navigator.clipboard.writeText(t || ""); toast.success("Copied"); }
    catch { toast.error("Copy failed"); }
  }

  const markSubmittedToInsurer = useCallback(async () => {
    if (!result?.claim_id) return;
    try {
      await api.post(`/claims/${result.claim_id}/mark-submitted`);
      setResult((prev) => ({ ...prev, submitted_to_insurer: true, claim_status: "submitted", submitted_at: new Date().toISOString() }));
      toast.success("Marked as submitted to insurer");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not mark as submitted"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.claim_id]);

  // Stable callback so ClaimTimeline never re-mounts when parent re-renders
  const openInsurerResponseModal = useCallback(() => setShowInsurerResponseModal(true), []);

  async function saveInsurerResponse() {
    if (!result?.claim_id) return;
    if (!insurerResponseText.trim() && !insurerResponseFile) { toast.error("Paste a response or upload a file first."); return; }
    setSavingDecision(true);
    try {
      const fd = new FormData();
      if (selectedPetId) fd.append("pet_id", selectedPetId);
      if (insurerResponseText.trim()) fd.append("decision_text", insurerResponseText.trim());
      if (insurerResponseFile) fd.append("decision_file", insurerResponseFile);
      const { data } = await api.post(`/claims/${result.claim_id}/decision`, fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 120000 });
      setResult((prev) => ({
        ...prev,
        insurer_decision_saved: true,
        claim_status: data.claim_status,
        actual_reimbursement_usd: data.actual_reimbursement_usd,
        decision: data.decision,
        case_closed: false,
        closed_at: null,
      }));
      toast.success("Insurer decision saved.");
      setShowInsurerResponseModal(false);
      setInsurerResponseText(""); setInsurerResponseFile(null);
      // Refresh sidebar history in the background (no await — don't block UI)
      loadPreviousClaims();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not save insurer decision"); }
    finally { setSavingDecision(false); }
  }

  async function closeClaimCase() {
    if (!result?.claim_id || closingCase) return;
    setClosingCase(true);
    try {
      const { data } = await api.post(`/claims/${result.claim_id}/close`);
      setResult((prev) => ({
        ...prev,
        claim_status: data.claim_status,
        case_closed: true,
        closed_at: data.closed_at,
      }));
      await loadPreviousClaims();
      toast.success("Case closed.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not close this case");
    } finally {
      setClosingCase(false);
    }
  }

  const reimbursableItems   = result?.likely_reimbursable_categories || [];
  const excludedItems       = result?.likely_excluded || [];
  const missingDocs         = result?.missing_documents || [];
  const reimbursableTotal   = reimbursableItems.reduce((s, i) => s + (Number(i.estimated_amount_usd) || 0), 0);
  const excludedTotal       = excludedItems.reduce((s, i) => s + (Number(i.estimated_amount_usd) || 0), 0);
  const reimbursementEst    = Number(result?.estimated_reimbursement_usd) || 0;
  const actualReimbursement = Number(result?.actual_reimbursement_usd) || 0;
  const breakdownTotal      = reimbursableTotal + excludedTotal || reimbursementEst || 1;
  const confidencePercent   = getConfidencePercent(reimbursableItems);
  const outcome             = getOutcome(result);
  const activeAppealLetter  = appealLetter || result?.appeal_draft || "";
  const caseClosed          = Boolean(result?.case_closed || result?.claim_status === "closed");
  const decisionStatus      = (result?.decision?.decision_status || result?.claim_status || "").toLowerCase();
  const isDeniedDecision    = Boolean(result?.insurer_decision_saved) && !caseClosed && ["denied", "rejected"].includes(decisionStatus);
  const petNameById         = Object.fromEntries((pets || []).map((pet) => [pet.pet_id, pet.name || ""]));
  const selectedPolicyRecord = policyRecords.find((record) => record.record_id === selectedPolicyRecordId);
  const claimSearchTerm     = claimSearch.trim().toLowerCase();
  const searchedClaims      = claimSearchTerm
    ? previousClaims.filter((claim) => {
        const petName = (claim.pet_name || petNameById[claim.pet_id] || "").toLowerCase();
        return petName.includes(claimSearchTerm);
      })
    : [];

  return (
    <div className="space-y-5 pb-20" data-testid="claims-page">

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-[30px] bg-[#2D2C28] p-8 sm:p-10 text-[#FAF9F6]">
        <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="absolute left-[-80px] bottom-[-80px] h-52 w-52 rounded-full bg-[#556045]/30 blur-3xl" />
        <div className="relative z-10 max-w-3xl">
          <div className="eyebrow text-[#E6AE2E] mb-3">{t("claims.eyebrow")}</div>
          <h1 className="font-serif-display text-4xl sm:text-6xl leading-[0.95]">
            {t("claims.title")}
          </h1>
          <p className="mt-5 text-sm text-white/65 max-w-2xl leading-relaxed">
            {t("claims.subtitle")}
          </p>
        </div>
      </header>

      <ClaimSearchBar
        query={claimSearch}
        setQuery={setClaimSearch}
        claims={searchedClaims}
        totalClaims={previousClaims.length}
        pets={pets}
        loading={loadingClaims}
        onOpen={openPreviousClaim}
      />

      {/* ── Free tier gate ────────────────────────────────────────────── */}
      {isFreeTier && (
        <div className="rounded-[24px] bg-[#FFF4EE] border border-[#F2C5B7] p-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-2xl bg-[#D26D53] text-white flex items-center justify-center shrink-0">
            <Lock size={18} />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-[#2D2C28] mb-1">{t("claims.upgrade_prompt")}</div>
            <p className="text-xs text-[#65635C] leading-relaxed">
              {t("claims.requires_paid")}
            </p>
            <Link to="/dashboard/pricing" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#D26D53]">
              {t("common.upgrade_plan")} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      <div className={`grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 items-start ${isFreeTier ? "opacity-50 pointer-events-none select-none" : ""}`}>

        {/* ── Sidebar / Claim setup ─────────────────────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-20">

          {/* ── 1. Basic info ── */}
          <div className="cream-card p-4 rounded-[24px] space-y-3">
            <div className="eyebrow text-[#D26D53]">Claim details</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Pet</label>
                <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)}
                  className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40">
                  {pets.length === 0 ? <option value="">No pets found</option> : pets.map((p) => (
                    <option key={p.pet_id} value={p.pet_id}>{p.name}{p.breed ? ` · ${p.breed}` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Insurance company</label>
                <input value={insurer} onChange={(e) => setInsurer(e.target.value)}
                  placeholder="e.g. Trupanion"
                  className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40" />
              </div>
            </div>
          </div>

          {/* ── 2. Documents ── */}
          <div className="cream-card p-4 rounded-[24px] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="eyebrow text-[#D26D53]">Documents</div>
              <span className="text-[11px] text-[#8A887F]">Upload or paste text</span>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block">Policy document</label>
              <div className="rounded-2xl border border-[#E5E2D9] bg-white/75 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#2D2C28] inline-flex items-center gap-1.5">
                    <FileCheck2 size={14} className="text-[#556045]" />
                    Saved pet policy
                  </span>
                  {loadingPolicyRecords && <Loader2 size={13} className="animate-spin text-[#8A887F]" />}
                </div>
                <select
                  value={selectedPolicyRecordId}
                  onChange={(e) => setSelectedPolicyRecordId(e.target.value)}
                  disabled={!selectedPetId || loadingPolicyRecords || policyRecords.length === 0}
                  className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 disabled:bg-[#F2F0E9] disabled:text-[#8A887F]"
                >
                  <option value="">
                    {policyRecords.length ? "Choose a saved policy" : "No saved policies for this pet"}
                  </option>
                  {policyRecords.map((record) => (
                    <option key={record.record_id} value={record.record_id}>
                      {record.title || "Saved policy"}{record.date ? ` · ${record.date}` : ""}
                    </option>
                  ))}
                </select>
                {selectedPolicyRecord && (
                  <div className="rounded-xl bg-[#EEF2E6] px-3 py-2 text-xs text-[#556045]">
                    Using {selectedPolicyRecord.title || "saved policy"} for this claim. You can still add extra policy notes below.
                  </div>
                )}
              </div>
              <FileDropzone value={policyFile} onChange={setPolicyFile} testId="claim-policy-file" compact />
              <textarea value={policyText} onChange={(e) => setPolicyText(e.target.value)} rows={2}
                placeholder="…or paste policy summary text here."
                className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 resize-none" />
            </div>
            <div className="pt-3 border-t border-[#E5E2D9] space-y-2">
              <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block">Vet invoice</label>
              <FileDropzone value={invoiceFile} onChange={setInvoiceFile} testId="claim-invoice-file" compact />
              <textarea value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} rows={2}
                placeholder="…or paste invoice line items here."
                className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 resize-none" />
            </div>
          </div>

          {/* ── 3. Policy intelligence ── */}
          <div className="rounded-[24px] border border-[#E6AE2E]/30 bg-[#FFFBEB] p-4 space-y-4">
            <button
              type="button"
              onClick={() => setShowPolicyParams((v) => !v)}
              className="w-full flex items-center justify-between group"
            >
              <div>
                <div className="eyebrow text-[#92400E]">Policy intelligence</div>
                <p className="text-xs text-[#8A887F] mt-0.5">Add your policy details for precise calculations</p>
              </div>
              <ChevronDown size={16} className={`text-[#92400E] transition-transform ${showPolicyParams ? "rotate-180" : ""}`} />
            </button>

            {showPolicyParams && (
              <div className="space-y-4 pt-1">
                {/* Deductible model */}
                <div>
                  <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Deductible type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ v: "annual", label: "Annual", desc: "Once per year" }, { v: "per_incident", label: "Per-incident", desc: "Each claim" }].map((opt) => (
                      <button key={opt.v} type="button" onClick={() => setDeductibleModel(opt.v)}
                        className={`rounded-xl border p-2.5 text-left transition ${deductibleModel === opt.v ? "border-[#E6AE2E] bg-[#FEF6E4]" : "border-[#E5E2D9] bg-white hover:border-[#E6AE2E]/50"}`}>
                        <div className="text-xs font-semibold text-[#2D2C28]">{opt.label}</div>
                        <div className="text-[10px] text-[#8A887F]">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deductible amount */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Deductible ($)</label>
                    <input value={deductibleUsd} onChange={(e) => setDeductibleUsd(e.target.value)} type="number" min="0" placeholder="e.g. 500"
                      className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40" />
                  </div>
                  {deductibleModel === "annual" && (
                    <div>
                      <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Already met ($)</label>
                      <input value={deductibleMetUsd} onChange={(e) => setDeductibleMetUsd(e.target.value)} type="number" min="0" placeholder="e.g. 200"
                        className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40" />
                    </div>
                  )}
                </div>

                {/* Deductible status (auto-computed hint) */}
                {deductibleModel === "per_incident" && (
                  <div>
                    <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Deductible status</label>
                    <select value={deductibleStatus} onChange={(e) => setDeductibleStatus(e.target.value)}
                      className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40">
                      <option value="unmet">Not yet met</option>
                      <option value="partial">Partially met</option>
                      <option value="met">Fully met</option>
                    </select>
                  </div>
                )}

                {/* Co-insurance rate */}
                <div>
                  <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Reimbursement rate (%)</label>
                  <div className="flex flex-wrap gap-2">
                    {["70", "80", "90", "100"].map((r) => (
                      <button key={r} type="button" onClick={() => setReimbursementRatePct(r)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${reimbursementRatePct === r ? "bg-[#E6AE2E] text-[#2D2C28]" : "border border-[#E5E2D9] bg-white text-[#65635C] hover:border-[#E6AE2E]/50"}`}>
                        {r}%
                      </button>
                    ))}
                    <input value={!["70","80","90","100",""].includes(reimbursementRatePct) ? reimbursementRatePct : ""}
                      onChange={(e) => setReimbursementRatePct(e.target.value)} type="number" min="0" max="100" placeholder="Other"
                      className="w-16 rounded-lg border border-[#E5E2D9] bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40" />
                  </div>
                </div>

                {/* Benefit limit */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Annual limit ($)</label>
                    <input value={benefitLimitUsd} onChange={(e) => setBenefitLimitUsd(e.target.value)} type="number" min="0" placeholder="e.g. 10000"
                      className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Limit used ($)</label>
                    <input value={benefitUsedUsd} onChange={(e) => setBenefitUsedUsd(e.target.value)} type="number" min="0" placeholder="e.g. 2500"
                      className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40" />
                  </div>
                </div>

                {/* Policy type */}
                <div>
                  <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Coverage type</label>
                  <select value={policyType} onChange={(e) => setPolicyType(e.target.value)}
                    className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40">
                    <option value="">Not specified</option>
                    <option value="accident_illness">Accident + Illness</option>
                    <option value="accident_only">Accident only</option>
                    <option value="wellness">Wellness / Preventive</option>
                    <option value="comprehensive">Comprehensive</option>
                  </select>
                </div>

                {/* Waiting period notes */}
                <div>
                  <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Waiting period / pre-existing notes</label>
                  <textarea value={waitingPeriodNotes} onChange={(e) => setWaitingPeriodNotes(e.target.value)} rows={2}
                    placeholder="e.g. 14-day illness waiting period, hip dysplasia excluded"
                    className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E6AE2E]/40 resize-none" />
                </div>

                {/* Live calculation preview */}
                {deductibleUsd && reimbursementRatePct && (
                  <div className="rounded-xl bg-[#FEF6E4] border border-[#E6AE2E]/40 p-3 text-xs text-[#8A5A24] space-y-1">
                    <p className="font-semibold">Calculation preview</p>
                    {deductibleModel === "annual" && deductibleMetUsd ? (
                      <p>Remaining deductible: ${Math.max(0, Number(deductibleUsd) - Number(deductibleMetUsd)).toFixed(0)}</p>
                    ) : deductibleModel === "per_incident" ? (
                      <p>Deductible per claim: ${Number(deductibleUsd).toFixed(0)}</p>
                    ) : null}
                    <p>Insurer pays {reimbursementRatePct}% of eligible amount after deductible</p>
                    {benefitLimitUsd && benefitUsedUsd && (
                      <p>Available benefit: ${Math.max(0, Number(benefitLimitUsd) - Number(benefitUsedUsd)).toFixed(0)} remaining</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-[20px] bg-[#FFF4EE] border border-[#F2C5B7] p-4 text-sm text-[#8C2D14] flex items-start gap-3">
              <AlertTriangle size={15} className="text-[#D26D53] shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="btn-primary w-full rounded-[18px] px-5 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? <><Loader2 size={16} className="animate-spin" /> Analyzing…</> : <><Sparkles size={16} /> Analyze claim</>}
          </button>

          {/* Claim timeline — sidebar */}
          {result && (
            <ClaimTimeline
              result={result}
              hasAppealLetter={Boolean(activeAppealLetter)}
              markSubmittedToInsurer={markSubmittedToInsurer}
              openInsurerResponse={openInsurerResponseModal}
              closeClaimCase={closeClaimCase}
              closingCase={closingCase}
              actualReimbursement={result?.actual_reimbursement_usd}
              outcome={outcome}
            />
          )}

          {result && (
            <button
              onClick={() => !result.saved_to_pet_vault && setShowVaultModal(true)}
              disabled={result.saved_to_pet_vault}
              className={`w-full rounded-[20px] border py-3 text-sm font-semibold transition flex items-center justify-center gap-2 ${
                result.saved_to_pet_vault
                  ? "border-[#E5E2D9] bg-[#F2F0E9] text-[#8A887F] cursor-not-allowed"
                  : "border-[#E5E2D9] text-[#65635C] hover:bg-[#FAF9F6]"
              }`}
            >
              {result.saved_to_pet_vault ? <><CheckCircle2 size={15} /> Saved to Pet Vault</> : <><FolderPlus size={15} /> Save to Pet Vault</>}
            </button>
          )}
        </aside>

        {/* ── Main result area ─────────────────────────────────────────── */}
        <main className="space-y-5">
          {!result && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StepCard icon={UploadCloud}   step="1" title="Upload" text="Add policy, invoice, or pasted text." />
                <StepCard icon={Sparkles}      step="2" title="Analyze" text="Estimate reimbursement and flag missing documents." />
                <StepCard icon={FileCheck2}    step="3" title="Track" text="Generate appeal, submit, upload insurer decision." />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                <div className="cream-card p-5 rounded-[28px] h-full">
                  <div className="eyebrow text-[#D26D53] mb-3">What to expect</div>
                  <ul className="space-y-2.5 text-sm text-[#2D2C28]">
                    {["Estimated reimbursement based on supplied documents", "Covered, excluded, and uncertain items separated neatly", "Missing documents to gather before filing", "Appeal letter and negotiation talking points", "Decision upload with AI outcome classification"].map((item) => (
                      <li key={item} className="flex items-start gap-2.5"><Check size={14} className="text-[#556045] shrink-0 mt-0.5" />  {item}</li>
                    ))}
                  </ul>
                </div>

                <div className="cream-card p-5 rounded-[28px] h-full">
                  <div className="eyebrow text-[#8C2D14] mb-3">What this does not do</div>
                  <ul className="space-y-2.5 text-sm text-[#2D2C28]">
                    {["Does not guarantee reimbursement", "Does not replace your insurer's final decision", "Does not provide legal advice", "Does not diagnose your pet"].map((item) => (
                      <li key={item} className="flex items-start gap-2.5"><X size={13} className="text-[#D26D53] shrink-0 mt-0.5" />  {item}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-[#65635C] mt-4 leading-relaxed">Final coverage depends on your insurer, policy terms, deductible, limits, exclusions, and submitted records.</p>
                </div>
              </div>

              <PreviousClaimsPanel claims={previousClaims} pets={pets} loadingClaims={loadingClaims} onOpen={openPreviousClaim} onRefresh={loadPreviousClaims} />
            </>
          )}

          {result && (
            <>
              {/* Decision outcome banner — smooth entrance so it doesn't snap the layout */}
              <div
                className={`overflow-hidden transition-all duration-300 ease-out ${
                  result.insurer_decision_saved && outcome
                    ? "opacity-100 max-h-[400px] mb-0"
                    : "opacity-0 max-h-0 pointer-events-none"
                }`}
              >
                {result.insurer_decision_saved && outcome && (
                  <DecisionBanner outcome={outcome} result={result} actualReimbursement={actualReimbursement} />
                )}
              </div>

              {isDeniedDecision && (
                <DeniedDecisionActions
                  result={result}
                  hasAppealLetter={Boolean(activeAppealLetter)}
                  generatingAppeal={generatingAppeal}
                  generateAppealLetter={generateAppealLetter}
                  openInsurerResponse={openInsurerResponseModal}
                  closeClaimCase={closeClaimCase}
                  closingCase={closingCase}
                />
              )}

              {/* Result hero */}
              <ResultHero result={result} actualReimbursement={actualReimbursement} confidencePercent={confidencePercent} />

              {/* Summary */}
              <SummaryCard result={result} confidencePercent={confidencePercent} />

              {/* ── Deductible calculation ─────────────────────────────── */}
              {result.deductible_note && (
                <div className="rounded-[24px] border border-[#E6AE2E]/40 bg-[#FFFBEB] p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#E6AE2E] text-[#2D2C28] flex items-center justify-center shrink-0">
                      <DollarSign size={16} />
                    </div>
                    <div className="flex-1">
                      <div className="eyebrow text-[#92400E] mb-1">Deductible &amp; co-insurance breakdown</div>
                      <p className="text-sm text-[#2D2C28] leading-relaxed">{result.deductible_note}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Pointed questions ─────────────────────────────────── */}
              {(result.pointed_questions || []).length > 0 && (
                <div className="cream-card rounded-[28px] overflow-hidden">
                  <div className="p-5 border-b border-[#E5E2D9]">
                    <div className="eyebrow text-[#D26D53] mb-1">Questions to ask your insurer</div>
                    <h3 className="font-serif-display text-2xl">Pointed questions</h3>
                    <p className="text-xs text-[#65635C] mt-1">Based on your policy parameters and invoice — ordered by urgency.</p>
                  </div>
                  <div className="divide-y divide-[#E5E2D9]">
                    {result.pointed_questions.map((q, i) => (
                      <div key={i} className="p-5 flex items-start gap-4">
                        <span className={`shrink-0 mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          q.urgency === "high"
                            ? "bg-[#FEF0EE] text-[#8C2D14] border border-[#F2C5B7]"
                            : "bg-[#FEF6E4] text-[#8A5A24] border border-[#E6AE2E]/40"
                        }`}>
                          {q.urgency || "med"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#2D2C28] leading-snug">{q.question}</p>
                          {q.why && <p className="text-xs text-[#65635C] mt-1 leading-relaxed">{q.why}</p>}
                        </div>
                        <button
                          onClick={() => copy(q.question)}
                          className="shrink-0 w-7 h-7 rounded-lg bg-[#F2F0E9] hover:bg-[#E5E2D9] inline-flex items-center justify-center text-[#65635C] transition-colors"
                          title="Copy question"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost breakdown bars */}
              <div className="cream-card p-5 rounded-[28px]">
                <div className="eyebrow text-[#D26D53] mb-4">Cost breakdown</div>
                <div className="space-y-4">
                  <BreakdownBar label="Likely reimbursable" amount={reimbursableTotal} percent={Math.round((reimbursableTotal / breakdownTotal) * 100)} color="bg-[#556045]" />
                  <BreakdownBar label="Likely excluded" amount={excludedTotal} percent={Math.round((excludedTotal / breakdownTotal) * 100)} color="bg-[#8C2D14]" />
                  <BreakdownBar label="Estimated reimbursement" amount={reimbursementEst} percent={Math.round((reimbursementEst / breakdownTotal) * 100)} color="bg-[#D26D53]" />
                </div>
              </div>

              {/* Line item tabs */}
              <div className="cream-card rounded-[28px] overflow-hidden">
                <div className="grid grid-cols-3 border-b border-[#E5E2D9]">
                  <TabButton active={activeTab === "reimbursable"} onClick={() => setActiveTab("reimbursable")} label={`Likely reimbursable (${reimbursableItems.length})`} />
                  <TabButton active={activeTab === "excluded"} onClick={() => setActiveTab("excluded")} label={`Likely excluded (${excludedItems.length})`} />
                  <TabButton active={activeTab === "missing"} onClick={() => setActiveTab("missing")} label={`Missing docs (${missingDocs.length})`} />
                </div>
                {activeTab === "reimbursable" && <ReimbursableList items={reimbursableItems} />}
                {activeTab === "excluded" && <ExcludedList items={excludedItems} />}
                {activeTab === "missing" && <MissingDocsList items={missingDocs} />}
              </div>

              {/* ── Appeal letter section ─────────────────────────────── */}
              <div className="cream-card rounded-[28px] overflow-hidden">
                <div className="flex items-center justify-between gap-4 p-5 border-b border-[#E5E2D9]">
                  <div>
                    <div className="eyebrow text-[#D26D53] mb-1">Appeal support</div>
                    <h3 className="font-serif-display text-2xl">Appeal letter</h3>
                    <p className="text-sm text-[#65635C] mt-1">Generate a polite appeal letter ready to send to your insurer.</p>
                  </div>
                  {activeAppealLetter ? (
                    <button
                      onClick={() => setAppealExpanded((v) => !v)}
                      className="shrink-0 rounded-xl border border-[#E5E2D9] px-4 py-2 text-sm font-semibold text-[#65635C] hover:border-[#D26D53] hover:text-[#D26D53] transition flex items-center gap-2"
                    >
                      {appealExpanded ? "Collapse" : "View letter"}
                      <ChevronDown size={13} className={`transition-transform ${appealExpanded ? "rotate-180" : ""}`} />
                    </button>
                  ) : (
                    <button
                      onClick={generateAppealLetter}
                      disabled={generatingAppeal}
                      className="shrink-0 btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
                    >
                      {generatingAppeal ? <><Loader2 size={14} className="animate-spin" /> Writing…</> : <><Sparkles size={14} /> Generate letter</>}
                    </button>
                  )}
                </div>

                {activeAppealLetter && appealExpanded && (
                  <div className="p-5">
                    <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-5 text-sm leading-relaxed whitespace-pre-wrap font-mono text-[#2D2C28] max-h-[420px] overflow-y-auto">
                      {activeAppealLetter}
                    </div>
                    <div className="mt-4 flex gap-3">
                      <button onClick={() => copy(activeAppealLetter)} className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
                        <Copy size={14} /> Copy letter
                      </button>
                      {!result.submitted_to_insurer && (
                        <button onClick={markSubmittedToInsurer} className="btn-ghost rounded-xl px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
                          <Send size={14} /> Mark as submitted
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {!activeAppealLetter && (
                  <div className="p-5 text-xs text-[#8A887F] leading-relaxed">
                    Once generated, your appeal letter will appear here and stay saved with this claim.
                  </div>
                )}
              </div>

              {/* Negotiation points */}
              <div className="cream-card p-5 rounded-[28px]">
                <div className="eyebrow text-[#D26D53] mb-1">Pushback support</div>
                <h3 className="font-serif-display text-2xl">Negotiation points</h3>
                <p className="text-sm text-[#65635C] mt-2">Generate calm talking points for a follow-up call with your insurer.</p>
                <button
                  onClick={generateNegotiationPoints}
                  disabled={generatingNegotiation}
                  className="mt-4 btn-ghost rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
                >
                  {generatingNegotiation ? <><Loader2 size={14} className="animate-spin" /> Writing…</> : <><Sparkles size={14} /> Generate talking points</>}
                </button>
              </div>

              {/* Ask a question */}
              <AskCard
                followupQuestion={followupQuestion}
                setFollowupQuestion={setFollowupQuestion}
                askingFollowup={askingFollowup}
                askFollowupQuestion={askFollowupQuestion}
                followupAnswer={followupAnswer}
              />

              <NextStepsPanel
                key={result.claim_id || "active-next-steps"}
                steps={result.next_steps || []}
              />

              <PreviousClaimsPanel claims={previousClaims} pets={pets} loadingClaims={loadingClaims} onOpen={openPreviousClaim} onRefresh={loadPreviousClaims} compact />

              {result.disclaimer && <p className="text-xs text-[#65635C] leading-relaxed">{result.disclaimer}</p>}
            </>
          )}
        </main>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showNegotiationModal && (
        <TextModal title="Negotiation points" subtitle="Review and copy talking points" text={negotiationPoints || ""} onClose={() => setShowNegotiationModal(false)} onCopy={copy} />
      )}

      {showInsurerResponseModal && (
        <InsurerResponseModal
          text={insurerResponseText} setText={setInsurerResponseText}
          file={insurerResponseFile} setFile={setInsurerResponseFile}
          onClose={() => setShowInsurerResponseModal(false)}
          onSave={saveInsurerResponse}
          savingDecision={savingDecision}
        />
      )}

      {showVaultModal && (
        <VaultModal pets={pets} selectedPetId={selectedPetId} setSelectedPetId={setSelectedPetId}
          savingToVault={savingToVault} onSave={saveToPetVault} onClose={() => setShowVaultModal(false)} />
      )}
    </div>
  );
}

// ── Decision outcome banner ───────────────────────────────────────────────────

function DecisionBanner({ outcome, result, actualReimbursement }) {
  const Icon = outcome.icon;
  const isApproved = outcome.label.toLowerCase().includes("approved") || outcome.label.toLowerCase().includes("accepted");
  const isDenied = outcome.label.toLowerCase().includes("denied") || outcome.label.toLowerCase().includes("rejected");

  return (
    <div className={`rounded-[28px] border p-6 ${outcome.color}`}>
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
          isApproved ? "bg-[#556045] text-white" : isDenied ? "bg-[#D26D53] text-white" : "bg-[#E6AE2E] text-[#2D2C28]"
        }`}>
          <Icon size={22} />
        </div>
        <div className="flex-1">
          <div className="eyebrow mb-1">Insurer decision</div>
          <h2 className="font-serif-display text-4xl leading-tight">{outcome.label}</h2>
          {actualReimbursement > 0 && (
            <p className="mt-2 text-base font-semibold">
              ${Number(actualReimbursement).toFixed(2)} {isApproved ? "approved for reimbursement" : "partial reimbursement approved"}
            </p>
          )}
          {(result?.decision?.summary || result?.decision?.reason_summary) && (
            <p className="mt-2 text-sm leading-relaxed opacity-80">
              {result.decision.summary || result.decision.reason_summary}
            </p>
          )}
          {isDenied && result?.decision?.appeal_reason && (
            <p className="mt-2 text-sm leading-relaxed opacity-80">
              {result.decision.appeal_reason}
            </p>
          )}
          {isDenied && (
            <p className="mt-3 text-sm font-semibold">
              Consider generating an appeal letter if you haven't already — many denials are reversible.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DeniedDecisionActions({
  result,
  hasAppealLetter,
  generatingAppeal,
  generateAppealLetter,
  openInsurerResponse,
  closeClaimCase,
  closingCase,
}) {
  const deniedAmount = result?.decision?.denied_amount_usd;

  return (
    <div className="rounded-[28px] border border-[#F2C5B7] bg-[#FFF4EE] p-5">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="max-w-2xl">
          <div className="eyebrow text-[#8C2D14] mb-1">Denial follow-up</div>
          <h3 className="font-serif-display text-3xl leading-tight">Appeal, reupload, or close this case.</h3>
          <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
            Use the insurer response you uploaded to generate a stronger appeal. After you send it, upload the next insurer response here. If you are done pursuing it, close the case.
          </p>
          {deniedAmount != null && (
            <p className="text-xs text-[#8C2D14] mt-2 font-semibold">
              Denied amount noted: ${Number(deniedAmount).toFixed(2)}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={generateAppealLetter}
            disabled={generatingAppeal}
            className="btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {generatingAppeal
              ? <><Loader2 size={14} className="animate-spin" /> Writing…</>
              : <><Sparkles size={14} /> {hasAppealLetter ? "Regenerate appeal" : "Generate appeal"}</>}
          </button>
          <button
            type="button"
            onClick={openInsurerResponse}
            className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2"
          >
            <UploadCloud size={14} /> Upload new response
          </button>
          <button
            type="button"
            onClick={closeClaimCase}
            disabled={closingCase}
            className="rounded-xl border border-[#F2C5B7] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[#8C2D14] inline-flex items-center justify-center gap-2 hover:bg-white disabled:opacity-60"
          >
            {closingCase
              ? <><Loader2 size={14} className="animate-spin" /> Closing…</>
              : <><CheckCircle2 size={14} /> Case closed</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Claim timeline ────────────────────────────────────────────────────────────
// Wrapped in memo: only re-renders when result / outcome / appeal state changes,
// not on every parent re-render (e.g. modal open/close, text input).
const ClaimTimeline = memo(function ClaimTimeline({ result, hasAppealLetter, markSubmittedToInsurer, openInsurerResponse, closeClaimCase, closingCase, actualReimbursement, outcome }) {
  const submitted = Boolean(result?.submitted_to_insurer);
  const decisionSaved = Boolean(result?.insurer_decision_saved);
  const caseClosed = Boolean(result?.case_closed || result?.claim_status === "closed");
  const decisionStatus = (result?.decision?.decision_status || result?.claim_status || "").toLowerCase();
  const isDeniedDecision = decisionSaved && ["denied", "rejected"].includes(decisionStatus);

  const steps = [
    {
      label: "Claim analyzed",
      time: result?.created_at ? new Date(result.created_at).toLocaleDateString() : "Done",
      done: true,
      icon: FileCheck2,
    },
    {
      label: "Appeal letter generated",
      time: hasAppealLetter ? "Letter ready to send" : "Not yet generated",
      done: hasAppealLetter,
      icon: Sparkles,
    },
    {
      label: "Submitted to insurer",
      time: submitted ? `Submitted ${result?.submitted_at ? new Date(result.submitted_at).toLocaleDateString() : ""}` : "Click when you've submitted",
      done: submitted,
      icon: Send,
      clickable: !submitted,
      onClick: markSubmittedToInsurer,
    },
    {
      label: decisionSaved ? `Insurer decision: ${outcome?.label || "recorded"}` : "Insurer decision",
      time: decisionSaved
        ? (result?.decision?.decision_saved_at ? new Date(result.decision.decision_saved_at).toLocaleDateString() : "Saved")
        : "Upload when received",
      done: decisionSaved,
      icon: CalendarCheck,
      clickable: !caseClosed && (!decisionSaved || isDeniedDecision),
      onClick: openInsurerResponse,
      actionLabel: decisionSaved ? "Upload another response" : "Upload decision",
      outcomeDot: outcome?.dot,
    },
    {
      label: "Case closed",
      time: caseClosed
        ? `Closed ${result?.closed_at ? new Date(result.closed_at).toLocaleDateString() : ""}`
        : actualReimbursement > 0
          ? `$${Number(actualReimbursement).toFixed(2)} recorded`
          : isDeniedDecision
            ? "Close when you are done appealing"
            : "Pending",
      done: caseClosed || actualReimbursement > 0,
      icon: DollarSign,
      clickable: isDeniedDecision && !caseClosed,
      onClick: closeClaimCase,
      actionLabel: closingCase ? "Closing..." : "Case closed",
    },
  ];

  return (
    <div className="cream-card p-5 rounded-[28px]">
      <div className="eyebrow text-[#D26D53] mb-1">Claim progress</div>
      <h3 className="font-serif-display text-2xl mb-5">Appeal timeline</h3>
      <div className="space-y-0">
        {steps.map((step, i) => (
          <TimelineStep key={i} step={step} isLast={i === steps.length - 1} />
        ))}
      </div>
    </div>
  );
});

function TimelineStep({ step, isLast }) {
  const Icon = step.icon;

  return (
    <div className={`flex gap-3 ${!isLast ? "pb-4" : ""}`}>
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300 ${
          step.done
            ? step.outcomeDot
              ? `${step.outcomeDot.replace("bg-", "border-")} bg-white`
              : "border-[#556045] bg-[#E8F5EC] text-[#556045]"
            : "border-[#E5E2D9] bg-[#FAF9F6] text-[#C5C2BB]"
        }`}>
          {step.done
            ? <Check size={13} className={step.outcomeDot ? `text-${step.outcomeDot.replace("bg-", "")}` : "text-[#556045]"} />
            : <Icon size={13} />
          }
        </div>
        {!isLast && <div className={`w-0.5 flex-1 mt-1 transition-colors duration-300 ${step.done ? "bg-[#C8E8D4]" : "bg-[#E5E2D9]"}`} />}
      </div>

      <div className={`pb-0 min-w-0 ${!isLast ? "mb-3" : ""}`}>
        <div className={`text-sm font-semibold transition-colors duration-200 ${step.done ? "text-[#2D2C28]" : "text-[#65635C]"}`}>
          {step.label}
        </div>
        <div className="text-xs text-[#8A887F] mt-0.5 transition-all duration-200">{step.time}</div>
        {/* Smooth hide/show of the action button */}
        <div className={`overflow-hidden transition-all duration-250 ease-out ${step.clickable ? "max-h-[40px] opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"}`}>
          <button
            onClick={step.onClick}
            disabled={step.actionLabel === "Closing..."}
            className="text-xs font-semibold text-[#D26D53] inline-flex items-center gap-1 hover:gap-2 transition-all"
          >
            {step.actionLabel || (step.label.includes("Submit") ? "Mark as submitted" : "Upload decision")} <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepCard({ icon: Icon, step, title, text }) {
  return (
    <div className="cream-card p-5 rounded-[28px]">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-9 h-9 rounded-2xl bg-[#2D2C28] text-white flex items-center justify-center text-xs font-bold">{step}</span>
        <span className="w-9 h-9 rounded-2xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center">
          <Icon size={16} />
        </span>
      </div>
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-[#65635C] mt-1.5 leading-relaxed">{text}</p>
    </div>
  );
}

function ResultHero({ result, actualReimbursement, confidencePercent }) {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[#FAF9F6] border border-[#E5E2D9] p-6">
      <div className="absolute right-[-60px] top-[-60px] w-44 h-44 rounded-full bg-[#D26D53]/10" />
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <div className="eyebrow text-[#D26D53] mb-2">Analysis complete</div>
          <h2 className="font-serif-display text-3xl sm:text-4xl leading-tight">{result.insurer || "Insurance"} claim analysis</h2>
          <p className="text-sm text-[#65635C] mt-2 max-w-xl">Review estimated reimbursement, flag missing documents, and generate appeal letters.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <HeroMiniStat label="Estimated" value={`$${Number(result.estimated_reimbursement_usd || 0).toFixed(2)}`} />
          <HeroMiniStat label="Actual" value={actualReimbursement > 0 ? `$${actualReimbursement.toFixed(2)}` : "Pending"} />
          <HeroMiniStat label="Confidence" value={`${confidencePercent}%`} />
          <HeroMiniStat label="Status" value={result.case_closed || result.claim_status === "closed" ? "Closed" : result.insurer_decision_saved ? "Decision in" : result.submitted_to_insurer ? "Submitted" : "Analyzing"} />
        </div>
      </div>
    </section>
  );
}

function NextStepsPanel({ steps }) {
  const [expanded, setExpanded] = useState(false);

  if (!steps.length) return null;

  return (
    <div className="cream-card rounded-[28px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full p-5 flex items-center justify-between gap-4 text-left"
        aria-expanded={expanded}
      >
        <div>
          <div className="eyebrow text-[#556045] mb-1">Next steps</div>
          <h3 className="font-serif-display text-2xl">Recommended actions</h3>
          <p className="text-xs text-[#65635C] mt-1">
            {steps.length} step{steps.length === 1 ? "" : "s"} ready to review.
          </p>
        </div>
        <span className="shrink-0 rounded-xl border border-[#E5E2D9] px-3 py-2 text-xs font-semibold text-[#65635C] inline-flex items-center gap-2">
          {expanded ? "Hide" : "Show"}
          <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[#E5E2D9]">
          <ol className="space-y-3 text-sm pt-5">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-[#2D2C28] text-white text-xs inline-flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function PreviousClaimsPanel({ claims, pets = [], loadingClaims, onOpen, onRefresh, compact }) {
  const [expanded, setExpanded] = useState(false);
  const [petSearch, setPetSearch] = useState("");
  const petNameById = Object.fromEntries((pets || []).map((pet) => [pet.pet_id, pet.name || ""]));
  const normalizedSearch = petSearch.trim().toLowerCase();
  const filteredClaims = normalizedSearch
    ? claims.filter((claim) => {
        const petName = (claim.pet_name || petNameById[claim.pet_id] || "").toLowerCase();
        return petName.includes(normalizedSearch);
      })
    : claims;

  return (
    <section className="cream-card rounded-[28px] overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="eyebrow text-[#D26D53] mb-1">Previous analyses</div>
          <h2 className="font-serif-display text-2xl">Claim history</h2>
          <p className="text-xs text-[#65635C] mt-1">
            {loadingClaims
              ? "Loading saved claim analyses..."
              : `${claims.length} saved claim ${claims.length === 1 ? "analysis" : "analyses"}.`}
          </p>
        </button>
        <div className="w-full sm:w-auto shrink-0 flex items-center gap-2">
          <button onClick={onRefresh} className="flex-1 sm:flex-none btn-ghost rounded-xl px-3 py-1.5 text-xs inline-flex items-center justify-center gap-1.5">
            <RefreshCcw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex-1 sm:flex-none rounded-xl border border-[#E5E2D9] px-3 py-2 text-xs font-semibold text-[#65635C] inline-flex items-center justify-center gap-2 hover:border-[#D26D53] hover:text-[#D26D53] transition"
            aria-label={expanded ? "Collapse previous analyses" : "Expand previous analyses"}
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Show"}
            <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-[#E5E2D9] pt-5">
          {loadingClaims ? (
            <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading...</div>
          ) : claims.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E5E2D9] p-6 text-sm text-[#65635C] text-center">No previous claim analyses yet.</div>
          ) : (
            <div className="space-y-3">
              <label className="relative block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />
                <input
                  value={petSearch}
                  onChange={(e) => setPetSearch(e.target.value)}
                  placeholder="Search by pet name"
                  className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] pl-9 pr-3 py-2.5 text-sm text-[#2D2C28] placeholder:text-[#8A887F] focus:outline-none focus:ring-2 focus:ring-[#D26D53]/20 focus:border-[#D26D53]"
                />
              </label>

              {filteredClaims.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#E5E2D9] p-6 text-sm text-[#65635C] text-center">
                  No saved claims match that pet name.
                </div>
              ) : (
                <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
              {filteredClaims.map((claim) => {
                const claimOutcome = getOutcome(claim);
                const petName = claim.pet_name || petNameById[claim.pet_id] || "";
                return (
                  <button key={claim.claim_id} onClick={() => onOpen(claim)}
                    className="text-left rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 hover:border-[#D26D53] hover:bg-white transition group">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm">{claim.insurer || "Unknown insurer"}</div>
                        <div className="text-xs text-[#65635C] mt-0.5">
                          {petName ? `${petName} · ` : ""}
                          {claim.created_at ? new Date(claim.created_at).toLocaleDateString() : "No date"}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-serif-display text-xl text-[#556045]">${Number(claim.estimated_reimbursement_usd || 0).toFixed(0)}</span>
                        {claimOutcome && (
                          <div className={`mt-1 text-[10px] rounded-full px-2 py-0.5 font-semibold ${claimOutcome.color}`}>{claimOutcome.label}</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="text-[11px] rounded-full bg-[#F2F0E9] text-[#65635C] px-2.5 py-0.5">{(claim.likely_reimbursable_categories || []).length} reimbursable items</span>
                      <span className="text-[11px] rounded-full bg-[#F2F0E9] text-[#65635C] px-2.5 py-0.5">{(claim.missing_documents || []).length} missing docs</span>
                      {!claim.insurer_decision_saved && (
                        <span className="text-[11px] rounded-full bg-[#FFF4EE] text-[#D26D53] px-2.5 py-0.5">Decision pending</span>
                      )}
                    </div>
                    <div className="mt-3 text-xs font-semibold text-[#D26D53] inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                      <Eye size={12} /> Open analysis
                    </div>
                  </button>
                );
              })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ClaimSearchBar({ query, setQuery, claims, totalClaims, pets = [], loading, onOpen }) {
  const petNameById = Object.fromEntries((pets || []).map((pet) => [pet.pet_id, pet.name || ""]));
  const hasQuery = query.trim().length > 0;

  return (
    <section className="cream-card rounded-[24px] p-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="min-w-0 lg:w-[280px]">
          <div className="eyebrow text-[#D26D53] mb-1">Find a saved claim</div>
          <p className="text-xs text-[#65635C]">
            Search previous claim analyses by pet name.
          </p>
        </div>

        <label className="relative flex-1 block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by pet name, e.g. Luna"
            className="w-full rounded-2xl border border-[#E5E2D9] bg-white pl-10 pr-3 py-3 text-sm text-[#2D2C28] placeholder:text-[#8A887F] focus:outline-none focus:ring-2 focus:ring-[#D26D53]/20 focus:border-[#D26D53]"
          />
        </label>

        <div className="text-xs text-[#8A887F] lg:text-right lg:w-[130px]">
          {loading ? "Loading..." : `${totalClaims} saved`}
        </div>
      </div>

      {hasQuery && (
        <div className="mt-3 border-t border-[#E5E2D9] pt-3">
          {loading ? (
            <div className="text-sm text-[#65635C] inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Searching...
            </div>
          ) : claims.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E5E2D9] p-4 text-sm text-[#65635C] text-center">
              No saved claims match that pet name.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
              {claims.slice(0, 6).map((claim) => {
                const petName = claim.pet_name || petNameById[claim.pet_id] || "Unknown pet";
                const claimOutcome = getOutcome(claim);
                return (
                  <button
                    key={claim.claim_id}
                    type="button"
                    onClick={() => onOpen(claim)}
                    className="text-left rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-3 hover:border-[#D26D53] hover:bg-white transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{petName}</div>
                        <div className="text-xs text-[#65635C] truncate">
                          {claim.insurer || "Unknown insurer"}
                        </div>
                      </div>
                      <Eye size={13} className="text-[#D26D53] shrink-0 mt-0.5" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[#8A887F]">
                        {claim.created_at ? new Date(claim.created_at).toLocaleDateString() : "No date"}
                      </span>
                      {claimOutcome && (
                        <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${claimOutcome.color}`}>
                          {claimOutcome.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {claims.length > 6 && (
            <p className="mt-2 text-[11px] text-[#8A887F]">
              Showing first 6 matches. Refine the pet name to narrow results.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCard({ result, confidencePercent }) {
  return (
    <div className="cream-card p-5 rounded-[28px]">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-5">
        <div>
          <div className="eyebrow text-[#D26D53] mb-4">Summary</div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <div className="text-xs text-[#65635C] mb-1">Insurer</div>
              <div className="font-semibold">{result.insurer || "Unspecified"}</div>
            </div>
            <div>
              <div className="text-xs text-[#65635C] mb-1">Estimated reimbursement</div>
              <div className="font-serif-display text-3xl text-[#556045]">${Number(result.estimated_reimbursement_usd || 0).toFixed(2)}</div>
            </div>
          </div>
          {result.deductible_note && (
            <div className="mt-4">
              <div className="text-xs text-[#65635C] mb-1">Deductible note</div>
              <p className="text-sm text-[#2D2C28]">{result.deductible_note}</p>
            </div>
          )}
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-[#E5E2D9] pt-5 lg:pt-0 lg:pl-5">
          <div className="flex items-center gap-2 text-sm font-semibold">Confidence <Info size={13} className="text-[#65635C]" /></div>
          <div className="mt-3 flex items-center justify-between">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              confidencePercent >= 75 ? "bg-[#E7EBDD] text-[#556045]" : confidencePercent >= 45 ? "bg-[#FEF6E4] text-[#8A5A24]" : "bg-[#FEF0EE] text-[#8C2D14]"
            }`}>
              {confidencePercent >= 75 ? "High" : confidencePercent >= 45 ? "Medium" : "Low"} confidence
            </span>
            <span className="font-serif-display text-3xl">{confidencePercent}%</span>
          </div>
          <p className="text-xs text-[#65635C] mt-3 leading-relaxed">Based on policy coverage, submitted items, and identified documents.</p>
        </div>
      </div>
    </div>
  );
}

function BreakdownBar({ label, amount, percent, color }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-xs">${Number(amount || 0).toFixed(2)} <span className="text-[#65635C]">({percent || 0}%)</span></span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-[#E5E2D9] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(Math.max(percent || 0, 0), 100)}%` }} />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button onClick={onClick} className={`px-3 py-4 text-xs sm:text-sm font-semibold border-b-2 ${active ? "border-[#556045] text-[#556045] bg-[#FAF9F6]" : "border-transparent text-[#65635C] hover:text-[#2D2C28]"}`}>
      {label}
    </button>
  );
}

function ReimbursableList({ items }) {
  if (!items.length) return <EmptyTab message="No likely reimbursable items identified." />;
  return (
    <ul className="divide-y divide-[#E5E2D9]">
      {items.map((item, i) => (
        <li key={i} className="px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-full bg-[#E7EBDD] text-[#556045] inline-flex items-center justify-center shrink-0"><Check size={14} /></span>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm">{item.label}</span>
                <ConfidencePill value={item.confidence} />
              </div>
              {item.rationale && <p className="text-xs text-[#65635C] mt-1">{item.rationale}</p>}
            </div>
            <div className="font-mono text-sm shrink-0">${Number(item.estimated_amount_usd || 0).toFixed(2)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ExcludedList({ items }) {
  if (!items.length) return <EmptyTab message="No likely excluded items." />;
  return (
    <ul className="divide-y divide-[#E5E2D9]">
      {items.map((item, i) => (
        <li key={i} className="px-5 py-4">
          <div className="font-semibold text-sm">{item.label}</div>
          {item.rationale && <p className="text-xs text-[#65635C] mt-1">{item.rationale}</p>}
        </li>
      ))}
    </ul>
  );
}

function MissingDocsList({ items }) {
  if (!items.length) return <EmptyTab message="No missing documents identified." />;
  return (
    <ul className="divide-y divide-[#E5E2D9]">
      {items.map((item, i) => (
        <li key={i} className="px-5 py-4 flex items-start gap-2.5 text-sm">
          <AlertTriangle size={14} className="text-[#E6AE2E] shrink-0 mt-0.5" />{item}
        </li>
      ))}
    </ul>
  );
}

function EmptyTab({ message }) {
  return <div className="p-8 text-sm text-[#65635C] text-center">{message}</div>;
}

function ConfidencePill({ value }) {
  const c = value || "medium";
  return (
    <span className={`text-[10px] uppercase tracking-widest rounded-full px-2 py-0.5 ${c === "high" ? "bg-[#E7EBDD] text-[#556045]" : c === "low" ? "bg-[#F4DAD3] text-[#8C2D14]" : "bg-[#F6E7D8] text-[#8A5A24]"}`}>
      {c}
    </span>
  );
}

function AskCard({ followupQuestion, setFollowupQuestion, askingFollowup, askFollowupQuestion, followupAnswer }) {
  return (
    <div className="cream-card p-5 rounded-[28px]">
      <div className="eyebrow text-[#D26D53] mb-2">Ask about this claim</div>
      <h3 className="font-serif-display text-2xl mb-4">Follow-up questions</h3>
      <div className="flex flex-wrap gap-2 mb-3">
        {["Why was this item excluded?", "What documents should I gather?", "What should I appeal?"].map((q) => (
          <button key={q} onClick={() => setFollowupQuestion(q)} className="btn-ghost rounded-xl px-3 py-1.5 text-xs font-semibold">{q}</button>
        ))}
      </div>
      <textarea value={followupQuestion} onChange={(e) => setFollowupQuestion(e.target.value)} rows={3}
        placeholder="Ask anything about this claim…"
        className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 resize-none" />
      <button onClick={askFollowupQuestion} disabled={askingFollowup || !followupQuestion.trim()}
        className="mt-3 btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
        {askingFollowup ? <><Loader2 size={14} className="animate-spin" /> Thinking…</> : <>Ask</>}
      </button>
      {followupAnswer && (
        <div className="mt-4 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 text-sm leading-relaxed whitespace-pre-wrap">{followupAnswer}</div>
      )}
    </div>
  );
}

function HeroMiniStat({ label, value }) {
  return (
    <div className="rounded-xl bg-white/70 border border-[#E5E2D9] p-3">
      <div className="text-[10px] uppercase tracking-widest text-[#65635C]">{label}</div>
      <div className="font-semibold text-sm mt-1">{value}</div>
    </div>
  );
}

function TextModal({ title, subtitle, text, onClose, onCopy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-[28px] border border-[#E5E2D9] bg-[#FAF9F6] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="eyebrow text-[#D26D53] mb-2">{title}</div>
            <h3 className="font-serif-display text-3xl">{subtitle}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#F2F0E9] flex items-center justify-center hover:bg-[#E5E2D9] transition">
            <X size={15} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-[#E5E2D9] bg-white p-5 text-sm leading-relaxed whitespace-pre-wrap">{text}</div>
        <div className="mt-4 flex justify-end">
          <button onClick={() => onCopy(text)} className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold inline-flex items-center gap-2">
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}

function InsurerResponseModal({ text, setText, file, setFile, onClose, onSave, savingDecision }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[28px] border border-[#E5E2D9] bg-[#FAF9F6] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="eyebrow text-[#D26D53] mb-2">Insurer decision</div>
            <h3 className="font-serif-display text-3xl">Upload or paste the decision</h3>
            <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
              Add the insurer's reimbursement decision, denial letter, EOB, or payment explanation.
              Our AI will read it and classify the outcome automatically.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-[#F2F0E9] flex items-center justify-center hover:bg-[#E5E2D9] transition shrink-0">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4">
          <FileDropzone value={file} onChange={setFile} testId="insurer-response-file" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7}
            placeholder="Or paste the insurer's decision letter here…"
            className="w-full rounded-2xl border border-[#E5E2D9] bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40 resize-none" />
        </div>
        <div className="mt-5 rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-4 flex items-start gap-3">
          <Sparkles size={14} className="text-[#D26D53] shrink-0 mt-0.5" />
          <p className="text-xs text-[#65635C] leading-relaxed">Our AI will automatically read the document and classify the outcome as Approved, Partially Approved, or Denied — and extract the reimbursement amount.</p>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-semibold">Cancel</button>
          <button onClick={onSave} disabled={savingDecision}
            className="btn-primary rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70">
            {savingDecision ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><UploadCloud size={14} /> Save &amp; analyze decision</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function VaultModal({ pets, selectedPetId, setSelectedPetId, savingToVault, onSave, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-[28px] border border-[#E5E2D9] bg-[#FAF9F6] p-6 shadow-2xl">
        <div className="eyebrow text-[#D26D53] mb-2">Save to Pet Vault</div>
        <h3 className="font-serif-display text-2xl mb-2">Choose a pet</h3>
        <p className="text-sm text-[#65635C] mb-5">This claim analysis will be saved under the selected pet's records.</p>
        <select value={selectedPetId} onChange={(e) => setSelectedPetId(e.target.value)}
          className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm">
          {pets.length === 0 ? <option value="">No pets found</option> : pets.map((p) => (
            <option key={p.pet_id} value={p.pet_id}>{p.name}{p.breed ? ` — ${p.breed}` : ""}</option>
          ))}
        </select>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost rounded-xl px-4 py-2 text-sm">Cancel</button>
          <button onClick={onSave} disabled={savingToVault || !selectedPetId}
            className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-70">
            {savingToVault ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getConfidencePercent(items) {
  if (!items || items.length === 0) return 0;
  const score = items.reduce((s, item) => s + (item.confidence === "high" ? 1 : item.confidence === "medium" ? 0.6 : 0.3), 0);
  return Math.round((score / items.length) * 100);
}
