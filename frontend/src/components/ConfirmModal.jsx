import { useEffect } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

const toneStyles = {
  danger: {
    iconWrap: "bg-[#FEF0EE] text-[#D26D53] border-[#F2C5B7]",
    confirm: "bg-[#D26D53] hover:bg-[#C05E45] text-white",
  },
  warning: {
    iconWrap: "bg-[#FFF7E2] text-[#B7791F] border-[#F2D28D]",
    confirm: "bg-[#2D2C28] hover:bg-[#3F3E39] text-white",
  },
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  tone = "warning",
  busy = false,
  onCancel,
  onConfirm,
}) {
  const styles = toneStyles[tone] || toneStyles.warning;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#2D2C28]/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => !busy && onCancel?.()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-md rounded-[24px] border border-[#E5E2D9] bg-[#FAF9F6] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${styles.iconWrap}`}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id="confirm-modal-title" className="font-serif-display text-2xl leading-tight text-[#2D2C28]">
                {title}
              </h2>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded-full p-2 text-[#8A887F] transition hover:bg-[#F2F0E9] hover:text-[#2D2C28] disabled:opacity-50"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-[#65635C]">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-[#E5E2D9] bg-white px-4 py-2.5 text-sm font-semibold text-[#65635C] transition hover:bg-[#F2F0E9] hover:text-[#2D2C28] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${styles.confirm}`}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
