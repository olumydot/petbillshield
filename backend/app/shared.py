"""PetBill Shield — FastAPI backend
Vet bill analysis, pet vault, insurance claim helper, scripts, billing, reminders, feedback.
Auth via Emergent-managed Google. AI via Claude Sonnet 4.5 (emergentintegrations).
"""
from dotenv import load_dotenv
load_dotenv()
import os
import io
import json
import uuid
import hashlib
import base64
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
from fastapi.staticfiles import StaticFiles
from anthropic import AsyncAnthropic

import httpx
import resend
import stripe as stripe_sdk
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from pypdf import PdfReader
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, HRFlowable

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from passlib.context import CryptContext

from urllib.parse import urlencode
from fastapi.responses import RedirectResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from datetime import datetime, timezone
from fastapi import HTTPException



import csv as csv_module
# TEMP LOCAL DEV STUBS
# Original Emergent imports removed because emergentintegrations is not public.

LlmChat = None
UserMessage = None
ImageContent = None

StripeCheckout = None
CheckoutSessionResponse = None
CheckoutStatusResponse = None
CheckoutSessionRequest = None

# -------------------- Setup --------------------
ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
CLAUDE_MODEL = "claude-sonnet-4-5-20250929"

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3001")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8002")

ENV = os.environ.get("ENV", "development").lower()
IS_PRODUCTION = ENV == "production"

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

FREE_AI_ANALYSES_PER_MONTH = int(os.environ.get("FREE_AI_ANALYSES_PER_MONTH", "1"))
FREE_AI_COMPARES_PER_MONTH = int(os.environ.get("FREE_AI_COMPARES_PER_MONTH", "10"))

# ── Per-plan AI usage limits ─────────────────────────────────────────────────
# None = unlimited monthly, but the daily estimate cap still applies.
# These are monthly call counts per usage_type.
# Adjust here to tune profitability without touching route code.
#
# Cost rough guide (Claude Sonnet): ~$0.04/estimate, ~$0.04/compare,
# ~$0.02/ask, ~$0.02/script, ~$0.04/claim, ~$0.02/timeline_summary
# Worst-case monthly cost: vault ~$1.30 · family ~$3.20 · rescue ~$7.50
AI_PLAN_LIMITS: dict[str, dict[str, int | None]] = {
    # ── Free ($0) ──────────────────────────────────────────
    "free": {
        "estimate":          1,    # advertised: 1/month
        "compare":           0,
        "ask":               0,
        "script":            0,
        "claim":             0,
        "timeline_summary":  0,
        "suggest_reminders": 0,
        "pet_question":      0,
        "forecast":          0,
    },
    # ── Pet Cost Vault ($8.99/mo) ───────────────────────────
    "vault": {
        "estimate":          None, # advertised unlimited (daily cap applies)
        "compare":           10,
        "ask":               15,
        "script":            8,
        "claim":             5,
        "timeline_summary":  5,
        "suggest_reminders": 3,
        "pet_question":      10,
        "forecast":          3,
    },
    # ── Family ($19.99/mo) ──────────────────────────────────
    "family": {
        "estimate":          None,
        "compare":           25,
        "ask":               35,
        "script":            20,
        "claim":             15,
        "timeline_summary":  15,
        "suggest_reminders": 8,
        "pet_question":      20,
        "forecast":          8,
    },
    # ── Rescue / Foster ($49.99/mo) ─────────────────────────
    "rescue": {
        "estimate":          None,
        "compare":           60,
        "ask":               80,
        "script":            50,
        "claim":             35,
        "timeline_summary":  35,
        "suggest_reminders": 20,
        "pet_question":      40,
        "forecast":          15,
    },
}

# Daily soft cap on "unlimited" estimate analyses — prevents a single user
# from running hundreds of analyses in one day.
AI_DAILY_ESTIMATE_CAP: dict[str, int] = {
    "free":   1,
    "vault":  10,
    "family": 15,
    "rescue": 25,
}

