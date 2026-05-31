from pathlib import Path
from datetime import datetime, timezone, timedelta
import uuid
from urllib.parse import urlencode

import httpx
import secrets
import hashlib
from pydantic import BaseModel, EmailStr
import resend
from fastapi import APIRouter, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import RedirectResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from app.shared import (
    ROOT_DIR,
    db,
    os,
    IS_PRODUCTION,
    BACKEND_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    FRONTEND_URL,
    User,
    SessionExchangeRequest,
    EmailSignupRequest,
    EmailLoginRequest,
    get_current_user,
    create_user_session,
    hash_password,
    verify_password,
    validate_password_strength,
    _is_admin_email,
    _hash_session_token,
    check_magic_bytes,
    SENDER_EMAIL,
    limiter,
    logger,
)

router = APIRouter()


@router.post("/auth/profile-picture")
@limiter.limit("10/hour")
async def upload_profile_picture(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    allowed = ["image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Use JPG, PNG, or WEBP")

    contents = await file.read()

    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 2MB")

    # Validate actual file content, not just the declared Content-Type
    if not check_magic_bytes(contents, file.content_type):
        raise HTTPException(status_code=400, detail="File content does not match the declared image type")

    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }[file.content_type]

    upload_dir = ROOT_DIR / "uploads" / "profile_pictures"
    upload_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{user.user_id}.{ext}"
    path = upload_dir / filename

    with open(path, "wb") as f:
        f.write(contents)

    picture_url = f"/uploads/profile_pictures/{filename}"

    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"picture": picture_url}}
    )

    return {"picture": picture_url}


# -------------------- Auth Endpoints --------------------
@router.post("/auth/session")
async def auth_exchange_session(payload: SessionExchangeRequest, response: Response):
    """Exchange Emergent session_id for a session_token, persist user + session, set cookie."""
    if not payload.session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Failed to validate session with Emergent")

    data = r.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture") or ""
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=500, detail="Invalid response from auth provider")

    # Upsert user by email
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}}
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id":    user_id,
        "token_hash": _hash_session_token(session_token),  # store hash, not plaintext
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
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

    return {
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
        "session_token": session_token,
    }


@router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    return {
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "picture": user.picture,
        "is_admin": _is_admin_email(user.email),
    }


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not _is_admin_email(user.email):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


