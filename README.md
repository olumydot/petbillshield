# PetBill Shield

PetBill Shield is a full-stack pet-care cost transparency app. It helps pet owners upload veterinary estimates or invoices, get a plain-English AI breakdown, organize pet records, compare bills, manage reminders, prepare insurance claims, and handle subscription billing.

## Highlights

- AI vet-bill analysis with line items, urgency, red flags, cost-saving prompts, and questions to ask the vet.
- Pet Vault with profiles, photos, records, health timeline, reminders, and per-pet history.
- Estimate comparison with follow-up Q&A.
- Insurance claim analysis, decision upload, appeal generation, reupload flow, and case closure.
- Stripe subscription billing with plan switching, cancellation, reactivation, and admin-managed promo codes.
- Admin portal for metrics, users, inbox replies, broadcasts, feedback, landing content, promo banners, and Stripe promo codes.
- Public promo banner controlled by admin and shown only on enabled surfaces.

## Tech Stack

| Area | Technology |
|---|---|
| Frontend | React 19, React Router 7, Tailwind CSS, Radix UI, lucide-react |
| Backend | FastAPI, Pydantic, Motor, APScheduler, slowapi |
| Database | MongoDB |
| AI | Anthropic Claude |
| Billing | Stripe subscriptions, embedded checkout, promotion codes |
| Email | Resend |
| Auth | Email/password sessions and Google OAuth |
| PDFs | pypdf, reportlab |

## Project Structure

```text
backend/
  app/
    main.py                 FastAPI app, middleware, route registration
    shared.py               settings, models, auth helpers, plan config
    routes/
      auth_routes.py
      billing_routes.py
      claim_routes.py
      content_routes.py
      estimate_routes.py
      admin_portal_routes.py
      ...
frontend/
  src/
    pages/                  route-level React screens
    pages/admin/            admin portal sections
    components/             shared UI and billing components
    context/                auth context
    lib/                    api, billing, cms helpers
backend/tests/              pytest suites
test_reports/               generated test reports
```

## Local Setup

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8002
```

The API runs at `http://localhost:8002`. Interactive docs are available at `http://localhost:8002/docs` when not in production.

### Frontend

```bash
cd frontend
npm install
npm start
```

The React app runs at `http://localhost:3000` by default.

## Environment Variables

### Backend

| Variable | Purpose |
|---|---|
| `ENV` | Set to `production` in production |
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name |
| `ANTHROPIC_API_KEY` | Claude API key |
| `STRIPE_API_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_VAULT_MONTHLY` | Pet Cost Vault monthly price ID |
| `STRIPE_PRICE_FAMILY_MONTHLY` | Family monthly price ID |
| `STRIPE_PRICE_RESCUE_MONTHLY` | Rescue/Foster monthly price ID |
| `STRIPE_PRICE_VAULT_YEARLY` | Pet Cost Vault yearly price ID |
| `STRIPE_PRICE_FAMILY_YEARLY` | Family yearly price ID |
| `STRIPE_PRICE_RESCUE_YEARLY` | Rescue/Foster yearly price ID |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `FRONTEND_URL` | Public frontend URL |
| `BACKEND_URL` | Public backend URL |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins |
| `RESEND_API_KEY` | Transactional email API key |
| `SENDER_EMAIL` | Sender address |
| `CONTACT_INBOX_EMAIL` | Contact form destination |
| `ADMIN_EMAILS` | Comma-separated admin account emails |
| `MAX_UPLOAD_MB` | Optional upload size limit, default `10` |

### Frontend

| Variable | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | API base URL |
| `REACT_APP_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `REACT_APP_GOOGLE_CLIENT_ID` | Google OAuth client ID |

## Subscription Plans

| Plan | Monthly | Yearly | Key Limits |
|---|---:|---:|---|
| Free | $0 | $0 | 1 pet, 1 bill analysis/month |
| Pet Cost Vault | $8.99 | $89.90 | 2 pets, unlimited estimates, claims, compare |
| Family | $19.99 | $199.90 | 5 pets, household workflows |
| Rescue/Foster | $49.99 | $499.90 | Unlimited pets and rescue tools |

## Promo and Discount Flow

Admins manage promos in `Admin Portal -> Sales & Promos`.

- Create Stripe promotion codes from the admin panel.
- Publish or hide the public promo banner.
- Choose where the banner appears: landing, pricing, billing settings.
- Restrict the promo to selected plan IDs.
- Checkout validates that the submitted promo is currently published, not expired, and allowed for the selected plan.

Public users see the banner only when the admin marks it available. The pricing checkout pre-applies the active published code.

## Admin Portal

The admin portal is available at:

- `/admin-portal`
- `admin.petbillshield.com` when deployed with that subdomain

Admin capabilities include:

- Overview metrics: users, subscribers, MRR/ARR, revenue, content volume, inbox, active promo.
- User detail: pets, estimates, claims, comparisons, reminders, AI usage, billing, notes.
- Inbox: contact-message review and replies.
- Broadcasts: audience targeting and email campaigns.
- Feedback: product feedback review.
- Site content: landing-page CMS content.
- Sales & Promos: Stripe promo codes and public promo banner rules.

## Testing

Focused backend test example:

```bash
PYTHONPATH=backend ./venv/bin/python -m pytest backend/tests/test_route_order.py
```

Frontend production build:

```bash
cd frontend
npm run build
```

Known current warning: `PetTimeline.jsx` has an existing React hook dependency lint warning.

## Deployment Notes

- Use HTTPS in production for Stripe embedded checkout and Google OAuth.
- Configure Stripe webhooks at `/api/webhook/stripe`.
- Ensure MongoDB users have index creation permission.
- Do not expose uploaded bill or claim files publicly; protected upload middleware guards estimates and claims.
- Set `CORS_ORIGINS` explicitly in production.

## License

None
