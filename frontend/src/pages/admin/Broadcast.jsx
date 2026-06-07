import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Sparkles, Loader2, Users, Check, ImagePlus, CalendarClock, Trash2, Plus } from "lucide-react";
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

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const [uploadingImg, setUploadingImg] = useState(false);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);

  const insertAtCursor = (snippet) => {
    const el = bodyRef.current;
    if (!el) { setBody((b) => `${b}\n${snippet}\n`); return; }
    const start = el.selectionStart ?? body.length;
    const end   = el.selectionEnd ?? body.length;
    const next  = `${body.slice(0, start)}\n${snippet}\n${body.slice(end)}`;
    setBody(next);
    // restore focus after state update
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + snippet.length + 2; });
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/admin/portal/upload-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Responsive, email-safe <img> with inline styles
      const img = `<img src="${data.url}" alt="" style="max-width:100%;height:auto;display:block;border-radius:8px;margin:16px 0;" />`;
      insertAtCursor(img);
      toast.success("Image inserted into the body.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Image upload failed");
    } finally {
      setUploadingImg(false);
    }
  };

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
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold">Body</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingImg}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2924] bg-[#1A1917] hover:bg-[#2A2924] text-[#E6AE2E] text-xs font-semibold px-2.5 py-1 transition disabled:opacity-40"
            >
              {uploadingImg ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
              {uploadingImg ? "Uploading…" : "Add image"}
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPickImage} className="hidden" />
          </div>
          <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} rows={10}
            placeholder="Email body — plain text becomes paragraphs. Use 'Add image' to insert a hosted image; you can also paste raw HTML (links, <img>, <strong>)."
            className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53] resize-none font-mono"
          />
          <p className="text-[11px] text-[#65635C] mt-1.5">
            Images are hosted publicly and embedded as responsive <code>&lt;img&gt;</code> tags. Send yourself a test first.
          </p>
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

      <ScheduledCampaigns />

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

// ── Recurring newsletter / weekly-tips auto-send ───────────────────────────────
function ScheduledCampaigns() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({
    name: "", segment: "newsletter", cadence: "monthly",
    subject: "", html_body: "", send_dow: 0, send_dom: 1, send_hour: 14, enabled: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/portal/scheduled-campaigns");
      setList(data.campaigns || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.html_body.trim()) {
      toast.error("Name, subject, and body are required."); return;
    }
    setSaving(true);
    try {
      await api.post("/admin/portal/scheduled-campaigns", form);
      toast.success("Scheduled campaign created.");
      setShowForm(false);
      setForm({ name: "", segment: "newsletter", cadence: "monthly", subject: "", html_body: "", send_dow: 0, send_dom: 1, send_hour: 14, enabled: true });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Couldn't create"); }
    finally { setSaving(false); }
  };

  const toggle = async (c) => {
    try { await api.patch(`/admin/portal/scheduled-campaigns/${c.campaign_id}`, { enabled: !c.enabled }); load(); }
    catch { toast.error("Couldn't update"); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try { await api.delete(`/admin/portal/scheduled-campaigns/${c.campaign_id}`); load(); }
    catch { toast.error("Couldn't delete"); }
  };
  const sendNow = async (c) => {
    if (!window.confirm(`Send "${c.name}" to its segment now?`)) return;
    try { const { data } = await api.post(`/admin/portal/scheduled-campaigns/${c.campaign_id}/send-now`); toast.success(`Sent to ${data.sent}`); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Send failed"); }
  };

  const scheduleLabel = (c) =>
    c.cadence === "weekly"
      ? `Every ${DOW[c.send_dow] || "Mon"} at ${String(c.send_hour).padStart(2, "0")}:00 UTC`
      : `Monthly on day ${c.send_dom} at ${String(c.send_hour).padStart(2, "0")}:00 UTC`;

  const inp = "w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]";

  return (
    <div className="border-t border-[#2A2924] pt-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className="text-[#E6AE2E]" />
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold">Scheduled auto-send</div>
        </div>
        <button onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2924] bg-[#1A1917] hover:bg-[#2A2924] text-[#FAF9F6] text-xs font-semibold px-2.5 py-1 transition">
          <Plus size={11} /> New recurring campaign
        </button>
      </div>
      <p className="text-[11px] text-[#65635C]">
        Recurring emails sent automatically to an opted-in segment on a weekly or monthly schedule (checked hourly, UTC).
      </p>

      {showForm && (
        <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] p-4 space-y-3">
          <input className={inp} placeholder="Internal name (e.g. Monthly newsletter)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
              {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select className={inp} value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {form.cadence === "weekly" ? (
              <select className={inp} value={form.send_dow} onChange={(e) => setForm({ ...form, send_dow: Number(e.target.value) })}>
                {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            ) : (
              <input className={inp} type="number" min={1} max={28} value={form.send_dom} onChange={(e) => setForm({ ...form, send_dom: Number(e.target.value) })} placeholder="Day of month (1–28)" />
            )}
            <input className={inp} type="number" min={0} max={23} value={form.send_hour} onChange={(e) => setForm({ ...form, send_hour: Number(e.target.value) })} placeholder="Hour (UTC 0–23)" />
          </div>
          <input className={inp} placeholder="Subject line" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <textarea className={`${inp} resize-none font-mono`} rows={6} placeholder="Body — text becomes paragraphs; raw HTML and <img> allowed." value={form.html_body} onChange={(e) => setForm({ ...form, html_body: e.target.value })} />
          <button onClick={create} disabled={saving}
            className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold px-4 py-2.5 inline-flex items-center gap-2 disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Create campaign
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-[#65635C] text-sm animate-pulse">Loading…</div>
      ) : list.length === 0 ? (
        <p className="text-sm text-[#65635C]">No scheduled campaigns yet.</p>
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <div key={c.campaign_id} className="rounded-xl border border-[#2A2924] bg-[#1A1917] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[#FAF9F6] truncate">{c.name}</div>
                  <div className="text-xs text-[#65635C] mt-0.5">
                    {c.segment} · {scheduleLabel(c)}{c.last_sent_at ? ` · last sent ${new Date(c.last_sent_at).toLocaleDateString()}` : " · never sent"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => toggle(c)}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.enabled ? "bg-[#E8F5EC] text-[#2F6B45]" : "bg-[#2A2924] text-[#8A887F]"}`}>
                    {c.enabled ? "Active" : "Paused"}
                  </button>
                  <button onClick={() => sendNow(c)} className="text-[#65635C] hover:text-[#E6AE2E]" title="Send now"><Send size={13} /></button>
                  <button onClick={() => remove(c)} className="text-[#65635C] hover:text-[#F87171]" title="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
