import { useEffect, useState } from "react";
import {
  FileSearch, PawPrint, Bell, ShieldCheck,
  ArrowRight, Map, X,
} from "lucide-react";

const FEATURES = [
  {
    icon: FileSearch,
    color: "bg-[#FFF4EE] text-[#D26D53]",
    title: "Decode any bill",
    desc: "Upload a vet estimate or invoice. We translate every charge into plain English — instantly.",
  },
  {
    icon: PawPrint,
    color: "bg-[#E8F5EC] text-[#2F6B45]",
    title: "Build the vault",
    desc: "One home for every pet's records, vaccines, medications, and vet contacts.",
  },
  {
    icon: Bell,
    color: "bg-[#FFF4E6] text-[#B5862A]",
    title: "Never miss care",
    desc: "Smart reminders for vaccines, refills, and follow-ups — across all your animals.",
  },
];

export default function WelcomeModal({ onStartTour, onSkip }) {
  const [visible, setVisible] = useState(false);

  // Slight delay so the dashboard renders first, then the modal "arrives"
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 280);
    return () => clearTimeout(t);
  }, []);

  const handleSkip = () => {
    setVisible(false);
    setTimeout(onSkip, 260);
  };

  const handleTour = () => {
    setVisible(false);
    setTimeout(onStartTour, 260);
  };

  return (
    <div
      className={`fixed inset-0 z-[999] flex items-center justify-center p-4 transition-all duration-300 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      style={{ background: "rgba(15, 14, 13, 0.78)", backdropFilter: "blur(6px)" }}
    >
      {/* Card */}
      <div
        className={`relative w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[24px] sm:rounded-[28px] bg-[#1A1917] border border-[#2A2924] shadow-2xl transition-all duration-300 ${
          visible ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        {/* Decorative background rings */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full border border-[#D26D53]/10" />
        <div className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full border border-[#D26D53]/8" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 w-48 h-48 rounded-full border border-[#E6AE2E]/8" />

        {/* Skip button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#2A2924] hover:bg-[#3D3C38] text-[#65635C] hover:text-[#FAF9F6] flex items-center justify-center transition z-10"
          aria-label="Skip welcome"
        >
          <X size={14} />
        </button>

        {/* Header */}
        <div className="px-5 sm:px-7 pt-7 sm:pt-8 pb-5">
          {/* Animated icon cluster */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-[#D26D53] to-[#B5502C] flex items-center justify-center shadow-lg shadow-[#D26D53]/30">
              <ShieldCheck size={26} className="text-white" />
              {/* Orbiting paw */}
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#E6AE2E] flex items-center justify-center shadow-sm animate-bounce">
                <PawPrint size={11} className="text-[#2D2C28]" />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#65635C] font-semibold">
                Welcome to
              </div>
              <div className="text-sm font-bold text-[#FAF9F6] leading-tight">
                PetBill Shield
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl sm:text-3xl leading-tight text-[#FAF9F6] mb-2">
            Your pet's financial guardian{" "}
            <span className="italic text-[#D26D53]">is ready.</span>
          </h2>
          <p className="text-sm text-[#8A887F] leading-relaxed">
            Plain-English clarity for every vet bill, insurance claim, and care record —
            so you can focus on your pet, not the paperwork.
          </p>
        </div>

        {/* Feature cards */}
        <div className="px-5 sm:px-7 pb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {FEATURES.map(({ icon: Icon, color, title, desc }, i) => (
            <div
              key={title}
              className="rounded-2xl bg-[#111] border border-[#2A2924] p-3.5 flex flex-col gap-2"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color}`}>
                <Icon size={15} />
              </div>
              <div className="text-xs font-semibold text-[#FAF9F6] leading-snug">{title}</div>
              <div className="text-[11px] text-[#65635C] leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>

        {/* Fun fact strip */}
        <div className="mx-5 sm:mx-7 mb-5 rounded-2xl bg-[#D26D53]/10 border border-[#D26D53]/20 px-4 py-3 flex items-center gap-3">
          <span className="text-lg select-none">💡</span>
          <p className="text-xs text-[#C9C6BD] leading-relaxed">
            <strong className="text-[#FAF9F6]">Quick tip:</strong> The average PetBill Shield user
            saves <strong className="text-[#E6AE2E]">$340 per estimate</strong> just by knowing which questions to ask.
          </p>
        </div>

        {/* CTAs */}
        <div className="px-5 sm:px-7 pb-6 sm:pb-7 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            onClick={handleTour}
            className="flex-1 rounded-2xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold py-3 inline-flex items-center justify-center gap-2 transition shadow-lg shadow-[#D26D53]/25"
          >
            <Map size={15} />
            Take a quick tour
          </button>
          <button
            onClick={handleSkip}
            className="flex-1 rounded-2xl border border-[#2A2924] bg-[#111] hover:bg-[#1E1D1A] text-[#8A887F] hover:text-[#FAF9F6] text-sm font-semibold py-3 inline-flex items-center justify-center gap-2 transition"
          >
            Explore on my own
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
