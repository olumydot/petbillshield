import { useState } from "react";
import { Send, Sparkles, Loader2, Users, Check } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import ConfirmModal from "@/components/ConfirmModal";

const SEGMENTS = [
  { id: "newsletter",  label: "Newsletter subscribers",   desc: "Users who opted into the newsletter" },
  { id: "tips_guides", label: "Tips & guides opt-ins",    desc: "Users who opted into weekly tips" },
  { id: "offers",      label: "Offers opt-ins",           desc: "Users who opted into promotions" },
  { id: "paid",        label: "Paid subscribers",         desc: "Active subscribers only" },
  { id: "all",         label: "All users",                desc: "Every registered user (use carefully)" },
];

export default function Broadcast() {
  const [segment,     setSegment]     = useState("newsletter");
  const [audCount,    setAudCount]    = useState(null);
  const [counting,    setCounting]    = useState(false);
  const [subject,     setSubject]     = useState("");
  const [body,        setBody]        = useState("");
  const [intent,      setIntent]      = useState("");
  const [generating,  setGenerating]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [sent,        setSent]        = useState(null);
  const [history,     setHistory]     = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  const checkAudience = async () => {
    setCounting(true);
    try {
      const { data } = await api.get("/admin/portal/broadcast/audience-count", { params: { segment } });
      setAudCount(data.count);
    } catch { toast.error("Couldn't count audience"); }
    finally { setCounting(false); }
  };

  const generateAI = async () => {
    if (!intent.trim()) { toast.error("Describe the intent first."); return; }
    setGenerating(true);
    try {
      const { data } = await api.post("/admin/portal/ai-compose", {
        intent,
        tone: "warm",
        context: `This is a broadcast email to: ${SEGMENTS.find(s => s.id === segment)?.label}`,
      });
      if (data.subject)     setSubject(data.subject);
      if (data.plain_body)  setBody(data.plain_body);
      toast.success("AI draft ready — review before sending.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "AI generation failed");
    } finally { setGenerating(false); }
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) { toast.error("Subject and body required."); return; }
    setSending(true);
    try {
      const { data } = await api.post("/admin/portal/broadcast", {
        subject, html_body: body, plain_body: body, segment
      });
      setSent(data);
      setShowSendConfirm(false);
      toast.success(`Sent to ${data.sent} recipients!`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Broadcast failed");
    } finally { setSending(false); }
  };

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/admin/portal/broadcast/history");
      setHistory(data.campaigns || []);
      setShowHistory(true);
    } catch { toast.error("Couldn't load history"); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <ConfirmModal
        open={showSendConfirm}
        title="Send broadcast?"
        description={`This will email ${SEGMENTS.find(s => s.id === segment)?.label || "the selected audience"}. This cannot be undone.`}
        confirmLabel={sending ? "Sending..." : "Send broadcast"}
        tone="warning"
        busy={sending}
        onCancel={() => setShowSendConfirm(false)}
        onConfirm={send}
      />

      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Communications</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6]">Broadcast email</h2>
        </div>
        <button onClick={loadHistory} className="text-xs text-[#65635C] hover:text-[#FAF9F6] transition">View history</button>
      </div>

      {/* Segment */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-2">Audience</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SEGMENTS.map(s => (
            <button key={s.id} onClick={() => { setSegment(s.id); setAudCount(null); }}
              className={`rounded-xl border p-3 text-left transition ${
                segment === s.id
                  ? "border-[#D26D53] bg-[#D26D53]/10"
                  : "border-[#2A2924] bg-[#1A1917] hover:border-[#3D3C38]"
              }`}
            >
              <div className="font-semibold text-sm text-[#FAF9F6]">{s.label}</div>
              <div className="text-xs text-[#65635C] mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={checkAudience} disabled={counting}
            className="rounded-xl border border-[#2A2924] bg-[#1A1917] hover:bg-[#2A2924] text-[#FAF9F6] text-xs px-3 py-1.5 inline-flex items-center gap-1.5 transition disabled:opacity-40"
          >
            {counting ? <Loader2 size={11} className="animate-spin" /> : <Users size={11} />}
            Check audience size
          </button>
          {audCount !== null && (
            <span className="text-sm font-semibold text-[#E6AE2E]">{audCount} recipients</span>
          )}
        </div>
      </div>

      {/* AI assist */}
      <div>
        <label className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-2">AI copywriter</label>
        <div className="flex gap-2">
          <input
            value={intent} onChange={e => setIntent(e.target.value)}
            placeholder="Describe the email (e.g. 'Spring sale 20% off for 3 days')"
            className="flex-1 rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
          />
          <button onClick={generateAI} disabled={generating || !intent.trim()}
            className="rounded-xl bg-[#2D2C28] border border-[#3D3C38] hover:bg-[#3F3E39] text-[#E6AE2E] text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-40 transition"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Generate
          </button>
        </div>
      </div>

      {/* Compose */}
      <div className="space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Subject line</label>
          <input value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Your email subject"
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Body</label>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
            placeholder="Email body (plain text — will be wrapped in PetBill Shield template)…"
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53] resize-none"
          />
        </div>
      </div>

      <button onClick={() => setShowSendConfirm(true)} disabled={sending || !subject.trim() || !body.trim()}
        className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold px-6 py-3 inline-flex items-center gap-2 disabled:opacity-40 transition"
      >
        {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {sending ? "Sending…" : "Send broadcast"}
      </button>

      {sent && (
        <div className="rounded-2xl border border-[#556045]/30 bg-[#556045]/10 p-4 flex items-center gap-3">
          <Check size={16} className="text-[#556045] shrink-0" />
          <span className="text-sm text-[#FAF9F6]">
            Sent to <strong>{sent.sent}</strong> recipients{sent.failed > 0 ? ` (${sent.failed} failed)` : ""}.
          </span>
        </div>
      )}

      {showHistory && history && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold">Broadcast history</div>
          {history.length === 0
            ? <p className="text-sm text-[#65635C]">No campaigns sent yet.</p>
            : history.map(c => (
            <div key={c.campaign_id} className="rounded-xl border border-[#2A2924] bg-[#1A1917] px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-[#FAF9F6]">{c.subject}</div>
                <div className="text-xs text-[#65635C] mt-0.5">
                  {c.segment} · {c.sent ?? c.recipient_count} sent · {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                c.status === "done" ? "bg-[#E8F5EC] text-[#2F6B45]" : "bg-[#3D320A] text-[#E6AE2E]"
              }`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
