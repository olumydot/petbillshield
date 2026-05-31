import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

export default function LanguageToggle({ variant = "header" }) {
  const { i18n } = useTranslation();
  const isEN = (i18n.language || "en").startsWith("en");

  function toggle() {
    const next = isEN ? "es" : "en";
    i18n.changeLanguage(next);
    localStorage.setItem("petbill_lang", next);
  }

  const base = "inline-flex items-center gap-1.5 rounded-md text-xs font-semibold transition-colors";
  const cls = variant === "header"
    ? `${base} px-2.5 py-2 border border-[#E5E2D9] hover:bg-[#F2F0E9]`
    : `${base} px-2 py-1 text-[#65635C] hover:text-[#2D2C28]`;

  return (
    <button onClick={toggle} className={cls} data-testid="language-toggle" aria-label="Toggle language">
      <Globe size={13} strokeWidth={1.75} />
      <span className="tabular-nums">{isEN ? "EN" : "ES"}</span>
    </button>
  );
}
