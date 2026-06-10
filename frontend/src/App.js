import "@/App.css";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";

import { AuthProvider } from "@/context/AuthContext";
import AuthCallback from "@/components/AuthCallback";
import ProtectedRoute from "@/components/ProtectedRoute";

import Landing from "@/pages/Landing";

const DashboardLayout = lazy(() => import("@/pages/DashboardLayout"));
const DashboardHome = lazy(() => import("@/pages/DashboardHome"));
const Analyze = lazy(() => import("@/pages/Analyze"));
const AnalysisDetail = lazy(() => import("@/pages/AnalysisDetail"));
const Pets = lazy(() => import("@/pages/Pets"));
const PetDetail = lazy(() => import("@/pages/PetDetail"));
const Claims = lazy(() => import("@/pages/Claims"));
const Scripts = lazy(() => import("@/pages/Scripts"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const Reminders = lazy(() => import("@/pages/Reminders"));
const Compare = lazy(() => import("@/pages/Compare"));
const CostEstimator = lazy(() => import("@/pages/CostEstimator"));
const SharedAnalysis = lazy(() => import("@/pages/SharedAnalysis"));
const HouseholdView = lazy(() => import("@/pages/HouseholdView"));
const Contact = lazy(() => import("@/pages/Contact"));
const AuthPage = lazy(() => import("@/pages/AuthPage"));
const PetTimeline = lazy(() => import("@/pages/PetTimeline"));
const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
const RescueFosterHub = lazy(() => import("./pages/RescueFosterHub"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const ChangePasswordPage = lazy(() => import("./pages/ChangePasswordPage"));
const AdminPortal = lazy(() => import("./pages/AdminPortal"));

// Detect admin subdomain — renders the full admin portal regardless of path
const IS_ADMIN_SUBDOMAIN =
  typeof window !== "undefined" &&
  (window.location.hostname.startsWith("admin.") ||
   window.location.hostname === "admin.petbillshield.com");

function AppRouter() {
  const location = useLocation();

  // Admin subdomain: mount the portal at every path
  if (IS_ADMIN_SUBDOMAIN) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <AdminPortal />
      </Suspense>
    );
  }

  // Synchronous URL fragment check (must NOT live in useEffect — race conditions)
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/contact" element={<Contact />} />
      <Route path="/share/:slug" element={<SharedAnalysis />} />
      <Route path="/household/:slug" element={<HouseholdView />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="rescue" element={<RescueFosterHub />} />
        <Route path="analyze" element={<Analyze />} />
        <Route path="analyze/:id" element={<AnalysisDetail />} />
        <Route path="compare" element={<Compare />} />
        <Route path="estimator" element={<CostEstimator />} />
        <Route path="timeline" element={<PetTimeline />} />
        <Route path="pets" element={<Pets />} />
        <Route path="pets/:id" element={<PetDetail />} />
        <Route path="claims" element={<Claims />} />
        <Route path="scripts" element={<Scripts />} />
        <Route path="reminders" element={<Reminders />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="/dashboard/checkout" element={<CheckoutPage />} />
        <Route path="settings" element={<ProfileSettings />} />
        <Route path="change-password" element={<ChangePasswordPage />} />
        <Route path="admin" element={<Navigate to="/admin-portal" replace />} />
      </Route>
      <Route path="/admin" element={<AdminPortal />} />
      <Route path="/admin-panel" element={<AdminPortal />} />
      <Route path="/admin-portal" element={<AdminPortal />} />
      <Route path="*" element={<Landing />} />
    </Routes>
    </Suspense>
  );
}

function RouteFallback() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="h-3 rounded-full bg-[#E5E2D9] overflow-hidden">
          <div className="h-full w-1/2 bg-[#D26D53] animate-pulse rounded-full" />
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster richColors position="top-right" />
          <Analytics />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
