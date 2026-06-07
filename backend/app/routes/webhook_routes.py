"""
Inbound email webhook — forward-to-analyze.

A user emails a vet bill (PDF or photo) to the inbound address configured in
Resend (e.g. bills@petbillshield.com). Resend posts the parsed message here.
We match the sender to a registered user, run the existing bill-analysis
pipeline on each attachment, and email the results straight back.

Configuration (env):
  RESEND_INBOUND_SECRET   optional shared secret; if set, requests must carry
                          it as ?secret=... or X-Webhook-Secret header.

Resend inbound payloads vary by release; the parser below is intentionally
defensive about field names and attachment encodings (base64 or download URL).
"""
import base64
import logging

import httpx
from fastapi import APIRouter, Request

from app.shared import (
    db, User, FRONTEND_URL, send_resend_email,
)
from app.routes.estimate_routes import run_estimate_for_user

router = APIRouter()
logger = logging.getLogger("petbill")

import os
INBOUND_SECRET = os.environ.get("RESEND_INBOUND_SECRET", "")

_ALLOWED_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".webp")


def _extract_sender(payload: dict) -> str:
    data = payload.get("data") or payload
    for key in ("from", "sender", "from_email"):
        val = data.get(key)
        if isinstance(val, dict):
            val = val.get("email") or val.get("address")
        if isinstance(val, str) and "@" in val:
            # "Name <email@x.com>" → email@x.com
            if "<" in val and ">" in val:
                val = val[val.find("<") + 1:val.find(">")]
            return val.strip().lower()
    return ""


def _extract_attachments(payload: dict) -> list[dict]:
    data = payload.get("data") or payload
    raw = data.get("attachments") or payload.get("attachments") or []
    out = []
    for att in raw:
        if not isinstance(att, dict):
            continue
        filename = att.get("filename") or att.get("name") or att.get("file_name") or ""
        content_type = att.get("content_type") or att.get("contentType") or att.get("type") or ""
        content_b64 = att.get("content") or att.get("content_base64") or att.get("data")
        url = att.get("url") or att.get("download_url")
        out.append({
            "filename": filename,
            "content_type": content_type,
            "content_b64": content_b64,
            "url": url,
        })
    return out


async def _attachment_bytes(att: dict) -> bytes | None:
    b64 = att.get("content_b64")
    if b64:
        try:
            # Some providers prefix with a data URI
            if isinstance(b64, str) and "," in b64 and b64.strip().startswith("data:"):
                b64 = b64.split(",", 1)[1]
            return base64.b64decode(b64)
        except Exception:
            logger.warning("inbound: failed to decode base64 attachment")
    url = att.get("url")
    if url:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(url)
                r.raise_for_status()
                return r.content
        except Exception:
            logger.warning("inbound: failed to download attachment url")
    return None


@router.post("/webhooks/resend-inbound")
async def resend_inbound(request: Request):
    # Optional shared-secret check (query param or header)
    if INBOUND_SECRET:
        provided = request.query_params.get("secret") or request.headers.get("x-webhook-secret", "")
        if provided != INBOUND_SECRET:
            logger.warning("inbound: rejected — bad secret")
            return {"ok": False, "error": "unauthorized"}

    try:
        payload = await request.json()
    except Exception:
        logger.warning("inbound: non-JSON body")
        return {"ok": True, "skipped": "no_json"}

    sender = _extract_sender(payload)
    if not sender:
        logger.info("inbound: no sender found")
        return {"ok": True, "skipped": "no_sender"}

    user_doc = await db.users.find_one({"email": sender}, {"_id": 0})
    if not user_doc:
        logger.info(f"inbound: no account for {sender}")
        # Politely tell the unknown sender how to get started
        try:
            await send_resend_email(
                to=sender,
                subject="We couldn't find your PetBill Shield account",
                html=(
                    "<p>Thanks for emailing your vet bill to PetBill Shield.</p>"
                    "<p>We couldn't find an account for this email address. "
                    f"Please <a href='{FRONTEND_URL}/auth'>sign up or log in</a> with this "
                    "address first, then forward your bill again.</p>"
                ),
            )
        except Exception:
            pass
        return {"ok": True, "skipped": "unknown_sender"}

    user = User(**user_doc)
    attachments = [a for a in _extract_attachments(payload)
                   if (a.get("filename") or "").lower().endswith(_ALLOWED_EXT)]

    if not attachments:
        try:
            await send_resend_email(
                to=sender,
                subject="No bill attachment found",
                html=(
                    "<p>We received your email but didn't find a PDF or photo of a vet bill attached.</p>"
                    "<p>Please reply with the bill as a PDF, JPG, PNG, or WEBP attachment and we'll analyze it.</p>"
                ),
            )
        except Exception:
            pass
        return {"ok": True, "skipped": "no_attachment"}

    analyzed = []
    failed = 0
    for att in attachments[:5]:  # cap per email
        contents = await _attachment_bytes(att)
        if not contents:
            failed += 1
            continue
        try:
            analysis = await run_estimate_for_user(
                user=user,
                contents=contents,
                filename=att.get("filename") or "bill",
                content_type=att.get("content_type") or "",
            )
            analyzed.append(analysis)
        except Exception as exc:
            failed += 1
            logger.warning(f"inbound: analysis failed for {sender}: {exc}")

    if not analyzed:
        try:
            await send_resend_email(
                to=sender,
                subject="We couldn't analyze that bill",
                html=(
                    "<p>We received your attachment but couldn't read it as a vet bill. "
                    "Make sure it's a clear PDF or photo, then try again.</p>"
                    f"<p>You can also upload it directly at <a href='{FRONTEND_URL}/dashboard/analyze'>your dashboard</a>.</p>"
                ),
            )
        except Exception:
            pass
        return {"ok": True, "analyzed": 0, "failed": failed}

    # Build a friendly results email
    rows = []
    for a in analyzed:
        link = f"{FRONTEND_URL}/dashboard/analyze/{a.analysis_id}"
        total = f"${a.estimated_total_usd:,.0f}" if a.estimated_total_usd else "—"
        flags = len(a.red_flags or [])
        rows.append(
            f"<li style='margin-bottom:10px'>"
            f"<strong>{(a.original_filename or 'Vet bill')}</strong> — estimated total {total}, "
            f"{flags} item{'s' if flags != 1 else ''} flagged to ask your vet. "
            f"<a href='{link}'>View full analysis →</a></li>"
        )
    html = (
        f"<p>Hi{(' ' + (user.name or '')) if getattr(user, 'name', '') else ''}, your bill"
        f"{'s are' if len(analyzed) > 1 else ' is'} analyzed and saved to your account:</p>"
        f"<ul style='padding-left:18px'>{''.join(rows)}</ul>"
        f"<p>Open your <a href='{FRONTEND_URL}/dashboard'>dashboard</a> to see the questions to ask, "
        f"cost-saving options, and to log what you actually pay.</p>"
        f"<p style='color:#888;font-size:12px'>PetBill Shield offers guidance only and never replaces your veterinarian.</p>"
    )
    try:
        await send_resend_email(
            to=sender,
            subject=f"Your vet bill analysis is ready ({len(analyzed)} bill{'s' if len(analyzed) > 1 else ''})",
            html=html,
        )
    except Exception:
        logger.warning("inbound: failed to send results email")

    return {"ok": True, "analyzed": len(analyzed), "failed": failed}