# Friendly feature names for error messages
_FEATURE_LABELS: dict[str, str] = {
    "estimate":          "bill analyses",
    "compare":           "estimate comparisons",
    "ask":               "follow-up questions",
    "script":            "question scripts",
    "claim":             "claim analyses",
    "timeline_summary":  "AI health summaries",
    "suggest_reminders": "AI reminder suggestions",
    "pet_question":      "pet questions",
    "forecast":          "cost forecasts",
}

def _plan_tier_key(plan_id: str | None) -> str:
    """Map a plan_id to the AI_PLAN_LIMITS tier key."""
    if not plan_id or plan_id in ("free", "free_tier"):
        return "free"
    if "vault"  in plan_id: return "vault"
    if "family" in plan_id: return "family"
    if "rescue" in plan_id: return "rescue"
    return "free"

UPLOAD_ROOT = ROOT_DIR / "uploads"
ESTIMATE_UPLOAD_DIR = UPLOAD_ROOT / "estimates"
CLAIM_UPLOAD_DIR = UPLOAD_ROOT / "claims"

ESTIMATE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CLAIM_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
RESEND_TEMPLATE_WELCOME = os.environ.get("RESEND_TEMPLATE_WELCOME", "").strip()
RESEND_TEMPLATE_RENEWAL_SUCCESS = os.environ.get("RESEND_TEMPLATE_RENEWAL_SUCCESS", "").strip()
RESEND_TEMPLATE_RENEWAL_REMINDER = os.environ.get("RESEND_TEMPLATE_RENEWAL_REMINDER", "").strip()
RESEND_TEMPLATE_PAYMENT_FAILED = os.environ.get("RESEND_TEMPLATE_PAYMENT_FAILED", "").strip()
RESEND_TEMPLATE_SUBSCRIPTION_CANCELED = os.environ.get("RESEND_TEMPLATE_SUBSCRIPTION_CANCELED", "").strip()
RESEND_TEMPLATE_SUBSCRIPTION_REACTIVATED = os.environ.get("RESEND_TEMPLATE_SUBSCRIPTION_REACTIVATED", "").strip()
RESEND_TEMPLATE_PLAN_CHANGED = os.environ.get("RESEND_TEMPLATE_PLAN_CHANGED", "").strip()
RESEND_TEMPLATE_PASSWORD_RESET = os.environ.get("RESEND_TEMPLATE_PASSWORD_RESET", "").strip()
RESEND_TEMPLATE_VERIFY_EMAIL_CHANGE = os.environ.get("RESEND_TEMPLATE_VERIFY_EMAIL_CHANGE", "").strip()
ADMIN_EMAILS = [e.strip().lower() for e in (os.environ.get('ADMIN_EMAILS', '') or '').split(',') if e.strip()]
CONTACT_INBOX_EMAIL = os.environ.get('CONTACT_INBOX_EMAIL', '')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY
if STRIPE_API_KEY:
    stripe_sdk.api_key = STRIPE_API_KEY

RESEND_TEMPLATE_IDS = {
    "welcome": RESEND_TEMPLATE_WELCOME,
    "renewal_success": RESEND_TEMPLATE_RENEWAL_SUCCESS,
    "renewal_reminder": RESEND_TEMPLATE_RENEWAL_REMINDER,
    "payment_failed": RESEND_TEMPLATE_PAYMENT_FAILED,
    "subscription_canceled": RESEND_TEMPLATE_SUBSCRIPTION_CANCELED,
    "subscription_reactivated": RESEND_TEMPLATE_SUBSCRIPTION_REACTIVATED,
    "plan_changed": RESEND_TEMPLATE_PLAN_CHANGED,
    "password_reset": RESEND_TEMPLATE_PASSWORD_RESET,
    "verify_email_change": RESEND_TEMPLATE_VERIFY_EMAIL_CHANGE,
}


