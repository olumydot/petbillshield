"""User profile, preferences, email change, and account-deletion endpoints."""
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, EmailStr
from typing import Optional
import secrets
import hashlib

from app.shared import (
    db, User, get_current_user, verify_password, hash_password,
    validate_password_strength, FRONTEND_URL, logger, send_resend_email,
    datetime, timezone, timedelta,
)

router = APIRouter()


# ── Change password (authenticated, knows current password) ──────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/user/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
):
    """
    Lets an email-auth user change their password without a reset email.
    Requires the current password to verify identity, then updates to the
    new password.  Google-auth users are blocked — they manage passwords via Google.
    """
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    if not doc.get("password_hash"):
        raise HTTPException(
            status_code=400,
            detail="Your account uses Google sign-in. Manage your password at myaccount.google.com.",
        )

    if not verify_password(payload.current_password, doc["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")

    if verify_password(payload.new_password, doc["password_hash"]):
        raise HTTPException(
            status_code=400,
            detail="New password must be different from your current password.",
        )

    strength_error = validate_password_strength(payload.new_password)
    if strength_error:
        raise HTTPException(status_code=400, detail=strength_error)

    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "password_hash":       hash_password(payload.new_password),
            "password_changed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    logger.info(f"Password changed for user {user.user_id}")
    return {"ok": True, "message": "Password changed successfully."}

# ── Constants ─────────────────────────────────────────────────────────────────

DEFAULT_PREFS = {
    "reminder_emails": True,   # email when reminders are due
    "newsletter":      False,  # monthly product newsletter
    "tips_guides":     False,  # weekly care tips
    "weekly_reports":  True,   # personalized Sunday account digest for paid users
    "offers":          False,  # promotions / new features
}

# ── Models ────────────────────────────────────────────────────────────────────

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None


class UpdatePrefsRequest(BaseModel):
    reminder_emails: Optional[bool] = None
    newsletter:      Optional[bool] = None
    tips_guides:     Optional[bool] = None
    weekly_reports:  Optional[bool] = None
    offers:          Optional[bool] = None


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr
    password:  Optional[str] = None  # required when account has a password


class DeleteAccountRequest(BaseModel):
    confirm:  str             # must equal "DELETE"
    password: Optional[str] = None  # required when account has a password


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/user/settings")
async def get_user_settings(user: User = Depends(get_current_user)):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    has_password   = bool(doc.get("password_hash"))
    auth_provider  = doc.get("auth_provider") or ("email" if has_password else "external")

    # Pending email change
    pending = await db.email_change_tokens.find_one(
        {"user_id": user.user_id, "used": False},
        {"_id": 0, "new_email": 1},
    )

    prefs = {**DEFAULT_PREFS, **(doc.get("prefs") or {})}

    return {
        "user_id":      doc["user_id"],
        "email":        doc["email"],
        "name":         doc.get("name", ""),
        "first_name":   doc.get("first_name", ""),
        "last_name":    doc.get("last_name", ""),
        "picture":      doc.get("picture", ""),
        "auth_provider": auth_provider,
        "has_password": has_password,
        "created_at":   doc.get("created_at"),
        "prefs":        prefs,
        "pending_email": pending["new_email"] if pending else None,
    }


@router.patch("/user/settings")
async def update_user_settings(
    payload: UpdateProfileRequest,
    user: User = Depends(get_current_user),
):
    updates: dict = {}

    if payload.name is not None:
        name = payload.name.strip()
        if len(name) < 1:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        if len(name) > 120:
            raise HTTPException(status_code=400, detail="Name is too long.")
        updates["name"] = name

    if not updates:
        return {"ok": True}

    await db.users.update_one({"user_id": user.user_id}, {"$set": updates})
    return {"ok": True}


@router.patch("/user/prefs")
async def update_user_prefs(
    payload: UpdatePrefsRequest,
    user: User = Depends(get_current_user),
):
    field_map = payload.dict(exclude_none=True)
    if not field_map:
        return {"ok": True}

    mongo_updates = {f"prefs.{k}": v for k, v in field_map.items()}
    await db.users.update_one({"user_id": user.user_id}, {"$set": mongo_updates})
    return {"ok": True}


@router.post("/user/change-email")
async def request_email_change(
    payload: ChangeEmailRequest,
    user: User = Depends(get_current_user),
):
    new_email = payload.new_email.lower().strip()

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    # Google / external accounts cannot change email here
    auth_provider = doc.get("auth_provider", "")
    if auth_provider == "google":
        raise HTTPException(
            status_code=400,
            detail="Your email is managed by Google and cannot be changed here.",
        )

    # Email-auth users must confirm with their current password
    if doc.get("password_hash"):
        if not payload.password:
            raise HTTPException(
                status_code=400,
                detail="Please enter your current password to change your email.",
            )
        if not verify_password(payload.password, doc["password_hash"]):
            raise HTTPException(status_code=400, detail="Incorrect password.")

    if new_email == doc["email"].lower():
        raise HTTPException(status_code=400, detail="That is already your current email address.")

    conflict = await db.users.find_one({"email": new_email}, {"_id": 0, "user_id": 1})
    if conflict:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists.",
        )

    # Invalidate any previous pending tokens
    await db.email_change_tokens.update_many(
        {"user_id": user.user_id, "used": False},
        {"$set": {
            "used": True,
            "invalidated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    token      = secrets.token_urlsafe(48)
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    await db.email_change_tokens.insert_one({
        "token_hash": token_hash,
        "user_id":    user.user_id,
        "new_email":  new_email,
        "used":       False,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    verify_url = f"{FRONTEND_URL}/dashboard/settings?verify_email={token}"

    try:
        await send_resend_email(
            to=new_email,
            subject="Verify your new PetBill Shield email address",
            template_key="verify_email_change",
            template_variables={
                "new_email": new_email,
                "verify_url": verify_url,
                "expires_hours": 24,
                "frontend_url": FRONTEND_URL,
            },
            html=f"""
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;line-height:1.7;color:#2D2C28;">
              <h2 style="margin-bottom:8px;">Verify your new email</h2>
              <p>You requested to change your PetBill Shield login email to
                 <strong>{new_email}</strong>.</p>
              <p>Click the button below to confirm. This link expires in <strong>24 hours</strong>.</p>
              <p style="margin:28px 0;">
                <a href="{verify_url}"
                   style="background:#D26D53;color:white;padding:13px 26px;
                          text-decoration:none;border-radius:8px;font-weight:600;
                          font-size:15px;">
                  Verify new email
                </a>
              </p>
              <p style="color:#65635C;font-size:13px;">
                If you didn't request this, you can safely ignore this email.
                Your account remains unchanged.
              </p>
            </div>
            """,
        )
    except Exception as e:
        logger.warning(f"Email change send failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not send verification email. Please try again.",
        )

    return {
        "ok": True,
        "message": f"Verification email sent to {new_email}. Click the link in that email to confirm.",
    }


@router.get("/user/verify-email")
async def verify_email_change(
    token: str = Query(...),
    user: User  = Depends(get_current_user),
):
    token_hash = _hash_token(token)

    record = await db.email_change_tokens.find_one(
        {"token_hash": token_hash, "used": False},
        {"_id": 0},
    )
    if not record:
        raise HTTPException(
            status_code=400,
            detail="Invalid or already-used verification link.",
        )

    if record["user_id"] != user.user_id:
        raise HTTPException(status_code=403, detail="This link does not belong to your account.")

    expires_at = record.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=400,
            detail="This verification link has expired. Please request a new one.",
        )

    new_email = record["new_email"]

    # Race-condition guard
    conflict = await db.users.find_one({"email": new_email}, {"_id": 0, "user_id": 1})
    if conflict and conflict["user_id"] != user.user_id:
        raise HTTPException(status_code=400, detail="This email address is already in use.")

    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "email":            new_email,
            "email_updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await db.email_change_tokens.update_one(
        {"token_hash": token_hash},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}},
    )
    # Revoke all sessions so user re-authenticates with new email
    await db.user_sessions.delete_many({"user_id": user.user_id})

    return {
        "ok": True,
        "new_email": new_email,
        "message": "Email updated. Please sign in again with your new address.",
    }


@router.delete("/user/change-email")
async def cancel_email_change(user: User = Depends(get_current_user)):
    """Cancel any pending email-change token for this user."""
    result = await db.email_change_tokens.update_many(
        {"user_id": user.user_id, "used": False},
        {"$set": {
            "used": True,
            "invalidated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True, "cancelled": result.modified_count}


@router.delete("/user/account")
async def delete_account(
    payload: DeleteAccountRequest,
    user: User = Depends(get_current_user),
):
    if payload.confirm != "DELETE":
        raise HTTPException(status_code=400, detail="Confirmation text must be exactly 'DELETE'.")

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    if doc.get("password_hash"):
        if not payload.password:
            raise HTTPException(status_code=400, detail="Password is required to delete your account.")
        if not verify_password(payload.password, doc["password_hash"]):
            raise HTTPException(status_code=400, detail="Incorrect password.")

    uid = user.user_id

    # Gather pet IDs for cascade
    pet_docs = await db.pets.find({"user_id": uid}, {"pet_id": 1}).to_list(None)
    pet_ids  = [p["pet_id"] for p in pet_docs]

    # Cascade delete
    await db.users.delete_one({"user_id": uid})
    await db.user_sessions.delete_many({"user_id": uid})
    await db.pets.delete_many({"user_id": uid})
    if pet_ids:
        await db.pet_records.delete_many({"pet_id": {"$in": pet_ids}})
        await db.pet_health_markers.delete_many({"pet_id": {"$in": pet_ids}})
    await db.estimates.delete_many({"user_id": uid})
    await db.claims.delete_many({"user_id": uid})
    await db.scripts.delete_many({"user_id": uid})
    await db.reminders.delete_many({"user_id": uid})
    await db.estimate_comparisons.delete_many({"user_id": uid})
    await db.uploaded_files.delete_many({"user_id": uid})
    await db.ai_usage.delete_many({"user_id": uid})
    await db.feedback.delete_many({"user_id": uid})
    await db.email_change_tokens.delete_many({"user_id": uid})
    await db.password_reset_tokens.delete_many({"user_id": uid})

    logger.info(f"Account deleted: {uid}")
    return {"ok": True}
