import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ExternalLink, PawPrint, ArrowLeft, Receipt, Syringe, Pill, Stethoscope, FlaskConical, ShieldCheck, StickyNote } from "lucide-react";
import { PetVaultWordmark } from "../components/PetVaultLogo";
import api, { BACKEND_ORIGIN } from "../lib/api";

const TYPE_ICON = {
  vaccine: Syringe, medication: Pill, invoice: Receipt, visit: Stethoscope,
  lab: FlaskConical, policy: ShieldCheck, note: StickyNote, reminder: StickyNote,
};

function imageUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = api.defaults.baseURL?.replace("/api", "") || BACKEND_ORIGIN;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function HouseholdView() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePet, setActivePet] = useState(null);
  const [petData, setPetData] = useState(null);
  const [loadingPet, setLoadingPet] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/public/household/${slug}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e?.response?.data?.detail || "This link is not available."))
      .finally(() => setLoading(false));
  }, [slug]);

  const openPet = (petId) => {
    setActivePet(petId);
    setPetData(null);
    setLoadingPet(true);
    api.get(`/public/household/${slug}/pets/${petId}`)
      .then((r) => setPetData(r.data))
      .catch(() => setPetData(null))
      .finally(() => setLoadingPet(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center paper-grain">
        <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 className="animate-spin" size={16}/>Loading household…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center paper-grain">
        <div className="cream-card p-10 max-w-md text-center">
          <div className="eyebrow mb-2">Shared household</div>
          <h1 className="font-serif-display text-3xl">{error || "Link not available"}</h1>
          <p className="text-sm text-[#65635C] mt-3">The owner may have revoked this link.</p>
          <Link to="/" className="btn-primary rounded-md px-4 py-2 text-sm font-semibold mt-5 inline-flex items-center gap-2">
            Visit PetBill Shield <ExternalLink size={14}/>
          </Link>
        </div>
      </div>
    );
  }

  const usd = (n) => (n || n === 0) ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "";

  return (
    <div className="min-h-screen paper-grain">
      <header className="border-b border-[#E5E2D9] bg-[#FAF9F6]/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between">
          <PetVaultWordmark className="h-6" />
          <span className="text-xs rounded-full bg-[#F2F0E9] border border-[#E5E2D9] px-3 py-1 text-[#65635C]">Read-only view</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8">
        {!activePet ? (
          <>
            <div className="mb-6">
              <div className="eyebrow text-[#D26D53] mb-1">Shared with you</div>
              <h1 className="font-serif-display text-4xl">{data.owner_name}'s pets</h1>
              <p className="text-sm text-[#65635C] mt-2">Tap a pet to view their records. This is a read-only view — nothing here can be changed.</p>
            </div>

            {data.pets.length === 0 ? (
              <div className="cream-card p-10 text-center text-[#65635C]">No pets to show yet.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.pets.map((p) => (
                  <button key={p.pet_id} onClick={() => openPet(p.pet_id)}
                    className="cream-card p-4 rounded-[22px] text-left hover:shadow-md transition flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-[#F2F0E9] overflow-hidden flex items-center justify-center shrink-0">
                      {p.picture ? <img src={imageUrl(p.picture)} alt={p.name} className="w-full h-full object-cover" />
                        : <PawPrint size={26} className="text-[#B5B0A8]" />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-serif-display text-xl truncate">{p.name}</div>
                      <div className="text-xs text-[#65635C] capitalize truncate">
                        {[p.species, p.breed].filter(Boolean).join(" · ")}
                      </div>
                      {p.chronic_conditions?.length > 0 && (
                        <div className="text-[11px] text-[#8A5A24] mt-1 truncate">{p.chronic_conditions.join(", ")}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={() => { setActivePet(null); setPetData(null); }}
              className="inline-flex items-center gap-1.5 text-sm text-[#65635C] hover:text-[#2D2C28] mb-5">
              <ArrowLeft size={15} /> All pets
            </button>

            {loadingPet ? (
              <div className="py-16 flex justify-center"><Loader2 size={22} className="animate-spin text-[#65635C]" /></div>
            ) : !petData ? (
              <div className="cream-card p-10 text-center text-[#65635C]">Couldn't load this pet.</div>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-20 h-20 rounded-3xl bg-[#F2F0E9] overflow-hidden flex items-center justify-center shrink-0">
                    {petData.pet.picture ? <img src={imageUrl(petData.pet.picture)} alt={petData.pet.name} className="w-full h-full object-cover" />
                      : <PawPrint size={32} className="text-[#B5B0A8]" />}
                  </div>
                  <div>
                    <h1 className="font-serif-display text-3xl">{petData.pet.name}</h1>
                    <div className="text-sm text-[#65635C] capitalize">{[petData.pet.species, petData.pet.breed].filter(Boolean).join(" · ")}</div>
                  </div>
                </div>

                {petData.records.length === 0 ? (
                  <div className="cream-card p-10 text-center text-[#65635C]">No records yet.</div>
                ) : (
                  <div className="space-y-2.5">
                    {petData.records.map((r) => {
                      const Icon = TYPE_ICON[r.record_type] || StickyNote;
                      return (
                        <div key={r.record_id} className="cream-card p-4 rounded-[18px] flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#F2F0E9] flex items-center justify-center shrink-0">
                            <Icon size={16} className="text-[#65635C]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-sm text-[#2D2C28] truncate">{r.title || r.record_type}</div>
                              {r.amount_usd ? <div className="text-sm font-mono text-[#556045] shrink-0">{usd(r.amount_usd)}</div> : null}
                            </div>
                            {r.details && <p className="text-xs text-[#65635C] mt-0.5 line-clamp-2">{r.details}</p>}
                            <div className="text-[11px] text-[#8A887F] mt-1 flex items-center gap-2">
                              <span className="capitalize">{r.record_type}</span>
                              {r.date && <span>· {String(r.date).slice(0, 10)}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <p className="text-center text-xs text-[#8A887F] mt-10">
          Powered by PetBill Shield · <Link to="/" className="underline">Create your own pet vault</Link>
        </p>
      </main>
    </div>
  );
}
