/**
 * Module-level CMS content cache.
 *
 * The first component to call `fetchCmsContent()` fires one network request.
 * Every subsequent caller in the same page session receives the same promise
 * (in-flight dedup) or the resolved data instantly — no duplicate fetches.
 *
 * Session-storage is also used so navigating within the SPA never re-fetches.
 */
import api from "./api";

const SESSION_KEY = "cms_landing_v1";

let _promise = null; // in-flight dedup

export async function fetchCmsContent() {
  // 1. sessionStorage hit — instant, no network
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  // 2. Deduplicate concurrent callers (e.g. Footer + Landing mounting together)
  if (_promise) return _promise;

  _promise = api
    .get("/content/landing")
    .then(({ data }) => {
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
      return data;
    })
    .catch(() => ({}))
    .finally(() => { _promise = null; });

  return _promise;
}

/** Call after an admin saves content so the next render picks up fresh data. */
export function invalidateCmsCache() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  _promise = null;
}
