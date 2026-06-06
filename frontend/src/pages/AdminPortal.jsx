import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard, Users, Mail, MessageSquare,
  Send, Tag, FileText, LogOut, ShieldCheck,
  Menu, X, ChevronRight, Lock, Loader2, Eye, EyeOff,
  DollarSign, CreditCard, Cpu,
} from "lucide-react";
import { toast } from "sonner";
import api, { API } from "@/lib/api";

import Overview  from "./admin/Overview";
import Revenue   from "./admin/Revenue";
import Billing   from "./admin/Billing";
import AiUsage   from "./admin/AiUsage";
import UsersPage from "./admin/Users";
import Inbox     from "./admin/Inbox";
import Feedback  from "./admin/Feedback";
import Broadcast from "./admin/Broadcast";
import Promos    from "./admin/Promos";
import Content   from "./admin/Content";

// ── Nav definition ────────────────────────────────────────────────────────────
const NAV = [
  { id: "overview",  label: "Overview",        icon: LayoutDashboard },
  { id: "revenue",   label: "Revenue",          icon: DollarSign      },
  { id: "billing",   label: "Billing",          icon: CreditCard      },
  { id: "users",     label: "Users",            icon: Users           },
  { id: "ai_usage",  label: "AI Usage",         icon: Cpu             },
  { id: "inbox",     label: "Inbox",            icon: Mail            },
  { id: "feedback",  label: "Feedback",         icon: MessageSquare   },
  { id: "broadcast", label: "Broadcast",        icon: Send            },
  { id: "promos",    label: "Sales & Promos",   icon: Tag             },
  { id: "content",   label: "Site Content",     icon: FileText        },
];

// ── Tab → component map ───────────────────────────────────────────────────────
const TABS = {
  overview:  <Overview  />,
  revenue:   <Revenue   />,
  billing:   <Billing   />,
  users:     <UsersPage />,
  ai_usage:  <AiUsage   />,
  inbox:     <Inbox     />,
  feedback:  <Feedback  />,
  broadcast: <Broadcast />,
  promos:    <Promos    />,
  content:   <Content   />,
};

