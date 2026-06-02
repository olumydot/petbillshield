from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi.errors import RateLimitExceeded
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.shared import ROOT_DIR, db, client, os, logger, IS_PRODUCTION, hashlib
from app.routes.auth_routes import router as auth_router
from app.routes.pet_routes import router as pet_router
from app.routes.estimate_routes import router as estimate_router
from app.routes.claim_routes import router as claim_router
from app.routes.script_routes import router as script_router
from app.routes.stats_routes import router as stats_router
from app.routes.billing_routes import router as billing_router, dispatch_renewal_reminders
from app.routes.packet_reminder_routes import router as packet_reminder_router, dispatch_due_reminders
from app.routes.misc_routes import router as misc_router
from app.routes import timeline
from app.routes.forecast_routes import router as forecast_router
from app.routes.pet_premium_features import router as pet_premium_router
from app.routes.user_routes import router as user_router
from app.routes.content_routes import router as content_router
from app.routes.admin_portal_routes import router as admin_portal_router
from app.routes.weekly_report_routes import (
    router as weekly_report_router,
    dispatch_weekly_account_reports,
)



# ── Disable interactive API docs in production ───────────────────────────────
app = FastAPI(
    title="PetBill Shield API",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)
scheduler = None


# ── Security headers middleware ──────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["X-Frame-Options"]         = "DENY"
        response.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"]      = (
            "geolocation=(), microphone=(), camera=(), payment=(self)"
        )
        response.headers["X-XSS-Protection"] = "0"  # disabled in favour of CSP
        if IS_PRODUCTION:
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        # Content-Security-Policy — tight but compatible with Stripe.js + PostHog
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://js.stripe.com https://assets.emergent.sh "
            "https://app.posthog.com https://us.i.posthog.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://api.stripe.com https://us.i.posthog.com "
            "https://*.posthog.com https://demobackend.emergentagent.com; "
            "frame-src https://js.stripe.com https://hooks.stripe.com; "
            "object-src 'none'; "
            "base-uri 'self';"
        )
        return response


app.add_middleware(SecurityHeadersMiddleware)


# ── Auth guard for sensitive upload paths ────────────────────────────────────
# Uploaded vet bills and claims are private — require a valid session cookie.
# Profile pictures (/uploads/profile_pictures/) remain public (used in img tags).
_PROTECTED_UPLOAD_PREFIXES = ("/uploads/estimates/", "/uploads/claims/", "/uploads/profile_pictures/")

class ProtectedUploadsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        is_protected = any(path.startswith(p) for p in (
            "/uploads/estimates/",
            "/uploads/claims/",
        ))
        if is_protected:
            token = request.cookies.get("session_token")
            if not token:
                auth = request.headers.get("Authorization", "")
                if auth.lower().startswith("bearer "):
                    token = auth.split(" ", 1)[1].strip()
            if not token:
                return Response(status_code=401, content="Unauthorized")
            # Quick session check without loading full user
            token_hash = hashlib.sha256(token.encode()).hexdigest()
            from app.shared import db as _db
            session = await _db.user_sessions.find_one({"token_hash": token_hash}, {"_id": 0})
            if not session:
                # Legacy plaintext fallback
                session = await _db.user_sessions.find_one({"session_token": token}, {"_id": 0})
            if not session:
                return Response(status_code=401, content="Unauthorized")
        return await call_next(request)


app.add_middleware(ProtectedUploadsMiddleware)