@router.post("/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
    if token:
        token_hash = _hash_session_token(token)
        # Delete by hash (current sessions) — also try plaintext for legacy sessions
        deleted = await db.user_sessions.delete_one({"token_hash": token_hash})
        if deleted.deleted_count == 0:
            await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


def hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/auth/forgot-password")
@limiter.limit("5/hour")
async def forgot_password(request: Request, payload: ForgotPasswordRequest):
    email = payload.email.lower().strip()

    # Always return the same response regardless of whether the account exists
    # — this prevents email enumeration attacks.
    SAFE_RESPONSE = {
        "ok": True,
        "message": "If an account exists for that email, a reset link has been sent. Check your inbox (and spam folder). The link expires in 30 minutes.",
    }

    user_doc = await db.users.find_one({"email": email}, {"_id": 0})
    if not user_doc:
        return SAFE_RESPONSE   # identical response — attacker can't tell

    token = secrets.token_urlsafe(48)
    token_hash = hash_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)

    await db.password_reset_tokens.insert_one({
        "token_hash": token_hash,
        "user_id":    user_doc["user_id"],
        "email":      email,
        "used":       False,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    reset_url = f"{FRONTEND_URL}/auth?reset_token={token}"

    try:
        resend.Emails.send({
            "from":    SENDER_EMAIL,
            "to":      email,
            "subject": "Reset your PetBill Shield password",
            "html": f"""
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <h2>Reset your password</h2>
                    <p>Click the button below to reset your PetBill Shield password.</p>
                    <p>
                        <a href="{reset_url}" style="background:#D26D53;color:white;padding:12px 18px;text-decoration:none;border-radius:6px;">
                            Reset password
                        </a>
                    </p>
                    <p>This link expires in 30 minutes. If you did not request this, you can safely ignore this email.</p>
                </div>
            """,
        })
    except Exception as e:
        logger.warning(f"Password reset email failed: {e}")
        # Still return the safe response — don't reveal that email failed

    return SAFE_RESPONSE


@router.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    token_hash = hash_reset_token(payload.token)

    reset_doc = await db.password_reset_tokens.find_one({
        "token_hash": token_hash,
        "used": False,
    }, {"_id": 0})

    if not reset_doc:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    expires_at = reset_doc.get("expires_at")

    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset link has expired")

    validate_password_strength(payload.password)

    await db.users.update_one(
        {"user_id": reset_doc["user_id"]},
        {
            "$set": {
                "password_hash": hash_password(payload.password),
                "auth_provider": "email",
                "password_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    await db.password_reset_tokens.update_one(
        {"token_hash": token_hash},
        {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}},
    )

    await db.user_sessions.delete_many({"user_id": reset_doc["user_id"]})

    return {
        "ok": True,
        "message": "Password reset successful. Please sign in with your new password.",
    }


@router.post("/auth/signup")
@limiter.limit("10/hour")
async def auth_signup(request: Request, payload: EmailSignupRequest, response: Response):
    email = payload.email.lower().strip()
    first_name = payload.first_name.strip().capitalize()
    last_name = payload.last_name.strip().capitalize()
    password = payload.password

    validate_password_strength(password)

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    name = f"{first_name} {last_name}".strip()

    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "first_name": first_name,
        "last_name": last_name,
        "picture": "",
        "auth_provider": "email",
        "password_hash": hash_password(password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    session_token = await create_user_session(user_id, response)

    return {
        "user": {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": "",
        },
        "session_token": session_token,
    }


_MAX_LOGIN_ATTEMPTS = 10   # per 15 min window
_LOCKOUT_MINUTES    = 15

@router.post("/auth/login")
@limiter.limit("20/minute")
async def auth_login(request: Request, payload: EmailLoginRequest, response: Response):
    email = payload.email.lower().strip()
    password = payload.password

    # ── Failed-attempt lockout ───────────────────────────────────────────────
    window_start = (datetime.now(timezone.utc) - timedelta(minutes=_LOCKOUT_MINUTES)).isoformat()
    recent_fails = await db.login_attempts.count_documents({
        "email": email, "success": False, "created_at": {"$gte": window_start},
    })
    if recent_fails >= _MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed login attempts. Please try again in {_LOCKOUT_MINUTES} minutes.",
        )

    async def _record(success: bool):
        await db.login_attempts.insert_one({
            "email":      email,
            "success":    success,
            "ip":         request.client.host if request.client else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    user_doc = await db.users.find_one({"email": email}, {"_id": 0})
    if not user_doc:
        await _record(False)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    password_hash = user_doc.get("password_hash")
    if not password_hash:
        await _record(False)
        raise HTTPException(status_code=401, detail="This account uses Google sign-in")

    if not verify_password(password, password_hash):
        await _record(False)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await _record(True)
    session_token = await create_user_session(user_doc["user_id"], response)

    return {
        "user": {
            "user_id": user_doc["user_id"],
            "email":   user_doc["email"],
            "name":    user_doc.get("name", ""),
            "picture": user_doc.get("picture", ""),
        },
        "session_token": session_token,
    }


@router.get("/auth/google/login")
async def google_login(request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google login is not configured")

    # Optional ?next= param so admin portal can request a redirect-back
    next_url = request.query_params.get("next", "")

    state = uuid.uuid4().hex

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": os.environ.get("GOOGLE_REDIRECT_URI", f"{BACKEND_URL.rstrip('/')}/api/auth/google/callback"),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }

    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)

    redirect = RedirectResponse(url)
    redirect.set_cookie(
        key="google_oauth_state",
        value=state,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        path="/",
        max_age=10 * 60,
    )
    # Store the desired post-login destination (e.g. /admin-portal)
    if next_url:
        redirect.set_cookie(
            key="google_oauth_next",
            value=next_url,
            httponly=True,
            secure=IS_PRODUCTION,
            samesite="lax",
            path="/",
            max_age=10 * 60,
        )

    return redirect


@router.get("/auth/google/callback")
async def google_callback(request: Request):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google login is not configured")

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    saved_state = request.cookies.get("google_oauth_state")

    if not code:
        raise HTTPException(status_code=400, detail="Missing Google authorization code")

    if not state or state != saved_state:
        raise HTTPException(status_code=400, detail="Invalid Google login state")

    token_url = "https://oauth2.googleapis.com/token"

    async with httpx.AsyncClient(timeout=20.0) as client:
        token_response = await client.post(
            token_url,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": os.environ.get("GOOGLE_REDIRECT_URI", f"{BACKEND_URL.rstrip('/')}/api/auth/google/callback"),
                "grant_type": "authorization_code",
            },
        )

    if token_response.status_code != 200:
        try:
            error_payload = token_response.json()
        except Exception:
            error_payload = {"raw": token_response.text[:500]}
        logger.warning(
            "Google token exchange failed status=%s error=%s description=%s",
            token_response.status_code,
            error_payload.get("error"),
            error_payload.get("error_description") or error_payload.get("raw"),
        )
        raise HTTPException(status_code=401, detail="Failed to verify Google login")

    tokens = token_response.json()
    google_id_token = tokens.get("id_token")

    if not google_id_token:
        raise HTTPException(status_code=401, detail="Google did not return an ID token")

    info = id_token.verify_oauth2_token(
        google_id_token,
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )

    email = (info.get("email") or "").lower().strip()
    name = info.get("name") or email
    picture = info.get("picture") or ""

    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email")

    if not info.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google account email is not verified")

    existing = await db.users.find_one({"email": email}, {"_id": 0})

    if existing:
        user_id = existing["user_id"]

        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "name": name,
                    "picture": picture,
                    "auth_provider": "google",
                    "last_login_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"

        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "first_name": info.get("given_name", ""),
            "last_name": info.get("family_name", ""),
            "picture": picture,
            "auth_provider": "google",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "last_login_at": datetime.now(timezone.utc).isoformat(),
        })

    # If a ?next= was stored before the OAuth flow, honour it; else go to dashboard
    next_url = request.cookies.get("google_oauth_next", "")
    # Only allow same-origin relative paths for security
    safe_next = next_url if (next_url.startswith("/") and not next_url.startswith("//")) else "/dashboard"

    # ── Admin-portal guard ────────────────────────────────────────────────────
    # If the OAuth flow was initiated from /admin-portal, block anyone whose
    # email is not in ADMIN_EMAILS — do NOT create a session for them.
    if safe_next.startswith("/admin-portal") and not _is_admin_email(email):
        reject = RedirectResponse(f"{FRONTEND_URL}/admin-portal?error=unauthorized")
        reject.delete_cookie("google_oauth_state", path="/")
        reject.delete_cookie("google_oauth_next",  path="/")
        return reject
    # ─────────────────────────────────────────────────────────────────────────

    redirect = RedirectResponse(f"{FRONTEND_URL}{safe_next}")
    redirect.delete_cookie("google_oauth_state", path="/")
    redirect.delete_cookie("google_oauth_next",  path="/")

    await create_user_session(user_id, redirect)

    return redirect