async def send_resend_email(
    *,
    to,
    subject: str,
    html: str | None = None,
    template_key: str | None = None,
    template_variables: dict | None = None,
    reply_to: str | list[str] | None = None,
):
    """
    Send an email through Resend.

    If a template ID is configured for template_key, we send via
    `template: { id, variables }`. Otherwise we fall back to raw HTML.
    """
    if not RESEND_API_KEY:
        logger.debug(f"RESEND not configured — would send '{subject}' to {to}")
        return None

    template_id = RESEND_TEMPLATE_IDS.get(template_key or "", "")
    base = {
        "from": SENDER_EMAIL,
        "to": to,
        "subject": subject,
    }
    if reply_to:
        base["reply_to"] = reply_to

    resend.api_key = RESEND_API_KEY

    # Prefer a configured Resend template, but NEVER let a missing/broken template
    # silently drop the email — fall back to the raw HTML the caller provided.
    if template_id:
        try:
            params = {
                **base,
                "template": {"id": template_id, "variables": template_variables or {}},
            }
            return await asyncio.to_thread(resend.Emails.send, params)
        except Exception as e:
            logger.warning(
                f"Resend template '{template_key}' ({template_id}) failed: {e} — "
                f"falling back to inline HTML."
            )
            if not html:
                raise

    if not html:
        raise ValueError("send_resend_email requires html when no template_id is configured")

    return await asyncio.to_thread(resend.Emails.send, {**base, "html": html})


def _is_admin_email(email: Optional[str]) -> bool:
    if not email:
        return False
    if '*' in ADMIN_EMAILS:
        return True
    return email.lower() in ADMIN_EMAILS

# Plans live ONLY on the backend (never trust frontend pricing)
# All paid plans are Stripe subscriptions. Estimate Defender is now included
# as a feature inside subscription plans, not sold as a one-time product.
PLANS = {
    "vault_monthly": {
        "label": "Pet Cost Vault",
        "amount": 9.99,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 30,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_VAULT_MONTHLY") or None,
        "limits": {
            "pets": 1,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
        },
    },
    "family_monthly": {
        "label": "Family / Multi-pet",
        "amount": 19.99,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 30,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_FAMILY_MONTHLY") or None,
        "limits": {
            "pets": 5,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
        },
    },
    "rescue_monthly": {
        "label": "Rescue / Foster",
        "amount": 49.99,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 30,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_RESCUE_MONTHLY") or None,
        "limits": {
            "pets": None,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
            "reports": True,
        },
    },
    "vault_yearly": {
        "label": "Pet Cost Vault Yearly",
        "amount": 89.90,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 365,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_VAULT_YEARLY") or None,
        "limits": {
            "pets": 1,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
        },
    },

    "family_yearly": {
        "label": "Family / Multi-pet Yearly",
        "amount": 199.90,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 365,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_FAMILY_YEARLY") or None,
        "limits": {
            "pets": 5,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
        },
    },

    "rescue_yearly": {
        "label": "Rescue / Foster Yearly",
        "amount": 499.90,
        "currency": "usd",
        "kind": "subscription",
        "period_days": 365,
        "stripe_price_id": os.environ.get("STRIPE_PRICE_RESCUE_YEARLY") or None,
        "limits": {
            "pets": None,
            "estimate_reviews_per_month": None,
            "ai_insights": True,
            "reminders": True,
            "insurance_claims": True,
            "forecasting": True,
            "reports": True,
        },
    },
}

# Real Stripe API base when subscription mode is enabled (we revert from the
# emergent proxy by clearing api_base in the subscription path).
_STRIPE_PROXY_API_BASE = stripe_sdk.api_base  # capture default; emergentintegrations will mutate this on first use


logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("petbill")

scheduler: Optional[AsyncIOScheduler] = None

# Rate limiter (in-process). For multi-instance deployments, swap to Redis.
limiter = Limiter(key_func=get_remote_address)


pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated="auto"
)




def normalize_password(password: str) -> str:
    # Bcrypt has a 72-byte limit.
    # This turns any password length into a fixed safe string.
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    safe_password = normalize_password(password)
    return pwd_context.hash(safe_password)


