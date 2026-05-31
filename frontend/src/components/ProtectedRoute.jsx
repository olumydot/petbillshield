import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Skeleton that matches the dashboard chrome so there's no layout jump
function DashboardSkeleton() {
  return (
    <div className="min-h-screen paper-grain" data-testid="protected-loading">
      {/* Header skeleton */}
      <div className="glass-header sticky top-0 z-40 border-b border-[#E5E2D9]">
        <div className="max-w-[1400px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="w-32 h-6 bg-[#E5E2D9] rounded-lg animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="w-20 h-6 bg-[#E5E2D9] rounded-full animate-pulse" />
            <div className="w-9 h-9 bg-[#E5E2D9] rounded-full animate-pulse" />
          </div>
        </div>
      </div>
      {/* Body skeleton */}
      <div className="max-w-[1400px] mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 py-8">
        {/* Sidebar skeleton */}
        <div className="hidden lg:block lg:col-span-3">
          <div className="rounded-[24px] border border-[#E5E2D9] bg-[#FAF9F6] p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-[#F2F0E9] rounded-xl animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </div>
        {/* Content skeleton */}
        <div className="lg:col-span-9 space-y-4">
          <div className="h-8 w-48 bg-[#E5E2D9] rounded-lg animate-pulse" />
          <div className="h-4 w-72 bg-[#F2F0E9] rounded-lg animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 bg-[#F2F0E9] rounded-[20px] animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
          <div className="h-48 bg-[#F2F0E9] rounded-[20px] animate-pulse mt-2" />
        </div>
      </div>
    </div>
  );
}

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!user) {
    const nextPath = location.pathname + location.search;

    const safeNext =
      nextPath.startsWith("/dashboard/pets/") ||
      nextPath.startsWith("/dashboard/analyze/")
        ? "/dashboard"
        : nextPath;

    localStorage.setItem("petbill_auth_next", safeNext);
    sessionStorage.setItem("petbill_auth_next", safeNext);

    return <Navigate to="/auth" replace />;
  }

  return children;
}