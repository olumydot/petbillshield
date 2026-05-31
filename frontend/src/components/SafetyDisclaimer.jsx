import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

export default function SafetyDisclaimer({ compact = false }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-start gap-3 ${compact ? "p-3" : "p-4"} cream-card`}
      data-testid="safety-disclaimer"
    >
      <ShieldAlert size={18} strokeWidth={1.75} className="text-[#556045] mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed text-[#65635C]">
        {t("safety.disclaimer")}
      </p>
    </div>
  );
}
