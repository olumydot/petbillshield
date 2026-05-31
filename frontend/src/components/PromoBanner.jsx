/**
 * PromoBanner
 *
 * Shows a dismissible site-wide promotional banner when the admin has it enabled.
 * Fetches from GET /content/promo-banner (public endpoint, no auth required).
 * Dismissed state is persisted in sessionStorage keyed by promo_code so a new
 * promo always shows even if the user previously dismissed a different one.
 */
import { useState, useEffect } from "react";
import { X, Tag, ArrowRight, Sparkles } from "lucide-react";
import api from "../lib/api";

const DISMISS_KEY_PREFIX = "petbill_banner_dismissed_";
const ACTIVE_PROMO_KEY = "petbill_active_promo_code";

export default function PromoBanner({ variant = "full", page = "landing", onPromo }) {
  const [banner,    setBanner]    = useState(null);  // null = loading, false = hidden, object = show
  const [dismissed, setDismissed] = useState(false);
  const [copied,    setCopied]    = useState(false);

  useEffect(() => {
    api.get("/content/promo-banner")
      .then(({ data }) => {
        if (!data?.enabled) {
          localStorage.removeItem(ACTIVE_PROMO_KEY);
          onPromo?.(null);
          setBanner(false);
          return;
        }
        if (Array.isArray(data.display_pages) && !data.display_pages.includes(page)) {
          setBanner(false);
          return;
        }
        // Check if this specific promo was already dismissed in this session
        const key = DISMISS_KEY_PREFIX + (data.promo_code || "default");
        if (sessionStorage.getItem(key) === "1") { setBanner(false); return; }
        setBanner(data);
        if (data.promo_code) {
          localStorage.setItem(ACTIVE_PROMO_KEY, data.promo_code);
          onPromo?.(data);
        }
      })
      .catch(() => setBanner(false));
  }, [page, onPromo]);

  function dismiss() {
    if (!banner) return;
    const key = DISMISS_KEY_PREFIX + (banner.promo_code || "default");
    sessionStorage.setItem(key, "1");
    setDismissed(true);
    setTimeout(() => setBanner(false), 300);
  }

  async function copyCode() {
    if (!banner?.promo_code) return;
    try {
      await navigator.clipboard.writeText(banner.promo_code);
      localStorage.setItem(ACTIVE_PROMO_KEY, banner.promo_code);
      onPromo?.(banner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (!banner) return null;

  // Style map
  const styles = {
    warning: {
      wrap:   "bg-[#E6AE2E] text-[#2D2C28]",
      code:   "bg-[#2D2C28]/15 hover:bg-[#2D2C28]/25 text-[#2D2C28]",
      dismiss:"text-[#2D2C28]/60 hover:text-[#2D2C28]",
      badge:  "bg-[#2D2C28]/10",
    },
    success: {
      wrap:   "bg-[#556045] text-white",
      code:   "bg-white/20 hover:bg-white/30 text-white",
      dismiss:"text-white/60 hover:text-white",
      badge:  "bg-white/10",
    },
    primary: {
      wrap:   "bg-[#D26D53] text-white",
      code:   "bg-white/20 hover:bg-white/30 text-white",
      dismiss:"text-white/60 hover:text-white",
      badge:  "bg-white/10",
    },
    dark: {
      wrap:   "bg-[#2D2C28] text-[#FAF9F6]",
      code:   "bg-white/15 hover:bg-white/25 text-[#FAF9F6]",
      dismiss:"text-white/40 hover:text-white",
      badge:  "bg-white/10",
    },
  };

  const s = styles[banner.style] || styles.warning;

  return (
    <div
      className={`relative transition-all duration-300 ease-out ${
        dismissed ? "opacity-0 max-h-0 overflow-hidden" : "opacity-100"
      } ${s.wrap}`}
      role="banner"
      data-testid="promo-banner"
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap sm:flex-nowrap">

        {/* Icon */}
        <span className={`shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center ${s.badge}`}>
          <Sparkles size={12} />
        </span>

        {/* Title + body */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap text-sm font-medium">
          {banner.title && <span className="font-bold">{banner.title}</span>}
          {banner.discount_display && <span className="font-bold opacity-90">{banner.discount_display}</span>}
          {banner.body  && <span className="opacity-90">{banner.body}</span>}
          {banner.expires_at && (
            <span className="opacity-70 text-xs">
              · Ends {new Date(banner.expires_at).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Promo code chip */}
        {banner.promo_code && (
          <button
            onClick={copyCode}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest transition-colors ${s.code}`}
            title="Click to copy code"
          >
            <Tag size={11} />
            {copied ? "Copied!" : banner.promo_code}
          </button>
        )}

        {/* CTA */}
        {banner.cta_text && (
          <a
            href={banner.cta_href || "/dashboard/pricing"}
            onClick={() => {
              if (banner.promo_code) localStorage.setItem(ACTIVE_PROMO_KEY, banner.promo_code);
            }}
            className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity`}
          >
            {banner.cta_text} <ArrowRight size={11} />
          </a>
        )}

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className={`shrink-0 ml-1 transition-colors ${s.dismiss}`}
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
