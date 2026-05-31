import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Tour step definitions
// ---------------------------------------------------------------------------
const STEPS = [
  {
    target: '[data-testid="nav-analyze"]',
    title: "Decode any vet bill",
    body: "Drop in an estimate or invoice and our AI breaks every charge into plain English — no more guessing what you're actually paying for.",
    emoji: "🔍",
  },
  {
    target: '[data-testid="nav-pets"]',
    title: "Your Pet Vault",
    body: "One home for every pet's records, vaccines, medications, and vet contacts. Add your first pet to unlock the full experience.",
    emoji: "🐾",
  },
  {
    target: '[data-testid="nav-reminders"]',
    title: "Never miss care again",
    body: "Smart reminders for vaccines, refills, and follow-ups — across all your animals, in one tidy inbox.",
    emoji: "🔔",
  },
  {
    target: '[data-testid="nav-timeline"]',
    title: "Health Timeline",
    body: "A scrollable medical history for each pet, organised by date. Easy to review and share before any vet visit.",
    emoji: "📋",
  },
  {
    target:
      '[data-testid="plan-badge-upgrade"],[data-testid="plan-badge-active"]',
    title: "Grow with your plan",
    body: "Compare two estimates side-by-side, get AI help with insurance claims, and script tough vet conversations — all unlocked as your needs grow.",
    emoji: "✨",
  },
];

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
const TOOLTIP_W = 296;
const RING = 10;   // padding around the target element for the spotlight ring
const GAP  = 16;   // gap between spotlight edge and tooltip

function tooltipWidth() {
  const available = Math.max(180, window.innerWidth - GAP * 2);
  return Math.min(TOOLTIP_W, available);
}

function findEl(selector) {
  for (const s of selector.split(",").map((x) => x.trim())) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function computeFallbackLayout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = tooltipWidth();

  return {
    spot: null,
    tip: {
      top: Math.max(GAP, Math.min(vh / 2 - 140, vh - 320)),
      left: Math.max(GAP, (vw - w) / 2),
      w,
    },
  };
}

