import { useState, useEffect, useCallback } from "react";
import {
  Save, Plus, Trash2, Loader2, Check, ChevronDown, ChevronUp,
  Star, Globe, Type, BarChart3, MessageSquare, Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { invalidateCmsCache } from "@/lib/cms";

const AVATAR_COLORS = [
  "bg-[#D26D53]","bg-[#556045]","bg-[#3D6B9A]","bg-[#8C2D14]",
  "bg-[#6B3FA0]","bg-[#B5862A]","bg-[#2F6B45]","bg-[#245EA8]",
];
const TAG_COLORS = [
  { label:"Terracotta", card:"bg-[#FFF4EE] text-[#D26D53]" },
  { label:"Green",      card:"bg-[#E8F5EC] text-[#2F6B45]" },
  { label:"Blue",       card:"bg-[#EDF5FF] text-[#245EA8]" },
  { label:"Neutral",    card:"bg-[#F2F0E9] text-[#65635C]" },
  { label:"Purple",     card:"bg-[#F3ECFF] text-[#6B3FA0]" },
];

function SectionHeader({ icon: Icon, title, expanded, onToggle }) {
  return (
    <button onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-4 border-b border-[#2A2924] hover:bg-[#1E1D1A] transition"
    >
      <Icon size={15} className="text-[#D26D53] shrink-0" />
      <span className="font-semibold text-sm text-[#FAF9F6] flex-1 text-left">{title}</span>
      {expanded ? <ChevronUp size={14} className="text-[#65635C]" /> : <ChevronDown size={14} className="text-[#65635C]" />}
    </button>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", rows }) {
  return (
    <label className="block">
      {label && <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1">{label}</span>}
      {rows
        ? <textarea value={value} onChange={onChange} rows={rows} placeholder={placeholder}
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53] resize-none" />
        : <input type={type} value={value} onChange={onChange} placeholder={placeholder}
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]" />
      }
    </label>
  );
}

// ── Default fallback content ──────────────────────────────────────────────────
const DEFAULT_CONTENT = {
  hero: {
    eyebrow:  "AI-powered vet bill clarity",
    subtext:  "Upload any vet estimate or invoice. Our AI reads every line item, flags concerns politely, and gives you the exact questions to ask — before you pay.",
    pull_quote: "Your second set of eyes before a costly vet decision — never to refuse care, always to ask better questions.",
  },
  stats: {
    pet_owners: "30,000+",
    vet_costs:  "$8.2M+",
    rating:     "4.9 ★",
    species:    "14+",
  },
  social_links: { twitter: "", instagram: "", facebook: "", tiktok: "", youtube: "" },
  reviews: [],
  faq: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function Content() {
  const [raw,     setRaw]     = useState(null);   // raw CMS doc from server
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [openSection, setOpenSection] = useState("reviews"); // which panel is expanded

  // Load
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/content/landing");
      setRaw(data);
      setContent({
        hero:         { ...DEFAULT_CONTENT.hero,         ...(data.hero         || {}) },
        stats:        { ...DEFAULT_CONTENT.stats,        ...(data.stats        || {}) },
        social_links: { ...DEFAULT_CONTENT.social_links, ...(data.social_links || {}) },
        reviews:      data.reviews || [],
        faq:          data.faq     || [],
      });
    } catch { /* use defaults */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/content/landing", content);
      invalidateCmsCache(); // bust cache so landing page picks up changes immediately
      toast.success("Landing page updated!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const toggle = (s) => setOpenSection(openSection === s ? null : s);

  const updHero   = (k, v) => setContent(c => ({ ...c, hero:         { ...c.hero,         [k]: v } }));
  const updStats  = (k, v) => setContent(c => ({ ...c, stats:        { ...c.stats,        [k]: v } }));
  const updSocial = (k, v) => setContent(c => ({ ...c, social_links: { ...c.social_links, [k]: v } }));

  // Reviews
  const addReview = () => setContent(c => ({
    ...c, reviews: [...c.reviews, {
      id: `r_${Date.now()}`, name: "", location: "", pet: "",
      initial: "A", avatarBg: AVATAR_COLORS[0],
      quote: "", tag: "", tagColor: TAG_COLORS[0].card,
    }]
  }));
  const updReview = (idx, k, v) => setContent(c => {
    const arr = [...c.reviews]; arr[idx] = { ...arr[idx], [k]: v }; return { ...c, reviews: arr };
  });
  const delReview = (idx) => setContent(c => ({ ...c, reviews: c.reviews.filter((_, i) => i !== idx) }));
  const moveReview = (idx, dir) => {
    setContent(c => {
      const arr = [...c.reviews]; const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return c;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return { ...c, reviews: arr };
    });
  };

  // FAQ
  const addFaq = () => setContent(c => ({ ...c, faq: [...c.faq, { id: `f_${Date.now()}`, q: "", a: "" }] }));
  const updFaq = (idx, k, v) => setContent(c => {
    const arr = [...c.faq]; arr[idx] = { ...arr[idx], [k]: v }; return { ...c, faq: arr };
  });
  const delFaq = (idx) => setContent(c => ({ ...c, faq: c.faq.filter((_, i) => i !== idx) }));

  if (loading) return <div className="text-[#65635C] text-sm animate-pulse">Loading content…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">CMS</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6]">Landing page editor</h2>
          <p className="text-xs text-[#65635C] mt-1">Changes go live immediately after saving.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold px-5 py-2.5 inline-flex items-center gap-2 disabled:opacity-50 transition"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save all changes
        </button>
      </div>

      {/* ── Reviews ── */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-hidden">
        <SectionHeader icon={Star} title={`Reviews (${content.reviews.length})`} expanded={openSection === "reviews"} onToggle={() => toggle("reviews")} />
        {openSection === "reviews" && (
          <div className="p-5 space-y-5">
            {content.reviews.map((r, idx) => (
              <div key={r.id || idx} className="rounded-2xl border border-[#2A2924] bg-[#111] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#FAF9F6]">Review #{idx + 1}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveReview(idx, -1)} disabled={idx===0} className="text-[#65635C] hover:text-[#FAF9F6] px-1 disabled:opacity-30 text-xs">↑</button>
                    <button onClick={() => moveReview(idx, 1)} disabled={idx===content.reviews.length-1} className="text-[#65635C] hover:text-[#FAF9F6] px-1 disabled:opacity-30 text-xs">↓</button>
                    <button onClick={() => delReview(idx)} className="text-[#65635C] hover:text-[#F87171] transition"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Name" value={r.name} onChange={e => updReview(idx,"name",e.target.value)} placeholder="Sarah M." />
                  <Input label="Location" value={r.location} onChange={e => updReview(idx,"location",e.target.value)} placeholder="Denver, CO" />
                </div>
                <Input label="Pet info" value={r.pet} onChange={e => updReview(idx,"pet",e.target.value)} placeholder="Golden Retriever · Biscuit, 4 yrs" />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Initial (avatar letter)" value={r.initial} onChange={e => updReview(idx,"initial",e.target.value.slice(0,1).toUpperCase())} placeholder="S" />
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1">Avatar colour</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {AVATAR_COLORS.map(c => (
                        <button key={c} onClick={() => updReview(idx,"avatarBg",c)}
                          className={`w-6 h-6 rounded-full ${c} ${r.avatarBg===c ? "ring-2 ring-white ring-offset-1 ring-offset-[#111]" : ""}`} />
                      ))}
                    </div>
                  </div>
                </div>
                <Input label="Tag label" value={r.tag} onChange={e => updReview(idx,"tag",e.target.value)} placeholder="Emergency surgery" />
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1">Tag colour</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {TAG_COLORS.map(tc => (
                      <button key={tc.label} onClick={() => updReview(idx,"tagColor",tc.card)}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border-2 transition ${tc.card} ${r.tagColor===tc.card ? "border-white" : "border-transparent"}`}>
                        {tc.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Input label="Quote (no quotation marks)" value={r.quote} onChange={e => updReview(idx,"quote",e.target.value)} rows={3}
                  placeholder="My dog needed ACL surgery and I had no idea what half the charges meant…" />
              </div>
            ))}
            <button onClick={addReview}
              className="w-full rounded-xl border border-dashed border-[#3D3C38] text-[#65635C] hover:text-[#FAF9F6] hover:border-[#65635C] text-xs font-semibold py-3 inline-flex items-center justify-center gap-1.5 transition"
            >
              <Plus size={13} /> Add review
            </button>
          </div>
        )}
      </div>

      {/* ── Hero copy ── */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-hidden">
        <SectionHeader icon={Type} title="Hero & pull-quote copy" expanded={openSection === "hero"} onToggle={() => toggle("hero")} />
        {openSection === "hero" && (
          <div className="p-5 space-y-4">
            <Input label="Eyebrow pill text" value={content.hero.eyebrow}
              onChange={e => updHero("eyebrow", e.target.value)} placeholder="AI-powered vet bill clarity" />
            <Input label="Hero subtext / description" value={content.hero.subtext}
              onChange={e => updHero("subtext", e.target.value)} rows={3} placeholder="Upload any vet estimate…" />
            <Input label="Pull-quote (the large italic blockquote)" value={content.hero.pull_quote}
              onChange={e => updHero("pull_quote", e.target.value)} rows={2}
              placeholder="Your second set of eyes before a costly vet decision…" />
          </div>
        )}
      </div>

      {/* ── Stats bar ── */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-hidden">
        <SectionHeader icon={BarChart3} title="Trust stats bar" expanded={openSection === "stats"} onToggle={() => toggle("stats")} />
        {openSection === "stats" && (
          <div className="p-5 grid grid-cols-2 gap-4">
            {[
              { key: "pet_owners", label: "Stat 1 — pet owners",   placeholder: "30,000+" },
              { key: "vet_costs",  label: "Stat 2 — vet costs",    placeholder: "$8.2M+" },
              { key: "rating",     label: "Stat 3 — rating",       placeholder: "4.9 ★" },
              { key: "species",    label: "Stat 4 — species",      placeholder: "14+" },
            ].map(({ key, label, placeholder }) => (
              <Input key={key} label={label} value={content.stats[key]} placeholder={placeholder}
                onChange={e => updStats(key, e.target.value)} />
            ))}
            <p className="col-span-2 text-xs text-[#65635C]">
              Labels shown below the numbers: "pet owners nationwide", "in vet costs reviewed", "average user rating", "species supported" — hardcoded in layout.
            </p>
          </div>
        )}
      </div>

      {/* ── Social links ── */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-hidden">
        <SectionHeader icon={LinkIcon} title="Social media links" expanded={openSection === "social"} onToggle={() => toggle("social")} />
        {openSection === "social" && (
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: "twitter",   label: "X / Twitter", placeholder: "https://twitter.com/petbillshield" },
              { key: "instagram", label: "Instagram",   placeholder: "https://instagram.com/petbillshield" },
              { key: "facebook",  label: "Facebook",    placeholder: "https://facebook.com/petbillshield" },
              { key: "tiktok",    label: "TikTok",      placeholder: "https://tiktok.com/@petbillshield" },
              { key: "youtube",   label: "YouTube",     placeholder: "https://youtube.com/@petbillshield" },
            ].map(({ key, label, placeholder }) => (
              <Input key={key} label={label} value={content.social_links[key]} placeholder={placeholder}
                type="url" onChange={e => updSocial(key, e.target.value)} />
            ))}
            <p className="col-span-2 text-xs text-[#65635C]">Leave blank to hide the link in the footer.</p>
          </div>
        )}
      </div>

      {/* ── FAQ ── */}
      <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-hidden">
        <SectionHeader icon={MessageSquare} title={`FAQ (${content.faq.length} items)`} expanded={openSection === "faq"} onToggle={() => toggle("faq")} />
        {openSection === "faq" && (
          <div className="p-5 space-y-4">
            {content.faq.map((f, idx) => (
              <div key={f.id || idx} className="rounded-2xl border border-[#2A2924] bg-[#111] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#FAF9F6]">FAQ #{idx + 1}</span>
                  <button onClick={() => delFaq(idx)} className="text-[#65635C] hover:text-[#F87171] transition"><Trash2 size={13} /></button>
                </div>
                <Input label="Question" value={f.q} onChange={e => updFaq(idx,"q",e.target.value)} placeholder="Do you tell me whether a treatment is necessary?" />
                <Input label="Answer" value={f.a} onChange={e => updFaq(idx,"a",e.target.value)} rows={3} placeholder="Never. We don't diagnose pets…" />
              </div>
            ))}
            <button onClick={addFaq}
              className="w-full rounded-xl border border-dashed border-[#3D3C38] text-[#65635C] hover:text-[#FAF9F6] hover:border-[#65635C] text-xs font-semibold py-3 inline-flex items-center justify-center gap-1.5 transition"
            >
              <Plus size={13} /> Add FAQ item
            </button>
            <p className="text-xs text-[#65635C]">
              If no FAQ items are added here, the page falls back to its built-in defaults.
            </p>
          </div>
        )}
      </div>

      {/* Floating save */}
      <div className="sticky bottom-4 flex justify-end">
        <button onClick={save} disabled={saving}
          className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold px-6 py-3 inline-flex items-center gap-2 disabled:opacity-50 transition shadow-xl shadow-black/30"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save all changes
        </button>
      </div>
    </div>
  );
}
