import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, AlertTriangle, Clock, Stethoscope, Check, ClipboardList, ExternalLink } from "lucide-react";
import { PetVaultWordmark } from "../components/PetVaultLogo";
import api from "../lib/api";

const URGENCY_CHIP = {
  urgent: "chip-urgent",
  soon: "chip-soon",
  elective: "chip-wait",
  unclear: "chip-info",
};

export default function SharedAnalysis() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api.get(`/public/analysis/${slug}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.detail || "This link is not available."))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center paper-grain" data-testid="shared-loading">
        <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 className="animate-spin" size={16}/>Loading shared analysis…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center paper-grain" data-testid="shared-error">
        <div className="cream-card p-10 max-w-md text-center">
          <div className="eyebrow mb-2">Shared analysis</div>
          <h1 className="font-serif-display text-3xl">{error || "Link not available"}</h1>
          <p className="text-sm text-[#65635C] mt-3">The owner may have revoked this link.</p>
          <Link to="/" className="btn-primary rounded-md px-4 py-2 text-sm font-semibold mt-5 inline-flex items-center gap-2">
            Visit PetBill Shield <ExternalLink size={14}/>
          </Link>
        </div>
      </div>
    );
  }

  const a = data.analysis || {};

  return (
    <div className="paper-grain min-h-screen">
      <header className="glass-header sticky top-0 z-40">
        <div className="max-w-[960px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group" data-testid="shared-logo-link">
            <PetVaultWordmark iconSize={30} className="group-hover:opacity-90 transition-opacity" />
          </Link>
          <span className="text-xs text-[#65635C]">Read-only · shared by the pet's owner</span>
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-5 sm:px-8 py-10 space-y-6" data-testid="shared-analysis">
        <div className="eyebrow">{a.pet_name ? `${a.pet_name} · ${a.pet_species}` : "Shared analysis"}</div>
        <h1 className="font-serif-display text-3xl sm:text-4xl tracking-tight leading-tight">
          {a.summary || "Vet estimate, in plain English."}
        </h1>
        <div className="text-xs text-[#65635C]">
          {a.estimated_total_usd != null && <span className="font-mono-clean">Estimate total ≈ ${Number(a.estimated_total_usd).toFixed(2)}</span>}
          {a.created_at && <span> · Prepared {new Date(a.created_at).toLocaleDateString()}</span>}
        </div>

        <section className="cream-card p-6">
          <div className="eyebrow text-[#D26D53] mb-3">Line items</div>
          <ul className="divide-y divide-[#E5E2D9]">
            {(a.line_items || []).map((li, i) => (
              <li key={i} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{li.label}</div>
                  {li.notes && <div className="text-xs text-[#65635C] mt-1">{li.notes}</div>}
                  <div className="mt-1.5 flex gap-1.5">
                    {li.urgency && <span className={`chip ${URGENCY_CHIP[li.urgency] || "chip-neutral"}`}>{li.urgency}</span>}
                    {li.category && <span className="chip chip-neutral">{li.category}</span>}
                  </div>
                </div>
                <div className="font-mono-clean text-sm tabular-nums shrink-0">
                  {li.amount_usd != null ? `$${Number(li.amount_usd).toFixed(2)}` : "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="cream-card p-6">
            <div className="eyebrow text-[#8C2D14] inline-flex items-center gap-1.5"><Stethoscope size={13}/> Urgent today</div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(a.urgent_now || []).map((x, i) => <li key={i} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#8C2D14] mt-2"/>{x}</li>)}
              {(a.urgent_now || []).length === 0 && <li className="text-[#65635C]">Nothing flagged as urgent.</li>}
            </ul>
          </div>
          <div className="cream-card p-6">
            <div className="eyebrow text-[#556045] inline-flex items-center gap-1.5"><Clock size={13}/> May be able to wait</div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {(a.can_wait || []).map((x, i) => <li key={i} className="flex items-start gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#556045] mt-2"/>{x}</li>)}
              {(a.can_wait || []).length === 0 && <li className="text-[#65635C]">Nothing identified as deferrable.</li>}
            </ul>
          </div>
        </section>

        {(a.red_flags || []).length > 0 && (
          <section className="cream-card p-6">
            <div className="eyebrow text-[#D26D53] inline-flex items-center gap-1.5"><AlertTriangle size={13}/> Items that may need clarification</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              {a.red_flags.map((rf, i) => (
                <div key={i} className="rounded-md border border-[#E5E2D9] bg-[#FAF9F6] p-4">
                  <div className="text-sm font-semibold">{rf.label}</div>
                  {rf.why && <p className="text-xs text-[#65635C] mt-2 leading-relaxed">{rf.why}</p>}
                  {rf.ask_the_vet && <p className="text-sm italic text-[#2D2C28] mt-2">"{rf.ask_the_vet}"</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {(a.questions_to_ask_vet || []).length > 0 && (
          <section className="cream-card p-6">
            <div className="eyebrow text-[#D26D53] inline-flex items-center gap-1.5"><ClipboardList size={13}/> Questions to ask your vet</div>
            <ol className="mt-3 space-y-2 list-decimal list-inside text-sm leading-relaxed">
              {a.questions_to_ask_vet.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </section>
        )}

        {(a.cost_saving_options || []).length > 0 && (
          <section className="cream-card p-6">
            <div className="eyebrow text-[#556045] mb-3">Safe cost-saving options to discuss</div>
            <ul className="space-y-2 text-sm">
              {a.cost_saving_options.map((x, i) => <li key={i} className="flex items-start gap-2"><Check size={15} className="text-[#556045] mt-0.5"/>{x}</li>)}
            </ul>
          </section>
        )}

        <div className="cream-card p-5">
          <p className="text-xs text-[#65635C] leading-relaxed">{a.disclaimer || "PetBill Shield doesn't diagnose pets, doesn't replace your veterinarian, and never tells you to refuse care. For urgent symptoms, seek immediate veterinary care."}</p>
        </div>

        <div className="text-center pt-4">
          <Link to="/" className="editorial-link text-sm">Get your own second set of eyes →</Link>
        </div>
      </main>
    </div>
  );
}
