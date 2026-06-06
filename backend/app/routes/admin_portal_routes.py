"""
Comprehensive admin-portal API.

All routes require is_admin.  The require_admin dependency raises 403 otherwise.

Sections
--------
/admin/portal/stats          — overview metrics
/admin/portal/users          — paginated user search + detail
/admin/portal/inbox          — contact-message inbox + reply
/admin/portal/ai-compose     — AI-generate email content
/admin/portal/broadcast      — bulk-email campaigns
/admin/portal/promos         — Stripe promo / coupon management
/admin/portal/feedback       — feedback viewer
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import Optional, List
import secrets, math, resend, csv, io

from app.shared import (
    db, User, require_admin, logger,
    datetime, timezone, timedelta,
    call_claude_json,
    SENDER_EMAIL, RESEND_API_KEY,
    STRIPE_API_KEY,
    stripe_sdk, uuid,
)

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

def _paginate(total: int, page: int, limit: int) -> dict:
    return {
        "total": total,
        "page":  page,
        "limit": limit,
        "pages": max(1, math.ceil(total / limit)),
    }


# Stripe API version 2025-03-31 (pinned by stripe-python 15.x) removed the
# top-level `coupon` param from PromotionCode.create and dropped the inline
# `coupon` object from PromotionCode list/retrieve responses. We pin promo
# operations to an older version where `coupon` is accepted and returned inline,
# so create + validate stay consistent across admin and checkout.
PROMO_STRIPE_VERSION = "2023-10-16"


def _configure_stripe() -> None:
    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"


def _promo_discount_label(coupon) -> str:
    percent_off = getattr(coupon, "percent_off", None)
    amount_off = getattr(coupon, "amount_off", None)
    currency = (getattr(coupon, "currency", None) or "usd").upper()
    if percent_off is not None:
        return f"{percent_off:g}%"
    if amount_off is not None:
        return f"{currency} {amount_off / 100:.2f}"
    return "Discount"


# ═══════════════════════════════════════════════════════════════════════════════
#  OVERVIEW STATS
# ═══════════════════════════════════════════════════════════════════════════════

# Plan → monthly price for MRR calculation
_PLAN_MRR: dict = {
    "vault_monthly":  8.99,
    "vault_yearly":   89.90 / 12,
    "family_monthly": 19.99,
    "family_yearly":  199.90 / 12,
    "rescue_monthly": 49.99,
    "rescue_yearly":  499.90 / 12,
}

@router.get("/admin/portal/stats")
async def portal_stats(_: User = Depends(require_admin)):
    now     = datetime.now(timezone.utc)
    ago_7d  = (now - timedelta(days=7)).isoformat()
    ago_30d = (now - timedelta(days=30)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    total_users     = await db.users.count_documents({})
    new_users_7d    = await db.users.count_documents({"created_at": {"$gte": ago_7d}})
    new_users_30d   = await db.users.count_documents({"created_at": {"$gte": ago_30d}})
    new_users_month = await db.users.count_documents({"created_at": {"$gte": month_start}})

    total_pets      = await db.pets.count_documents({})
    total_estimates = await db.estimates.count_documents({})
    total_claims    = await db.claims.count_documents({})
    total_feedback  = await db.feedback.count_documents({})
    unread_inbox    = await db.contact_messages.count_documents({"replied": {"$ne": True}})

    # Active subscribers by plan
    plan_pipeline = [
        {"$match": {"subscription_status": "active", "plan_id": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$plan_id", "count": {"$sum": 1}}},
    ]
    plan_counts: dict = {}
    async for row in db.users.aggregate(plan_pipeline):
        plan_counts[row["_id"]] = row["count"]

    active_subscribers = sum(plan_counts.values())

    # MRR = sum(subscribers × monthly_price_equivalent)
    mrr = sum(
        count * _PLAN_MRR.get(plan_id, 0)
        for plan_id, count in plan_counts.items()
    )

    # Cancellations in last 30 days (cancel_at_period_end set recently)
    cancellations_30d = await db.plan_switches.count_documents({
        "action": "cancel_subscription",
        "created_at": {"$gte": ago_30d},
    })

    # All-time revenue from paid transactions
    rev_cursor = db.payment_transactions.aggregate([
        {"$match": {"payment_status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ])
    revenue_all_time = 0.0
    async for row in rev_cursor:
        revenue_all_time = round(float(row.get("total") or 0), 2)
        break

    # Revenue this calendar month
    rev_month_cursor = db.payment_transactions.aggregate([
        {"$match": {"payment_status": "paid", "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ])
    revenue_month = 0.0
    async for row in rev_month_cursor:
        revenue_month = round(float(row.get("total") or 0), 2)
        break

    # Analyses this month
    estimates_month = await db.estimates.count_documents({"created_at": {"$gte": month_start}})
    claims_month    = await db.claims.count_documents({"created_at": {"$gte": month_start}})
    comparisons_month = await db.estimate_comparisons.count_documents({"created_at": {"$gte": month_start}})
    active_promo = await db.site_content.find_one({"key": "promo_banner"}, {"_id": 0}) or {}

    return {
        "users": {
            "total":        total_users,
            "active_subs":  active_subscribers,
            "new_7d":       new_users_7d,
            "new_30d":      new_users_30d,
            "new_this_month": new_users_month,
        },
        "revenue": {
            "mrr_usd":        round(mrr, 2),
            "arr_usd":        round(mrr * 12, 2),
            "all_time_usd":   revenue_all_time,
            "this_month_usd": revenue_month,
        },
        "plans": plan_counts,
        "content": {
            "pets":             total_pets,
            "estimates":        total_estimates,
            "estimates_month":  estimates_month,
            "claims":           total_claims,
            "claims_month":     claims_month,
            "comparisons_month": comparisons_month,
        },
        "feedback":        {"total": total_feedback},
        "inbox":           {"unread": unread_inbox},
        "promo": {
            "enabled": bool(active_promo.get("enabled")),
            "code": active_promo.get("promo_code") or "",
            "title": active_promo.get("title") or "",
            "expires_at": active_promo.get("expires_at") or "",
        },
        "cancellations_30d": cancellations_30d,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  USERS
# ═══════════════════════════════════════════════════════════════════════════════

# Subscription-type groupings for admin filtering. A "paid" tier only counts a
# user when their subscription is currently active; everyone else is "free".
_PLAN_GROUP_IDS = {
    "vault":  ["vault_monthly", "vault_yearly"],
    "family": ["family_monthly", "family_yearly"],
    "rescue": ["rescue_monthly", "rescue_yearly"],
}
_ALL_PAID_PLAN_IDS = [pid for ids in _PLAN_GROUP_IDS.values() for pid in ids]


def _plan_group_filter(plan: str) -> dict:
    """Mongo filter fragment for a subscription-type group."""
    plan = (plan or "").strip().lower()
    if plan in _PLAN_GROUP_IDS:
        return {"plan_id": {"$in": _PLAN_GROUP_IDS[plan]}, "subscription_status": "active"}
    if plan == "free":
        # Anyone who is NOT a currently-active paid subscriber.
        return {"$nor": [{"plan_id": {"$in": _ALL_PAID_PLAN_IDS}, "subscription_status": "active"}]}
    return {}  # "all" / unknown → no plan filter


def _user_sort_spec(sort: str):
    """Map a sort key to a Mongo sort spec (only doc-level fields)."""
    return {
        "recent":  [("created_at", -1)],   # newest first (default)
        "oldest":  [("created_at",  1)],
        "name":    [("name", 1), ("email", 1)],
        "renewal": [("entitlement_expires_at", -1)],
    }.get((sort or "").strip().lower(), [("created_at", -1)])


@router.get("/admin/portal/users")
async def portal_list_users(
    q:     str = Query(""),
    plan:  str = Query(""),          # "", "all", "free", "vault", "family", "rescue"
    sort:  str = Query("recent"),    # recent | oldest | name | renewal
    page:  int = Query(1,  ge=1),
    limit: int = Query(30, ge=1, le=100),
    _: User    = Depends(require_admin),
):
    skip = (page - 1) * limit
    query: dict = {}
    if q.strip():
        query["$or"] = [
            {"email": {"$regex": q.strip(), "$options": "i"}},
            {"name":  {"$regex": q.strip(), "$options": "i"}},
        ]

    plan_filter = _plan_group_filter(plan)
    if plan_filter:
        query = {"$and": [query, plan_filter]} if query else plan_filter

    total = await db.users.count_documents(query)
    docs  = await db.users.find(
        query,
        {"_id": 0, "password_hash": 0},
    ).sort(_user_sort_spec(sort)).skip(skip).limit(limit).to_list(limit)

    # Attach basic counts
    for doc in docs:
        uid = doc["user_id"]
        doc["pet_count"]      = await db.pets.count_documents({"user_id": uid})
        doc["estimate_count"] = await db.estimates.count_documents({"user_id": uid})
        doc["claim_count"]    = await db.claims.count_documents({"user_id": uid})
        doc["comparison_count"] = await db.estimate_comparisons.count_documents({"user_id": uid})

    # Group counts respect the search term but ignore the plan filter, so the
    # tab badges always show the full breakdown for the current search.
    search_q: dict = {}
    if q.strip():
        search_q["$or"] = [
            {"email": {"$regex": q.strip(), "$options": "i"}},
            {"name":  {"$regex": q.strip(), "$options": "i"}},
        ]

    async def _count(group_filter: dict) -> int:
        merged = {"$and": [search_q, group_filter]} if search_q and group_filter else (group_filter or search_q or {})
        return await db.users.count_documents(merged)

    group_counts = {
        "all":    await _count({}),
        "free":   await _count(_plan_group_filter("free")),
        "vault":  await _count(_plan_group_filter("vault")),
        "family": await _count(_plan_group_filter("family")),
        "rescue": await _count(_plan_group_filter("rescue")),
    }

    return {
        "users": docs,
        "pagination": _paginate(total, page, limit),
        "group_counts": group_counts,
    }


@router.get("/admin/portal/users/export.csv")
async def portal_export_users_csv(
    q:    str = Query(""),
    plan: str = Query(""),       # all/free/vault/family/rescue
    sort: str = Query("recent"),
    _: User   = Depends(require_admin),
):
    """Export ALL users matching the current search + subscription-type filter as CSV."""
    query: dict = {}
    if q.strip():
        query["$or"] = [
            {"email": {"$regex": q.strip(), "$options": "i"}},
            {"name":  {"$regex": q.strip(), "$options": "i"}},
        ]
    plan_filter = _plan_group_filter(plan)
    if plan_filter:
        query = {"$and": [query, plan_filter]} if query else plan_filter

    docs = await db.users.find(
        query, {"_id": 0, "password_hash": 0},
    ).sort(_user_sort_spec(sort)).to_list(100000)

    def _group_label(d: dict) -> str:
        pid = (d.get("plan_id") or "").lower()
        active = d.get("subscription_status") == "active"
        if active and "vault"  in pid: return "Vault"
        if active and "family" in pid: return "Family"
        if active and "rescue" in pid: return "Rescue"
        return "Free"

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "name", "email", "subscription_group", "plan_id", "subscription_status",
        "renews_or_ends", "joined", "auth_provider", "pets", "bills", "claims",
    ])
    for d in docs:
        uid = d["user_id"]
        w.writerow([
            d.get("name", ""),
            d.get("email", ""),
            _group_label(d),
            d.get("plan_id", "") or "free",
            d.get("subscription_status", "") or "",
            d.get("entitlement_expires_at", "") or "",
            d.get("created_at", "") or "",
            d.get("auth_provider", "") or "email",
            await db.pets.count_documents({"user_id": uid}),
            await db.estimates.count_documents({"user_id": uid}),
            await db.claims.count_documents({"user_id": uid}),
        ])

    buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    group = (plan or "all").lower() or "all"
    filename = f"petbillshield-users-{group}-{stamp}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/portal/users/{user_id}")
async def portal_user_detail(
    user_id: str,
    _: User = Depends(require_admin),
):
    doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    pets      = await db.pets.find({"user_id": user_id}, {"_id": 0}).to_list(100)
    estimates = await db.estimates.find(
        {"user_id": user_id}, {"_id": 0, "ai_analysis": 0}
    ).sort("created_at", -1).to_list(20)
    claims    = await db.claims.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(10)
    reminders = await db.reminders.count_documents({"user_id": user_id})
    comparisons = await db.estimate_comparisons.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(10)
    usage = await db.ai_usage.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(25)

    # billing
    billing = await db.billing_states.find_one({"user_id": user_id}, {"_id": 0}) or {}

    return {
        "user":          doc,
        "billing":       billing,
        "pets":          pets,
        "estimates":     estimates,
        "claims":        claims,
        "comparisons":   comparisons,
        "ai_usage":      usage,
        "reminder_count": reminders,
    }


class AdminNoteRequest(BaseModel):
    note: str


@router.post("/admin/portal/users/{user_id}/note")
async def portal_add_user_note(
    user_id: str,
    payload: AdminNoteRequest,
    admin: User = Depends(require_admin),
):
    await db.admin_user_notes.insert_one({
        "note_id":    str(uuid.uuid4()),
        "user_id":    user_id,
        "admin_id":   admin.user_id,
        "note":       payload.note.strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@router.get("/admin/portal/users/{user_id}/notes")
async def portal_get_user_notes(
    user_id: str,
    _: User = Depends(require_admin),
):
    rows = await db.admin_user_notes.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"notes": rows}


# ═══════════════════════════════════════════════════════════════════════════════
#  INBOX  (contact messages)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/admin/portal/inbox")
async def portal_inbox(
    page:     int  = Query(1, ge=1),
    limit:    int  = Query(25, ge=1, le=100),
    unread:   bool = Query(False),
    _: User        = Depends(require_admin),
):
    skip  = (page - 1) * limit
    query = {"replied": {"$ne": True}} if unread else {}
    total = await db.contact_messages.count_documents(query)
    msgs  = await db.contact_messages.find(
        query, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"messages": msgs, "pagination": _paginate(total, page, limit)}


class ReplyRequest(BaseModel):
    subject: str
    body:    str          # plain text — will be wrapped in HTML template


def _contact_message_lookup_query(msg_id: str) -> dict:
    return {"$or": [{"contact_id": msg_id}, {"message_id": msg_id}]}


@router.post("/admin/portal/inbox/{msg_id}/reply")
async def portal_reply(
    msg_id:  str,
    payload: ReplyRequest,
    admin: User = Depends(require_admin),
):
    msg = await db.contact_messages.find_one(_contact_message_lookup_query(msg_id), {"_id": 0})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="Email sending is not configured (RESEND_API_KEY missing).")

    to_email = msg.get("email", "")
    if not to_email:
        raise HTTPException(status_code=400, detail="No reply-to email on original message.")

    # Wrap body in simple brand HTML
    html = _email_html(payload.subject, payload.body, to_name=msg.get("name", ""))

    try:
        resend.Emails.send({
            "from":    SENDER_EMAIL,
            "to":      to_email,
            "subject": payload.subject,
            "html":    html,
        })
    except Exception as e:
        logger.warning(f"Reply send failed: {e}")
        raise HTTPException(status_code=500, detail=f"Send failed: {e}")

    await db.contact_messages.update_one(
        _contact_message_lookup_query(msg_id),
        {"$set": {
            "replied":     True,
            "replied_at":  datetime.now(timezone.utc).isoformat(),
            "replied_by":  admin.user_id,
        }},
    )
    return {"ok": True}


@router.patch("/admin/portal/inbox/{msg_id}/read")
async def portal_mark_read(msg_id: str, _: User = Depends(require_admin)):
    await db.contact_messages.update_one(
        _contact_message_lookup_query(msg_id),
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════════════
#  AI EMAIL COMPOSER
# ═══════════════════════════════════════════════════════════════════════════════

AI_EMAIL_SYSTEM = """You are the PetBill Shield internal copywriter.
Write professional, warm, brand-consistent emails on behalf of the PetBill Shield team.

