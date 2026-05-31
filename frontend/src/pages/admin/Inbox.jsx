import { useState, useEffect, useCallback } from "react";
import { Mail, Reply, Sparkles, Check, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

export default function Inbox() {
  const [messages,   setMessages]   = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [expanded,   setExpanded]   = useState(null);
  const [replyForm,  setReplyForm]  = useState(null);  // msg_id being replied to
  const [subject,    setSubject]    = useState("");
  const [body,       setBody]       = useState("");
  const [sending,    setSending]    = useState(false);
  const [aiIntent,   setAiIntent]   = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/portal/inbox", {
        params: { page: p, limit: 25, unread: unreadOnly }
      });
      setMessages(data.messages || []);
      setPagination(data.pagination);
    } catch { toast.error("Failed to load inbox"); }
    finally { setLoading(false); }
  }, [page, unreadOnly]);

  useEffect(() => { load(); }, [page, unreadOnly]); // eslint-disable-line

  const openReply = (msg) => {
    setReplyForm(msg.message_id);
    setSubject(`Re: ${msg.subject || "Your message to PetBill Shield"}`);
    setBody("");
    setAiIntent(`Reply to this message: "${msg.message?.slice(0, 200)}"`);
  };

  const generateAI = async (msg) => {
    setGenerating(true);
    try {
      const { data } = await api.post("/admin/portal/ai-compose", {
        intent:  aiIntent || `Reply to contact form message from ${msg.name}: "${msg.message?.slice(0,300)}"`,
        context: `Original message:\nFrom: ${msg.name} <${msg.email}>\nSubject: ${msg.subject || "(no subject)"}\nMessage:\n${msg.message}`,
        tone: "warm",
      });
      if (data.subject) setSubject(data.subject);
      if (data.plain_body) setBody(data.plain_body);
      toast.success("AI draft ready — review before sending.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "AI generation failed");
    } finally { setGenerating(false); }
  };

  const sendReply = async (msgId) => {
    if (!subject.trim() || !body.trim()) { toast.error("Subject and body required."); return; }
    setSending(true);
    try {
      await api.post(`/admin/portal/inbox/${msgId}/reply`, { subject, body });
      toast.success("Reply sent!");
      setReplyForm(null);
      setMessages(msgs => msgs.map(m =>
        m.message_id === msgId ? { ...m, replied: true } : m
      ));
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Support</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6]">Inbox</h2>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#8A887F] cursor-pointer select-none">
          <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)}
            className="accent-[#D26D53]" />
          Unread only
        </label>
      </div>

      {loading
        ? <div className="text-[#65635C] text-sm animate-pulse">Loading messages…</div>
        : messages.length === 0
        ? <div className="text-center py-16 text-[#65635C]">
            <Mail size={32} className="mx-auto mb-3 opacity-30" />
            <p>No messages{unreadOnly ? " unread" : ""}.</p>
          </div>
        : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <div key={msg.message_id}
              className={`rounded-2xl border overflow-hidden transition ${
                msg.replied ? "border-[#2A2924] bg-[#1A1917]" : "border-[#3D2E1A] bg-[#221D14]"
              }`}
            >
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 px-5 py-4 text-left"
                onClick={() => setExpanded(expanded === msg.message_id ? null : msg.message_id)}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${msg.replied ? "bg-[#556045]" : "bg-[#E6AE2E]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm text-[#FAF9F6]">{msg.name || "(no name)"}</span>
                    <span className="text-xs text-[#65635C] truncate">{msg.email}</span>
                    {msg.replied && <span className="text-[10px] text-[#556045] font-semibold ml-auto shrink-0">Replied</span>}
                  </div>
                  <div className="text-xs text-[#8A887F] truncate mt-0.5">{msg.subject || msg.message?.slice(0, 60)}</div>
                </div>
                <div className="text-xs text-[#65635C] shrink-0">
                  {new Date(msg.created_at).toLocaleDateString()}
                </div>
                {expanded === msg.message_id
                  ? <ChevronUp size={14} className="text-[#65635C] shrink-0" />
                  : <ChevronDown size={14} className="text-[#65635C] shrink-0" />
                }
              </button>

              {/* Expanded content */}
              {expanded === msg.message_id && (
                <div className="px-5 pb-5 border-t border-[#2A2924] space-y-4">
                  <p className="text-sm text-[#C9C6BD] leading-relaxed mt-4 whitespace-pre-wrap">{msg.message}</p>

                  {/* Reply form toggle */}
                  {replyForm !== msg.message_id ? (
                    <button
                      onClick={() => openReply(msg)}
                      className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 transition"
                    >
                      <Reply size={12} /> Reply
                    </button>
                  ) : (
                    <div className="space-y-3 rounded-2xl border border-[#2A2924] bg-[#1A1917] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#FAF9F6]">Reply to {msg.email}</span>
                        <button onClick={() => setReplyForm(null)} className="text-[#65635C] hover:text-[#FAF9F6]"><X size={14} /></button>
                      </div>

                      {/* AI help */}
                      <div className="flex gap-2">
                        <input
                          value={aiIntent} onChange={e => setAiIntent(e.target.value)}
                          placeholder="Brief instruction for AI (optional)…"
                          className="flex-1 rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-xs px-3 py-2 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
                        />
                        <button
                          onClick={() => generateAI(msg)} disabled={generating}
                          className="rounded-xl bg-[#2D2C28] border border-[#3D3C38] hover:bg-[#3F3E39] text-[#E6AE2E] text-xs font-semibold px-3 py-2 inline-flex items-center gap-1.5 disabled:opacity-50 transition"
                        >
                          {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                          AI draft
                        </button>
                      </div>

                      <input
                        value={subject} onChange={e => setSubject(e.target.value)}
                        placeholder="Subject"
                        className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
                      />
                      <textarea
                        value={body} onChange={e => setBody(e.target.value)}
                        rows={6}
                        placeholder="Write your reply here…"
                        className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53] resize-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => sendReply(msg.message_id)} disabled={sending || !body.trim()}
                          className="rounded-xl bg-[#556045] hover:bg-[#445035] text-white text-xs font-semibold px-4 py-2 inline-flex items-center gap-1.5 disabled:opacity-40 transition"
                        >
                          {sending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Send reply
                        </button>
                        <button onClick={() => setReplyForm(null)} className="text-xs text-[#65635C] hover:text-[#FAF9F6]">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-[#65635C] pt-2 border-t border-[#2A2924]">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="hover:text-[#FAF9F6] disabled:opacity-30">← Prev</button>
          <span>Page {page} of {pagination.pages} · {pagination.total} total</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)} className="hover:text-[#FAF9F6] disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  );
}