// ── Inline sign-in gate (no redirect — safe for subdomain) ───────────────────
function AdminLogin({ onSuccess }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [show,     setShow]     = useState(false);
  const [busy,     setBusy]     = useState(false);

  // Detect ?error=unauthorized left by the Google callback guard
  const urlError = new URLSearchParams(window.location.search).get("error");
  const denied   = urlError === "unauthorized";
  const cleanedRef = useRef(false);
  if (denied && !cleanedRef.current) {
    cleanedRef.current = true;
    // Remove ?error= from the address bar without triggering a re-render
    window.history.replaceState({}, "", window.location.pathname);
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/login", { email, password });
      onSuccess();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Sign-in failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#111110] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#2A2924] bg-[#1A1917] p-8 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#D26D53] flex items-center justify-center">
            <ShieldCheck size={22} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-[#FAF9F6] text-lg">PetBill Shield</div>
            <div className="text-xs text-[#65635C] mt-0.5 uppercase tracking-widest">Admin Portal</div>
          </div>
        </div>

        {/* Rejection banner */}
        {denied && (
          <div className="rounded-xl bg-[#3D1A1A] border border-[#F87171]/30 px-4 py-3 text-xs text-[#F87171] leading-relaxed">
            That Google account is not authorised for admin access.
          </div>
        )}

        {/* Google sign-in */}
        <button
          type="button"
          onClick={() => { window.location.href = `${API}/auth/google/login?next=/admin-portal`; }}
          className="w-full flex items-center justify-center gap-3 rounded-xl border border-[#3D3C38] bg-[#111] hover:bg-[#1E1D1A] text-[#FAF9F6] text-sm font-medium py-2.5 transition"
        >
          {/* Google G logo */}
          <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#2A2924]" />
          <span className="text-[10px] text-[#65635C] uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-[#2A2924]" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Email</span>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus
              className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-[#65635C] font-semibold block mb-1.5">Password</span>
            <div className="relative">
              <input
                type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                required
                className="w-full rounded-xl border border-[#2A2924] bg-[#111] text-[#FAF9F6] text-sm px-3 py-2.5 pr-10 placeholder:text-[#65635C] focus:outline-none focus:ring-1 focus:ring-[#D26D53]"
              />
              <button type="button" onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#65635C] hover:text-[#FAF9F6]">
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
          <button type="submit" disabled={busy}
            className="w-full rounded-xl bg-[#D26D53] hover:bg-[#C05E45] text-white text-sm font-semibold py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-50 transition"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
            {busy ? "Signing in…" : "Sign in to admin"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminPortal() {
  const [checking, setChecking] = useState(true);
  const [authed,   setAuthed]   = useState(false);
  const [tab,      setTab]      = useState("overview");
  const [sideOpen, setSideOpen] = useState(false);

  // ── Auth guard — always self-contained, never redirects away ───────────────
  const checkAuth = () => {
    setChecking(true);
    api.get("/admin/portal/stats")
      .then(() => { setAuthed(true);  setChecking(false); })
      .catch((err) => {
        setChecking(false);
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          setAuthed(false); // show inline login form — never redirect
        } else {
          // Network/server error: let through and let sub-pages surface it
          setAuthed(true);
        }
      });
  };

  useEffect(() => { checkAuth(); }, []); // eslint-disable-line

  if (checking) {
    return (
      <div className="min-h-screen bg-[#111110] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[#65635C]">
          <ShieldCheck size={20} className="animate-pulse text-[#D26D53]" />
          <span className="text-sm">Verifying admin access…</span>
        </div>
      </div>
    );
  }

  // Not authenticated — show inline login (works on both subdomain and /admin-portal)
  if (!authed) {
    return <AdminLogin onSuccess={() => checkAuth()} />;
  }

  function handleLogout() {
    api.post("/auth/logout").catch(() => {});
    setAuthed(false);
  }

  function selectTab(id) {
    setTab(id);
    setSideOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#111110] flex">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      {/* Mobile overlay */}
      {sideOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSideOpen(false)}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-[#0E0D0C] border-r border-[#2A2924] z-30 flex flex-col
          transition-transform duration-300
          ${sideOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 lg:static lg:flex
        `}
      >
        {/* Logo */}
        <div className="px-6 py-5 border-b border-[#2A2924] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#D26D53] flex items-center justify-center">
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div>
              <div className="text-xs font-bold text-[#FAF9F6] leading-none">PetBill Shield</div>
              <div className="text-[9px] uppercase tracking-widest text-[#65635C] mt-0.5">Admin Portal</div>
            </div>
          </div>
          <button
            onClick={() => setSideOpen(false)}
            className="lg:hidden text-[#65635C] hover:text-[#FAF9F6] transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => selectTab(id)}
              className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-all duration-150 group ${
                tab === id
                  ? "text-[#FAF9F6] bg-[#1A1917]"
                  : "text-[#8A887F] hover:text-[#FAF9F6] hover:bg-[#181714]"
              }`}
            >
              <Icon
                size={16}
                className={tab === id ? "text-[#D26D53]" : "text-[#65635C] group-hover:text-[#8A887F]"}
              />
              {label}
              {tab === id && (
                <ChevronRight size={12} className="ml-auto text-[#D26D53]" />
              )}
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-4 py-4 border-t border-[#2A2924]">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm text-[#65635C] hover:text-[#F87171] hover:bg-[#1A1917] transition"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-[#2A2924] bg-[#0E0D0C] flex items-center gap-4 px-5 lg:px-7 shrink-0 sticky top-0 z-10">
          <button
            onClick={() => setSideOpen(true)}
            className="lg:hidden text-[#65635C] hover:text-[#FAF9F6] transition"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2 text-xs text-[#65635C]">
            <div className="w-2 h-2 rounded-full bg-[#556045] animate-pulse" />
            Admin session active
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-5 lg:p-8">
          {TABS[tab] ?? <Overview />}
        </main>
      </div>
    </div>
  );
}
