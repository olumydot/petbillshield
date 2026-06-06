import { useState, useEffect, useCallback } from "react";
import { Search, User, PawPrint, FileSearch, ChevronRight, X, Plus, Download, ArrowDownUp } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const SORT_OPTIONS = [
  { key: "recent",  label: "Newest first" },
  { key: "oldest",  label: "Oldest first" },
  { key: "name",    label: "Name (A–Z)" },
  { key: "renewal", label: "Renewal date" },
];

function Badge({ children, color = "gray" }) {
  const map = {
    green:  "bg-[#E8F5EC] text-[#2F6B45]",
    gray:   "bg-[#2A2924] text-[#8A887F]",
    gold:   "bg-[#3D320A] text-[#E6AE2E]",
    red:    "bg-[#3D1010] text-[#F87171]",
    terracotta: "bg-[#3A1B12] text-[#F0A088]",
    sage:   "bg-[#1E2B18] text-[#A6C48A]",
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[color] || map.gray}`}>
      {children}
    </span>
  );
}

// Map a user's stored plan to a subscription-type group + display badge.
function planGroup(user) {
  const pid = (user?.plan_id || "").toLowerCase();
  const active = user?.subscription_status === "active";
  if (active && pid.includes("vault"))  return { key: "vault",  label: "Vault",  color: "terracotta" };
  if (active && pid.includes("family")) return { key: "family", label: "Family", color: "sage" };
  if (active && pid.includes("rescue")) return { key: "rescue", label: "Rescue", color: "gold" };
  return { key: "free", label: "Free", color: "gray" };
}

const PLAN_FILTERS = [
  { key: "all",    label: "All" },
  { key: "free",   label: "Free" },
  { key: "vault",  label: "Vault" },
  { key: "family", label: "Family" },
  { key: "rescue", label: "Rescue" },
];

export default function Users() {
  const [q,          setQ]          = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [sort,       setSort]       = useState("recent");
  const [groupCounts, setGroupCounts] = useState(null);
  const [users,      setUsers]      = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page,       setPage]       = useState(1);
  const [loading,    setLoading]    = useState(false);
  const [exporting,  setExporting]  = useState(false);
  const [selected,   setSelected]   = useState(null);   // user detail drawer
  const [detail,     setDetail]     = useState(null);
  const [note,       setNote]       = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async (search = q, p = page, plan = planFilter, sortKey = sort) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/portal/users", {
        params: { q: search, plan, sort: sortKey, page: p, limit: 30 },
      });
      setUsers(data.users || []);
      setPagination(data.pagination);
      if (data.group_counts) setGroupCounts(data.group_counts);
    } catch { toast.error("Failed to load users"); }
    finally { setLoading(false); }
  }, [q, page, planFilter, sort]);

  useEffect(() => { load(); }, [page]); // eslint-disable-line
  // debounced search
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); load(q, 1, planFilter, sort); }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  // Re-load immediately when the subscription-type filter changes
  function selectPlanFilter(key) {
    setPlanFilter(key);
    setPage(1);
    load(q, 1, key, sort);
  }

  function selectSort(key) {
    setSort(key);
    setPage(1);
    load(q, 1, planFilter, key);
  }

  // Export the CURRENT filtered group as a CSV download
  async function exportCsv() {
    setExporting(true);
    try {
      const res = await api.get("/admin/portal/users/export.csv", {
        params: { q, plan: planFilter, sort },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `petbillshield-users-${planFilter}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  const openDetail = async (uid) => {
    setSelected(uid);
    setDetail(null);
    try {
      const [d, n] = await Promise.all([
        api.get(`/admin/portal/users/${uid}`),
        api.get(`/admin/portal/users/${uid}/notes`),
      ]);
      setDetail({ ...d.data, notes: n.data.notes || [] });
    } catch { toast.error("Couldn't load user detail"); }
  };

  const addNote = async () => {
    if (!note.trim() || !selected) return;
    setSavingNote(true);
    try {
      await api.post(`/admin/portal/users/${selected}/note`, { note });
      const { data } = await api.get(`/admin/portal/users/${selected}/notes`);
      setDetail((d) => ({ ...d, notes: data.notes || [] }));
      setNote("");
      toast.success("Note added");
    } catch { toast.error("Couldn't save note"); }
    finally { setSavingNote(false); }
  };

  return (
    <div className="flex h-full gap-4">
      {/* List */}
      <div className={`flex flex-col gap-3 ${selected ? "w-1/2" : "w-full"} transition-all duration-200`}>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Subscribers</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6] mb-3">User management</h2>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#65635C]" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-xl border border-[#2A2924] bg-[#1E1D1A] text-[#FAF9F6] pl-9 pr-3 py-2.5 text-sm placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
          />
        </div>

        {/* Group by subscription type */}
        <div className="flex flex-wrap gap-1.5">
          {PLAN_FILTERS.map((f) => {
            const isActive = planFilter === f.key;
            const count = groupCounts ? groupCounts[f.key] : null;
            return (
              <button
                key={f.key}
                onClick={() => selectPlanFilter(f.key)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
                  isActive
                    ? "bg-[#D26D53] border-[#D26D53] text-white"
                    : "bg-[#1E1D1A] border-[#2A2924] text-[#8A887F] hover:text-[#FAF9F6] hover:border-[#3A3833]"
                }`}
              >
                {f.label}
                {count != null && (
                  <span className={`ml-1.5 ${isActive ? "text-white/80" : "text-[#65635C]"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sort + export */}
        <div className="flex items-center justify-between gap-2">
          <div className="relative inline-flex items-center">
            <ArrowDownUp size={12} className="absolute left-2.5 text-[#65635C] pointer-events-none" />
            <select
              value={sort}
              onChange={(e) => selectSort(e.target.value)}
              className="appearance-none rounded-lg border border-[#2A2924] bg-[#1E1D1A] text-[#FAF9F6] text-xs pl-7 pr-7 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#D26D53] cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2A2924] bg-[#1E1D1A] text-[#8A887F] hover:text-[#FAF9F6] hover:border-[#3A3833] text-xs font-semibold px-3 py-1.5 transition disabled:opacity-40"
            title={`Export ${planFilter === "all" ? "all users" : planFilter + " subscribers"} as CSV`}
          >
            <Download size={12} />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>

        {loading
          ? <div className="text-[#65635C] text-sm animate-pulse py-4">Loading…</div>
          : (
          <div className="space-y-1 overflow-y-auto flex-1">
            {users.map((u) => (
              <button
                key={u.user_id}
                onClick={() => openDetail(u.user_id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  selected === u.user_id
                    ? "bg-[#D26D53]/15 border border-[#D26D53]/30"
                    : "hover:bg-[#2A2924]"
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-[#D26D53]/20 flex items-center justify-center text-[#D26D53] text-xs font-bold shrink-0">
                  {(u.name || u.email || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#FAF9F6] truncate">{u.name || "(no name)"}</div>
                  <div className="text-xs text-[#65635C] truncate">{u.email}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => { const g = planGroup(u); return <Badge color={g.color}>{g.label}</Badge>; })()}
                  {u.pet_count > 0      && <Badge color="green">{u.pet_count} pet{u.pet_count !== 1 ? "s" : ""}</Badge>}
                  {u.estimate_count > 0 && <Badge>{u.estimate_count} bills</Badge>}
                  {u.claim_count > 0    && <Badge color="gold">{u.claim_count} claims</Badge>}
                  <ChevronRight size={12} className="text-[#65635C]" />
                </div>
              </button>
            ))}
            {users.length === 0 && <div className="text-[#65635C] text-sm py-8 text-center">No users found.</div>}
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

      {/* Detail drawer */}
      {selected && (
        <div className="w-1/2 rounded-2xl border border-[#2A2924] bg-[#1A1917] overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2924]">
            <h3 className="font-semibold text-[#FAF9F6]">User detail</h3>
            <button onClick={() => { setSelected(null); setDetail(null); }} className="text-[#65635C] hover:text-[#FAF9F6]">
              <X size={16} />
            </button>
          </div>

          {!detail
            ? <div className="flex-1 flex items-center justify-center text-[#65635C] text-sm">Loading…</div>
            : (
            <div className="p-5 space-y-5">
              {/* Profile */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#D26D53]/20 flex items-center justify-center text-[#D26D53] font-bold text-lg shrink-0">
                  {(detail.user?.name || detail.user?.email || "?")[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-[#FAF9F6]">{detail.user?.name || "(no name)"}</div>
                  <div className="text-sm text-[#65635C]">{detail.user?.email}</div>
                  <div className="text-xs text-[#8A887F] mt-0.5">
                    Joined {detail.user?.created_at ? new Date(detail.user.created_at).toLocaleDateString() : "—"}
                    {detail.user?.auth_provider && <> · {detail.user.auth_provider}</>}
                  </div>
                </div>
              </div>

              {/* Counts */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: PawPrint, label: "Pets", value: detail.pets?.length ?? 0, color: "#556045" },
                  { icon: FileSearch, label: "Estimates", value: detail.estimates?.length ?? 0, color: "#D26D53" },
                  { icon: User, label: "Claims", value: detail.claims?.length ?? 0, color: "#E6AE2E" },
                  { icon: FileSearch, label: "Comparisons", value: detail.comparisons?.length ?? 0, color: "#B5936A" },
                  { icon: User, label: "Reminders", value: detail.reminder_count ?? 0, color: "#245EA8" },
                  { icon: User, label: "AI calls", value: detail.ai_usage?.length ?? 0, color: "#8A5A24" },
                ].map(({ icon: Icon, label, value, color }) => (
                  <div key={label} className="rounded-xl bg-[#2A2924] p-3 text-center">
                    <Icon size={14} style={{ color }} className="mx-auto mb-1" />
                    <div className="font-bold text-[#FAF9F6]">{value}</div>
                    <div className="text-[10px] text-[#65635C]">{label}</div>
                  </div>
                ))}
              </div>

              {/* Billing */}
              {detail.billing && Object.keys(detail.billing).length > 0 && (
                <div className="rounded-xl bg-[#2A2924] p-3 text-sm">
                  <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Billing</div>
                  <div className="text-[#FAF9F6]">{detail.billing.plan_label || detail.billing.plan_id || "—"}</div>
                  {detail.billing.entitlement_expires_at && (
                    <div className="text-xs text-[#65635C] mt-1">
                      {detail.billing.cancel_at_period_end ? "Ends" : "Renews"}{" "}
                      {new Date(detail.billing.entitlement_expires_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}

              {/* Recent activity */}
              <div className="rounded-xl bg-[#2A2924] p-3 text-xs">
                <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Recent activity</div>
                <div className="space-y-2">
                  {(detail.estimates || []).slice(0, 3).map((e) => (
                    <div key={e.analysis_id} className="flex justify-between gap-3">
                      <span className="text-[#8A887F] truncate">{e.pet_name || "Bill analysis"}</span>
                      <span className="text-[#FAF9F6] shrink-0">{e.created_at ? new Date(e.created_at).toLocaleDateString() : "—"}</span>
                    </div>
                  ))}
                  {(detail.claims || []).slice(0, 3).map((c) => (
                    <div key={c.claim_id} className="flex justify-between gap-3">
                      <span className="text-[#8A887F] truncate">{c.insurer || "Claim analysis"}</span>
                      <span className="text-[#FAF9F6] shrink-0">{c.claim_status || "analyzed"}</span>
                    </div>
                  ))}
                  {(detail.estimates || []).length === 0 && (detail.claims || []).length === 0 && (
                    <div className="text-[#65635C]">No recent analyses.</div>
                  )}
                </div>
              </div>

              {/* Prefs */}
              {detail.user?.prefs && (
                <div className="rounded-xl bg-[#2A2924] p-3 text-xs">
                  <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Email prefs</div>
                  <div className="space-y-1">
                    {Object.entries(detail.user.prefs).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-[#8A887F] capitalize">{k.replace(/_/g, " ")}</span>
                        <span className={v ? "text-[#556045]" : "text-[#65635C]"}>{v ? "✓ on" : "off"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-2">Admin notes</div>
                {(detail.notes || []).map((n) => (
                  <div key={n.note_id} className="rounded-xl bg-[#2A2924] p-3 text-sm text-[#FAF9F6] mb-2">
                    <p className="leading-relaxed">{n.note}</p>
                    <div className="text-[10px] text-[#65635C] mt-1.5">{new Date(n.created_at).toLocaleString()}</div>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <textarea
                    value={note} onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Add a note about this user…"
                    className="flex-1 rounded-xl border border-[#2A2924] bg-[#1E1D1A] text-[#FAF9F6] text-sm px-3 py-2 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53] resize-none"
                  />
                  <button
                    onClick={addNote} disabled={!note.trim() || savingNote}
                    className="rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white px-3 text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
