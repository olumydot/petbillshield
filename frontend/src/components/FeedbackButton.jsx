import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquareHeart, X, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";

const CATEGORIES = ["general", "bug", "idea", "praise", "complaint"];

export default function FeedbackButton({ floating = true }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [category, setCategory] = useState("general");
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState("");   // honeypot — never shown to users
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (rating < 1) {
      toast.error("Tap a star to set a rating");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/feedback", {
        rating,
        category,
        comment,
        page: window.location.pathname,
        website,
      });
      toast.success(t("common.feedback_thanks"));
      setOpen(false);
      setRating(0); setHover(0); setComment(""); setCategory("general"); setWebsite("");
    } catch {
      toast.error("Couldn't send feedback");
    } finally {
      setSubmitting(false);
    }
  }

  const triggerCls = floating
    ? "fixed bottom-5 right-5 z-40 bg-[#2D2C28] text-[#FAF9F6] hover:bg-[#3a3935] rounded-full pl-4 pr-5 py-3 text-sm font-semibold shadow-lg inline-flex items-center gap-2 transition-transform hover:-translate-y-0.5"
    : "btn-ghost rounded-md px-3 py-2 text-sm inline-flex items-center gap-2";

  return (
    <>
      <button onClick={() => setOpen(true)} className={triggerCls} data-testid="feedback-open-btn">
        <MessageSquareHeart size={16} strokeWidth={1.75} />
        {t("common.send_feedback")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={() => setOpen(false)} data-testid="feedback-modal">
          <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF9F6] rounded-lg p-6 w-full max-w-md border border-[#E5E2D9]" role="dialog">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow text-[#D26D53] mb-1">PetBill Shield</div>
                <h3 className="font-serif-display text-2xl">{t("common.feedback_title")}</h3>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#65635C] hover:text-[#2D2C28]" data-testid="feedback-close-btn"><X size={18}/></button>
            </div>
            <p className="text-sm text-[#65635C] mt-2 leading-relaxed">{t("common.feedback_subtitle")}</p>

            {/* Honeypot — hidden from real users */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="absolute -left-[9999px] w-px h-px opacity-0"
              aria-hidden="true"
            />

            <div className="mt-5">
              <div className="eyebrow mb-2">Rating</div>
              <div className="flex items-center gap-1" data-testid="feedback-rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(n)}
                    className="p-1"
                    aria-label={`Set rating ${n}`}
                    data-testid={`feedback-star-${n}`}
                  >
                    <Star
                      size={26}
                      strokeWidth={1.5}
                      className={(hover || rating) >= n ? "fill-[#E4A834] text-[#E4A834]" : "text-[#A2AA92]"}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <div className="eyebrow mb-2">{t("common.feedback_category")}</div>
              <div className="flex flex-wrap gap-2" data-testid="feedback-category">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`chip ${category === c ? "bg-[#2D2C28] text-[#FAF9F6] border-[#2D2C28]" : "chip-neutral"}`}
                    data-testid={`feedback-cat-${c}`}
                  >
                    {t(`common.category_${c}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <div className="eyebrow mb-2">{t("common.feedback_comment")}</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder="What worked? What didn't?"
                className="w-full rounded-md border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2 text-sm"
                data-testid="feedback-comment"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn-ghost rounded-md px-4 py-2 text-sm" data-testid="feedback-cancel-btn">{t("common.cancel")}</button>
              <button onClick={submit} disabled={submitting} className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70" data-testid="feedback-submit-btn">
                {submitting ? <><Loader2 size={14} className="animate-spin"/> Sending…</> : t("common.feedback_submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
