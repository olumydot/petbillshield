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

  async function openModal() {
    setOpen(true);
    if (share) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/estimates/${analysisId}/share`);
      setShare(data);
    } catch {
      toast.error("Couldn't create share link.");
      setOpen(false);
    } finally { setLoading(false); }
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
                  <p className="text-xs text-[#65635C] mt-3">Views so far: <span className="font-mono-clean">{share.view_count || 0}</span></p>
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
