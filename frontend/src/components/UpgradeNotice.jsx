import { Lock, ArrowRight, X } from "lucide-react";
import { Link } from "react-router-dom";

export default function UpgradeNotice({
  title = "This feature requires a paid plan.",
  message = "Upgrade to unlock this feature.",
  onDismiss,
}) {
  return (
    <div className="cream-card p-5 border border-[#D26D53]/30 bg-[#FFF7F2]">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-md bg-[#D26D53] text-white inline-flex items-center justify-center shrink-0">
          <Lock size={18} />
        </div>

        <div className="flex-1">
          <div className="eyebrow text-[#D26D53] mb-1">
            Upgrade needed
          </div>

          <h3 className="font-serif-display text-2xl">
            {title}
          </h3>

          <p className="text-sm text-[#65635C] mt-1">
            {message}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Link
              to="/dashboard/pricing"
              className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2"
            >
              Upgrade plan
              <ArrowRight size={14} />
            </Link>

            {onDismiss && (
              <button
                onClick={onDismiss}
                className="btn-ghost rounded-md px-4 py-2 text-sm"
              >
                Not now
              </button>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[#65635C] hover:text-[#2D2C28]"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}