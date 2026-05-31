import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback } from "react";
import api from "../lib/api";
import {
  Loader2,
  Sparkles,
  Copy,
  MessagesSquare,
  Lock,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Trash2,
  RotateCcw,
  Clock,
  History,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useBilling } from "../lib/billing";

// Keys only — translated inside the component via t()
const TONES = [
  { v: "polite", labelKey: "scripts.tone_polite",  desc: "Friendly and respectful" },
  { v: "warm",   labelKey: "scripts.tone_warm",    desc: "Empathetic and caring"   },
  { v: "firm",   labelKey: "scripts.tone_firm",    desc: "Clear and confident"     },
  { v: "direct", labelKey: "scripts.tone_direct",  desc: "No fluff, just facts"    },
];

const EXAMPLES = [
  "The vet gave me a $2,400 estimate and I need to ask what's urgent today vs. what can wait.",
  "I want to ask for an itemized breakdown of my bill before I pay.",
  "I need to understand what my insurance covers before I approve the surgery.",
  "I want to ask about less expensive alternatives for this medication.",
];

export default function Scripts() {
  const { t } = useTranslation();
  const [situation,   setSituation]   = useState("");
  const [tone,        setTone]        = useState("polite");
  const [petName,     setPetName]     = useState("");
  const [petSpecies,  setPetSpecies]  = useState("");
  const [cost,        setCost]        = useState("");
  const [loading,     setLoading]     = useState(false);
  const [result,      setResult]      = useState(null);
  const [history,     setHistory]     = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const { billing } = useBilling();

  const isFreeTier =
    !billing?.active ||
    billing?.plan_id === "free" ||
    billing?.plan_id === "free_tier";

  const loadHistory = useCallback(async () => {
    if (isFreeTier) return;
    try {
      setLoadingHist(true);
      const { data } = await api.get("/scripts");
      setHistory(data?.scripts || []);
    } catch {
      // silently fail — history is nice-to-have
    } finally {
      setLoadingHist(false);
    }
  }, [isFreeTier]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function submit() {
    if (!situation.trim()) return toast.error("Describe the situation briefly.");
    setLoading(true);
    try {
      const { data } = await api.post("/scripts/generate", {
        situation,
        tone,
        pet_name:            petName,
        pet_species:         petSpecies,
        estimated_cost_usd:  cost ? Number(cost) : null,
      });
      setResult(data);
      // Reload history to show the newly saved script at the top
      loadHistory();
    } catch {
      toast.error("Could not generate a script");
    } finally {
      setLoading(false);
    }
  }

  async function deleteScript(scriptId) {
    try {
      await api.delete(`/scripts/${scriptId}`);
      setHistory(prev => prev.filter(s => s.script_id !== scriptId));
      toast.success("Script deleted");
    } catch {
      toast.error("Could not delete script");
    }
  }

  function reuseSettings(script) {
    setSituation(script.situation || "");
    setTone(script.tone || "polite");
    setPetName(script.pet_name || "");
    setPetSpecies(script.pet_species || "");
    setCost(script.estimated_cost_usd != null ? String(script.estimated_cost_usd) : "");
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.success("Settings loaded — edit and regenerate.");
  }

  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="space-y-7 pb-16" data-testid="scripts-page">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-7 sm:p-10 lg:p-12">
        <div className="absolute right-[-80px] top-[-80px] h-[260px] w-[260px] rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="absolute left-[-80px] bottom-[-80px] h-[260px] w-[260px] rounded-full bg-[#556045]/25 blur-3xl" />

        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75">
            <MessagesSquare size={14} />
            Question scripts
          </div>

          <h1 className="mt-5 font-serif-display text-5xl sm:text-6xl leading-[0.95]">
            The exact{" "}
            <span className="italic text-[#D26D53]">words to use</span>{" "}
            at the vet.
          </h1>

          <p className="mt-5 text-sm sm:text-base text-white/70 max-w-2xl leading-relaxed">
            Many of us freeze under stress. Tell us your situation and we'll
            write a calm, professional script you can read aloud or paraphrase
            — tailored to your tone and your pet.
          </p>
        </div>
      </section>

      {isFreeTier ? (
        <FreeTierGate />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6 items-start">

          {/* ── Left: form ── */}
          <aside className="space-y-5">
            <div className="cream-card p-6 rounded-[28px]">
              <div className="eyebrow text-[#D26D53] mb-4">Situation</div>

              <textarea
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={5}
                placeholder="e.g. The vet gave me a $2,400 estimate for emergency dental surgery and I need to ask what's urgent today and what can wait."
                className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-4 py-3 text-sm outline-none focus:border-[#D26D53] resize-none leading-relaxed"
                data-testid="script-situation"
              />

              <div className="mt-3">
                <div className="eyebrow mb-2">Quick starters</div>
                <div className="space-y-2">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setSituation(ex)}
                      className="w-full text-left rounded-xl border border-[#E5E2D9] bg-white/50 px-3 py-2 text-xs text-[#65635C] hover:border-[#D26D53] hover:text-[#2D2C28] transition line-clamp-2"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="cream-card p-6 rounded-[28px]">
              <div className="eyebrow text-[#D26D53] mb-4">Tone</div>
              <div className="grid grid-cols-2 gap-2">
                {TONES.map((toneOpt) => (
                  <button
                    key={toneOpt.v}
                    onClick={() => setTone(toneOpt.v)}
                    className={`rounded-2xl border p-3 text-left transition ${
                      tone === toneOpt.v
                        ? "border-[#D26D53] bg-[#FFF7F2]"
                        : "border-[#E5E2D9] bg-white/50 hover:border-[#D26D53]/40"
                    }`}
                  >
                    <div className="font-semibold text-sm">{t(toneOpt.labelKey)}</div>
                    <div className="text-xs text-[#65635C] mt-0.5">{toneOpt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="cream-card p-6 rounded-[28px]">
              <div className="eyebrow text-[#D26D53] mb-4">About your pet (optional)</div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="eyebrow block mb-1">Pet name</span>
                    <input
                      value={petName}
                      onChange={(e) => setPetName(e.target.value)}
                      placeholder="Mochi"
                      className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                      data-testid="script-pet-name"
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow block mb-1">Species</span>
                    <input
                      value={petSpecies}
                      onChange={(e) => setPetSpecies(e.target.value)}
                      placeholder="dog / cat…"
                      className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                      data-testid="script-pet-species"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="eyebrow block mb-1">Estimated cost (USD)</span>
                  <input
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    type="number"
                    step="0.01"
                    placeholder="2400"
                    className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                    data-testid="script-cost"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={submit}
              disabled={loading || !situation.trim()}
              className="w-full rounded-2xl bg-[#D26D53] hover:bg-[#BD5D44] text-white px-6 py-4 text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 transition shadow-lg"
              data-testid="script-submit"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Writing your script…</>
              ) : (
                <><Sparkles size={16} /> Generate script</>
              )}
            </button>
          </aside>

          {/* ── Right: result + history ── */}
          <div className="space-y-6">
            {!result ? (
              <EmptyState loading={loading} />
            ) : (
              <ScriptResult result={result} onCopy={copyText} />
            )}

            <PreviousScripts
              history={history}
              loading={loadingHist}
              onDelete={deleteScript}
              onReuse={reuseSettings}
              onCopy={copyText}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── PreviousScripts ───────────────────────────────────────────────────────────
function PreviousScripts({ history, loading, onDelete, onReuse, onCopy }) {
  const [open, setOpen] = useState(true);

  if (loading) {
    return (
      <div className="cream-card rounded-[28px] p-6 flex items-center gap-3 text-sm text-[#65635C]">
        <Loader2 size={15} className="animate-spin text-[#D26D53]" />
        Loading previous scripts…
      </div>
    );
  }

  return (
    <div className="cream-card rounded-[28px] overflow-hidden">
      {/* Header — always visible, toggles list */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-5 hover:bg-[#F5F2EB] transition"
      >
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#F2E5DE] text-[#D26D53] flex items-center justify-center shrink-0">
            <History size={16} />
          </span>
          <div className="text-left">
            <div className="font-semibold text-[#2D2C28] text-sm leading-tight">Previous scripts</div>
            <div className="text-xs text-[#8A887F] mt-0.5">
              {history.length === 0 ? "None saved yet" : `${history.length} script${history.length !== 1 ? "s" : ""} saved`}
            </div>
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`text-[#8A887F] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-[#E5E2D9]">
          {history.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#F2F0E9] flex items-center justify-center mx-auto mb-3">
                <MessagesSquare size={20} className="text-[#C5C2BB]" />
              </div>
              <p className="text-sm font-semibold text-[#2D2C28]">No previous scripts yet</p>
              <p className="text-xs text-[#8A887F] mt-1.5 max-w-xs mx-auto">
                Scripts you generate are saved here automatically so you can revisit or reuse them.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0EDE6]">
              {history.map((s) => (
                <ScriptHistoryItem
                  key={s.script_id}
                  script={s}
                  onDelete={onDelete}
                  onReuse={onReuse}
                  onCopy={onCopy}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ScriptHistoryItem ─────────────────────────────────────────────────────────
function ScriptHistoryItem({ script, onDelete, onReuse, onCopy }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    setDeleting(true);
    await onDelete(script.script_id);
    setDeleting(false);
  }

  return (
    <div className="group">
      {/* Summary row — click to expand */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-6 py-4 hover:bg-[#FAFAF8] transition-colors"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-semibold rounded-full px-2.5 py-0.5 capitalize border
                ${script.tone === "polite"  ? "bg-[#E8F5EC] text-[#2F6B45] border-[#C8E8D4]" :
                  script.tone === "warm"    ? "bg-[#FFF7F2] text-[#B85C38] border-[#F5D0C2]" :
                  script.tone === "firm"    ? "bg-[#F0F4FF] text-[#3D4A8C] border-[#C5CEEF]" :
                                             "bg-[#F2F0E9] text-[#65635C] border-[#E0DDD5]"}`}
              >
                {script.tone}
              </span>
              {script.pet_name && (
                <span className="text-[10px] text-[#8A887F]">
                  {script.pet_name}{script.pet_species ? ` · ${script.pet_species}` : ""}
                </span>
              )}
              {script.estimated_cost_usd != null && (
                <span className="text-[10px] text-[#8A887F]">${Number(script.estimated_cost_usd).toLocaleString()}</span>
              )}
            </div>

            <p className="text-sm text-[#2D2C28] leading-snug line-clamp-2">
              {script.situation}
            </p>

            <div className="flex items-center gap-1 mt-1.5">
              <Clock size={10} className="text-[#C5C2BB]" />
              <span className="text-[10px] text-[#C5C2BB]">{formatDate(script.created_at)}</span>
            </div>
          </div>

          <ChevronDown
            size={14}
            className={`text-[#C5C2BB] shrink-0 mt-1 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-6 pb-5 space-y-4 bg-[#FAFAF8]">
          {/* Script text */}
          <div className="rounded-2xl border border-[#E5E2D9] bg-white p-5">
            <p className="text-sm leading-loose text-[#2D2C28] whitespace-pre-wrap">{script.script}</p>
          </div>

          {/* Follow-up questions */}
          {(script.follow_up_questions || []).length > 0 && (
            <div className="space-y-1.5">
              <p className="eyebrow text-[#556045]">Follow-up questions</p>
              {script.follow_up_questions.map((q, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xl border border-[#E5E2D9] bg-white px-4 py-3">
                  <ChevronRight size={13} className="text-[#D26D53] mt-0.5 shrink-0" />
                  <span className="text-xs leading-relaxed text-[#2D2C28]">{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={() => onReuse(script)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#556045] hover:text-[#3D4A2C] transition-colors"
            >
              <RotateCcw size={12} />
              Reuse settings
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onCopy(script.script)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] hover:border-[#D26D53] hover:text-[#D26D53] transition"
              >
                <Copy size={12} />
                Copy
              </button>

              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#E5E2D9] bg-white px-3 py-1.5 text-xs font-semibold text-[#65635C] hover:border-red-300 hover:text-red-500 transition disabled:opacity-50"
              >
                {deleting
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Trash2 size={12} />
                }
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FreeTierGate ──────────────────────────────────────────────────────────────
function FreeTierGate() {
  return (
    <div className="cream-card p-10 rounded-[34px] text-center max-w-2xl mx-auto">
      <span className="w-16 h-16 rounded-3xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center mx-auto">
        <Lock size={28} />
      </span>

      <h2 className="font-serif-display text-4xl mt-5">Scripts are a paid feature.</h2>

      <p className="text-sm text-[#65635C] mt-3 max-w-md mx-auto leading-relaxed">
        Upgrade to a paid plan to generate calm, professional vet conversation
        scripts tailored to your exact situation.
      </p>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          to="/dashboard/pricing"
          className="btn-primary rounded-xl px-6 py-3 text-sm font-semibold inline-flex items-center gap-2"
        >
          View plans <ArrowRight size={15} />
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
        {[
          "Polite, firm, warm, or direct tone",
          "Personalized for your pet and situation",
          "Follow-up question suggestions",
        ].map((f) => (
          <div key={f} className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4 flex items-start gap-3">
            <CheckCircle2 size={16} className="text-[#556045] mt-0.5 shrink-0" />
            <span className="text-sm text-[#65635C]">{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState({ loading }) {
  if (loading) {
    return (
      <div className="cream-card p-12 rounded-[28px] text-center">
        <Loader2 size={28} className="animate-spin text-[#D26D53] mx-auto" />
        <h3 className="font-serif-display text-3xl mt-5">Writing your script…</h3>
        <p className="text-sm text-[#65635C] mt-2">Crafting calm, clear language for your vet conversation.</p>
      </div>
    );
  }

  return (
    <div className="cream-card p-12 rounded-[28px]">
      <div className="max-w-lg mx-auto text-center">
        <span className="w-14 h-14 rounded-3xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center mx-auto">
          <MessagesSquare size={24} />
        </span>
        <h3 className="font-serif-display text-4xl mt-5">A calm voice, at the ready.</h3>
        <p className="text-sm text-[#65635C] mt-3 leading-relaxed">
          Fill in your situation on the left and we'll draft the exact words to
          use — tailored to your tone and your pet.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-3">
        {[
          { n: "1", t: "Describe your situation", d: "What are you facing at the vet?" },
          { n: "2", t: "Choose a tone",           d: "Polite, warm, firm, or direct." },
          { n: "3", t: "Add optional context",    d: "Pet name, species, or estimated cost." },
        ].map((step) => (
          <div key={step.n} className="flex items-start gap-4 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-5">
            <span className="w-9 h-9 rounded-full bg-[#2D2C28] text-white text-sm font-bold inline-flex items-center justify-center shrink-0">
              {step.n}
            </span>
            <div>
              <div className="font-semibold text-sm">{step.t}</div>
              <p className="text-xs text-[#65635C] mt-1">{step.d}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ScriptResult ──────────────────────────────────────────────────────────────
function ScriptResult({ result, onCopy }) {
  return (
    <div className="space-y-5" data-testid="script-result">
      <div className="cream-card p-6 rounded-[28px]">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <div className="eyebrow text-[#D26D53] mb-1">Your script</div>
            <h2 className="font-serif-display text-3xl leading-tight">Ready to use</h2>
          </div>
          <button
            onClick={() => onCopy(result.script)}
            className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-2"
            data-testid="script-copy"
          >
            <Copy size={14} /> Copy script
          </button>
        </div>

        <div className="rounded-2xl bg-[#FAF9F6] border border-[#E5E2D9] p-6">
          <p className="text-sm leading-loose text-[#2D2C28] whitespace-pre-wrap" data-testid="script-text">
            {result.script}
          </p>
        </div>
      </div>

      {(result.follow_up_questions || []).length > 0 && (
        <div className="cream-card p-6 rounded-[28px]">
          <div className="eyebrow text-[#556045] mb-3">Follow-up questions</div>
          <h3 className="font-serif-display text-2xl mb-4">After you say that, ask…</h3>
          <div className="space-y-2">
            {result.follow_up_questions.map((q, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] p-4">
                <ChevronRight size={16} className="text-[#D26D53] mt-0.5 shrink-0" />
                <span className="text-sm">{q}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-[24px] bg-[#556045] text-white p-6">
        <div className="flex items-start gap-4">
          <span className="w-10 h-10 rounded-2xl bg-white/10 inline-flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <div className="font-semibold">A note on using this script</div>
            <p className="text-sm text-white/75 mt-1 leading-relaxed">
              Read it naturally, in your own voice. You don't need to memorize
              it — even paraphrasing it will help you feel more prepared. Your
              vet is your partner, not your opponent.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch { return value; }
}
