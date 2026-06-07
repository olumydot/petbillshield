import { useEffect, useState } from "react";
import { Share2, Copy, X, Link as LinkIcon, ShieldOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import ConfirmModal from "./ConfirmModal";

export default function ShareAnalysisButton({ analysisId, testIdPrefix = "share" }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState(null);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [expiry, setExpiry] = useState(0); // days; 0 = never

  async function openModal() {
    setOpen(true);
    if (share) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/estimates/${analysisId}/share`, { expires_in_days: expiry || null });
      setShare(data);
    } catch {
      toast.error("Couldn't create share link.");
      setOpen(false);
    } finally { setLoading(false); }
  }

  async function changeExpiry(days) {
    setExpiry(days);
    if (!share) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/estimates/${analysisId}/share`, { expires_in_days: days || null });
      setShare(data);
      toast.success(days ? `Link now expires in ${days} day${days === 1 ? "" : "s"}` : "Link set to never expire");
    } catch {
      toast.error("Couldn't update expiry.");
    } finally { setLoading(false); }
  }

  function expiryLabel(iso) {
    if (!iso) return "Never expires";
    try {
      const d = new Date(iso);
      const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
      return days <= 0 ? "Expired" : `Expires in ${days} day${days === 1 ? "" : "s"} · ${d.toLocaleDateString()}`;
    } catch { return "Never expires"; }
  }

  const url = share ? `${window.location.origin}/share/${share.slug}` : "";

  async function copyUrl() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    catch { toast.error("Copy failed"); }
  }

  async function revoke() {
    if (!share) return;
    setRevoking(true);
    try {
      await api.delete(`/shares/${share.share_id}`);
      toast.success("Link revoked");
      setShare(null);
      setShowRevokeConfirm(false);
      setOpen(false);
    } catch {
      toast.error("Couldn't revoke");
    } finally { setRevoking(false); }
  }

  // Reset share when analysisId changes
  useEffect(() => { setShare(null); }, [analysisId]);

  return (
    <>
      <button onClick={openModal} className="btn-ghost rounded-md px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5" data-testid={`${testIdPrefix}-open-btn`}>
        <Share2 size={13}/> Share
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4" onClick={() => setOpen(false)} data-testid={`${testIdPrefix}-modal`}>
          <div onClick={(e) => e.stopPropagation()} className="bg-[#FAF9F6] rounded-lg p-6 w-full max-w-md border border-[#E5E2D9]">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow text-[#D26D53] mb-1">Share with vet / family</div>
                <h3 className="font-serif-display text-2xl">Read-only share link</h3>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#65635C] hover:text-[#2D2C28]" data-testid={`${testIdPrefix}-close-btn`}><X size={18}/></button>
            </div>
            <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
              Anyone with the link can read this analysis — without signing in. Revoke anytime to instantly cut access.
            </p>

            <div className="mt-5">
              {loading || !share ? (
                <div className="text-sm text-[#65635C] inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin"/>Creating link…</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 cream-card p-3">
                    <LinkIcon size={14} className="text-[#65635C] shrink-0"/>
                    <input
                      readOnly
                      value={url}
                      className="flex-1 bg-transparent text-xs font-mono-clean text-[#2D2C28] focus:outline-none"
                      data-testid={`${testIdPrefix}-url`}
                      onFocus={(e) => e.target.select()}
                    />
                    <button onClick={copyUrl} className="btn-primary rounded-md px-3 py-1.5 text-xs inline-flex items-center gap-1.5" data-testid={`${testIdPrefix}-copy-btn`}>
                      <Copy size={13}/> Copy
                    </button>
                  </div>
                  <div className="mt-4">
                    <label className="text-[11px] font-semibold text-[#8A887F] uppercase tracking-wider block mb-1.5">Link expiry</label>
                    <select
                      value={expiry}
                      onChange={(e) => changeExpiry(Number(e.target.value))}
                      className="w-full rounded-xl border border-[#E5E2D9] bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#D26D53]/40"
                      data-testid={`${testIdPrefix}-expiry`}
                    >
                      <option value={0}>Never expires</option>
                      <option value={1}>1 day</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                    </select>
                  </div>
                  <p className="text-xs text-[#65635C] mt-3 flex items-center justify-between">
                    <span>Views so far: <span className="font-mono-clean">{share.view_count || 0}</span></span>
                    <span className="text-[#8A887F]">{expiryLabel(share.expires_at)}</span>
                  </p>
                </>
              )}
            </div>

            {share && (
              <div className="mt-5 flex items-center justify-end gap-2">
                <button onClick={() => setShowRevokeConfirm(true)} disabled={revoking} className="btn-ghost rounded-md px-3 py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-70" data-testid={`${testIdPrefix}-revoke-btn`}>
                  <ShieldOff size={13}/> Revoke link
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={showRevokeConfirm}
        title="Revoke share link?"
        description="People with this link will no longer be able to view the analysis."
        confirmLabel={revoking ? "Revoking..." : "Revoke link"}
        tone="danger"
        busy={revoking}
        onCancel={() => setShowRevokeConfirm(false)}
        onConfirm={revoke}
      />
    </>
  );
}
