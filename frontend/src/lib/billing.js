import { useCallback, useEffect, useState } from "react";
import api from "../lib/api";

// ── Stale-while-revalidate billing cache ─────────────────────────────────────
// Fresh TTL: 3 minutes — within this window, the cached value is used as-is
// and no background fetch is triggered.
// Stale TTL: 30 minutes — between 3-30 min the cached value is shown
// immediately (no flash) while a background refresh runs silently.
// After 30 min the cache is considered expired and a hard-loading state is used.
const CACHE_KEY   = "petbill_billing";
const FRESH_TTL   = 3  * 60 * 1000;  // 3 min  — skip background refresh
const STALE_TTL   = 30 * 60 * 1000;  // 30 min — show stale, refresh in bg

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { value: null, stale: false };
    const { v, ts } = JSON.parse(raw);
    const age = Date.now() - ts;
    if (age > STALE_TTL)  return { value: null, stale: false };  // too old
    if (age > FRESH_TTL)  return { value: v,    stale: true  };  // stale but usable
    return               { value: v,    stale: false };           // fresh
  } catch { return { value: null, stale: false }; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ v: data, ts: Date.now() })); } catch {}
}

export function clearBillingCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

/**
 * Hook for user's billing/entitlement state.
 * Uses stale-while-revalidate so paid-tier UI never flashes on page load.
 *
 * Returns: { billing, loading, refresh, checkout, switchPlan, subscribe,
 *            cancelSwitch, cancelPlan, reactivatePlan }
 */
export function useBilling() {
  const { value: cachedValue, stale } = readCache();

  const [billing, setBilling] = useState(cachedValue);
  // loading = true only when there is NO cached value at all (hard loading state)
  // stale values are shown immediately; loading stays false
  const [loading, setLoading] = useState(cachedValue === null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/billing/me");
      writeCache(data);
      setBilling(data);
    } catch (err) {
      // 401 means the session is gone — clear stale cache so next login is clean
      if (err?.response?.status === 401) clearBillingCache();
      // On error, keep whatever we already have displayed (don't blank the UI)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If cache is fresh, skip the API call entirely — no loading, no flash.
    // If stale or absent, refresh (for absent: shows loading skeleton; for stale: runs silently in bg).
    const { stale: isStale, value: hasCached } = readCache();
    if (!hasCached || isStale) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Starts a Stripe checkout for a plan_id and redirects to Stripe-hosted page. */
  const checkout = useCallback(async (plan_id) => {
    const { data } = await api.post("/billing/checkout", {
      plan_id,
      origin_url: window.location.origin,
    });
    if (data?.url) {
      window.location.href = data.url;
    }
  }, []);

  /**
   * Midcycle plan switch for an existing subscriber.
   * Calls POST /billing/switch, then refreshes billing state.
   * Returns the response data; throws on error.
   */
  const switchPlan = useCallback(async (plan_id) => {
    const { data } = await api.post("/billing/switch", { plan_id });
    await refresh();
    return data;
  }, [refresh]);

  /**
   * Creates a Stripe Subscription (incomplete) and returns the client_secret
   * so the frontend can confirm payment with PaymentElement — no redirect.
   * Returns { client_secret, subscription_id, plan_id }.
   */
  const subscribe = useCallback(async (plan_id) => {
    const { data } = await api.post("/billing/subscribe", { plan_id });
    return data;
  }, []);

  /**
   * Cancels a pending end-of-period downgrade.
   * Reverts the Stripe subscription back to the current plan's price and
   * clears the pending_downgrade_* fields. Throws on error.
   */
  const cancelSwitch = useCallback(async () => {
    const { data } = await api.post("/billing/cancel-switch");
    await refresh();
    return data;
  }, [refresh]);

  /**
   * Schedules the subscription to cancel at end of current billing period.
   * User keeps access until then, then reverts to free automatically.
   */
  const cancelPlan = useCallback(async () => {
    const { data } = await api.post("/billing/cancel");
    await refresh();
    return data;
  }, [refresh]);

  /**
   * Removes a scheduled end-of-period cancellation — keeps the subscription active.
   */
  const reactivatePlan = useCallback(async () => {
    const { data } = await api.post("/billing/reactivate");
    await refresh();
    return data;
  }, [refresh]);

  return { billing, loading, refresh, checkout, switchPlan, subscribe, cancelSwitch, cancelPlan, reactivatePlan };
}
