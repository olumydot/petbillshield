import { useState, useEffect } from "react";
import PromoBanner from "../components/PromoBanner";
import { Link } from "react-router-dom";
import {
  ShieldCheck, FileSearch, MessagesSquare, ScrollText, PawPrint,
  Receipt, AlertTriangle, ArrowRight, Check, Clock, Stethoscope,
  Sparkles, BookOpen, ChevronRight, Heart,
  TrendingDown, Bell, Activity, Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useAuth } from "../context/AuthContext";
import { fetchCmsContent } from "../lib/cms";

const HERO_IMG  = "https://static.prod-images.emergentagent.com/jobs/246e6a6e-d794-46ca-a652-ef02580c36cd/images/692e8ce477ea39df11f6784b14d234f9c37d5b3f7b843493e7e817bfaad6b2c8.png";
const CARE_IMG  = "https://static.prod-images.emergentagent.com/jobs/246e6a6e-d794-46ca-a652-ef02580c36cd/images/62e91cf70794e25795e71123ff7b68e2f719c18e7c2342a63d0e69b638403893.png";
const BILL_IMG  = "https://static.prod-images.emergentagent.com/jobs/246e6a6e-d794-46ca-a652-ef02580c36cd/images/e0bc5cec31b130d847dd17d3081b102591c0aeb8f3394731d109018db07ce1c6.png";