function computeLayout(el) {
  if (!el) return computeFallbackLayout();
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = tooltipWidth();

  const spot = {
    top:  r.top  - RING,
    left: r.left - RING,
    w:    r.width  + RING * 2,
    h:    r.height + RING * 2,
  };

  const rightRoom = vw - (r.right + RING + GAP);
  const belowRoom = vh - (r.bottom + RING + GAP);
  const aboveRoom = r.top - RING - GAP;

  let tip;
  if (rightRoom >= w) {
    // Place to the right, vertically centred on target
    tip = {
      top:  Math.max(GAP, Math.min(r.top + r.height / 2 - 110, vh - 260)),
      left: r.right + RING + GAP,
      w,
    };
  } else if (belowRoom >= 200) {
    // Place below
    tip = {
      top:  r.bottom + RING + GAP,
      left: Math.max(GAP, Math.min(r.left - RING, vw - w - GAP)),
      w,
    };
  } else if (aboveRoom >= 200) {
    // Place above
    tip = {
      bottom: vh - (r.top - RING - GAP),
      left:   Math.max(GAP, Math.min(r.left - RING, vw - w - GAP)),
      w,
    };
  } else {
    // Centred fallback
    tip = {
      top:  vh / 2 - 110,
      left: vw / 2 - w / 2,
      w,
    };
  }

  return { spot, tip };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TourOverlay({ onDone, storageKey }) {
  const [step, setStep]       = useState(0);
  const [layout, setLayout]   = useState(null);
  const [visible, setVisible] = useState(false);

  const refresh = useCallback(() => {
    const el = findEl(STEPS[step].target);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      requestAnimationFrame(() => setLayout(computeLayout(el)));
    } else {
      setLayout(computeFallbackLayout());
    }
  }, [step]);

  // Re-run whenever `step` changes
  useEffect(() => {
    setVisible(false);
    setLayout(null);

    const delay = step === 0 ? 120 : 200;
    const t = setTimeout(() => {
      refresh();
      // Small additional tick so the DOM rect is stable before we fade in
      setTimeout(() => setVisible(true), 60);
    }, delay);

    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [step, refresh]);

  // -------------------------------------------------------------------------
  const finish = useCallback(() => {
    setVisible(false);
    if (storageKey) {
      localStorage.setItem(storageKey, "true");
    }
    setTimeout(onDone, 260);
  }, [onDone, storageKey]);

  const next = () => {
    if (step < STEPS.length - 1) {
      setVisible(false);
      setTimeout(() => setStep((s) => s + 1), 180);
    } else {
      finish();
    }
  };

  const prev = () => {
    if (step > 0) {
      setVisible(false);
      setTimeout(() => setStep((s) => s - 1), 180);
    }
  };

  // -------------------------------------------------------------------------
  const cur    = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const spot   = layout?.spot;
  const tip    = layout?.tip;

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Spotlight — creates the full-screen dark overlay via box-shadow.    */}
      {/* The element itself is transparent, revealing the target beneath.   */}
      {/* pointer-events: none so the dashboard is still fully interactive.  */}
      {/* ------------------------------------------------------------------ */}
      {spot ? (
        <div
          className={`fixed z-[1000] rounded-[14px] pointer-events-none transition-all duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          style={{
            top:    spot.top,
            left:   spot.left,
            width:  spot.w,
            height: spot.h,
            boxShadow:
              "0 0 0 9999px rgba(15, 14, 13, 0.82), " +
              "0 0 0 2px rgba(210, 109, 83, 0.65), " +
              "0 0 40px rgba(210, 109, 83, 0.18)",
          }}
        />
      ) : (
        /* Fallback backdrop when the target element isn't found */
        <div
          className={`fixed inset-0 z-[1000] pointer-events-none transition-opacity duration-300 ${
            visible ? "opacity-100" : "opacity-0"
          }`}
          style={{ background: "rgba(15, 14, 13, 0.82)" }}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Skip / close button — always top-right                             */}
      {/* ------------------------------------------------------------------ */}
      <button
        onClick={finish}
        className={`fixed top-5 right-5 z-[1002] w-9 h-9 rounded-full bg-[#2A2924] hover:bg-[#3D3C38] text-[#65635C] hover:text-[#FAF9F6] flex items-center justify-center transition-all duration-300 ${
          visible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-label="Skip tour"
      >
        <X size={15} />
      </button>

      {/* ------------------------------------------------------------------ */}
      {/* Tooltip card                                                        */}
      {/* ------------------------------------------------------------------ */}
      {tip && (
        <div
          className={`fixed z-[1001] transition-all duration-300 ${
            visible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none"
          }`}
          style={{
            ...(tip.top    !== undefined ? { top: tip.top }       : {}),
            ...(tip.bottom !== undefined ? { bottom: tip.bottom } : {}),
            left:  tip.left,
            width: tip.w || TOOLTIP_W,
            maxHeight: "calc(100vh - 32px)",
            overflowY: "auto",
          }}
        >
          {/* Step progress bar (sits above the card) */}
          <div className="h-1 rounded-full bg-[#2A2924] mb-2.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#D26D53] to-[#E6AE2E] transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          {/* Card */}
          <div className="rounded-[22px] bg-[#1A1917] border border-[#2A2924] shadow-2xl overflow-hidden">
            {/* Subtle top-edge accent */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#D26D53]/30 to-transparent" />

            <div className="p-5">
              {/* Emoji + step counter */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-[22px] leading-none select-none">{cur.emoji}</span>
                <span className="text-[10px] tracking-[0.15em] uppercase font-semibold text-[#3D3C38]">
                  {step + 1} / {STEPS.length}
                </span>
              </div>

              {/* Title */}
              <h3 className="font-serif text-[17px] leading-tight text-[#FAF9F6] mb-2">
                {cur.title}
              </h3>

              {/* Body */}
              <p className="text-xs text-[#8A887F] leading-relaxed mb-5">
                {cur.body}
              </p>

              {/* Dots + navigation buttons */}
              <div className="flex items-center justify-between gap-3">
                {/* Progress dots */}
                <div className="flex items-center gap-1.5">
                  {STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`rounded-full transition-all duration-200 ${
                        i === step
                          ? "w-5 h-1.5 bg-[#D26D53]"
                          : i < step
                          ? "w-1.5 h-1.5 bg-[#D26D53]/35"
                          : "w-1.5 h-1.5 bg-[#3D3C38]"
                      }`}
                    />
                  ))}
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1.5">
                  {/* Skip text link */}
                  {!isLast && (
                    <button
                      onClick={finish}
                      className="text-[10px] text-[#3D3C38] hover:text-[#65635C] font-medium transition px-1 py-1"
                    >
                      Skip
                    </button>
                  )}

                  {/* Back */}
                  {step > 0 && (
                    <button
                      onClick={prev}
                      className="w-7 h-7 rounded-xl bg-[#2A2924] hover:bg-[#3D3C38] flex items-center justify-center text-[#8A887F] hover:text-[#FAF9F6] transition"
                    >
                      <ChevronLeft size={13} />
                    </button>
                  )}

                  {/* Next / Done */}
                  <button
                    onClick={next}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition ${
                      isLast
                        ? "bg-[#D26D53] hover:bg-[#C05E45] text-white shadow-lg shadow-[#D26D53]/25"
                        : "bg-[#2A2924] hover:bg-[#3D3C38] text-[#FAF9F6]"
                    }`}
                  >
                    {isLast ? (
                      <>
                        Let&apos;s go! <Sparkles size={11} />
                      </>
                    ) : (
                      <>
                        Next <ChevronRight size={12} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