Brand voice: helpful, clear, never clinical, never pushy, always genuine.
Brand colours context: terracotta warmth, sage calm, cream approachability.

Return STRICT JSON only:
{
  "subject": "string — compelling subject line",
  "preview_text": "string — 80-char preview / preheader",
  "html_body": "string — clean HTML email body (no <html>/<head>, just <body> content)",
  "plain_body": "string — plain-text version"
}
No markdown fences."""


class AiComposeRequest(BaseModel):
    intent:     str            # e.g. "Reply to complaint about billing", "Newsletter April"
    context:    Optional[str]  # extra context (original message, product details, etc.)
    tone:       Optional[str] = "warm"   # warm | professional | urgent


@router.post("/admin/portal/ai-compose")
async def portal_ai_compose(
    payload: AiComposeRequest,
    _: User = Depends(require_admin),
):
    user_prompt = (
        f"Intent: {payload.intent}\n"
        f"Tone: {payload.tone or 'warm'}\n"
        + (f"Context:\n{payload.context}\n" if payload.context else "")
        + "Write the email now."
    )
    try:
        result = await call_claude_json(AI_EMAIL_SYSTEM, user_prompt, max_tokens=2000)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {e}")

    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  BROADCAST  (bulk email campaigns)
# ═══════════════════════════════════════════════════════════════════════════════

SEGMENT_QUERIES = {
    "all":         {},
    "paid":        {"billing_active": True},     # fallback — checked in code
    "free":        {},                            # filtered in code
    "newsletter":  {"prefs.newsletter": True},
    "tips_guides": {"prefs.tips_guides": True},
    "offers":      {"prefs.offers": True},
}


async def _get_segment_emails(segment: str) -> list[dict]:
    """Return [{ email, name }] for the given segment."""
    users = await db.users.find(
        {}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "prefs": 1}
    ).to_list(None)

    if segment == "all":
        return [{"email": u["email"], "name": u.get("name", "")} for u in users]

    if segment in ("newsletter", "tips_guides", "offers", "reminder_emails"):
        return [
            {"email": u["email"], "name": u.get("name", "")}
            for u in users
            if (u.get("prefs") or {}).get(segment, False)
        ]

    if segment == "paid":
        paid_ids = set()
        async for row in db.payment_transactions.find(
            {"payment_status": "paid"}, {"user_id": 1}
        ):
            paid_ids.add(row["user_id"])
        return [
            {"email": u["email"], "name": u.get("name", "")}
            for u in users
            if u["user_id"] in paid_ids
        ]

    return []


@router.get("/admin/portal/broadcast/audience-count")
async def portal_audience_count(
    segment: str = Query("newsletter"),
    _: User = Depends(require_admin),
):
    recipients = await _get_segment_emails(segment)
    return {"count": len(recipients), "segment": segment}


class BroadcastRequest(BaseModel):
    subject:    str
    html_body:  str
    plain_body: Optional[str] = ""
    segment:    str = "newsletter"   # all | paid | newsletter | tips_guides | offers


@router.post("/admin/portal/broadcast")
async def portal_broadcast(
    payload: BroadcastRequest,
    admin: User = Depends(require_admin),
):
    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="RESEND_API_KEY not configured.")

    recipients = await _get_segment_emails(payload.segment)
    if not recipients:
        raise HTTPException(status_code=400, detail="No recipients in this segment.")

    # Store campaign record first
    campaign_id = str(uuid.uuid4())
    await db.broadcast_campaigns.insert_one({
        "campaign_id":  campaign_id,
        "subject":      payload.subject,
        "segment":      payload.segment,
        "recipient_count": len(recipients),
        "sent_by":      admin.user_id,
        "status":       "sending",
        "created_at":   datetime.now(timezone.utc).isoformat(),
    })

    sent = 0
    failed = 0
    for r in recipients:
        try:
            html = _email_html(payload.subject, payload.html_body, to_name=r["name"])
            resend.Emails.send({
                "from":    SENDER_EMAIL,
                "to":      r["email"],
                "subject": payload.subject,
                "html":    html,
            })
            sent += 1
        except Exception as e:
            logger.warning(f"Broadcast send failed for {r['email']}: {e}")
            failed += 1

    await db.broadcast_campaigns.update_one(
        {"campaign_id": campaign_id},
        {"$set": {
            "status": "done",
            "sent": sent, "failed": failed,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "sent": sent, "failed": failed, "campaign_id": campaign_id}


@router.get("/admin/portal/broadcast/history")
async def portal_broadcast_history(_: User = Depends(require_admin)):
    rows = await db.broadcast_campaigns.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"campaigns": rows}


# ═══════════════════════════════════════════════════════════════════════════════
#  PROMOS  (Stripe coupons + promotion codes)
# ═══════════════════════════════════════════════════════════════════════════════

class CreatePromoRequest(BaseModel):
    name:            str                    # e.g. "Summer 20% off"
    code:            str                    # e.g. SUMMER20
    discount_type:   str = "percent"        # percent | fixed
    discount_value:  float                  # 20 for 20%, 5.00 for $5
    duration:        str = "once"           # once | repeating | forever
    duration_months: Optional[int] = None   # only for repeating
    max_redemptions: Optional[int] = None
    expires_days:    Optional[int] = None   # None = no expiry


@router.get("/admin/portal/promos")
async def portal_list_promos(_: User = Depends(require_admin)):
    if not STRIPE_API_KEY:
        return {"promos": [], "note": "Stripe not configured"}
    try:
        _configure_stripe()
        codes = stripe_sdk.PromotionCode.list(
            limit=50,
            active=True,
            expand=["data.coupon"],
            stripe_version=PROMO_STRIPE_VERSION,
        )
        result = []
        for pc in codes.auto_paging_iter():
            coupon = pc.coupon
            result.append({
                "id":           pc.id,
                "code":         pc.code,
                "name":         getattr(coupon, "name", None) or pc.code,
                "active":       pc.active,
                "discount":     _promo_discount_label(coupon),
                "duration":     getattr(coupon, "duration", None) or "unknown",
                "times_redeemed": pc.times_redeemed,
                "max_redemptions": pc.max_redemptions,
                "expires_at":   pc.expires_at,
            })
        return {"promos": result}
    except Exception as e:
        logger.exception(f"Could not load Stripe promo codes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/admin/portal/promos")
async def portal_create_promo(
    payload: CreatePromoRequest,
    _: User = Depends(require_admin),
):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured.")
    try:
        _configure_stripe()
        coupon_params: dict = {
            "name":     payload.name,
            "duration": payload.duration,
        }
        if payload.discount_type == "percent":
            coupon_params["percent_off"] = payload.discount_value
        else:
            coupon_params["amount_off"] = int(payload.discount_value * 100)
            coupon_params["currency"]   = "usd"
        if payload.duration == "repeating" and payload.duration_months:
            coupon_params["duration_in_months"] = payload.duration_months

        coupon = stripe_sdk.Coupon.create(**coupon_params, stripe_version=PROMO_STRIPE_VERSION)

        promo_params: dict = {
            "coupon": coupon.id,
            "code":   payload.code.upper().strip(),
        }
        if payload.max_redemptions:
            promo_params["max_redemptions"] = payload.max_redemptions
        if payload.expires_days:
            import time
            promo_params["expires_at"] = int(time.time()) + (payload.expires_days * 86400)

        promo = stripe_sdk.PromotionCode.create(**promo_params, stripe_version=PROMO_STRIPE_VERSION)
        return {"ok": True, "promo_id": promo.id, "code": promo.code}
    except stripe_sdk.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message or e))


@router.delete("/admin/portal/promos/{promo_id}")
async def portal_deactivate_promo(
    promo_id: str,
    _: User = Depends(require_admin),
):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured.")
    try:
        _configure_stripe()
        stripe_sdk.PromotionCode.modify(promo_id, active=False, stripe_version=PROMO_STRIPE_VERSION)
        return {"ok": True}
    except stripe_sdk.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message or e))


# ═══════════════════════════════════════════════════════════════════════════════
#  FEEDBACK  (enhanced)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/admin/portal/feedback")
async def portal_feedback(
    page:  int = Query(1, ge=1),
    limit: int = Query(40, ge=1, le=200),
    _: User    = Depends(require_admin),
):
    skip  = (page - 1) * limit
    total = await db.feedback.count_documents({})
    rows  = await db.feedback.find(
        {}, {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    # Avg rating
    cur = db.feedback.aggregate([
        {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "dist": {"$push": "$rating"}}}
    ])
    avg = 0.0
    dist = {}
    async for row in cur:
        avg = round(float(row.get("avg") or 0), 2)
        for r in (row.get("dist") or []):
            dist[str(r)] = dist.get(str(r), 0) + 1
        break

    return {
        "feedback":   rows,
        "pagination": _paginate(total, page, limit),
        "avg_rating": avg,
        "distribution": dist,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  EMAIL HTML TEMPLATE
# ═══════════════════════════════════════════════════════════════════════════════

def _email_html(subject: str, body: str, to_name: str = "") -> str:
    greeting = f"Hi {to_name}," if to_name else "Hello,"
    # Convert plain newlines to <br> for the body
    body_html = body.replace("\n\n", "</p><p>").replace("\n", "<br>")
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{subject}</title></head>
<body style="margin:0;padding:0;background:#F5F2EB;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EB;padding:32px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr>
    <td style="background:#2D2C28;padding:24px 32px;">
      <span style="color:#FAF9F6;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
        PetBill <span style="color:#D26D53;">Shield</span>
      </span>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;color:#2D2C28;font-size:15px;line-height:1.7;">
      <p style="margin:0 0 16px;">{greeting}</p>
      <p style="margin:0 0 16px;">{body_html}</p>
      <p style="margin:24px 0 0;color:#8A887F;font-size:13px;">
        Warm regards,<br>
        <strong>The PetBill Shield Team</strong>
      </p>
    </td>
  </tr>
  <tr>
    <td style="background:#F5F2EB;padding:16px 32px;text-align:center;font-size:12px;color:#8A887F;">
      PetBill Shield · <a href="https://petbillshield.com" style="color:#D26D53;">petbillshield.com</a>
      · <a href="mailto:hello@petbillshield.com" style="color:#8A887F;">hello@petbillshield.com</a>
      <br>You received this because you have a PetBill Shield account.
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>"""