// ── Tiny shared chip ─────────────────────────────────────────────────────────
function Chip({ children, dark }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${
      dark
        ? "bg-white/10 text-white/80 border-white/15"
        : "bg-[#F2F0E9] text-[#65635C] border-[#E5E2D9]"
    }`}>
      {children}
    </span>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeFaq, setActiveFaq] = useState(null);

  // ── CMS content (falls back to hardcoded defaults if unavailable) ──────────
  const [cms, setCms] = useState(null);

  useEffect(() => {
    fetchCmsContent().then((data) => setCms(data));
  }, []);

  // Merge helpers — CMS wins when truthy, otherwise fall back to default
  const cmsReviews = (cms?.reviews?.length > 0) ? cms.reviews : null;
  const cmsFaqs    = (cms?.faqs?.length    > 0) ? cms.faqs    : null;
  const cmsHero    = cms?.hero    || {};
  const cmsStats   = cms?.stats   || {};
  const cmsSocial  = cms?.social  || {};

  function goProtected(path) {
    sessionStorage.setItem("petbill_auth_next", path);
    localStorage.setItem("petbill_auth_next", path);
    if (user) window.location.assign(path);
    else      window.location.assign(`/auth?next=${encodeURIComponent(path)}`);
  }

  const PrimaryCta = ({ label, testId, to }) => (
    <button
      onClick={() => goProtected(to || "/dashboard/analyze")}
      className="group w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-[#D26D53] hover:bg-[#C05E45] text-white rounded-2xl px-6 sm:px-7 py-4 text-sm font-semibold transition-all duration-200 shadow-lg shadow-[#D26D53]/25 hover:shadow-xl hover:shadow-[#D26D53]/30 hover:-translate-y-0.5"
      data-testid={testId}
    >
      {label}
      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );

  const GhostCta = ({ label, href, testId }) => (
    <a
      href={href}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-[#65635C] hover:text-[#2D2C28] rounded-2xl px-5 py-4 text-sm font-semibold border border-[#E5E2D9] hover:border-[#2D2C28]/30 transition-all duration-200 bg-white/60 hover:bg-white"
      data-testid={testId}
    >
      {label}
    </a>
  );

  return (
    <div className="paper-grain overflow-x-hidden">
      {/* Promo banner — only visible when admin enables it */}
      <PromoBanner page="landing" />

      <Header variant="marketing" />

      {/* ═══════════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════════════ */}
      <section
        className="w-full max-w-[1280px] mx-auto px-5 sm:px-8 pt-14 sm:pt-20 lg:pt-24 overflow-hidden"
        data-testid="landing-hero"
      >
        {/* Eyebrow pill */}
        <div className="inline-flex items-center gap-2 bg-[#FFF4EE] border border-[#F2C5B7] rounded-full px-4 py-1.5 mb-8 fade-up delay-0">
          <Sparkles size={12} className="text-[#D26D53]" />
          <span className="text-xs font-semibold text-[#D26D53]">
            {cmsHero.eyebrow || "AI-powered vet bill clarity"}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center min-w-0">
          {/* Left — copy */}
          <div className="lg:col-span-6 fade-up delay-1 min-w-0 max-w-[calc(100vw-2.5rem)] sm:max-w-full">
            <h1 className="font-serif-display text-4xl min-[380px]:text-5xl sm:text-6xl lg:text-[5.5rem] leading-[0.95] sm:leading-[0.92] tracking-tight text-[#2D2C28] max-w-[calc(100vw-2.5rem)] sm:max-w-full">
              Your vet bill,{" "}
              <span className="italic text-[#D26D53]">finally</span>
              <br />in plain English.
            </h1>

            <p className="mt-7 text-base sm:text-lg text-[#65635C] leading-relaxed max-w-[calc(100vw-2.5rem)] sm:max-w-lg">
              {cmsHero.subtext ||
                "Upload any vet estimate or invoice. Our AI reads every line item, flags concerns politely, and gives you the exact questions to ask — before you pay."}
            </p>

            <div className="mt-9 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 max-w-[calc(100vw-2.5rem)] sm:max-w-full">
              <PrimaryCta label="Analyze your vet bill" testId="hero-cta-upload" />
              <GhostCta label="See how it works" href="#how" testId="hero-how-link" />
            </div>

            {/* Trust signals */}
            <div className="mt-9 flex flex-wrap items-center gap-x-5 sm:gap-x-7 gap-y-3 text-xs text-[#8A887F] max-w-[calc(100vw-2.5rem)] sm:max-w-full">
              {[
                { icon: Check, label: "No diagnosis — ever" },
                { icon: Heart, label: "Free first review" },
                { icon: PawPrint, label: "Works for any pet" },
                { icon: Users, label: "30,000+ pet owners" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5">
                  <Icon size={13} className="text-[#556045]" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Right — bento */}
          <div className="lg:col-span-6 fade-up delay-2 min-w-0">
            <div className="grid grid-cols-5 gap-3">
              {/* Main photo */}
              <div className="col-span-5 relative rounded-[28px] overflow-hidden border border-[#E5E2D9] shadow-2xl shadow-black/10">
                <img
                  src={HERO_IMG}
                  alt="Collage of pets"
                  className="w-full h-[300px] sm:h-[360px] object-cover"
                />
                {/* Floating badge */}
                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div className="pbs-dark-card backdrop-blur-md rounded-2xl px-4 py-3 shadow-lg">
                    <div className="pbs-card-accent text-[10px] uppercase tracking-widest font-semibold">Avg. savings identified</div>
                    <div className="pbs-card-value font-serif-display text-3xl leading-tight">$340</div>
                    <div className="text-[10px] mt-0.5">per estimate reviewed *</div>
                  </div>
                  <div className="bg-[#2D2C28]/90 backdrop-blur-md rounded-2xl p-3.5 border border-white/10 shadow-lg">
                    <ShieldCheck size={22} className="text-[#E4A834]" />
                  </div>
                </div>
              </div>

              {/* Mini cards */}
              <div className="col-span-3 rounded-[20px] pbs-dark-card p-5">
                <div className="pbs-card-accent text-[10px] uppercase tracking-widest font-semibold">Plain-English breakdown</div>
                <div className="mt-2 space-y-1.5">
                  {[
                    { label: "CBC bloodwork", tag: "Urgent",   color: "pbs-chip-terracotta" },
                    { label: "Dental cleaning", tag: "Can wait", color: "pbs-chip-sage" },
                    { label: "Anesthesia",     tag: "Urgent",   color: "pbs-chip-terracotta" },
                  ].map(({ label, tag, color }) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="pbs-card-value text-xs font-semibold">{label}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{tag}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="col-span-2 rounded-[20px] bg-[#556045] p-5 flex flex-col justify-between">
                <MessagesSquare size={20} className="text-[#A8C499]" />
                <div className="text-xs font-semibold text-white/90 leading-snug">Polite scripts to ask the right questions</div>
              </div>
            </div>
          </div>
        </div>

        {/* Pull-quote band + social proof stats */}
        <div className="mt-20 sm:mt-24 border-t border-b border-[#E5E2D9] py-10 fade-up delay-3">
          <blockquote className="font-serif-display text-2xl sm:text-3xl lg:text-4xl leading-snug max-w-4xl text-[#2D2C28]">
            {cmsHero.pull_quote
              ? <>{cmsHero.pull_quote}</>
              : <>"Your second set of eyes before a costly vet decision —
            <span className="italic text-[#D26D53]"> never to refuse care, always to ask better questions.</span>"</>
            }
          </blockquote>

          <div className="mt-10 pt-10 border-t border-[#E5E2D9] grid grid-cols-2 sm:grid-cols-4 gap-y-8 gap-x-6">
            {[
              { value: cmsStats.pet_owners || "30,000+", label: "pet owners nationwide", accent: "#D26D53" },
              { value: cmsStats.vet_costs  || "$8.2M+",  label: "in vet costs reviewed",  accent: "#556045" },
              { value: cmsStats.rating     || "4.9 ★",   label: "average user rating",    accent: "#E6AE2E" },
              { value: cmsStats.species    || "14+",     label: "species supported",       accent: "#245EA8" },
            ].map(({ value, label, accent }) => (
              <div key={label}>
                <div
                  className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight"
                  style={{ color: accent }}
                >
                  {value}
                </div>
                <div className="mt-1.5 text-sm text-[#65635C] leading-snug">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════════════════════════════ */}
      <section
        id="how"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-how"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4 fade-up delay-0">
            <div className="eyebrow mb-3 text-[#D26D53]">01 — How it works</div>
            <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
              Upload. Understand.{" "}
              <span className="italic text-[#D26D53]">Ask.</span>
            </h2>
            <p className="mt-5 text-[#65635C] leading-relaxed max-w-sm">
              Three calm steps. Whether it's a $2,400 emergency or months of chronic-care costs, the process is the same.
            </p>
          </div>

          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                n: "01", icon: FileSearch, color: "bg-[#FFF4EE] text-[#D26D53]",
                title: "Upload the bill",
                desc: "PDF, photo, or pasted text. We accept whatever you've got from the vet desk.",
              },
              {
                n: "02", icon: ScrollText, color: "bg-[#EDF5FF] text-[#245EA8]",
                title: "Get a clear breakdown",
                desc: "Plain-English line items, urgency tags, red flags, and questions to ask.",
              },
              {
                n: "03", icon: MessagesSquare, color: "bg-[#E8F5EC] text-[#2F6B45]",
                title: "Walk in prepared",
                desc: "Use the polite script to clarify, stage, or compare options confidently.",
              },
            ].map((s, i) => (
              <div
                key={s.n}
                className={`rounded-[24px] bg-white border border-[#E5E2D9] p-6 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 fade-up delay-${i + 1}`}
              >
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[10px] font-mono text-[#8A887F]">{s.n}</span>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.color}`}>
                    <s.icon size={17} />
                  </div>
                </div>
                <h3 className="font-serif-display text-xl leading-tight">{s.title}</h3>
                <p className="mt-2 text-sm text-[#65635C] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FEATURES
      ════════════════════════════════════════════════════════════════ */}
      <section
        id="features"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-features"
      >
        <div className="fade-up delay-0">
          <div className="eyebrow mb-3 text-[#D26D53]">02 — Six tools in one shield</div>
          <h2 className="font-serif-display text-4xl sm:text-5xl lg:text-[3.5rem] leading-[0.95] tracking-tight max-w-3xl">
            Everything you need to feel{" "}
            <span className="italic text-[#D26D53]">prepared</span> before saying yes.
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Big card 1 */}
          <FeatureCard
            className="md:col-span-7"
            bg="bg-[#2D2C28]"
            dark
            icon={FileSearch}
            kicker="AI bill defender"
            title="A plain-English breakdown of every line."
            body="Diagnostics, treatment, anesthesia, hospitalization — every charge translated, urgency-tagged, and ready to discuss. Red flags surfaced politely so you know what to ask before signing."
            chips={["Urgent vs elective", "Line-item clarity", "Second-opinion checklist"]}
            image={BILL_IMG}
          />
          <div className="md:col-span-5 grid grid-rows-2 gap-5">
            <FeatureCard
              bg="bg-[#FFF4EE]"
              icon={AlertTriangle}
              kicker="Red-flag checker"
              title="Polite flags, never accusations."
              body='We say "may need clarification" — never "overbilling." Duplicate charges, vague items, bundled fees all flagged with a kind question you can ask.'
              chips={["Duplicate charges", "Vague items"]}
            />
            <FeatureCard
              bg="bg-[#EDF5FF]"
              icon={MessagesSquare}
              kicker="Question scripts"
              title="The exact words to use."
              body="We write the calm, professional script — to call, email, or read at the front desk when the pressure is on."
              chips={["Polite", "Firm", "Warm"]}
            />
          </div>

          {/* Row 2 */}
          <FeatureCard
            className="md:col-span-5"
            bg="bg-[#E8F5EC]"
            icon={PawPrint}
            kicker="Pet cost vault"
            title="Every pet. Every vaccine. Every receipt."
            body="Medical records, medications, invoices, insurance details, chronic conditions, vet contacts — all in one calm home. Built for single pets, families, and rescue networks alike."
            chips={["Multi-pet", "Annual cost summary"]}
            image={CARE_IMG}
          />
          <FeatureCard
            className="md:col-span-7"
            bg="bg-[#556045]"
            dark
            icon={Receipt}
            kicker="Insurance claim helper"
            title="From confusing reimbursement to a clean appeal."
            body="Upload your policy + invoice. We estimate likely reimbursable categories, list missing documents, and draft a respectful appeal if your claim came back lower than expected."
            chips={["Deductible tracker", "Missing docs", "Appeal draft"]}
          />

          {/* Row 3 */}
          <FeatureCard
            className="md:col-span-4"
            bg="bg-[#F3ECFF]"
            icon={Bell}
            kicker="Care reminders"
            title="Never miss a vaccine or refill."
            body="Set smart reminders for vaccines, medications, follow-ups, and annual wellness visits. We ping you before things lapse."
          />
          <FeatureCard
            className="md:col-span-4"
            bg="bg-[#FFF4E6]"
            icon={Activity}
            kicker="Health timeline"
            title="Your pet's story, at a glance."
            body="A chronological view of every visit, diagnosis, vaccine, and cost so you and your vet always have context."
          />
          <FeatureCard
            className="md:col-span-4"
            bg="bg-[#F2F0E9]"
            icon={TrendingDown}
            kicker="Cost-saving options"
            title="Generics, staging, nonprofits."
            body="Safe, non-diagnostic options to discuss with your vet — outside pharmacies, payment plans, generic meds, and assistance programs."
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          PERSONAS
      ════════════════════════════════════════════════════════════════ */}
      <section
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-personas"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-4 fade-up delay-0">
            <div className="eyebrow mb-3 text-[#D26D53]">03 — Built for every kind of pet parent</div>
            <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
              From <span className="italic text-[#D26D53]">emergency</span> rooms to
              chronic-care kitchens.
            </h2>
            <p className="mt-5 text-[#65635C] leading-relaxed max-w-sm">
              We don't assume insurance. We don't assume income. We assume you love your pet and deserve clarity.
            </p>
          </div>

          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                t: "The emergency pet parent",
                d: "\"My dog is sick and the vet just handed me a $2,400 estimate.\"",
                icon: Stethoscope,
                color: "bg-[#FFF4EE] border-[#F2C5B7] text-[#D26D53]",
              },
              {
                t: "The uninsured pet owner",
                d: "\"I don't have insurance. I need to know what I can ask before I say yes.\"",
                icon: Receipt,
                color: "bg-[#EDF5FF] border-[#C5D8F5] text-[#245EA8]",
              },
              {
                t: "The chronic-care home",
                d: "\"My cat has kidney disease and the costs keep piling up month after month.\"",
                icon: Clock,
                color: "bg-[#E8F5EC] border-[#C8E8D4] text-[#2F6B45]",
              },
              {
                t: "The rescue / foster parent",
                d: "\"I manage several animals and bills, records, and reminders are everywhere.\"",
                icon: PawPrint,
                color: "bg-[#F3ECFF] border-[#D9C8F5] text-[#6B3FA0]",
              },
            ].map((p, i) => (
              <div
                key={p.t}
                className={`rounded-[24px] border p-6 ${p.color} fade-up delay-${i + 1} hover:shadow-md transition-shadow`}
              >
                <div className={`w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center mb-4`}>
                  <p.icon size={18} />
                </div>
                <h3 className="font-serif-display text-xl text-[#2D2C28]">{p.t}</h3>
                <p className="mt-2 text-sm text-[#65635C] italic leading-relaxed">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          TESTIMONIALS
      ════════════════════════════════════════════════════════════════ */}
      <section
        id="reviews"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-reviews"
      >
        {/* Header row */}
        <div className="mb-12 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 fade-up delay-0">
          <div>
            <div className="eyebrow mb-3 text-[#D26D53]">Loved by pet owners</div>
            <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
              Trusted by{" "}
              <span className="italic text-[#D26D53]">{cmsStats.pet_owners || "30,000+"}</span>{" "}
              pet owners nationwide.
            </h2>
            <p className="mt-3 text-[#65635C] max-w-lg text-sm leading-relaxed">
              From panicked emergency visits to years of chronic-care costs — real pet owners share
              how PetBill Shield changed their vet experience.
            </p>
          </div>

          {/* Aggregate rating badge */}
          <div className="flex items-center gap-3 shrink-0 rounded-2xl border border-[#E5E2D9] bg-white px-5 py-4 self-start sm:self-auto">
            <div className="text-[#E6AE2E] text-xl leading-none tracking-widest select-none">★★★★★</div>
            <div>
              <div className="font-semibold text-[#2D2C28] text-lg leading-tight">
                {cmsStats.rating || "4.9"} / 5
              </div>
              <div className="text-xs text-[#65635C]">
                {cmsStats.pet_owners || "30,000+"} reviews
              </div>
            </div>
          </div>
        </div>

        {/* Review grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(cmsReviews || REVIEWS).map((r, i) => (
            <ReviewCard key={r.name} review={r} i={i} />
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          PRICING
      ════════════════════════════════════════════════════════════════ */}
      <section
        id="pricing"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-pricing"
      >
        <div className="mb-12 fade-up delay-0">
          <div className="eyebrow mb-3 text-[#D26D53]">04 — Pricing</div>
          <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
            Fair plans. No <span className="italic text-[#D26D53]">surprise</span> charges.
          </h2>
          <p className="mt-3 text-[#65635C] max-w-lg text-sm">
            Start free. Upgrade when your pet's care history deserves a real home.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <LandingPriceCard
            name="Free"
            price="$0"
            sub="Free forever"
            features={[
              "1 pet profile",
              "1 estimate review / month",
              "Basic bill explanation",
              "Basic health timeline (no AI)",
              "Care reminders",
            ]}
            cta={
              <button
                onClick={() => goProtected("/dashboard/analyze")}
                className="w-full rounded-xl border border-[#E5E2D9] bg-[#F2F0E9] hover:bg-[#E8E5DD] text-[#2D2C28] py-3 text-sm font-semibold transition-colors"
                data-testid="pricing-cta-free"
              >
                Get started free
              </button>
            }
          />

          <LandingPriceCard
            featured
            name="Pet Cost Vault"
            price="$8.99"
            sub="/ month"
            badge="Most loved"
            savings="Save 2 months yearly"
            features={[
              "2 pets",
              "Unlimited estimate reviews",
              "AI estimate defender",
              "Pet vault: records, meds, reminders",
              "Health timeline + cost forecasting",
              "Insurance claim helper + appeals",
            ]}
            cta={
              <Link
                to="/dashboard/checkout?plan=vault_monthly"
                className="w-full rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors shadow-lg shadow-[#D26D53]/20"
              >
                Subscribe <ArrowRight size={15} />
              </Link>
            }
          />

          <LandingPriceCard
            name="Family"
            price="$19.99"
            sub="/ month"
            savings="Save 2 months yearly"
            features={[
              "Up to 5 pets",
              "Unlimited estimate reviews",
              "Shared household pet vault",
              "Multi-pet spending summary",
              "Care reminders across all pets",
              "Insurance + appeal support",
            ]}
            cta={
              <Link
                to="/dashboard/checkout?plan=family_monthly"
                className="w-full rounded-xl bg-[#2D2C28] hover:bg-[#1A1917] text-[#FAF9F6] py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
              >
                Subscribe <ArrowRight size={15} />
              </Link>
            }
          />
        </div>

        {/* Rescue card — wide */}
        <div className="mt-5 rounded-[28px] bg-[#F8F5EE] border border-[#E5E2D9] p-7 sm:p-8 fade-up delay-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6 justify-between">
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 bg-[#E8F5EC] text-[#2F6B45] border border-[#C8E8D4] rounded-full px-3 py-1 text-xs font-semibold mb-3">
                <Heart size={11} /> Rescue / Foster
              </div>
              <div className="flex items-end gap-3 mb-2">
                <span className="font-serif-display text-4xl">$49.99</span>
                <span className="text-[#65635C] text-sm mb-1">/ month · save 2 months yearly</span>
              </div>
              <p className="text-sm text-[#65635C] max-w-xl leading-relaxed">
                Built for rescues, fosters, and multi-animal households managing many records, vaccines, reminders, and reimbursement workflows.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                "Unlimited pets",
                "Unlimited estimate reviews",
                "Donation-ready expense reports",
                "Adoption packet records",
                "Vaccine logs across animals",
                "Foster transfer-ready records",
              ].map((f) => (
                <div key={f} className="flex items-center gap-2 text-[#65635C]">
                  <Check size={13} className="text-[#2F6B45] shrink-0" /> {f}
                </div>
              ))}
            </div>
            <Link
              to="/dashboard/checkout?plan=rescue_monthly"
              className="shrink-0 rounded-xl bg-[#2D2C28] hover:bg-[#1A1917] text-[#FAF9F6] px-7 py-3.5 text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              Subscribe <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SAFETY NOTE
      ════════════════════════════════════════════════════════════════ */}
      <section
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-safety"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 rounded-[28px] bg-[#F8F5EE] border border-[#E5E2D9] p-8 sm:p-12 fade-up delay-0">
            <div className="inline-flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#556045] flex items-center justify-center">
                <ShieldCheck size={15} className="text-white" />
              </div>
              <span className="eyebrow text-[#556045]">A note on safety</span>
            </div>
            <h2 className="font-serif-display text-3xl sm:text-4xl leading-tight">
              PetBill Shield doesn't diagnose. It doesn't replace your vet. It helps you ask.
            </h2>
            <ul className="mt-7 space-y-3">
              {[
                "We do not diagnose pets or recommend treatment.",
                "We do not tell users to refuse care.",
                "We help you understand costs and prepare polite questions.",
                "For urgent symptoms, seek immediate veterinary care.",
              ].map((x) => (
                <li key={x} className="flex items-start gap-3 text-sm text-[#65635C]">
                  <div className="w-5 h-5 rounded-full bg-[#E8F5EC] flex items-center justify-center shrink-0 mt-0.5">
                    <Check size={11} className="text-[#556045]" />
                  </div>
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-5 hidden lg:block fade-up delay-2">
            <div className="rounded-[28px] overflow-hidden border border-[#E5E2D9] shadow-xl shadow-black/10">
              <img
                src={CARE_IMG}
                alt="A hand petting a golden retriever in warm light"
                className="w-full h-[400px] object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FAQ
      ════════════════════════════════════════════════════════════════ */}
      <section
        id="faq"
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-faq"
      >
        <div className="mb-10 fade-up delay-0">
          <div className="eyebrow mb-3 text-[#D26D53]">05 — FAQ</div>
          <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
            Honest answers, no <span className="italic text-[#D26D53]">jargon.</span>
          </h2>
        </div>

        <div className="space-y-3 max-w-3xl">
          {(cmsFaqs || [
            {
              q: "Do you tell me whether a treatment is necessary?",
              a: "Never. We don't diagnose pets and we don't replace your vet. We help you understand line items and ask better questions.",
            },
            {
              q: "Will this work without pet insurance?",
              a: "Yes. Most users don't have insurance. We give you cost-saving questions, payment-plan asks, and nonprofit assistance ideas regardless.",
            },
            {
              q: "What kinds of pets are supported?",
              a: "Dogs, cats, rabbits, birds, reptiles, horses, and exotics. The framework is the same — understand the bill, ask the right questions.",
            },
            {
              q: "Is my data private?",
              a: "Your records live in your private vault. We don't sell your data. Sign-out and deletion are one click away.",
            },
            {
              q: "How accurate is the AI analysis?",
              a: "Our AI reads your bill like a knowledgeable friend. It explains common vet billing practices but always defers final decisions to you and your vet.",
            },
          ]).map((f, i) => (
            <div
              key={f.q}
              className="rounded-[20px] border border-[#E5E2D9] bg-white/60 overflow-hidden fade-up"
            >
              <button
                className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-white/80 transition-colors"
                onClick={() => setActiveFaq(activeFaq === i ? null : i)}
              >
                <span className="font-serif-display text-lg text-[#2D2C28]">{f.q}</span>
                <ChevronRight
                  size={18}
                  className={`text-[#D26D53] shrink-0 transition-transform duration-200 ${activeFaq === i ? "rotate-90" : ""}`}
                />
              </button>
              {activeFaq === i && (
                <div className="px-5 pb-5 text-sm text-[#65635C] leading-relaxed border-t border-[#E5E2D9] pt-4">
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SEO RESOURCE TOPICS
      ════════════════════════════════════════════════════════════════ */}
      <section
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32"
        data-testid="section-resources"
        aria-label="Vet bill resources and guides"
      >
        <div className="mb-10 fade-up delay-0">
          <div className="eyebrow mb-3 text-[#D26D53]">Vet bill resources</div>
          <h2 className="font-serif-display text-4xl sm:text-5xl leading-none tracking-tight">
            Common vet bill <span className="italic text-[#D26D53]">questions</span>, answered.
          </h2>
          <p className="mt-3 text-[#65635C] max-w-xl text-sm leading-relaxed">
            From unexpected emergency invoices to chronic-care planning — the topics pet owners
            search for most, all in one place.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SEO_TOPICS.map((topic, i) => (
            <SeoTopicCard key={topic.title} topic={topic} i={i} />
          ))}
        </div>

        {/* Keyword cloud — visually styled, genuinely useful */}
        <div className="mt-10 p-7 rounded-[24px] bg-[#F8F5EE] border border-[#E5E2D9]">
          <p className="text-xs text-[#8A887F] uppercase tracking-widest font-semibold mb-4">
            Topics we help with
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              "Vet bill too expensive",
              "Understand veterinary estimate",
              "Dog emergency vet costs",
              "Cat chronic illness expenses",
              "Pet insurance claim denied",
              "How to appeal a vet bill",
              "Negotiate vet payment plan",
              "Generic vs brand pet medication",
              "Compare vet estimates",
              "What does anesthesia fee cover",
              "Vet bill for senior pet",
              "Puppy first vet visit cost",
              "Rabbit & exotic vet costs",
              "Pet wellness plan worth it",
              "Vet bill assistance programs",
              "Is this vet charge legit",
              "Annual pet care cost planning",
              "Dental cleaning for dogs cost",
              "Pet surgery estimate breakdown",
              "Boarding vs hospitalization fee",
            ].map((kw) => (
              <button
                key={kw}
                onClick={() => {}}
                className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-[#E5E2D9] text-[#65635C] hover:border-[#D26D53]/40 hover:text-[#D26D53] transition-colors cursor-default"
              >
                {kw}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════════════════════════════ */}
      <section
        className="max-w-[1280px] mx-auto px-5 sm:px-8 mt-24 sm:mt-32 mb-20"
        data-testid="section-final-cta"
      >
        <div className="relative rounded-[32px] p-10 sm:p-16 lg:p-20 bg-[#2D2C28] text-[#FAF9F6] overflow-hidden">
          {/* Decorative rings */}
          <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full border border-white/5 pointer-events-none" />
          <div className="absolute -top-16 -right-16 w-[360px] h-[360px] rounded-full border border-white/5 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full border border-white/5 pointer-events-none -translate-x-1/2 translate-y-1/2" />

          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-[#E4A834]/15 border border-[#E4A834]/30 rounded-full px-4 py-1.5 mb-6">
              <Sparkles size={12} className="text-[#E4A834]" />
              <span className="text-xs font-semibold text-[#E4A834]">Ready when you are</span>
            </div>
            <h2 className="font-serif-display text-4xl sm:text-5xl lg:text-[4.5rem] leading-[0.93] tracking-tight">
              Put the next bill through the{" "}
              <span className="italic text-[#D26D53]">shield</span>.
            </h2>
            <p className="mt-6 text-[#FAF9F6]/65 leading-relaxed max-w-xl">
              One upload. Plain-English clarity. The exact questions to ask. You decide what to do — with your vet, on your terms.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={() => goProtected("/dashboard/analyze")}
                className="group inline-flex items-center gap-2.5 bg-[#D26D53] hover:bg-[#C05E45] text-white rounded-2xl px-8 py-4 text-sm font-semibold transition-all duration-200 shadow-xl shadow-[#D26D53]/30 hover:shadow-[#D26D53]/40 hover:-translate-y-0.5"
                data-testid="final-cta-upload"
              >
                Analyze your vet bill
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                onClick={() => goProtected("/dashboard/pets")}
                className="inline-flex items-center gap-2 border border-[#FAF9F6]/20 text-[#FAF9F6]/80 hover:text-[#FAF9F6] rounded-2xl px-7 py-4 text-sm font-semibold hover:bg-white/10 transition-all duration-200"
                data-testid="final-cta-dashboard"
              >
                <BookOpen size={15} /> Open vault
              </button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-[#8A887F] mt-4 text-right italic">
          * Illustrative savings based on staged-treatment and clarified line-item discussions; varies by case.
        </p>
      </section>

      <Footer />
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ className, bg, dark, icon: Icon, kicker, title, body, chips, image }) {
  return (
    <div className={`pbs-feature-card rounded-[24px] p-7 sm:p-8 flex flex-col ${bg || "bg-[#F2F0E9]"} ${className || ""}`}>
      <div className="flex items-start justify-between gap-3 mb-5">
        <span className={`eyebrow ${dark ? "text-[#E4A834]" : "text-[#D26D53]"}`}>{kicker}</span>
        <div className={`pbs-feature-icon w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${dark ? "bg-white/10 text-white" : "bg-white/80 text-[#2D2C28]"}`}>
          <Icon size={17} />
        </div>
      </div>
      <h3 className={`font-serif-display text-2xl sm:text-3xl leading-snug ${dark ? "text-white" : "text-[#2D2C28]"}`}>
        {title}
      </h3>
      <p className={`text-sm mt-2 leading-relaxed flex-1 ${dark ? "text-white/70" : "text-[#65635C]"}`}>{body}</p>
      {chips && (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((c) => <Chip key={c} dark={dark}>{c}</Chip>)}
        </div>
      )}
      {image && (
        <div className="mt-6 rounded-2xl overflow-hidden border border-black/5">
          <img src={image} alt="" className="w-full h-[180px] object-cover" />
        </div>
      )}
    </div>
  );
}

// ── Reviews data ─────────────────────────────────────────────────────────────
const REVIEWS = [
  {
    name: "Sarah M.",
    location: "Denver, CO",
    pet: "Golden Retriever · Biscuit, 4 yrs",
    initial: "S",
    avatarBg: "bg-[#D26D53]",
    quote: "Got a $3,200 estimate for Biscuit's ACL repair and the paperwork might as well have been a foreign language. PetBill Shield translated every charge and helped me spot an anesthesia monitoring fee I never would have noticed. My vet adjusted it without any fuss. Saved $480 just by asking.",
    tag: "Emergency surgery",
    tagColor: "bg-[#FFF4EE] text-[#D26D53]",
  },
  {
    name: "James T.",
    location: "Austin, TX",
    pet: "Tabby Cat · Miso, 9 yrs",
    initial: "J",
    avatarBg: "bg-[#556045]",
    quote: "Miso's thyroid medication was bleeding us dry. PetBill Shield flagged that we were paying brand-name pricing and gave me the exact words to ask about generic methimazole. Our vet switched us without hesitation. That one question saves about $65 a month — more than the subscription costs.",
    tag: "Chronic care",
    tagColor: "bg-[#E8F5EC] text-[#2F6B45]",
  },
  {
    name: "Priya K.",
    location: "Seattle, WA",
    pet: "Labrador Mix · Waffles, 2 yrs",
    initial: "P",
    avatarBg: "bg-[#3D6B9A]",
    quote: "First-time dog owner here — every vet visit felt like signing a blank check. Now I upload each estimate and walk in genuinely prepared. My vet said I ask better questions than almost any client she has. I didn't have the words before. PetBill Shield gave them to me.",
    tag: "First-time pet owner",
    tagColor: "bg-[#EDF5FF] text-[#245EA8]",
  },
  {
    name: "Marcus & Diane L.",
    location: "Chicago, IL",
    pet: "3 dogs + 1 cat",
    initial: "M",
    avatarBg: "bg-[#8C2D14]",
    quote: "Between four animals, keeping track of vaccines, refills, and follow-ups was a constant scramble. The pet vault and reminder system alone paid for itself in the first month. Haven't missed a single appointment in eight months, and the multi-pet cost summary helps us actually budget.",
    tag: "Multi-pet family",
    tagColor: "bg-[#F2F0E9] text-[#65635C]",
  },
  {
    name: "Tanya B.",
    location: "Nashville, TN",
    pet: "Foster coordinator · 8–10 animals",
    initial: "T",
    avatarBg: "bg-[#6B3FA0]",
    quote: "I foster dogs for a local rescue and expense tracking used to eat my whole Saturday. The per-animal cost reports, transfer-ready records, and donation-ready summaries have completely changed how I handle reimbursements. What took hours now takes twenty minutes.",
    tag: "Rescue / Foster",
    tagColor: "bg-[#F3ECFF] text-[#6B3FA0]",
  },
  {
    name: "Chris R.",
    location: "Phoenix, AZ",
    pet: "Mixed Breed · Remy, 6 yrs",
    initial: "C",
    avatarBg: "bg-[#B5862A]",
    quote: "2am toxic ingestion, a $1,850 emergency bill, and total shock the next morning. I uploaded the invoice and finally understood every single charge — the IV fluids, the emesis fee, the overnight monitoring. Nothing felt hidden anymore. Didn't erase the bill, but gave me real peace of mind.",
    tag: "Emergency visit",
    tagColor: "bg-[#FFF4EE] text-[#D26D53]",
  },
];

// ── SEO topics data ───────────────────────────────────────────────────────────
const SEO_TOPICS = [
  {
    icon: FileSearch,
    title: "How to read a vet bill",
    body: "Vet invoices bundle anesthesia, hospitalization, and diagnostics into opaque line items. PetBill Shield translates every charge into plain English so you know exactly what you paid for — before you sign.",
  },
  {
    icon: TrendingDown,
    title: "How to lower vet costs",
    body: "Ask about generic medications, staged treatment plans, and nonprofit assistance programs. Small, polite questions can save hundreds of dollars without compromising your pet's care.",
  },
  {
    icon: AlertTriangle,
    title: "Is my vet overcharging me?",
    body: "Most vets are transparent — but fees vary widely. Duplicate charges, vague bundled items, and fees with no description are common red flags. We surface them politely so you know what to ask.",
  },
  {
    icon: Receipt,
    title: "Pet insurance claim denied",
    body: "Denied claims often lack supporting documentation or use incorrect billing codes. We help you identify what's missing and draft a respectful, evidence-based appeal letter to your insurer.",
  },
  {
    icon: Stethoscope,
    title: "Emergency vet bill help",
    body: "Emergency visits can run $1,500–$5,000+. Understanding each charge, knowing which follow-up care is urgent, and asking about payment plans can make a significant difference to your recovery.",
  },
  {
    icon: Activity,
    title: "Managing chronic pet illness costs",
    body: "Kidney disease, diabetes, hyperthyroidism — recurring care means recurring costs. Tracking every visit, medication, and refill in one vault keeps you and your vet aligned across years of care.",
  },
  {
    icon: BookOpen,
    title: "Pet medical records & history",
    body: "Centralise vaccines, diagnoses, medications, surgical notes, and vet contacts in a single secure vault. Share records instantly when switching vets, travelling, or boarding your pet.",
  },
  {
    icon: Bell,
    title: "Vaccine & medication reminders",
    body: "Never miss a booster, flea treatment, or annual wellness visit again. Smart reminders work across all your pets and send you an alert before anything lapses.",
  },
];

// ── Review card ───────────────────────────────────────────────────────────────
function ReviewCard({ review, i }) {
  return (
    <div
      className={`rounded-[24px] bg-white border border-[#E5E2D9] p-6 flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 fade-up delay-${Math.min(i + 1, 4)}`}
    >
      {/* Stars */}
      <div className="text-[#E6AE2E] text-sm tracking-widest select-none mb-3" aria-label="5 stars">
        ★★★★★
      </div>

      {/* Tag */}
      <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full w-fit mb-3 ${review.tagColor}`}>
        {review.tag}
      </span>

      {/* Quote */}
      <p className="text-sm text-[#65635C] leading-relaxed flex-1 italic">
        "{review.quote}"
      </p>

      {/* Author */}
      <div className="mt-5 flex items-center gap-3 pt-4 border-t border-[#F2F0E9]">
        <div
          className={`w-9 h-9 rounded-full ${review.avatarBg} text-white flex items-center justify-center text-sm font-bold shrink-0`}
        >
          {review.initial}
        </div>
        <div>
          <div className="font-semibold text-sm text-[#2D2C28]">{review.name}</div>
          <div className="text-[11px] text-[#8A887F] leading-snug">{review.location} · {review.pet}</div>
        </div>
      </div>
    </div>
  );
}

// ── SEO topic card ────────────────────────────────────────────────────────────
function SeoTopicCard({ topic, i }) {
  const Icon = topic.icon;
  return (
    <article
      className={`rounded-[20px] bg-white border border-[#E5E2D9] p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 fade-up delay-${Math.min(i + 1, 4)}`}
    >
      <div className="w-9 h-9 rounded-xl bg-[#FFF4EE] flex items-center justify-center mb-3">
        <Icon size={16} className="text-[#D26D53]" />
      </div>
      <h3 className="font-serif-display text-lg leading-tight text-[#2D2C28] mb-2">
        {topic.title}
      </h3>
      <p className="text-xs text-[#65635C] leading-relaxed">{topic.body}</p>
    </article>
  );
}

// ── Landing price card ────────────────────────────────────────────────────────
function LandingPriceCard({ name, price, sub, features, cta, featured, badge, savings }) {
  return (
    <div
      className={`relative rounded-[28px] p-7 flex flex-col fade-up ${
        featured
          ? "bg-[#2D2C28] text-[#FAF9F6] shadow-2xl shadow-black/20"
          : "bg-white border border-[#E5E2D9]"
      }`}
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#D26D53] text-white text-[11px] font-bold px-4 py-1 rounded-full shadow-lg">
          {badge}
        </div>
      )}
      <div className="mb-1">
        <span className={`eyebrow ${featured ? "text-[#E4A834]" : "text-[#D26D53]"}`}>{name}</span>
      </div>
      <div className="flex items-end gap-2 mt-3">
        <span className="font-serif-display text-5xl leading-none">{price}</span>
        <span className={`text-sm mb-1 ${featured ? "text-white/60" : "text-[#8A887F]"}`}>{sub}</span>
      </div>
      {savings && (
        <div className={`mt-1.5 text-xs font-medium ${featured ? "text-[#E4A834]" : "text-[#D26D53]"}`}>
          {savings}
        </div>
      )}
      <ul className={`mt-6 space-y-2.5 text-sm flex-1 ${featured ? "text-white/80" : "text-[#65635C]"}`}>
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check size={14} className={`mt-0.5 shrink-0 ${featured ? "text-[#E4A834]" : "text-[#556045]"}`} />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-7">{cta}</div>
    </div>
  );
}
