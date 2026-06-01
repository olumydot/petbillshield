import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api, { BACKEND_ORIGIN } from "../lib/api";
import {
  PawPrint,
  Plus,
  ArrowRight,
  Loader2,
  Lock,
  Sparkles,
  ShieldCheck,
  Heart,
  Users,
  Crown,
  Search,
  Filter,
  Camera,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useBilling } from "../lib/billing";

const SPECIES = ["dog", "cat", "rabbit", "bird", "reptile", "horse", "exotic"];

const BACKEND = BACKEND_ORIGIN;

function getImageUrl(path) {
  if (!path) return "";
  return path.startsWith("/uploads") ? `${BACKEND}${path}` : path;
}

export default function Pets() {
  const { t } = useTranslation();
  const [pets, setPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");

  const [form, setForm] = useState({
    name: "",
    species: "dog",
    breed: "",
    age_years: "",
    insurance_provider: "",
    picture_file: null,
  });

  const { billing, loading: billingLoading } = useBilling();

  const isBillingReady = !billingLoading && billing !== undefined;

  const isFreeTier =
    isBillingReady &&
    (!billing?.active ||
      billing?.plan_id === "free" ||
      billing?.plan_id === "free_tier");

  const isVaultPlan =
    billing?.plan_id === "vault_monthly" ||
    billing?.plan_id === "vault_yearly";

  const isFamilyPlan =
    billing?.plan_id === "family_monthly" ||
    billing?.plan_id === "family_yearly";

  const isRescuePlan =
    billing?.plan_id === "rescue_monthly" ||
    billing?.plan_id === "rescue_yearly";

  const activePets   = pets.filter((p) => p.is_active !== false);
  const inactivePets = pets.filter((p) => p.is_active === false);

  const petLimitReached =
    !billingLoading &&
    ((isFreeTier && pets.length >= 1) ||
      (isVaultPlan && pets.length >= 2) ||
      (isFamilyPlan && pets.length >= 5));

  const addPetDisabled = billingLoading || petLimitReached;

  // How many active slots the plan allows (shown in the inactive pet overlay)
  const planActiveLimit = isRescuePlan ? null
    : isVaultPlan  ? 2
    : isFamilyPlan ? 5
    : 1;

  const filteredPets = useMemo(() => {
    return pets.filter((p) => {
      const matchesQuery =
        !query.trim() ||
        p.name?.toLowerCase().includes(query.toLowerCase()) ||
        p.breed?.toLowerCase().includes(query.toLowerCase()) ||
        p.species?.toLowerCase().includes(query.toLowerCase());

      const matchesSpecies =
        speciesFilter === "all" || p.species === speciesFilter;

      return matchesQuery && matchesSpecies;
    });
  }, [pets, query, speciesFilter]);

  async function load() {
    setLoadingPets(true);

    try {
      const { data } = await api.get("/pets");
      setPets(data || []);
    } catch (e) {
      if (e?.response?.status === 403) {
        setPets([]);
        return;
      }

      toast.error("Could not load pets.");
    } finally {
      setLoadingPets(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Active status is managed entirely by the backend (_grant_entitlement).
  // Users cannot manually swap pets — that would defeat plan limits.
  // The only way to get more active pets is to upgrade the plan.

  async function save() {
    if (!form.name.trim()) {
      return toast.error("Please give your pet a name.");
    }

    setSaving(true);

    try {
      const payload = {
        name: form.name.trim(),
        species: form.species,
        breed: form.breed.trim(),
        age_years: form.age_years ? Number(form.age_years) : null,
        insurance_provider: form.insurance_provider.trim(),
      };

      const { data: newPet } = await api.post("/pets", payload);

      if (form.picture_file && newPet?.pet_id) {
        const fd = new FormData();
        fd.append("file", form.picture_file);

        await api.post(`/pets/${newPet.pet_id}/picture`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      toast.success(`${form.name} added to the vault.`);

      setOpen(false);
      setForm({
        name: "",
        species: "dog",
        breed: "",
        age_years: "",
        insurance_provider: "",
        picture_file: null,
      });

      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save pet.");
    } finally {
      setSaving(false);
    }
  }

  function handleAddPetClick() {
    if (addPetDisabled) {
      if (billingLoading) return;

      if (isFreeTier && petLimitReached) {
        toast.error("Free plan allows 1 pet. Upgrade to Pet Cost Vault to add more.");
      } else if (isVaultPlan) {
        toast.error("Your Pet Cost Vault plan allows 2 pets. Upgrade to Family to add more pets.");
      } else if (isFamilyPlan) {
        toast.error("Your Family plan allows up to 5 pets. Upgrade to Rescue / Foster for unlimited pets.");
      }

      return;
    }

    setOpen(true);
  }

  if (billingLoading || loadingPets) {
    return (
      <div className="space-y-6" data-testid="pets-page-loading">
        <section className="rounded-[32px] bg-[#2D2C28] text-white p-8 lg:p-10 overflow-hidden">
          <div className="animate-pulse">
            <div className="h-4 w-32 bg-white/20 rounded-full" />
            <div className="h-12 w-72 bg-white/20 rounded-xl mt-5" />
            <div className="h-4 w-[420px] max-w-full bg-white/20 rounded-full mt-5" />
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((x) => (
            <div key={x} className="cream-card h-[220px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-20" data-testid="pets-page">
      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-7 sm:p-9 lg:p-11">
        <div className="absolute right-[-80px] top-[-90px] h-[260px] w-[260px] rounded-full bg-[#D26D53]/25 blur-2xl" />
        <div className="absolute left-[-80px] bottom-[-100px] h-[260px] w-[260px] rounded-full bg-[#556045]/30 blur-2xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75">
              <Sparkles size={14} />
              {t("pets.eyebrow")}
            </div>

            <h1 className="font-serif-display text-5xl sm:text-6xl lg:text-7xl tracking-tight leading-[0.9] mt-5">
              {t("pets.title")}
            </h1>

            <p className="mt-5 text-sm sm:text-base text-white/70 max-w-2xl leading-relaxed">
              {t("pets.subtitle")}
            </p>

            <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
              <HeroStat label="Total pets" value={pets.length} icon={PawPrint} />
              <HeroStat label="Active" value={activePets.length} icon={CheckCircle2} />
              <HeroStat label="Inactive" value={inactivePets.length} icon={Lock} />
              <HeroStat
                label="Plan"
                value={
                  isRescuePlan
                    ? "Unlimited"
                    : isFamilyPlan
                    ? "Family"
                    : isVaultPlan
                    ? "Vault"
                    : "Free"
                }
                icon={Crown}
              />
            </div>
          </div>

          <div className="lg:min-w-[260px]">
            <button
              onClick={handleAddPetClick}
              disabled={addPetDisabled}
              className={`w-full rounded-2xl px-6 py-4 font-semibold transition inline-flex items-center justify-center gap-2 ${
                addPetDisabled
                  ? "bg-white/10 text-white/45 cursor-not-allowed border border-white/10"
                  : "bg-[#D26D53] hover:bg-[#BD5D44] text-white shadow-xl"
              }`}
            >
              {addPetDisabled ? <Lock size={17} /> : <Plus size={17} />}
              {petLimitReached ? t("pets.limit_reached") : t("pets.add_pet")}
            </button>

            <p className="text-xs text-white/50 mt-3 text-center">
              {isRescuePlan
                ? "Rescue / Foster plan: unlimited pet profiles."
                : isFamilyPlan
                ? "Family plan: up to 5 active pets."
                : isVaultPlan
                ? "Vault plan: up to 2 active pets."
                : "Free plan includes 1 pet profile."}
            </p>
          </div>
        </div>
      </section>

      <section className="cream-card p-4 sm:p-5 rounded-[26px]">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A887F]" />

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, breed, or species..."
              className="w-full rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] pl-10 pr-4 py-3 text-sm outline-none focus:border-[#D26D53]"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter size={15} className="text-[#8A887F]" />

            <select
              value={speciesFilter}
              onChange={(e) => setSpeciesFilter(e.target.value)}
              className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-4 py-3 text-sm capitalize outline-none focus:border-[#D26D53]"
            >
              <option value="all">All species</option>
              {SPECIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {pets.length === 0 ? (
        <EmptyVault
          addPetDisabled={addPetDisabled}
          isFreeTier={isFreeTier}
          onAdd={handleAddPetClick}
        />
      ) : filteredPets.length === 0 ? (
        <div className="cream-card p-10 text-center rounded-[28px]">
          <Search className="mx-auto text-[#D26D53]" size={28} />
          <h3 className="font-serif-display text-3xl mt-4">
            No pets match that search.
          </h3>
          <p className="text-sm text-[#65635C] mt-2">
            Try a different name, breed, or species.
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredPets.map((p) => (
            <PetCard
              key={p.pet_id}
              pet={p}
              planActiveLimit={planActiveLimit}
            />
          ))}
        </section>
      )}

      <section className="pbs-dark-card rounded-[28px] p-6">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-[#556045] text-white inline-flex items-center justify-center shrink-0">
            <ShieldCheck size={18} />
          </div>

          <div>
            <h3 className="font-serif-display text-2xl">
              Your records stay safe.
            </h3>

            <p className="text-sm mt-1 leading-relaxed max-w-3xl">
              Downgrading only changes which pets are active. Saved profiles,
              invoices, vaccines, medications, and notes remain preserved.
            </p>
          </div>
        </div>
      </section>

      {open && (
        <AddPetModal
          form={form}
          setForm={setForm}
          saving={saving}
          save={save}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function PetCard({ pet, planActiveLimit }) {
  const inactive = pet.is_active === false;
  const img = getImageUrl(pet.picture);

  return (
    <div
      className={`group relative overflow-hidden rounded-[28px] border transition-all duration-300 ${
        inactive
          ? "border-[#D9D5CC] bg-[#EDEAE2] opacity-75"
          : "border-[#E5E2D9] bg-[#FAF9F6] hover:-translate-y-1 hover:shadow-xl hover:border-[#D26D53]/70"
      }`}
    >
      <Link
        to={`/dashboard/pets/${pet.pet_id}`}
        className="block"
      >
        <div className="relative h-[230px] bg-[#2D2C28] overflow-hidden">
          {img ? (
            <img
              src={img}
              alt={pet.name}
              className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${
                inactive ? "grayscale brightness-50" : "brightness-95"
              }`}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/60">
              <PawPrint size={64} />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />

          <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20">
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold inline-flex items-center gap-1 ${
                inactive
                  ? "bg-[#2D2C28]/85 text-white"
                  : "bg-[#E7EBDD] text-[#556045]"
              }`}
            >
              {inactive ? <Lock size={12} /> : <CheckCircle2 size={12} />}
              {inactive ? "Inactive" : "Active"}
            </span>

            <span className="rounded-full bg-white/85 text-[#2D2C28] px-3 py-1 text-[11px] font-semibold capitalize">
              {pet.species || "pet"}
            </span>
          </div>

          <div className="absolute bottom-5 left-5 right-5 z-20 text-white">
            <h3 className="font-serif-display text-4xl leading-none">
              {pet.name}
            </h3>

            <p className="text-xs text-white/80 mt-2 capitalize">
              {pet.breed || "Breed unknown"}
              {pet.age_years ? ` · ${pet.age_years}y` : ""}
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <MiniInfo label="Insurance" value={pet.insurance_provider || "None"} />
            <MiniInfo label="Status" value={inactive ? "Read-only" : "Ready"} />
          </div>

          <div className="mt-5 flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#D26D53]">
              Open profile
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
            </span>

            <Heart size={17} className={inactive ? "text-[#8A887F]" : "text-[#D26D53]"} />
          </div>
        </div>
      </Link>

      {inactive && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center p-5 bg-black/50">
          <Lock size={26} className="text-white mb-3" />
          <div className="text-white font-semibold text-sm">Read-only</div>
          <p className="text-xs text-white/75 mt-1.5 max-w-[200px] leading-relaxed">
            Your plan includes{" "}
            {planActiveLimit === null ? "unlimited" : planActiveLimit} active pet
            {planActiveLimit !== 1 ? "s" : ""}.
            Records are always saved.
          </p>
          <Link
            to="/dashboard/pricing"
            onClick={(e) => e.stopPropagation()}
            className="mt-4 px-4 py-2 rounded-xl bg-[#D26D53] text-white text-xs font-semibold hover:bg-[#BD5D44] transition-colors"
          >
            Upgrade to unlock
          </Link>
        </div>
      )}
    </div>
  );
}

function HeroStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-white/60 text-xs">
        <Icon size={14} />
        {label}
      </div>

      <div className="font-serif-display text-3xl mt-2 text-white">
        {value}
      </div>
    </div>
  );
}

function MiniInfo({ label, value }) {
  return (
    <div className="rounded-2xl border border-[#E5E2D9] bg-white/55 p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#8A887F]">
        {label}
      </div>

      <div className="text-sm font-semibold mt-1 truncate">
        {value}
      </div>
    </div>
  );
}

function EmptyVault({ addPetDisabled, isFreeTier, onAdd }) {
  return (
    <div className="rounded-[32px] border border-[#E5E2D9] bg-[#FAF9F6] p-12 text-center">
      <div className="mx-auto w-16 h-16 rounded-3xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center">
        <PawPrint size={30} />
      </div>

      <h3 className="font-serif-display text-4xl mt-5">
        No pets in the vault yet.
      </h3>

      <p className="text-sm text-[#65635C] mt-3 max-w-md mx-auto">
        Add your first pet to keep records, medications, invoices, reminders,
        and insurance notes in one place.
      </p>

      <button
        onClick={onAdd}
        disabled={addPetDisabled}
        className={`px-5 py-3 rounded-xl font-semibold transition inline-flex items-center gap-2 mt-6 ${
          addPetDisabled
            ? "bg-[#E5E2D9] text-[#9B968D] cursor-not-allowed"
            : "bg-[#D26D53] hover:bg-[#BD5D44] text-white"
        }`}
      >
        {addPetDisabled ? <Lock size={16} /> : <Plus size={16} />}
        {addPetDisabled ? "Pet limit reached — upgrade to add more" : "Add your first pet"}
      </button>
    </div>
  );
}

function AddPetModal({ form, setForm, saving, save, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FAF9F6] rounded-[28px] p-6 w-full max-w-xl border border-[#E5E2D9] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-[#D26D53] mb-2">Add to vault</div>
            <h3 className="font-serif-display text-4xl leading-none">
              New pet
            </h3>
            <p className="text-sm text-[#65635C] mt-3">
              Start with the basics. You can add records, bills, and reminders later.
            </p>
          </div>

          <div className="w-12 h-12 rounded-2xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center">
            <Camera size={20} />
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-premium"
              placeholder="Mochi"
            />
          </Field>

          <Field label="Pet photo">
            <input
              type="file"
              accept="image/*"
              onChange={(e) =>
                setForm({
                  ...form,
                  picture_file: e.target.files?.[0] || null,
                })
              }
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-3 text-sm"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Species">
              <select
                value={form.species}
                onChange={(e) =>
                  setForm({ ...form, species: e.target.value })
                }
                className="input-premium capitalize"
              >
                {SPECIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Age">
              <input
                value={form.age_years}
                onChange={(e) =>
                  setForm({ ...form, age_years: e.target.value })
                }
                type="number"
                min="0"
                step="0.5"
                className="input-premium"
                placeholder="3"
              />
            </Field>
          </div>

          <Field label="Breed">
            <input
              value={form.breed}
              onChange={(e) =>
                setForm({ ...form, breed: e.target.value })
              }
              className="input-premium"
              placeholder="Shiba Inu"
            />
          </Field>

          <Field label="Insurance provider">
            <input
              value={form.insurance_provider}
              onChange={(e) =>
                setForm({ ...form, insurance_provider: e.target.value })
              }
              className="input-premium"
              placeholder="e.g. Trupanion"
            />
          </Field>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="btn-ghost rounded-xl px-5 py-3 text-sm"
          >
            Cancel
          </button>

          <button
            onClick={save}
            disabled={saving}
            className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Plus size={14} />
                Save pet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1">{label}</span>
      {children}
    </label>
  );
}
