"""
Landing-page content management (CMS).
GET /content/landing       — public, landing page content.
GET /content/promo-banner  — public, returns the active promo banner (if enabled).
PUT /content/landing       — admin only.
PUT /content/promo-banner  — admin only, set/toggle the promo banner.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Any
from app.shared import db, User, require_admin, datetime, timezone, logger

router = APIRouter()

_KEY        = "landing"
_BANNER_KEY = "promo_banner"

_DEFAULT_BANNER = {
    "enabled": False,
    "title": "Yearly launch offer",
    "body": "50% off your first 3 months on any yearly plan.",
    "promo_code": "",
    "discount_display": "50% off first 3 months",
    "cta_text": "View yearly plans",
    "cta_href": "/dashboard/pricing",
    "style": "primary",
    "starts_at": "",
    "expires_at": "",
    "display_pages": ["landing", "pricing", "billing"],
    "allowed_plan_ids": ["vault_yearly", "family_yearly", "rescue_yearly"],
    "plan_scope": "yearly",
    "required_percent_off": 50,
    "required_duration_months": 3,
}


def _as_list(value):
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return []


def _normalize_banner(payload: dict) -> dict:
    data = {**_DEFAULT_BANNER, **(payload or {})}
    data["enabled"] = bool(data.get("enabled"))
    data["promo_code"] = (data.get("promo_code") or "").strip().upper()
    data["style"] = data.get("style") if data.get("style") in ("warning", "success", "primary", "dark") else "warning"
    data["display_pages"] = _as_list(data.get("display_pages")) or _DEFAULT_BANNER["display_pages"]
    data["allowed_plan_ids"] = _as_list(data.get("allowed_plan_ids"))
    data["plan_scope"] = data.get("plan_scope") if data.get("plan_scope") in ("all", "monthly", "yearly") else "all"
    for field in ("required_percent_off", "required_duration_months"):
        value = data.get(field)
        if value in ("", None):
            data[field] = None
            continue
        try:
            data[field] = int(value)
        except Exception:
            data[field] = None
    return data


def _parse_iso(value: str):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def _banner_is_live(doc: dict) -> bool:
    if not doc or not doc.get("enabled"):
        return False
    now = datetime.now(timezone.utc)
    starts_at = _parse_iso(doc.get("starts_at"))
    expires_at = _parse_iso(doc.get("expires_at"))
    if starts_at and starts_at > now:
        return False
    if expires_at and expires_at < now:
        return False
    return True


@router.get("/content/landing")
async def get_landing_content():
    """Public endpoint — returns the stored CMS content or empty dict."""
    doc = await db.site_content.find_one({"key": _KEY}, {"_id": 0})
    if not doc:
        return {}
    doc.pop("key", None)
    return doc


@router.put("/content/landing")
async def update_landing_content(
    payload: dict,
    _: User = Depends(require_admin),
):
    """Admin-only: replace the entire landing-page content blob."""
    payload["key"]        = _KEY
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_content.update_one(
        {"key": _KEY},
        {"$set": payload},
        upsert=True,
    )
    logger.info("Landing page content updated by admin")
    return {"ok": True}


@router.patch("/content/landing")
async def patch_landing_content(
    payload: dict,
    _: User = Depends(require_admin),
):
    """Admin-only: merge partial updates into the stored content."""
    payload.pop("key", None)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    update_doc = {"$set": {k: v for k, v in payload.items()}}
    await db.site_content.update_one({"key": _KEY}, update_doc, upsert=True)
    return {"ok": True}


# ── Promo banner ──────────────────────────────────────────────────────────────

@router.get("/content/promo-banner")
async def get_promo_banner():
    """
    Public endpoint — returns the banner data if enabled, else {"enabled": false}.
    Called by Landing, PricingPage on every mount.
    """
    doc = await db.site_content.find_one({"key": _BANNER_KEY}, {"_id": 0})
    if not _banner_is_live(doc):
        return {"enabled": False}
    doc.pop("key", None)
    return _normalize_banner(doc)


@router.get("/content/promo-banner/admin")
async def get_promo_banner_admin(_: User = Depends(require_admin)):
    """Admin-only endpoint — returns draft/disabled banner settings too."""
    doc = await db.site_content.find_one({"key": _BANNER_KEY}, {"_id": 0}) or {}
    doc.pop("key", None)
    return _normalize_banner(doc)


@router.put("/content/promo-banner")
async def set_promo_banner(
    payload: dict,
    _: User = Depends(require_admin),
):
    """
    Admin-only — create or fully replace the promo banner.
    Expected fields:
      enabled: bool
      title: str
      body: str
      promo_code: str (optional — the code users enter at checkout)
      discount_display: str (e.g. "20% off")
      cta_text: str (e.g. "Claim offer")
      style: "warning" | "success" | "primary" | "dark"
      expires_at: ISO datetime string (optional)
    """
    payload = _normalize_banner(payload)
    payload["key"]        = _BANNER_KEY
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_content.update_one(
        {"key": _BANNER_KEY},
        {"$set": payload},
        upsert=True,
    )
    logger.info(f"Promo banner updated — enabled={payload.get('enabled')}")
    return {"ok": True}


@router.patch("/content/promo-banner")
async def patch_promo_banner(
    payload: dict,
    _: User = Depends(require_admin),
):
    """Admin-only: partial update — e.g. just toggle enabled."""
    payload.pop("key", None)
    existing = await db.site_content.find_one({"key": _BANNER_KEY}, {"_id": 0}) or {}
    payload = _normalize_banner({**existing, **payload})
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_content.update_one(
        {"key": _BANNER_KEY},
        {"$set": payload},
        upsert=True,
    )
    return {"ok": True}
