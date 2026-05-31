import { useEffect, useState } from "react";
import api from "../lib/api";
import { TrendingUp, Loader2, PieChart as PieIcon } from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const CATEGORY_COLOR = {
  diagnostic: "#D26D53",
  treatment: "#E4A834",
  medication: "#556045",
  hospitalization: "#8C2D14",
  surgery: "#A23F1F",
  imaging: "#9D8559",
  labwork: "#A2AA92",
  exam: "#65635C",
  vaccine: "#3D4A2C",
  dental: "#6F4B12",
  boarding: "#C49B7A",
  other: "#B5B0A1",
};

export default function SpendTrendsCard({ className = "" }) {
  const [data, setData] = useState(null);
  const [pets, setPets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);
  const [view, setView] = useState("trend");
  const [selectedPetName, setSelectedPetName] = useState("all");

  useEffect(() => {
    async function loadPets() {
      try {
        const res = await api.get("/pets");
        setPets(res.data || []);
      } catch (err) {
        console.error(err);
      }
    }

    loadPets();
  }, []);

  useEffect(() => {
    setLoading(true);

    api
      .get(`/stats/trends?months=${months}`)
      .then((r) => setData(r.data))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [months]);

  const buckets = data?.buckets || [];

  const filteredBuckets =
    selectedPetName === "all"
      ? buckets
      : buckets.map((bucket) => ({
          ...bucket,
          total_usd: bucket.by_pet?.[selectedPetName] || 0,
        }));

  const chartData = filteredBuckets.map((b) => ({
    name: b.label,
    total: b.total_usd || 0,
  }));

  const selectedTotal =
    selectedPetName === "all"
      ? data?.total_usd || 0
      : data?.by_pet_totals?.[selectedPetName] || 0;

  const categoryData = Object.entries(data?.by_category_totals || {})
    .map(([k, v]) => ({ name: k, value: v }))
    .sort((a, b) => b.value - a.value);

  const hasAny = chartData.some((d) => d.total > 0);

  return (
    <div className={`cream-card p-6 ${className}`} data-testid="spend-trends-card">
      <div className="flex items-center justify-between mb-3">
        <div className="eyebrow text-[#D26D53] inline-flex items-center gap-1.5">
          <TrendingUp size={13} /> Spend trends
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5 rounded-md bg-[#FAF9F6] border border-[#E5E2D9]">
            {[
              { v: "trend", label: "Trend", icon: TrendingUp },
              { v: "category", label: "Category", icon: PieIcon },
            ].map((opt) => (
              <button
                key={opt.v}
                onClick={() => setView(opt.v)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded inline-flex items-center gap-1 ${
                  view === opt.v
                    ? "bg-[#2D2C28] text-[#FAF9F6]"
                    : "text-[#65635C]"
                }`}
              >
                <opt.icon size={11} />
                {opt.label}
              </button>
            ))}
          </div>

          <div className="inline-flex p-0.5 rounded-md bg-[#FAF9F6] border border-[#E5E2D9]">
            {[3, 6, 12].map((m) => (
              <button
                key={m}
                onClick={() => setMonths(m)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded ${
                  months === m
                    ? "bg-[#2D2C28] text-[#FAF9F6]"
                    : "text-[#65635C]"
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-baseline gap-3 mb-3">
        <div className="font-serif-display text-3xl tabular-nums">
          ${Number(selectedTotal || 0).toLocaleString()}
        </div>

        <div className="text-xs text-[#65635C]">
          tracked over last {months} months
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[#65635C] inline-flex items-center gap-2 h-[200px]">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : !hasAny && view === "trend" ? (
        <div className="h-[200px] flex flex-col items-center justify-center text-sm text-[#65635C] text-center">
          <p>No invoice records logged for this pet yet.</p>
          <p className="text-xs mt-1">
            Add invoice records under the pet vault to start tracking.
          </p>
        </div>
      ) : view === "trend" ? (
        <div className="h-[200px]" data-testid="spend-chart-trend">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="terracotta" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D26D53" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#D26D53" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="#E5E2D9"
                strokeDasharray="3 3"
                vertical={false}
              />

              <XAxis
                dataKey="name"
                stroke="#65635C"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />

              <YAxis
                stroke="#65635C"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                width={38}
                tickFormatter={(v) => `$${v}`}
              />

              <Tooltip
                contentStyle={{
                  background: "#FAF9F6",
                  border: "1px solid #E5E2D9",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#65635C" }}
                formatter={(v) => [`$${Number(v).toFixed(2)}`, "Spent"]}
              />

              <Area
                type="monotone"
                dataKey="total"
                stroke="#D26D53"
                strokeWidth={2}
                fill="url(#terracotta)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[230px]" data-testid="spend-chart-category">
          {categoryData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[#65635C]">
              No category data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  dataKey="value"
                  nameKey="name"
                  cx="40%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="#FAF9F6"
                >
                  {categoryData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={CATEGORY_COLOR[entry.name] || "#B5B0A1"}
                    />
                  ))}
                </Pie>

                <Tooltip
                  contentStyle={{
                    background: "#FAF9F6",
                    border: "1px solid #E5E2D9",
                    borderRadius: 6,
                    fontSize: 12,
                    textTransform: "capitalize",
                  }}
                  formatter={(v, n) => [`$${Number(v).toFixed(2)}`, n]}
                />

                <Legend
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                  iconType="circle"
                  iconSize={8}
                  formatter={(v) => (
                    <span
                      style={{
                        color: "#2D2C28",
                        textTransform: "capitalize",
                        fontSize: 11,
                      }}
                    >
                      {v}
                    </span>
                  )}
                  wrapperStyle={{ fontSize: 11, paddingLeft: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {view === "trend" && (
        <div className="mt-4 pt-4 border-t border-[#E5E2D9]">
          <div className="flex items-center justify-between mb-3">
            <div className="eyebrow text-[#556045]">By pet</div>

            <select
              value={selectedPetName}
              onChange={(e) => setSelectedPetName(e.target.value)}
              className="bg-transparent border border-[#E5E2D9] rounded-md px-3 py-1.5 text-xs text-[#65635C] focus:outline-none focus:border-[#D26D53]"
            >
              <option value="all">All pets</option>

              {pets.map((pet) => (
                <option key={pet.pet_id} value={pet.name}>
                  {pet.name}
                </option>
              ))}
            </select>
          </div>

          <ul className="space-y-1.5">
            {pets
              .filter((pet) =>
                selectedPetName === "all"
                  ? true
                  : pet.name === selectedPetName
              )
              .map((pet) => {
                const total = data?.by_pet_totals?.[pet.name] || 0;

                return (
                  <li
                    key={pet.pet_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="truncate">{pet.name}</span>

                    <span className="font-mono-clean tabular-nums">
                      ${Number(total).toLocaleString()}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {view === "category" && categoryData.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[#E5E2D9]">
          <div className="eyebrow text-[#556045] mb-2">Top categories</div>

          <ul className="space-y-1.5">
            {categoryData.slice(0, 6).map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between text-sm"
              >
                <span className="inline-flex items-center gap-2 capitalize">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      background: CATEGORY_COLOR[c.name] || "#B5B0A1",
                    }}
                  />
                  {c.name}
                </span>

                <span className="font-mono-clean tabular-nums">
                  ${Number(c.value).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}