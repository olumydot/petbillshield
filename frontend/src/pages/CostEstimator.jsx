import { useState } from "react";
import api from "../lib/api";
import {
  Calculator, Loader2, Sparkles, MapPin, Search, TrendingUp, Info,
} from "lucide-react";

const SPECIES = ["dog", "cat", "rabbit", "bird", "reptile", "horse", "exotic"];

const COMMON = [
  "Spay / neuter", "Dental cleaning", "Annual wellness exam", "Vaccination (core)",
  "Bloodwork (CBC + chemistry)", "X-ray", "Ultrasound", "Mass / lump removal",
  "Dental extraction", "Allergy workup",
];

export default function CostEstimator() {
  const [procedure, setProcedure] = useState("");
  const [species,   setSpecies]   = useState("dog");
  const [city,      setCity]      = useState("");
  const [state,     setState]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState("");

  const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const estimate = async (proc) => {
    const label = (proc ?? procedure).trim();
    if (!label) { setError("Enter a procedure or service."); return; }
    setProcedure(label);
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.get("/transparency/compare", {
        params: { label, species, city: city.trim(), state: state.trim() },
      });
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't estimate that right now. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-7 pb-20" data-testid="cost-estimator-page">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[30px] bg-[#2D2C28] p-8 sm:p-10 text-[#FAF9F6]">
        <div className="absolute right-0 top-0 h-52 w-52 rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75 mb-4">
            <Calculator size={14} /> Cost estimator
          </div>
          <h1 className="font-serif-display text-4xl sm:text-5xl leading-[0.95]">
            What should it cost{" "}
            <span className="italic text-[#E0855F]">before</span> you go?
          </h1>
          <p className="mt-4 text-sm text-white/65 max-w-2xl leading-relaxed">
            Get a plain-English price range for a procedure or service — based on real reports
            from pet owners near you, or an AI estimate when local data is still thin. Walk into
            the vet knowing roughly what to expect.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="cream-card rounded-[28px] p-5 sm:p-6 space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] block mb-1.5">Procedure or service</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />
            <input
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") estimate(); }}
              placeholder="e.g. Dental cleaning, ACL surgery, X-ray…"
              className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] pl-10 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {COMMON.map((c) => (
              <button key={c} onClick={() => estimate(c)}
                className="text-[11px] rounded-full border border-[#E5E2D9] bg-white/60 hover:border-[#D26D53]/50 px-2.5 py-1 text-[#65635C] transition">
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] block mb-1.5">Species</label>
            <select value={species} onChange={(e) => setSpecies(e.target.value)}
              className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40">
              {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] block mb-1.5">City <span className="text-[#B5B0A8]">(optional)</span></label>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Austin"
              className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold text-[#8A887F] block mb-1.5">State <span className="text-[#B5B0A8]">(optional)</span></label>
            <input value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" maxLength={2}
              className="w-full rounded-xl border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40" />
          </div>
        </div>

        <button onClick={() => estimate()} disabled={loading}
          className="btn-primary rounded-2xl px-6 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60">
          {loading ? <><Loader2 size={16} className="animate-spin" /> Estimating…</> : <><Calculator size={16} /> Estimate cost</>}
        </button>

        {error && <p className="text-sm text-[#8C2D14]">{error}</p>}
      </section>

      {/* Result */}
      {result && <EstimateResult result={result} procedure={procedure} usd={usd} />}
    </div>
  );
}

function EstimateResult({ result, procedure, usd }) {
  if (!result.available && result.pending) {
    return (
      <section className="cream-card rounded-[28px] p-6 text-center">
        <Sparkles size={22} className="text-[#D26D53] mx-auto mb-2" />
        <h3 className="font-serif-display text-2xl">Building your estimate…</h3>
        <p className="text-sm text-[#65635C] mt-2 max-w-md mx-auto">
          We're generating a price range for "{procedure}". Check back in a moment and search again.
        </p>
      </section>
    );
  }
  if (!result.available) {
    return (
      <section className="cream-card rounded-[28px] p-6 text-center">
        <Info size={22} className="text-[#8A887F] mx-auto mb-2" />
        <h3 className="font-serif-display text-2xl">No estimate yet</h3>
        <p className="text-sm text-[#65635C] mt-2">{result.reason || "Try a more common procedure name."}</p>
      </section>
    );
  }

  const isReal = result.source === "real_data";
  const low  = isReal ? result.p25_usd : result.low_usd;
  const mid  = isReal ? result.avg_usd : result.mid_usd;
  const high = isReal ? result.p75_usd : result.high_usd;

  const scope = result.scope === "city+state" ? "in your city"
    : result.scope === "state" ? "in your state"
    : "nationally";

  return (
    <section className="cream-card rounded-[28px] p-6 sm:p-7">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={16} className="text-[#556045]" />
        <span className="eyebrow text-[#556045]">Estimated cost · {procedure}</span>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <span className="font-serif-display text-5xl text-[#2D2C28]">{usd(mid)}</span>
        <span className="text-sm text-[#65635C] mb-1.5">typical · range {usd(low)}–{usd(high)}</span>
      </div>

      {isReal ? (
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#E7EBDD] border border-[#C8D8B5] px-3 py-1 text-xs font-semibold text-[#2F6B45]">
          <MapPin size={12} /> Based on {result.count} real report{result.count === 1 ? "" : "s"} {scope}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#FFFBEB] border border-dashed border-[#E6AE2E]/50 px-3 py-1 text-xs font-semibold text-[#92400E]">
            <Sparkles size={12} /> AI estimate — no local reports yet
          </div>
          {result.notes && <p className="text-sm text-[#65635C] leading-relaxed mt-2">{result.notes}</p>}
        </div>
      )}

      <p className="text-xs text-[#8A887F] mt-5 leading-relaxed border-t border-[#E5E2D9] pt-4">
        This is guidance only — actual costs vary by clinic, your pet's condition, region, and what's included.
        Use it to ask informed questions, not as a quote. PetBill Shield never diagnoses or replaces your vet.
      </p>
    </section>
  );
}
