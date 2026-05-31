import { useState } from "react";
import { createPortal } from "react-dom";
import { Mail, X, Loader2, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";

export default function EmailVetButton({ analysisId }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ to_email: "", vet_name: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function close() { setOpen(false); setResult(null); }

  async function submit() {
    if (!form.to_email.trim()) { toast.error("Enter the vet's email"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/estimates/${analysisId}/email-packet`, form);
      setResult(data);
      if (data?.delivered) toast.success("Packet emailed to your vet");
      else toast.error("Email queued but delivery failed — see details");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't send the packet");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost rounded-md px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5" data-testid="email-vet-open-btn">
        <Mail size={13}/> Email to my vet
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#2D2C28]/60 p-4"
            onClick={close}
            data-testid="email-vet-modal"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative z-[10000] w-full max-w-lg rounded-lg bg-[#FAF9F6] border border-[#E5E2D9] p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="eyebrow text-[#D26D53] mb-1">Send to your vet</div>
                  <h3 className="font-serif-display text-2xl">Email the packet</h3>
                </div>
                <button onClick={close} className="text-[#65635C] hover:text-[#2D2C28]">
                  <X size={18} />
                </button>
              </div>

              {result ? (
                <div className="mt-5">
                  <div className="cream-card p-4 flex items-start gap-3">
                    <CheckCircle2
                      className={result.delivered ? "text-[#556045]" : "text-[#8C2D14]"}
                      size={22}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        {result.delivered ? "Packet sent" : "Delivery issue"}
                      </div>
                      <div className="text-xs text-[#65635C] mt-1">
                        {result.delivered
                          ? `${form.to_email} should receive the PDF momentarily.`
                          : result.delivery_error || "The email service couldn't deliver. Try a different address."}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button onClick={close} className="btn-primary rounded-md px-4 py-2 text-sm font-semibold">
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[#65635C] mt-2 leading-relaxed">
                    We'll email the full PDF packet to your vet, with a polite cover note.
                  </p>

                  <div className="mt-4 space-y-3">
                    <Field label="Vet email">
                      <input
                        value={form.to_email}
                        onChange={(e) => setForm({ ...form, to_email: e.target.value })}
                        type="email"
                        placeholder="vet@clinic.com"
                        className="w-full rounded-md border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2 text-sm"
                      />
                    </Field>

                    <Field label="Vet's name (optional)">
                      <input
                        value={form.vet_name}
                        onChange={(e) => setForm({ ...form, vet_name: e.target.value })}
                        placeholder="Dr. Patel"
                        className="w-full rounded-md border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2 text-sm"
                      />
                    </Field>

                    <Field label="Note to add (optional)">
                      <textarea
                        value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        rows={3}
                        placeholder="I'd love to walk through the urgent items at our next appointment."
                        className="w-full rounded-md border border-[#E5E2D9] bg-[#FAF9F6] px-3 py-2 text-sm"
                />
                    </Field>
                  </div>

                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button onClick={close} className="btn-ghost rounded-md px-4 py-2 text-sm">
                      Cancel
                    </button>

                    <button
                      onClick={submit}
                      disabled={busy}
                      className="btn-primary rounded-md px-4 py-2 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
                    >
                      {busy ? (
                        <>
                          <Loader2 size={14} className="animate-spin" /> Sending…
                        </>
                      ) : (
                        <>
                          <Send size={14} /> Send packet
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
          </>
        );
      }

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1">{label}</span>
      {children}
    </label>
  );
}
