import { useState, useEffect } from "react";
import { Star, MessageSquare } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

const CATS = { general: "#65635C", bug: "#F87171", idea: "#E6AE2E", praise: "#556045", complaint: "#D26D53" };

export default function Feedback() {
  const [data,    setData]    = useState(null);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("all");

  useEffect(() => {
    setLoading(true);
    api.get("/admin/portal/feedback", { params: { page, limit: 40 } })
      .then(({ data }) => setData(data))
      .catch(() => toast.error("Failed to load feedback"))
      .finally(() => setLoading(false));
  }, [page]);

  const rows = (data?.feedback || []).filter(r => filter === "all" || r.category === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold mb-1">Feedback</div>
          <h2 className="text-2xl font-bold text-[#FAF9F6]">
            User feedback
            {data && <span className="text-lg text-[#E6AE2E] ml-2">★ {data.avg_rating?.toFixed(1) || "—"}</span>}
          </h2>
        </div>
        <div className="flex gap-1 flex-wrap">
          {["all", "general", "praise", "idea", "bug", "complaint"].map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={`text-xs px-3 py-1.5 rounded-full capitalize transition ${
                filter === c ? "bg-[#D26D53] text-white" : "border border-[#2A2924] text-[#8A887F] hover:text-[#FAF9F6]"
              }`}
            >{c}</button>
          ))}
        </div>
      </div>

      {/* Rating distribution */}
      {data?.distribution && (
        <div className="rounded-2xl border border-[#2A2924] bg-[#1A1917] p-4 flex items-center gap-6 flex-wrap">
          {[5,4,3,2,1].map(r => {
            const count = data.distribution[String(r)] || 0;
            const max   = Math.max(...Object.values(data.distribution || {1:1}));
            return (
              <div key={r} className="flex items-center gap-2 text-xs">
                <span className="text-[#E6AE2E] w-4 text-right">{r}★</span>
                <div className="w-20 bg-[#2A2924] rounded-full h-1.5">
                  <div className="bg-[#E6AE2E] h-1.5 rounded-full" style={{ width: `${max ? (count/max)*100 : 0}%` }} />
                </div>
                <span className="text-[#65635C]">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {loading
        ? <div className="text-[#65635C] text-sm animate-pulse">Loading…</div>
        : rows.length === 0
        ? <div className="text-center py-16 text-[#65635C]"><MessageSquare size={28} className="mx-auto mb-2 opacity-30" /><p>No feedback yet.</p></div>
        : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="rounded-2xl border border-[#2A2924] bg-[#1A1917] px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[#E6AE2E] text-sm">{Array(r.rating).fill("★").join("")}</span>
                      {r.category && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: `${CATS[r.category] || "#65635C"}20`, color: CATS[r.category] || "#65635C" }}>
                          {r.category}
                        </span>
                      )}
                      {r.page && <span className="text-[10px] text-[#65635C]">{r.page}</span>}
                    </div>
                    {r.comment && <p className="text-sm text-[#C9C6BD] leading-relaxed">{r.comment}</p>}
                    {r.user_email && <div className="text-xs text-[#65635C] mt-1">{r.user_email}</div>}
                  </div>
                  <div className="text-[11px] text-[#65635C] shrink-0">
                    {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }

      {data?.pagination?.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-[#65635C] pt-2 border-t border-[#2A2924]">
          <button disabled={page <= 1} onClick={() => setPage(p => p-1)} className="hover:text-[#FAF9F6] disabled:opacity-30">← Prev</button>
          <span>Page {page} of {data.pagination.pages}</span>
          <button disabled={page >= data.pagination.pages} onClick={() => setPage(p => p+1)} className="hover:text-[#FAF9F6] disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  );
}
