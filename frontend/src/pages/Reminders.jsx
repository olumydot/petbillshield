import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import {
  Bell,
  Plus,
  Loader2,
  Trash2,
  MailCheck,
  MailX,
  Clock,
  Send,
  Pencil,
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  PawPrint,
  X,
  BellRing,
  Stethoscope,
  ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useBilling } from "../lib/billing";

function toLocalInput(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function relativeLabel(iso) {
  if (!iso) return "";
  const now = new Date();
  const d = new Date(iso);
  const diff = d - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  if (diff < 0) {
    if (mins < 60) return `${mins}m overdue`;
    if (hours < 24) return `${hours}h overdue`;
    return `${days}d overdue`;
  }
  if (mins < 60) return `in ${mins}m`;
  if (hours < 24) return `in ${hours}h`;
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function groupReminders(items) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const weekEnd = new Date(todayStart.getTime() + 7 * 86400000);

  const overdue = items.filter(
    (r) => r.status === "pending" && new Date(r.scheduled_for) < now
  );
  const today = items.filter((r) => {
    const d = new Date(r.scheduled_for);
    return r.status === "pending" && d >= now && d < tomorrowStart;
  });
  const thisWeek = items.filter((r) => {
    const d = new Date(r.scheduled_for);
    return r.status === "pending" && d >= tomorrowStart && d < weekEnd;
  });
  const upcoming = items.filter((r) => {
    const d = new Date(r.scheduled_for);
    return r.status === "pending" && d >= weekEnd;
  });
  const done = items.filter(
    (r) => r.status === "sent" || r.status === "cancelled" || r.status === "failed"
  );
  return { overdue, today, thisWeek, upcoming, done };
}

const REMINDER_TYPES = [
  { v: "vaccine", label: "Vaccine" },
  { v: "medication", label: "Medication refill" },
  { v: "vet_visit", label: "Vet visit" },
  { v: "lab_work", label: "Lab work" },
  { v: "follow_up", label: "Follow-up" },
  { v: "grooming", label: "Grooming" },
  { v: "other", label: "Other" },
];

export default function Reminders() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [pets, setPets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedPetFilter, setSelectedPetFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [buildingPlan, setBuildingPlan] = useState(false);
  const [planPetId, setPlanPetId] = useState("");
  const { billing } = useBilling();

  const isFreeTier =
    !billing?.active ||
    billing?.plan_id === "free" ||
    billing?.plan_id === "free_tier";

  const blankForm = () => ({
    pet_id: "",
    type: "other",
    title: "",
    message: "",
    scheduled_for: toLocalInput(
      new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    ),
    email: "",
    repeat: "none",
  });

  const [form, setForm] = useState(blankForm());

  async function load() {
    setLoading(true);
    try {
      const [remindersRes, petsRes] = await Promise.allSettled([
        api.get("/reminders"),
        api.get("/pets"),
      ]);
      if (remindersRes.status === "fulfilled") {
        setItems(remindersRes.value.data || []);
      } else if (remindersRes.reason?.response?.status === 403) {
        setItems([]);
      } else {
        toast.error("Could not load reminders.");
      }
      if (petsRes.status === "fulfilled") {
        setPets(petsRes.value.data || []);
      } else if (petsRes.reason?.response?.status === 403) {
        setPets([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setEditingId(null);
    setForm(blankForm());
    setOpen(true);
  }

  function openEdit(r) {
    setEditingId(r.reminder_id);
    setForm({
      pet_id: r.pet_id || "",
      type: r.type || "other",
      title: r.title || "",
      message: r.message || "",
      scheduled_for: toLocalInput(r.scheduled_for),
      email: r.email || "",
      repeat: r.repeat || "none",
    });
    setOpen(true);
  }

  function planDate(daysFromNow) {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  async function buildPreventivePlan() {
    const pet = pets.find((p) => p.pet_id === planPetId) || pets[0];
    if (!pet) return toast.error("Add a pet before building a care plan.");

    const existing = items.filter((r) => r.pet_id === pet.pet_id && r.status === "pending");
    const hasMatch = (pattern) => existing.some((r) => pattern.test(`${r.title} ${r.message}`));
    const templates = [
      {
        type: "vet_visit",
        title: "Annual wellness exam",
        message: "Routine yearly checkup. Confirm vaccine status, weight, dental health, and any preventive care questions with your vet.",
        scheduled_for: planDate(30),
        repeat: "yearly",
        pattern: /annual|wellness|exam/i,
      },
      {
        type: "grooming",
        title: "Dental health check",
        message: "Review teeth, gums, breath, and whether a professional cleaning or dental estimate is needed.",
        scheduled_for: planDate(45),
        repeat: "yearly",
        pattern: /dental|teeth|oral/i,
      },
      {
        type: "medication",
        title: "Flea, tick, or heartworm refill",
        message: "Check preventive supply and ask your vet if dosing or product choice should change.",
        scheduled_for: planDate(14),
        repeat: "monthly",
        pattern: /flea|tick|heartworm|parasite/i,
      },
      {
        type: "follow_up",
        title: "Monthly care budget check",
        message: "Review new bills, claim opportunities, refill costs, and upcoming appointments for this pet.",
        scheduled_for: planDate(7),
        repeat: "monthly",
        pattern: /budget|claim opportunities|care budget/i,
      },
    ];

    const toCreate = templates.filter((item) => !hasMatch(item.pattern));
    if (toCreate.length === 0) {
      return toast.success(`${pet.name} already has the starter preventive reminders.`);
    }

    setBuildingPlan(true);
    try {
      await Promise.all(toCreate.map((item) => api.post("/reminders", {
        pet_id: pet.pet_id,
        type: item.type,
        title: item.title,
        message: item.message,
        scheduled_for: item.scheduled_for,
        repeat: item.repeat,
      })));
      toast.success(`Created ${toCreate.length} preventive reminder${toCreate.length === 1 ? "" : "s"} for ${pet.name}.`);
      setSelectedPetFilter(pet.pet_id);
      await load();
    } catch {
      toast.error("Could not build the preventive care plan.");
    } finally {
      setBuildingPlan(false);
    }
  }

  async function save() {
    if (!form.title) return toast.error("Give your reminder a title");
    if (!form.scheduled_for) return toast.error("Pick a date and time");
    setSaving(true);
    try {
      const iso = new Date(form.scheduled_for).toISOString();
      const payload = {
        pet_id: form.pet_id || null,
        type: form.type,
        title: form.title,
        message: form.message,
        scheduled_for: iso,
        email: form.email || undefined,
        repeat: form.repeat || "none",
      };
      if (editingId) {
        await api.put(`/reminders/${editingId}`, payload);
        toast.success("Reminder updated");
      } else {
        await api.post("/reminders", payload);
        toast.success("Reminder scheduled");
      }
      setOpen(false);
      setEditingId(null);
      setForm(blankForm());
      load();
    } catch {
      toast.error("Couldn't save reminder");
    } finally {
      setSaving(false);
    }
  }

  async function removeRem(id) {
    try {
      await api.delete(`/reminders/${id}`);
      setItems((arr) => arr.filter((x) => x.reminder_id !== id));
      toast.success("Reminder deleted");
    } catch {
      toast.error("Could not delete reminder");
    }
  }

  async function dispatchNow() {
    setDispatching(true);
    try {
      const { data } = await api.post("/reminders/dispatch-now");
      toast.success(
        `Processed ${data?.processed ?? 0} due reminder${data?.processed === 1 ? "" : "s"}`
      );
      load();
    } catch {
      toast.error("Couldn't dispatch reminders");
    } finally {
      setDispatching(false);
    }
  }

  const filtered =
    selectedPetFilter === "all"
      ? items
      : items.filter((r) => r.pet_id === selectedPetFilter);

  const groups = useMemo(() => groupReminders(filtered), [filtered]);

  const stats = useMemo(() => {
    const overdue = items.filter(
      (r) => r.status === "pending" && new Date(r.scheduled_for) < new Date()
    ).length;
    const pending = items.filter((r) => r.status === "pending").length;
    const sent = items.filter((r) => r.status === "sent").length;
    return { total: items.length, pending, overdue, sent };
  }, [items]);

  useEffect(() => {
    if (!planPetId && pets.length > 0) {
      setPlanPetId(pets[0].pet_id);
    }
  }, [pets, planPetId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-40 rounded-[34px] bg-[#2D2C28] animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((x) => (
            <div key={x} className="cream-card h-20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-16" data-testid="reminders-page">
      <section className="relative overflow-hidden rounded-[34px] bg-[#2D2C28] text-[#FAF9F6] p-7 sm:p-10">
        <div className="absolute right-[-60px] top-[-60px] h-[240px] w-[240px] rounded-full bg-[#D26D53]/20 blur-3xl" />
        <div className="absolute left-[-60px] bottom-[-60px] h-[220px] w-[220px] rounded-full bg-[#556045]/25 blur-3xl" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-7">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white/75">
              <Bell size={14} />
              {t("reminders.eyebrow")}
            </div>

            <h1 className="mt-5 font-serif-display text-5xl sm:text-6xl leading-[0.95]">
              {t("reminders.title")}
            </h1>

            <p className="mt-4 text-sm text-white/70 max-w-xl leading-relaxed">
              {t("reminders.subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={openNew}
              className="rounded-2xl bg-[#D26D53] hover:bg-[#BD5D44] text-white px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 shadow-lg transition"
            >
              <Plus size={16} />
              {t("reminders.add_reminder")}
            </button>

            <button
              onClick={dispatchNow}
              disabled={dispatching}
              className="rounded-2xl border border-white/15 bg-white/10 hover:bg-white/15 text-white px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 transition disabled:opacity-60"
              data-testid="dispatch-now-btn"
            >
              {dispatching ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Send size={15} />
              )}
              Send due now
            </button>
          </div>
        </div>

        <div className="relative z-10 mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat
            label="Total"
            value={stats.total}
            icon={Bell}
            tone="neutral"
          />
          <MiniStat
            label="Pending"
            value={stats.pending}
            icon={Clock}
            tone="neutral"
          />
          <MiniStat
            label="Overdue"
            value={stats.overdue}
            icon={AlertTriangle}
            tone={stats.overdue > 0 ? "alert" : "neutral"}
          />
          <MiniStat
            label="Sent"
            value={stats.sent}
            icon={MailCheck}
            tone="green"
          />
        </div>
      </section>

      <section className="rounded-[30px] bg-[#FAF9F6] border border-[#E5E2D9] p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="max-w-2xl">
            <div className="eyebrow text-[#D26D53] mb-1">Preventive care plan</div>
            <h2 className="font-serif-display text-2xl leading-tight">Create a starter routine in one click</h2>
            <p className="text-sm text-[#65635C] mt-1 leading-relaxed">
              Premium users can seed yearly wellness, yearly dental, monthly parasite-prevention, and monthly budget check reminders.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              value={planPetId}
              onChange={(e) => setPlanPetId(e.target.value)}
              className="rounded-2xl border border-[#E5E2D9] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#D26D53]"
            >
              {pets.length === 0 ? (
                <option value="">Add a pet first</option>
              ) : pets.map((pet) => (
                <option key={pet.pet_id} value={pet.pet_id}>{pet.name}</option>
              ))}
            </select>
            <button
              onClick={buildPreventivePlan}
              disabled={buildingPlan || pets.length === 0}
              className="rounded-2xl bg-[#556045] hover:bg-[#49533C] text-white px-5 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 transition disabled:opacity-60"
            >
              {buildingPlan ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}
              Build plan
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          {[
            ["Annual wellness", "yearly"],
            ["Dental check", "yearly"],
            ["Parasite refill", "monthly"],
            ["Care budget check", "monthly"],
          ].map(([title, cadence]) => (
            <div key={title} className="rounded-2xl bg-white border border-[#E5E2D9] p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#2D2C28]">
                <Stethoscope size={14} className="text-[#D26D53]" />
                {title}
              </div>
              <div className="text-xs text-[#8A887F] mt-1 capitalize">{cadence} reminder</div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <PawPrint size={15} className="text-[#8A887F]" />
          <select
            value={selectedPetFilter}
            onChange={(e) => setSelectedPetFilter(e.target.value)}
            className="rounded-2xl border border-[#E5E2D9] bg-[#FAF9F6] px-4 py-2.5 text-sm outline-none focus:border-[#D26D53]"
          >
            <option value="all">All pets</option>
            {pets.map((pet) => (
              <option key={pet.pet_id} value={pet.pet_id}>
                {pet.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setShowDone((v) => !v)}
          className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
            showDone
              ? "border-[#556045] bg-[#E7EBDD] text-[#556045]"
              : "border-[#E5E2D9] bg-[#FAF9F6] text-[#65635C]"
          }`}
        >
          {showDone ? "Hide" : "Show"} completed ({groups.done.length})
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState onAdd={openNew} />
      ) : (
        <div className="space-y-6">
          {groups.overdue.length > 0 && (
            <ReminderGroup
              title={t("reminders.overdue")}
              subtitle={t("reminders.status_pending")}
              tone="alert"
              items={groups.overdue}
              pets={pets}
              onEdit={openEdit}
              onDelete={removeRem}
            />
          )}

          {groups.today.length > 0 && (
            <ReminderGroup
              title={t("reminders.today")}
              subtitle={t("reminders.due_soon")}
              tone="warn"
              items={groups.today}
              pets={pets}
              onEdit={openEdit}
              onDelete={removeRem}
            />
          )}

          {groups.thisWeek.length > 0 && (
            <ReminderGroup
              title={t("reminders.upcoming")}
              subtitle={t("reminders.in_days", {count: 7})}
              tone="normal"
              items={groups.thisWeek}
              pets={pets}
              onEdit={openEdit}
              onDelete={removeRem}
            />
          )}

          {groups.upcoming.length > 0 && (
            <ReminderGroup
              title={t("reminders.upcoming")}
              subtitle={t("reminders.status_pending")}
              tone="normal"
              items={groups.upcoming}
              pets={pets}
              onEdit={openEdit}
              onDelete={removeRem}
            />
          )}

          {showDone && groups.done.length > 0 && (
            <ReminderGroup
              title={t("reminders.status_sent")}
              subtitle={t("reminders.status_cancelled")}
              tone="done"
              items={groups.done}
              pets={pets}
              onEdit={openEdit}
              onDelete={removeRem}
            />
          )}
        </div>
      )}

      {open && (
        <ReminderModal
          form={form}
          setForm={setForm}
          saving={saving}
          editingId={editingId}
          pets={pets}
          onSave={save}
          onClose={() => {
            setOpen(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }) {
  const colors = {
    neutral: "bg-white/10 border-white/10 text-white/60",
    alert: "bg-[#D26D53]/30 border-[#D26D53]/30 text-[#F4A58A]",
    green: "bg-[#556045]/30 border-[#556045]/30 text-[#A8C29A]",
    warn: "bg-[#E6AE2E]/20 border-[#E6AE2E]/20 text-[#E6AE2E]",
  };

  return (
    <div
      className={`rounded-2xl border p-4 backdrop-blur ${colors[tone] || colors.neutral}`}
    >
      <div className="flex items-center gap-2 text-xs">
        <Icon size={13} />
        {label}
      </div>
      <div className="font-serif-display text-3xl mt-2 text-white">
        {value}
      </div>
    </div>
  );
}

function ReminderGroup({ title, subtitle, tone, items, pets, onEdit, onDelete }) {
  const toneStyles = {
    alert: {
      dot: "bg-[#D26D53]",
      title: "text-[#D26D53]",
      badge: "bg-[#FFF7F2] text-[#D26D53] border-[#F4A58A]",
    },
    warn: {
      dot: "bg-[#E6AE2E]",
      title: "text-[#8A5A22]",
      badge: "bg-[#FEF9E7] text-[#8A5A22] border-[#E6AE2E]/40",
    },
    normal: {
      dot: "bg-[#556045]",
      title: "text-[#2D2C28]",
      badge: "bg-[#E7EBDD] text-[#556045] border-[#B7C3A4]",
    },
    done: {
      dot: "bg-[#8A887F]",
      title: "text-[#65635C]",
      badge: "bg-[#F2F0E9] text-[#65635C] border-[#D9D5CC]",
    },
  };

  const s = toneStyles[tone] || toneStyles.normal;

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
        <span className={`font-semibold text-sm ${s.title}`}>{title}</span>
        <span
          className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${s.badge}`}
        >
          {items.length}
        </span>
        {subtitle && (
          <span className="text-xs text-[#8A887F] hidden sm:inline">
            · {subtitle}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {items.map((r) => (
          <ReminderCard
            key={r.reminder_id}
            r={r}
            tone={tone}
            pets={pets}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}

function ReminderCard({ r, tone, pets, onEdit, onDelete }) {
  const isOverdue = tone === "alert";
  const isToday = tone === "warn";
  const isDone = tone === "done";
  const petObj = pets.find((p) => p.pet_id === r.pet_id);
  const when = new Date(r.scheduled_for);
  const rel = relativeLabel(r.scheduled_for);

  return (
    <div
      className={`group relative rounded-[24px] border p-5 transition-all hover:shadow-md ${
        isOverdue
          ? "border-[#D26D53]/40 bg-[#FFF7F2]"
          : isToday
          ? "border-[#E6AE2E]/35 bg-[#FEF9E7]"
          : isDone
          ? "border-[#E5E2D9] bg-[#F8F5EF] opacity-65"
          : "border-[#E5E2D9] bg-[#FAF9F6] hover:border-[#D26D53]/40"
      }`}
      data-testid={`reminder-${r.reminder_id}`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-2xl inline-flex items-center justify-center shrink-0 ${
            isOverdue
              ? "bg-[#D26D53] text-white"
              : isToday
              ? "bg-[#E6AE2E] text-white"
              : isDone
              ? "bg-[#F2F0E9] text-[#8A887F]"
              : "bg-[#F2E5DE] text-[#D26D53]"
          }`}
        >
          {isOverdue || isToday ? (
            <BellRing size={20} className={isOverdue ? "animate-pulse" : ""} />
          ) : isDone ? (
            r.status === "sent" ? (
              <MailCheck size={20} />
            ) : (
              <MailX size={20} />
            )
          ) : (
            <Bell size={20} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-[#2D2C28]">
              {r.title}
            </span>

            {petObj && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E7EBDD] text-[#556045] px-2.5 py-0.5 text-[11px] font-semibold">
                <PawPrint size={11} />
                {petObj.name}
              </span>
            )}

            <span
              className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 capitalize ${
                r.status === "sent"
                  ? "bg-[#E7EBDD] text-[#556045]"
                  : r.status === "failed"
                  ? "bg-[#F4DAD3] text-[#8C2D14]"
                  : r.status === "cancelled"
                  ? "bg-[#F2F0E9] text-[#65635C]"
                  : isOverdue
                  ? "bg-[#D26D53] text-white"
                  : "bg-[#E5E2D9] text-[#65635C]"
              }`}
            >
              {isOverdue ? "overdue" : r.status}
            </span>
          </div>

          {r.message && (
            <p className="text-xs text-[#65635C] mt-1.5 leading-relaxed line-clamp-2">
              {r.message}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#65635C]">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={12} />
              {when.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>

            <span
              className={`font-semibold ${
                isOverdue
                  ? "text-[#D26D53]"
                  : isToday
                  ? "text-[#8A5A22]"
                  : "text-[#2D2C28]"
              }`}
            >
              {rel}
            </span>

            {r.email && (
              <span className="inline-flex items-center gap-1">
                <Send size={11} />
                {r.email}
              </span>
            )}

            {r.sent_at && (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={11} className="text-[#556045]" />
                Sent {new Date(r.sent_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isDone && (
            <button
              onClick={() => onEdit(r)}
              className="w-8 h-8 rounded-xl bg-white border border-[#E5E2D9] inline-flex items-center justify-center text-[#65635C] hover:text-[#D26D53] hover:border-[#D26D53] transition"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}

          <button
            onClick={() => onDelete(r.reminder_id)}
            className="w-8 h-8 rounded-xl bg-white border border-[#E5E2D9] inline-flex items-center justify-center text-[#65635C] hover:text-[#8C2D14] hover:border-[#8C2D14] transition"
            title="Delete"
            data-testid={`reminder-del-${r.reminder_id}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div
      className="cream-card rounded-[32px] p-12 text-center"
      data-testid="reminders-empty"
    >
      <div className="w-16 h-16 rounded-3xl bg-[#F2E5DE] text-[#D26D53] inline-flex items-center justify-center mx-auto">
        <Bell size={28} />
      </div>

      <h3 className="font-serif-display text-4xl mt-5">No reminders yet.</h3>

      <p className="text-sm text-[#65635C] mt-3 max-w-md mx-auto leading-relaxed">
        Add a vaccine due date, medication refill, or follow-up visit — we'll
        send you an email reminder so nothing slips through the cracks.
      </p>

      <button
        onClick={onAdd}
        className="mt-6 btn-primary rounded-xl px-6 py-3 text-sm font-semibold inline-flex items-center gap-2"
        data-testid="empty-new-reminder-btn"
      >
        <Plus size={15} />
        Schedule a reminder
      </button>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left max-w-2xl mx-auto">
        {[
          { icon: Bell, t: "Vaccine reminders", d: "Never miss a booster date" },
          {
            icon: Clock,
            t: "Medication refills",
            d: "Stay ahead of prescription renewals",
          },
          { icon: CalendarDays, t: "Lab work & follow-ups", d: "Keep care on schedule" },
        ].map((f) => (
          <div
            key={f.t}
            className="rounded-2xl border border-[#E5E2D9] bg-white/50 p-4"
          >
            <f.icon size={16} className="text-[#D26D53] mb-2" />
            <div className="font-semibold text-sm">{f.t}</div>
            <p className="text-xs text-[#65635C] mt-1">{f.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReminderModal({ form, setForm, saving, editingId, pets, onSave, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2D2C28]/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      data-testid="reminder-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FAF9F6] rounded-[30px] p-6 sm:p-8 w-full max-w-lg border border-[#E5E2D9] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="eyebrow text-[#D26D53] mb-2">
              {editingId ? "Edit reminder" : "New reminder"}
            </div>
            <h3 className="font-serif-display text-3xl leading-none">
              {editingId ? "Update this reminder" : "Schedule an email"}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#F2F0E9] text-[#65635C] hover:text-[#2D2C28] inline-flex items-center justify-center transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pet (optional)">
              <select
                value={form.pet_id}
                onChange={(e) => setForm({ ...form, pet_id: e.target.value })}
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                data-testid="rem-form-pet"
              >
                <option value="">— No pet —</option>
                {pets.map((p) => (
                  <option key={p.pet_id} value={p.pet_id}>
                    {p.name} ({p.species})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
              >
                {REMINDER_TYPES.map((rtype) => (
                  <option key={rtype.v} value={rtype.v}>
                    {rtype.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Rabies vaccine — due"
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
              data-testid="rem-form-title"
            />
          </Field>

          <Field label="Message (optional)">
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              rows={3}
              placeholder="Add context or notes for this reminder…"
              className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53] resize-none"
              data-testid="rem-form-message"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date & time">
              <input
                value={form.scheduled_for}
                onChange={(e) =>
                  setForm({ ...form, scheduled_for: e.target.value })
                }
                type="datetime-local"
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                data-testid="rem-form-when"
              />
            </Field>

            <Field label="Repeat">
              <select
                value={form.repeat || "none"}
                onChange={(e) => setForm({ ...form, repeat: e.target.value })}
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
              >
                <option value="none">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="Override email (optional)">
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                type="email"
                placeholder="Defaults to your account"
                className="w-full rounded-2xl border border-[#E5E2D9] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-[#D26D53]"
                data-testid="rem-form-email"
              />
            </Field>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="btn-ghost rounded-xl px-5 py-3 text-sm"
            data-testid="rem-form-cancel"
          >
            Cancel
          </button>

          <button
            onClick={onSave}
            disabled={saving}
            className="btn-primary rounded-xl px-5 py-3 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-70"
            data-testid="rem-form-save"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Bell size={14} />
                {editingId ? "Update reminder" : "Schedule reminder"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="eyebrow block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
