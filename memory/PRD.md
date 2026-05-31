# PetBill Shield — Product Requirements Document

## Original problem statement
A consumer AI app that helps pet owners review vet estimates, understand invoices, prepare questions, track pet records, and organize insurance / reimbursement claims. NOT a diagnostic tool. Positioning: **"Your second set of eyes before a costly vet decision."** Tagline: **"Understand your vet bill before you pay it."**

App name: **PetBill Shield**.

## Tech stack
- **Frontend**: React 19, Tailwind, Shadcn UI, Lucide icons, Sonner toasts, i18next (EN/ES), Recharts.
- **Backend**: FastAPI (Python 3.11), MongoDB (motor async), APScheduler, slowapi.
- **AI**: Claude Sonnet 4.5 via Emergent Universal LLM Key.
- **Auth**: Emergent-managed Google OAuth (admin via `ADMIN_EMAILS` allowlist).
- **Payments**: Stripe Checkout (one-time fallback via Emergent proxy + subscription-ready code path) + Stripe Customer Portal for self-serve management.
- **Email**: Resend (test sender — production needs domain verification).
- **PDF**: reportlab.

## Implementation timeline
- **v0.1 MVP** — Landing + auth + vault + AI analyzer + claims + scripts · 31/31 tests
- **v0.2 Phase 2** — Stripe checkout + reminders dispatcher + PDF export + EN/ES + camera + feedback pill · 33/33 tests
- **v0.3 Phase 3** — Shareable links + spend trends chart + compare estimates + contact us + admin panel · 23/23 tests
- **v0.4 Phase 4** — Category breakdown + CSV import + rate-limit + honeypot + subscription-ready Stripe · 17/17 tests
- **v0.5 Phase 5** — Stripe Customer Portal + Email PDF to vet + nav-link & syntax-bug fixes · 11/11 tests

**Cumulative: 115/115 backend tests passing.**

## What changed in Phase 5
- **Stripe Customer Portal** — `POST /api/billing/portal` returns a Stripe-hosted portal URL where the user can cancel, change card, view invoices, request refunds. Guarded with a friendly 503 in preview env (sk_test_emergent doesn't reach real Stripe). "Manage subscription" button appears in the Pricing page's active-plan banner.
- **Email PDF packet to vet** — `POST /api/estimates/{id}/email-packet` generates the PDF and sends it via Resend with a polite cover note (from owner's name, addressed to vet). Persists dispatch records in `db.vet_dispatches`. New `Email to my vet` button on the Analysis Detail page.
- **Bug fixes** — Stray `>` token in `FeedbackButton.jsx` (build break) removed. Marketing-nav links (#how, #features, #pricing, #faq) now resolve correctly when the user is on `/contact` or other non-home routes (via `/#hash` Link routing).
- **Platform Q&A**:
  - "Made with Emergent" badge — Removable on paid plans by deleting `<a id="emergent-badge">` in `/app/frontend/public/index.html` (lines 41-85). Required to remain on Free Tier.
  - Self-hosting — Use the "Save to GitHub" button (paid plans) to export the entire codebase; deploy frontend + backend + MongoDB anywhere (DigitalOcean, AWS, Vercel, Railway, etc.).

## Production launch checklist
1. **Resend domain verification** — verify a domain and set `SENDER_EMAIL` accordingly so reminders + vet packet emails + contact replies actually deliver.
2. **Real Stripe** — replace `STRIPE_API_KEY` with a live key; create recurring Prices in Stripe dashboard; set `STRIPE_PRICE_VAULT_MONTHLY`, `STRIPE_PRICE_FAMILY_MONTHLY`, `STRIPE_PRICE_RESCUE_MONTHLY`. The Customer Portal endpoint and subscription-mode checkout both activate automatically.
3. **Stripe webhook signing** — set `STRIPE_WEBHOOK_SECRET` to enable signature verification.
4. **Rate-limit storage** — swap slowapi's in-memory store for Redis on multi-replica deployments.
5. **CORS** — tighten `CORS_ORIGINS` from `*` to your production domain.

## Backlog
### P0
- Webhook signature verification toggle when `STRIPE_WEBHOOK_SECRET` is set
- Refund / cancellation UX flow within the dashboard (in addition to Stripe portal)

### P1
- "Smart weekly digest" email — surface spending anomalies per pet (e.g. medication spend up 38% vs. last quarter)
- Spend-trends drill-down by pet (click a pet → filtered chart + records list)
- Per-share viewer audit log
- Stripe Customer Portal entry from the Dashboard Home (currently only on Pricing)
- Mobile PWA install prompt

### P2
- More languages (PT-BR, FR, DE)
- Embeddable widget for vet clinic websites
- Webhook for clinic PMS integrations
- Router-splitting (server.py is now 2011 lines) into separate modules

## Test credentials
See `/app/memory/test_credentials.md`. Google OAuth — no app passwords. Tests use mongosh-seeded sessions.
