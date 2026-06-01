import { useState, useEffect } from "react";
import { Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PetVaultWordmark } from "./PetVaultLogo";
import { fetchCmsContent } from "../lib/cms";

const DASHBOARD_LINKS = [
  { label: "Analyze a bill",   to: "/dashboard/analyze" },
  { label: "Pet vault",        to: "/dashboard/pets" },
  { label: "Health timeline",  to: "/dashboard/timeline" },
  { label: "Reminders",        to: "/dashboard/reminders" },
  { label: "Plans & pricing",  to: "/dashboard/pricing" },
  { label: "Contact us",       to: "/contact" },
];

// ── Brand SVG icons (inline, no external dependency) ─────────────────────────
const SOCIAL_PLATFORMS = [
  {
    key: "twitter",
    label: "X / Twitter",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34l-.04-8.32a8.28 8.28 0 004.84 1.54V5.07a4.85 4.85 0 01-1.03-.38z" />
      </svg>
    ),
  },
  {
    key: "youtube",
    label: "YouTube",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
];

export default function Footer() {
  const { user } = useAuth();
  const [social, setSocial] = useState({});

  useEffect(() => {
    fetchCmsContent().then((data) => {
      if (data?.social_links) setSocial(data.social_links);
    });
  }, []);

  return (
    <footer className="mt-24 border-t border-[#E5E2D9] bg-[#F5F2EB]" data-testid="site-footer">

      {/* ── Social strip ──────────────────────────────────────────────────── */}
      <div className="border-b border-[#E5E2D9]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-widest font-semibold text-[#8A887F]">Follow us</p>
            <p className="text-sm text-[#65635C] mt-0.5">Stay in the loop — tips, updates &amp; pet care insights.</p>
          </div>

          <div className="flex items-center gap-3">
            {SOCIAL_PLATFORMS.map(({ key, label, icon }) => {
              const href = social[key];
              const base = "w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200";
              if (href) {
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className={`${base} bg-white border border-[#E5E2D9] text-[#65635C] hover:bg-[#D26D53] hover:border-[#D26D53] hover:text-white hover:scale-105 shadow-sm hover:shadow-md`}
                  >
                    {icon}
                  </a>
                );
              }
              // Not yet configured — shown dimmed so the layout is always consistent
              return (
                <span
                  key={key}
                  title={`${label} — coming soon`}
                  className={`${base} bg-[#F2F0E9] border border-[#E5E2D9] text-[#C9C6BD] cursor-default select-none`}
                >
                  {icon}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main columns ──────────────────────────────────────────────────── */}
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 pt-12 pb-10 grid grid-cols-1 md:grid-cols-12 gap-10">

        {/* Brand */}
        <div className="md:col-span-6">
          <Link to="/" className="inline-flex">
            <PetVaultWordmark iconSize={30} />
          </Link>

          <p className="mt-4 text-sm text-[#65635C] leading-relaxed max-w-sm">
            Understand your vet bill before you pay it. Plain-English breakdowns,
            polite question scripts, and a vault for every pet you love.
          </p>

          <a
            href="mailto:hello@petbillshield.com"
            className="mt-5 inline-flex items-center gap-1.5 text-sm text-[#65635C] hover:text-[#D26D53] transition"
          >
            <Mail size={13} />
            hello@petbillshield.com
          </a>
        </div>

        {/* Dashboard links */}
        <div className="md:col-span-3">
          <div className="eyebrow mb-4">Dashboard</div>
          <ul className="space-y-2.5 text-sm">
            {DASHBOARD_LINKS.map((l) => (
              <li key={l.to}>
                <Link className="text-[#65635C] hover:text-[#D26D53] transition" to={l.to}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Safety */}
        <div className="md:col-span-3">
          <div className="eyebrow mb-4">Safety first</div>
          <p className="text-xs text-[#65635C] leading-relaxed">
            PetBill Shield does not diagnose pets, does not replace your veterinarian,
            and never tells you to refuse care. For urgent symptoms, seek immediate
            veterinary attention.
          </p>
          <Link
            to={user ? "/dashboard" : "/auth"}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#2D2C28] text-white px-4 py-2.5 text-sm font-semibold hover:bg-[#3F3E39] transition"
            data-testid="footer-cta"
          >
            {user ? "Go to dashboard" : "Get started free"}
          </Link>
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────────── */}
      <div className="border-t border-[#E5E2D9]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8A887F]">
          <span>© {new Date().getFullYear()} PetBill Shield · A second set of eyes for pet owners.</span>
          <span>Powered by AI · Secured by Stripe</span>
        </div>
      </div>

    </footer>
  );
}