app.include_router(auth_router, prefix="/api")
app.include_router(pet_router, prefix="/api")
# Register misc before estimate routes so static paths like
# /estimates/compare/ask are not captured by /estimates/{analysis_id}/ask.
app.include_router(misc_router, prefix="/api")
app.include_router(estimate_router, prefix="/api")
app.include_router(claim_router, prefix="/api")
app.include_router(script_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(billing_router, prefix="/api")
app.include_router(packet_reminder_router, prefix="/api")
app.include_router(timeline.router, prefix="/api", tags=["timeline"])
app.include_router(forecast_router, prefix="/api", tags=["forecast"])
app.include_router(pet_premium_router, prefix="/api")
app.include_router(user_router, prefix="/api")
app.include_router(content_router, prefix="/api")
app.include_router(admin_portal_router, prefix="/api")
app.include_router(weekly_report_router, prefix="/api")


@app.get("/api/")
async def root():
    return {"app": "PetBill Shield", "status": "ok"}

uploads_dir = ROOT_DIR / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

async def _rate_limit_handler(request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again in a minute."})

app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# ── CORS — never allow wildcard in production ────────────────────────────────
_raw_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3001,http://localhost:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if IS_PRODUCTION and "*" in _allowed_origins:
    # Safety net: wildcard in production is a misconfiguration
    logger.error("CORS_ORIGINS contains '*' in production — using empty list instead. Set CORS_ORIGINS.")
    _allowed_origins = []

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

@app.on_event("startup")
async def startup_scheduler():
    global scheduler

    await db.estimates.create_index([("user_id", 1), ("created_at", -1)])
    await db.claims.create_index([("user_id", 1), ("created_at", -1)])
    await db.pets.create_index([("user_id", 1)])
    await db.pet_records.create_index([("pet_id", 1), ("created_at", -1)])
    await db.estimate_comparisons.create_index([("user_id", 1), ("created_at", -1)])
    # session_token is no longer stored (we store token_hash instead).
    # Keep a sparse index so any legacy documents are still indexed but new
    # documents (which omit the field) don't collide on null.
    await db.user_sessions.create_index([("session_token", 1)], unique=True, sparse=True)
    await db.estimate_comparisons.create_index([("comparison_id", 1), ("user_id", 1)], unique=True)
    await db.estimate_comparisons.create_index([("pet_id", 1), ("created_at", -1)])
    await db.compare_questions.create_index([("user_id", 1), ("created_at", -1)])
    await db.compare_questions.create_index([("a_id", 1), ("b_id", 1)])
    await db.uploaded_files.create_index([("user_id", 1), ("created_at", -1)])
    await db.uploaded_files.create_index([("linked_id", 1)])
    await db.ai_usage.create_index([("user_id", 1), ("usage_type", 1), ("created_at", -1)])
    await db.pet_health_markers.create_index([("pet_id", 1), ("date", 1)])
    await db.pet_health_markers.create_index([("source_id", 1)])
    await db.scripts.create_index([("user_id", 1), ("created_at", -1)])
    await db.email_change_tokens.create_index([("token_hash", 1)], unique=True)
    await db.email_change_tokens.create_index([("user_id", 1), ("used", 1)])
    await db.site_content.create_index([("key", 1)], unique=True)
    # Vet-bill transparency dataset — real data
    await db.procedure_costs.create_index([("label_lower", 1), ("state", 1), ("city", 1)])
    await db.procedure_costs.create_index([("label_lower", 1), ("pet_species", 1)])
    await db.procedure_costs.create_index([("created_at", -1)])
    # Vet-bill transparency dataset — AI estimates
    await db.procedure_estimates.create_index([("label_lower", 1), ("retired", 1)])
    await db.procedure_estimates.create_index([("created_at", -1)])
    await db.broadcast_campaigns.create_index([("created_at", -1)])
    await db.admin_user_notes.create_index([("user_id", 1), ("created_at", -1)])
    await db.downgrade_notices.create_index([("user_id", 1), ("shown_count", 1), ("dismissed", 1)])
    await db.downgrade_notices.create_index([("notice_id", 1)], unique=True)
    await db.weekly_account_reports.create_index([("user_id", 1), ("week_key", 1)], unique=True)
    await db.weekly_account_reports.create_index([("sent_at", -1)])
    # Security indices
    await db.user_sessions.create_index([("token_hash", 1)], unique=True, sparse=True)
    await db.login_attempts.create_index([("email", 1), ("created_at", -1)])
    await db.login_attempts.create_index(
        [("created_at", 1)], expireAfterSeconds=86400  # auto-purge after 24h
    )
    await db.password_reset_tokens.create_index([("token_hash", 1)], unique=True)
    await db.password_reset_tokens.create_index(
        [("created_at", 1)], expireAfterSeconds=3600   # auto-purge after 1h
    )

    try:
        scheduler = AsyncIOScheduler(timezone="UTC")
        scheduler.add_job(
            dispatch_due_reminders,
            "interval",
            minutes=5,
            id="reminders_dispatch",
            coalesce=True,
            max_instances=1,
        )
        scheduler.add_job(
            dispatch_renewal_reminders,
            "cron",
            hour=9,       # 9 AM UTC daily
            minute=0,
            id="renewal_reminders",
            coalesce=True,
            max_instances=1,
        )
        scheduler.add_job(
            dispatch_weekly_account_reports,
            "cron",
            day_of_week="sun",
            hour=20,
            minute=0,
            timezone="America/Chicago",
            id="weekly_account_reports",
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
        logger.info("APScheduler started — reminder dispatcher every 5 min")
    except Exception as e:
        logger.warning(f"Scheduler failed to start: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    global scheduler
    try:
        if scheduler:
            scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()