def verify_password(password: str, password_hash: str) -> bool:
    safe_password = normalize_password(password)

    # New hashes: verify normalized password
    try:
        if pwd_context.verify(safe_password, password_hash):
            return True
    except Exception:
        pass

    # Old hashes: support users created before this fix
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if not any(c.isupper() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one uppercase letter")

    if not any(c.islower() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one lowercase letter")

    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one number")

    if not any(not c.isalnum() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one symbol")


def make_session_token() -> str:
    return f"sess_{uuid.uuid4().hex}{uuid.uuid4().hex}"


def _hash_session_token(token: str) -> str:
    """One-way hash for storing session tokens in DB — mitigates DB breach exposure."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── Magic-byte validation ────────────────────────────────────────────────────
# Maps declared MIME type → accepted leading byte sequences.
# Used for file upload validation across auth and estimate routes.
_FILE_MAGIC: dict[str, list[bytes]] = {
    "image/jpeg":      [b"\xff\xd8\xff"],
    "image/png":       [b"\x89PNG\r\n\x1a\n"],
    "image/webp":      [b"RIFF"],        # RIFF....WEBP
    "application/pdf": [b"%PDF-"],
}

def check_magic_bytes(contents: bytes, declared_type: str) -> bool:
    """Return True if the file's leading bytes match the declared MIME type."""
    sigs = _FILE_MAGIC.get(declared_type, [])
    return any(contents.startswith(sig) for sig in sigs)


async def create_user_session(user_id: str, response: Response) -> str:
    session_token = make_session_token()
    token_hash    = _hash_session_token(session_token)
    expires_at    = datetime.now(timezone.utc) + timedelta(days=7)

    await db.user_sessions.insert_one({
        "user_id":       user_id,
        "token_hash":    token_hash,          # hashed — never store raw token
        "expires_at":    expires_at.isoformat(),
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "ip":            None,                # filled in later if available
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )

    return session_token

# -------------------- Models --------------------
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime


class SessionExchangeRequest(BaseModel):
    session_id: str


class EmailSignupRequest(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    password: str


class EmailLoginRequest(BaseModel):
    email: EmailStr
    password: str

class Pet(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pet_id: str = Field(default_factory=lambda: f"pet_{uuid.uuid4().hex[:12]}")
    user_id: str
    name: str
    species: Literal["dog", "cat", "rabbit", "bird", "reptile", "horse", "exotic"] = "dog"
    breed: Optional[str] = ""
    age_years: Optional[float] = None
    weight_lbs: Optional[float] = None
    sex: Optional[str] = ""
    chronic_conditions: List[str] = []
    insurance_provider: Optional[str] = ""
    insurance_policy_number: Optional[str] = ""
    vet_clinic_name: Optional[str] = ""
    vet_clinic_phone: Optional[str] = ""
    notes: Optional[str] = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    picture: Optional[str] = ""
    birthday: Optional[str] = ""


class PetCreate(BaseModel):
    name: str
    species: Literal["dog", "cat", "rabbit", "bird", "reptile", "horse", "exotic"] = "dog"
    breed: Optional[str] = ""
    age_years: Optional[float] = None
    weight_lbs: Optional[float] = None
    sex: Optional[str] = ""
    chronic_conditions: List[str] = []
    insurance_provider: Optional[str] = ""
    insurance_policy_number: Optional[str] = ""
    vet_clinic_name: Optional[str] = ""
    vet_clinic_phone: Optional[str] = ""
    notes: Optional[str] = ""
    picture: Optional[str] = ""
    birthday: Optional[str] = ""


RECORD_CATEGORIES = ["diagnostic", "treatment", "medication", "hospitalization", "surgery", "imaging", "labwork", "exam", "vaccine", "dental", "boarding", "insurance", "other"]


class PetRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    record_id: str = Field(default_factory=lambda: f"rec_{uuid.uuid4().hex[:12]}")
    pet_id: str
    user_id: str
    record_type: Literal["vaccine", "medication", "invoice", "reminder", "lab", "visit", "policy", "note"] = "note"
    title: str
    details: Optional[str] = ""
    amount_usd: Optional[float] = None
    date: Optional[str] = ""   # ISO date string for simplicity
    category: Optional[str] = "other"  # one of RECORD_CATEGORIES
    metadata: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PetRecordCreate(BaseModel):
    record_type: Literal["vaccine", "medication", "invoice", "reminder", "lab", "visit", "policy", "note"] = "note"
    title: str
    details: Optional[str] = ""
    amount_usd: Optional[float] = None
    date: Optional[str] = ""
    category: Optional[str] = "other"
    metadata: dict = Field(default_factory=dict)


class EstimateAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")
    analysis_id: str = Field(default_factory=lambda: f"est_{uuid.uuid4().hex[:12]}")
    user_id: str
    pet_id: Optional[str] = None
    pet_name: Optional[str] = ""
    pet_species: Optional[str] = ""
    source_type: Literal["pdf", "image", "text"] = "text"
    original_filename: Optional[str] = ""
    raw_text_excerpt: Optional[str] = ""
    summary: str = ""
    estimated_total_usd: Optional[float] = None
    line_items: List[dict] = []           # {label, amount_usd, urgency, category, notes}
    red_flags: List[dict] = []            # {label, severity, why, ask_the_vet}
    urgent_now: List[str] = []
    can_wait: List[str] = []
    questions_to_ask_vet: List[str] = []
    cost_saving_options: List[str] = []
    second_opinion_checklist: List[str] = []
    disclaimer: str = ""
    saved_to_pet_vault: Optional[bool] = False
    saved_pet_id: Optional[str] = None
    saved_record_id: Optional[str] = None
    saved_to_pet_vault_at: Optional[str] = None
    saved_line_item_keys: List[str] = []
    health_markers_extracted: Optional[bool] = False
    health_markers_saved: Optional[bool] = False
    health_markers_count: Optional[int] = 0
    health_markers_date: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ClaimAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")
    claim_id: str = Field(default_factory=lambda: f"clm_{uuid.uuid4().hex[:12]}")
    user_id: str
    pet_id: Optional[str] = None
    pet_name: Optional[str] = ""
    insurer: Optional[str] = ""
    policy_record_id: Optional[str] = ""
    policy_text_excerpt: Optional[str] = ""
    invoice_text_excerpt: Optional[str] = ""
    likely_reimbursable_categories: List[dict] = []
    likely_excluded: List[dict] = []
    missing_documents: List[str] = []
    estimated_reimbursement_usd: Optional[float] = None
    deductible_note: Optional[str] = ""
    # Pointed questions derived from the specific policy parameters supplied
    pointed_questions: List[dict] = []   # [{question, why, urgency: "high"|"medium"}]
    appeal_draft: Optional[str] = ""
    next_steps: List[str] = []
    disclaimer: str = ""
    # Policy parameters provided by user (stored for display / re-analysis)
    deductible_usd: Optional[float] = None
    deductible_model: Optional[str] = ""    # "annual" | "per_incident"
    deductible_met_usd: Optional[float] = None   # for annual: how much already applied this year
    deductible_status: Optional[str] = ""   # "met" | "partial" | "unmet"
    reimbursement_rate_pct: Optional[int] = None  # e.g. 80
    benefit_limit_usd: Optional[float] = None
    benefit_used_usd: Optional[float] = None     # how much of annual limit already used
    policy_type: Optional[str] = ""
    waiting_period_notes: Optional[str] = ""
    # Track claim journey
    claim_status: Optional[str] = "analyzed"
    submitted_to_insurer: Optional[bool] = False
    submitted_at: Optional[str] = None
    insurer_decision_saved: Optional[bool] = False
    actual_reimbursement_usd: Optional[float] = None
    decision: Optional[dict] = None
    case_closed: Optional[bool] = False
    closed_at: Optional[str] = None
    saved_to_pet_vault: Optional[bool] = False
    saved_pet_id: Optional[str] = None
    saved_record_id: Optional[str] = None
    saved_to_pet_vault_at: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScriptRequest(BaseModel):
    situation: str
    tone: Literal["polite", "firm", "warm", "direct"] = "polite"
    pet_name: Optional[str] = ""
    pet_species: Optional[str] = ""
    estimated_cost_usd: Optional[float] = None


class ScriptResponse(BaseModel):
    script: str
    follow_up_questions: List[str]



class PetQuestionRequest(BaseModel):
    pet_id: str
    question: str


class ClaimQuestionRequest(BaseModel):
    claim_id: str
    question: str


class SaveClaimToVaultRequest(BaseModel):
    pet_id: str
    claim_id: str


class CompareRequest(BaseModel):
    a_id: str
    b_id: str


class CompareQuestionRequest(BaseModel):
    a_id: str
    b_id: str
    question: str
    comparison: Optional[dict] = None



class EstimateComparison(BaseModel):
    model_config = ConfigDict(extra="ignore")

    comparison_id: str = Field(
        default_factory=lambda: f"cmp_{uuid.uuid4().hex[:12]}"
    )

    user_id: str
    pet_id: Optional[str] = None
    pet_name: Optional[str] = ""

    title: Optional[str] = ""

    a_id: str
    b_id: str

    a_snapshot: dict
    b_snapshot: dict

    rows: List[dict] = []

    a_total: Optional[float] = None
    b_total: Optional[float] = None
    total_diff_usd: Optional[float] = None

    recommendation: dict = {}

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


FREE_PLANS = ["free", "free_tier", None]


def get_user_plan(user_doc_or_user):
    if isinstance(user_doc_or_user, dict):
        return (
            user_doc_or_user.get("plan_id")
            or user_doc_or_user.get("subscription_plan")
            or "free"
        )

    return (
        getattr(user_doc_or_user, "plan_id", None)
        or getattr(user_doc_or_user, "subscription_plan", None)
        or "free"
    )


# -------------------- Auth Helpers --------------------
def month_start_iso() -> str:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    return start.isoformat()


def get_pet_limit_for_plan(plan_id: str):
    # Limits must match what is advertised on the pricing/landing page
    if plan_id in ["vault_monthly", "vault_yearly"]:
        return 2          # advertised: "2 pets"

    if plan_id in ["family_monthly", "family_yearly"]:
        return 5          # advertised: "up to 5 pets"

    if plan_id in ["rescue_monthly", "rescue_yearly"]:
        return None       # unlimited

    return 1              # free tier: 1 pet profile



async def user_has_active_plan(user_id: str) -> bool:
    doc = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}

    plan_id = doc.get("plan_id")
    expires_at = doc.get("entitlement_expires_at")

    if not plan_id:
        return False

    if not expires_at:
        return True

    try:
        dt = datetime.fromisoformat(expires_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt > datetime.now(timezone.utc)
    except Exception:
        return False


async def enforce_ai_usage_limit(user: User, usage_type: str):
    """
    Enforce per-plan monthly AI usage limits.

    Free users: hard monthly caps per feature.
    Paid users: monthly caps per feature (None = unlimited monthly, but
                estimates also have a daily soft cap to prevent runaway costs).

    Set DEV_BYPASS_LIMITS=true in .env to skip all checks during development.
    """
    if os.environ.get("DEV_BYPASS_LIMITS", "false").lower() == "true":
        return

    # Resolve the user's plan tier — use entitlement fields, NOT subscription_status.
    # subscription_status can be stale (e.g. "incomplete") even when the user has a
    # valid entitlement_expires_at, so we mirror the logic in require_paid_plan.
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    plan_id_raw  = doc.get("plan_id")
    expires_at   = doc.get("entitlement_expires_at")

    is_entitled = False
    if plan_id_raw and plan_id_raw not in ("free", "free_tier"):
        if not expires_at:
            is_entitled = True          # no expiry = lifetime / not yet set
        else:
            try:
                dt = datetime.fromisoformat(expires_at)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                is_entitled = dt > datetime.now(timezone.utc)
            except Exception:
                is_entitled = False

    raw_plan  = plan_id_raw if is_entitled else None
    tier_key  = _plan_tier_key(raw_plan)
    tier_limits = AI_PLAN_LIMITS.get(tier_key, AI_PLAN_LIMITS["free"])

    monthly_limit = tier_limits.get(usage_type, 0)
    feature_label = _FEATURE_LABELS.get(usage_type, usage_type)

    # ── Zero limit → feature not available on this plan ──────────────────────
    if monthly_limit == 0:
        if tier_key == "free":
            raise HTTPException(
                status_code=403,
                detail=f"This feature requires a paid plan. Upgrade to access {feature_label}.",
            )
        raise HTTPException(
            status_code=403,
            detail=f"{feature_label.capitalize()} are not available on your current plan.",
        )

    now_utc = datetime.now(timezone.utc)
    month_start = datetime(now_utc.year, now_utc.month, 1, tzinfo=timezone.utc).isoformat()

    # ── Unlimited monthly but daily estimate cap applies ─────────────────────
    if monthly_limit is None:
        if usage_type == "estimate":
            daily_cap = AI_DAILY_ESTIMATE_CAP.get(tier_key, 10)
            day_start = datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=timezone.utc).isoformat()
            used_today = await db.ai_usage.count_documents({
                "user_id":    user.user_id,
                "usage_type": "estimate",
                "created_at": {"$gte": day_start},
            })
            if used_today >= daily_cap:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"You've run {used_today} bill analyses today — "
                        f"daily limit is {daily_cap}. Come back tomorrow or contact support."
                    ),
                )
        return  # no monthly cap for this feature on this plan

    # ── Monthly hard cap ──────────────────────────────────────────────────────
    used_this_month = await db.ai_usage.count_documents({
        "user_id":    user.user_id,
        "usage_type": usage_type,
        "created_at": {"$gte": month_start},
    })

    if used_this_month >= monthly_limit:
        if tier_key == "free":
            raise HTTPException(
                status_code=403,
                detail=(
                    f"You've used your {monthly_limit} free {feature_label} for this month. "
                    f"Upgrade to get more."
                ),
            )
        raise HTTPException(
            status_code=429,
            detail=(
                f"You've reached your monthly limit of {monthly_limit} {feature_label} "
                f"on your current plan ({used_this_month}/{monthly_limit} used). "
                f"Limit resets on the 1st of next month."
            ),
        )



async def record_ai_usage(user: User, usage_type: str, linked_id: Optional[str] = None):
    await db.ai_usage.insert_one({
        "usage_id": f"use_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "usage_type": usage_type,
        "linked_id": linked_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

SAFETY_DISCLAIMER = (
    "PetBill Shield does not diagnose pets, does not replace your veterinarian, "
    "and never tells you to refuse care. It helps you understand costs and prepare "
    "questions. For urgent symptoms, seek immediate veterinary care."
)


async def get_current_user(request: Request) -> User:
    """Validate session token from cookie first, then Authorization header."""
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Look up by hashed token first (new sessions), fall back to plaintext (old sessions)
    token_hash = _hash_session_token(token)
    session = await db.user_sessions.find_one({"token_hash": token_hash}, {"_id": 0})
    if not session:
        # Legacy: session created before hashing was introduced
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if session:
            # Migrate on the fly: replace plaintext with hash
            await db.user_sessions.update_one(
                {"session_token": token},
                {"$set": {"token_hash": token_hash}, "$unset": {"session_token": ""}},
            )
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    # normalize datetime
    created_at = user_doc.get("created_at")
    if isinstance(created_at, str):
        user_doc["created_at"] = datetime.fromisoformat(created_at)
    return User(**user_doc)




# Shared reminder models used by pet auto-reminder logic
class Reminder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reminder_id: str = Field(default_factory=lambda: f"rem_{uuid.uuid4().hex[:12]}")
    user_id: str
    pet_id: Optional[str] = None
    pet_name: Optional[str] = ""
    title: str
    message: Optional[str] = ""
    scheduled_for: str
    email: Optional[str] = ""
    status: Literal["pending", "sent", "failed", "cancelled"] = "pending"
    repeat: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"
    sent_at: Optional[str] = None
    last_error: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ReminderCreate(BaseModel):
    pet_id: Optional[str] = None
    title: str
    message: Optional[str] = ""
    scheduled_for: str
    email: Optional[str] = ""
    repeat: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not _is_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def require_paid_plan(
    user: User,
    raise_error: bool = True,
):
    doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0}
    )

    plan_id = doc.get("plan_id")
    expires_at = doc.get("entitlement_expires_at")

    is_paid = True

    if not plan_id or plan_id in ["free", "free_tier"]:
        is_paid = False

    if expires_at:
        dt = datetime.fromisoformat(expires_at)

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        if dt <= datetime.now(timezone.utc):
            is_paid = False

    if not is_paid and raise_error:
        raise HTTPException(
            status_code=403,
            detail="This feature requires a paid subscription."
        )

    return is_paid


def parse_json_safely(text: str) -> dict:
    if not text:
        return {}

    s = text.strip()

    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[:s.rfind("```")]
        s = s.strip()
        if s.lower().startswith("json"):
            s = s[4:].strip()

    try:
        return json.loads(s)
    except Exception:
        try:
            start = s.find("{")
            end = s.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(s[start:end + 1])
        except Exception as e:
            logger.warning(f"JSON parse failed: {e}")

    return {}


async def call_claude_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500
) -> dict:
    if not anthropic_client:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY not configured"
        )

    message = await anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        temperature=0,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = message.content[0].text
    return parse_json_safely(raw)


def extract_pdf_text(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages[:10]:
            pages.append(page.extract_text() or "")
        return "\n".join(pages).strip()
    except Exception as e:
        logger.warning(f"PDF text extraction failed: {e}")
        return ""


def validate_upload_size(contents: bytes):
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File is too large. Maximum allowed size is {MAX_UPLOAD_MB}MB.",
        )


def safe_file_ext(filename: str, content_type: str = "") -> str:
    name = (filename or "").lower()

    if name.endswith(".pdf") or "pdf" in content_type:
        return "pdf"
    if name.endswith(".jpg") or name.endswith(".jpeg") or content_type == "image/jpeg":
        return "jpg"
    if name.endswith(".png") or content_type == "image/png":
        return "png"
    if name.endswith(".webp") or content_type == "image/webp":
        return "webp"

    return "bin"


async def save_uploaded_file(
    contents: bytes,
    original_filename: str,
    content_type: str,
    folder: Path,
    user_id: str,
    purpose: str,
    linked_id: Optional[str] = None,
) -> dict:
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    ext = safe_file_ext(original_filename, content_type)
    stored_name = f"{file_id}.{ext}"
    path = folder / stored_name

    with open(path, "wb") as f:
        f.write(contents)

    public_path = f"/uploads/{folder.name}/{stored_name}"

    doc = {
        "file_id": file_id,
        "user_id": user_id,
        "purpose": purpose,
        "linked_id": linked_id,
        "original_filename": original_filename or "",
        "stored_filename": stored_name,
        "path": str(path),
        "url": public_path,
        "content_type": content_type or "",
        "size_bytes": len(contents),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.uploaded_files.insert_one(doc)
    return doc


COMPARE_RECOMMENDATION_SYSTEM_PROMPT = """
You are PetBill Shield.

You compare two veterinary estimates and give a careful, plain-English suggestion.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not guarantee the cheaper option is better.
- Consider total cost, urgent items, repeated items, missing items, red flags, questions to ask, and whether one estimate seems more complete.
- Be cautious and practical.
- Always remind the user that the final decision rests with them and their veterinarian.

Return strict JSON only:
{
  "recommended_side": "a" | "b" | "neither" | "unclear",
  "title": "string",
  "summary": "string",
  "reasons": ["string"],
  "questions_to_ask": ["string"],
  "medical_caution": "string"
}
"""
