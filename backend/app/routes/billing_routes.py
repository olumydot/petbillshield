from fastapi import APIRouter
from app.shared import *

router = APIRouter()

# ── Plan tier ordering (mirrors frontend PLAN_TIER) ───────────────────────────
PLAN_TIER_BACKEND: dict = {
    "free":           0,
    "free_tier":      0,
    "vault_monthly":  1,
    "vault_yearly":   1,
    "family_monthly": 2,
    "family_yearly":  2,
    "rescue_monthly": 3,
    "rescue_yearly":  3,
}

def _plan_tier(plan_id: str) -> int:
    return PLAN_TIER_BACKEND.get(plan_id or "free", 0)

def _is_plan_upgrade(from_plan: str, to_plan: str) -> bool:
    """
    Returns True if switching to *to_plan* grants more access or a better
    billing cycle (same-tier monthly → yearly).  Upgrades are applied
    immediately with proration; everything else is deferred to period-end.
    """
    ft = _plan_tier(from_plan)
    tt = _plan_tier(to_plan)
    if tt > ft:
        return True
    if tt == ft and ft > 0:
        # Same access tier: monthly → yearly is always the better deal
        return (from_plan or "").endswith("_monthly") and (to_plan or "").endswith("_yearly")
    return False

# Reverse map: stripe_price_id → our plan_id (built once at import time)
_PRICE_TO_PLAN: dict = {
    v["stripe_price_id"]: k
    for k, v in PLANS.items()
    if v.get("stripe_price_id")
}
_PROMO_BANNER_KEY = "promo_banner"


def _public_plan(plan: dict) -> dict:
    if not plan:
        return {}
    return {k: v for k, v in plan.items() if k != "stripe_price_id"}


def _public_plans() -> dict:
    return {plan_id: _public_plan(plan) for plan_id, plan in PLANS.items()}


def _parse_promo_date(value: str):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


async def _validate_published_promo(code: str, plan_id: str) -> dict:
    normalized = (code or "").strip().upper()
    if not normalized:
        return {}

    promo = await db.site_content.find_one({"key": _PROMO_BANNER_KEY}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc)
    starts_at = _parse_promo_date(promo.get("starts_at"))
    expires_at = _parse_promo_date(promo.get("expires_at"))
    allowed_plan_ids = promo.get("allowed_plan_ids") or []
    plan_scope = (promo.get("plan_scope") or "all").strip().lower()

    if not promo.get("enabled") or (promo.get("promo_code") or "").strip().upper() != normalized:
        raise HTTPException(status_code=400, detail="That promo is not currently available.")
    if starts_at and starts_at > now:
        raise HTTPException(status_code=400, detail="That promo is not active yet.")
    if expires_at and expires_at < now:
        raise HTTPException(status_code=400, detail="That promo has expired.")
    if plan_scope == "yearly" and not (plan_id or "").endswith("_yearly"):
        raise HTTPException(status_code=400, detail="That promo is only valid for yearly plans.")
    if plan_scope == "monthly" and not (plan_id or "").endswith("_monthly"):
        raise HTTPException(status_code=400, detail="That promo is only valid for monthly plans.")
    if allowed_plan_ids and plan_id not in allowed_plan_ids:
        raise HTTPException(status_code=400, detail="That promo is not valid for this plan.")

    return promo


async def _stripe_promotion_code(code: str):
    normalized = (code or "").strip().upper()
    codes = await asyncio.to_thread(
        stripe_sdk.PromotionCode.list,
        code=normalized,
        active=True,
        limit=1,
    )
    if not codes.data:
        raise HTTPException(status_code=400, detail="That promo code is invalid or has expired.")
    return codes.data[0]


def _validate_stripe_promotion_terms(promotion_code, promo: dict, plan_id: str) -> None:
    coupon = getattr(promotion_code, "coupon", None)
    if not coupon:
        raise HTTPException(status_code=400, detail="That promo code is invalid or has expired.")

    required_percent = promo.get("required_percent_off")
    required_months = promo.get("required_duration_months")
    annual_equivalent = (
        bool(required_percent)
        and bool(required_months)
        and (plan_id or "").endswith("_yearly")
        and int(required_months or 0) < 12
    )

    if required_percent:
        percent_off = getattr(coupon, "percent_off", None)
        expected_percent = (
            float(required_percent) * (int(required_months or 0) / 12)
            if annual_equivalent
            else float(required_percent)
        )
        if percent_off is None or round(float(percent_off), 4) != round(expected_percent, 4):
            detail = (
                f"For yearly plans, create this Stripe coupon as {expected_percent:g}% off once "
                f"to equal {required_percent}% off the first {required_months} months."
                if annual_equivalent
                else f"That promo must be {required_percent}% off to match this offer."
            )
            raise HTTPException(
                status_code=400,
                detail=detail,
            )

    if annual_equivalent:
        duration = getattr(coupon, "duration", None)
        if duration != "once":
            raise HTTPException(
                status_code=400,
                detail="For yearly plans, this Stripe coupon must be one-time so it only discounts the first annual invoice.",
            )
    elif required_months:
        duration = getattr(coupon, "duration", None)
        duration_months = getattr(coupon, "duration_in_months", None)
        if duration != "repeating" or int(duration_months or 0) != int(required_months):
            raise HTTPException(
                status_code=400,
                detail=f"That promo must apply for the first {required_months} months to match this offer.",
            )

# -------------------- Billing / Stripe --------------------
class CheckoutCreateRequest(BaseModel):
    plan_id:    str
    origin_url: str             # e.g., window.location.origin
    coupon_code: Optional[str] = None  # optional Stripe promo/coupon code


def _stripe(host_url: str) -> StripeCheckout:
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")
    webhook_url = f"{host_url.rstrip('/')}/api/webhook/stripe"
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@router.post("/billing/checkout")
async def billing_create_checkout(
    payload: CheckoutCreateRequest,
    http_request: Request,
    user: User = Depends(get_current_user),
):
    plan = PLANS.get(payload.plan_id)

    if not plan:
        raise HTTPException(status_code=400, detail="Unknown plan")

    if plan.get("kind") != "subscription":
        raise HTTPException(status_code=400, detail="This plan is not a subscription")

    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(
            status_code=503,
            detail="Subscriptions require a real Stripe API key, not the Emergent test proxy.",
        )

    if not plan.get("stripe_price_id"):
        raise HTTPException(
            status_code=500,
            detail=f"Stripe price ID is missing for {payload.plan_id}",
        )

    origin = payload.origin_url.rstrip("/")

    # ── Guard: do not create duplicate or conflicting subscriptions ──
    caller_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    # If we already have an open Checkout Session for this plan, resume it
    # instead of creating a fresh session every click.
    resumed_checkout = await _resume_open_checkout_session(user.user_id, payload.plan_id)
    if resumed_checkout:
        return resumed_checkout

    # Older builds used a direct Subscription + PaymentIntent path that could
    # leave a user locally flagged as "incomplete". Checkout Sessions can start
    # cleanly once we drop that stale local marker.
    if (caller_doc.get("subscription_status") or "").strip().lower() == "incomplete":
        await _clear_local_incomplete_subscription(user.user_id)
        caller_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    local_subscription_id = caller_doc.get("stripe_subscription_id")
    local_subscription_status = (caller_doc.get("subscription_status") or "").strip().lower()
    if local_subscription_id and local_subscription_status in _BLOCKING_SUBSCRIPTION_STATUSES:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"
        try:
            await asyncio.to_thread(
                stripe_sdk.Subscription.retrieve,
                local_subscription_id,
            )
        except Exception as e:
            if _is_missing_subscription_error(e):
                await _clear_stale_missing_subscription(user.user_id, local_subscription_id)
                caller_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
            else:
                logger.warning(
                    f"checkout: could not verify local subscription {local_subscription_id}: {e}"
                )

    conflict_detail = _subscription_creation_conflict_detail(caller_doc)
    if conflict_detail:
        if (caller_doc.get("subscription_status") or "").strip().lower() == "incomplete":
            raise HTTPException(
                status_code=409,
                detail={
                    "message": conflict_detail,
                    "resume_url": f"{origin}/dashboard/checkout?plan={payload.plan_id}",
                },
            )
        raise HTTPException(status_code=409, detail=conflict_detail)

    success_url = f"{origin}/dashboard/pricing?session_id={{CHECKOUT_SESSION_ID}}&plan={payload.plan_id}"
    cancel_url = f"{origin}/dashboard/pricing?canceled=1"

    metadata = {
        "user_id": user.user_id,
        "user_email": user.email,
        "plan_id": payload.plan_id,
        "plan_label": plan["label"],
        "kind": plan["kind"],
        "period_days": str(plan["period_days"] or 30),
    }

    # Get or create Stripe customer so the session is linked to the right account
    caller_doc2 = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stripe_customer_id = caller_doc2.get("stripe_customer_id")

    try:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"

        stripe_customer_id = await _get_or_create_stripe_customer(
            user,
            stripe_customer_id,
        )

        # ── Authoritative double-billing guard ──────────────────────────────
        # Ask Stripe (not our local DB) whether this customer already has a
        # live subscription. This closes the window where a paid user whose
        # local record never flipped to "active" could check out a second time.
        existing_sub = await _stripe_blocking_subscription(stripe_customer_id)
        if existing_sub:
            existing_status = stripe_value(existing_sub, "status", "")
            # Self-heal: sync our DB to Stripe's truth so the UI unlocks too.
            try:
                price_id = existing_sub["items"]["data"][0]["price"]["id"]
                healed_plan = _PRICE_TO_PLAN.get(price_id)
                if healed_plan and existing_status in ("active", "trialing"):
                    pe = stripe_value(existing_sub, "current_period_end", None)
                    exp = (
                        datetime.fromtimestamp(int(pe), tz=timezone.utc).isoformat()
                        if pe else None
                    )
                    await _grant_entitlement(
                        user_id=user.user_id,
                        plan_id=healed_plan,
                        stripe_customer_id=stripe_customer_id,
                        stripe_subscription_id=stripe_value(existing_sub, "id", None),
                        expires_at_override=exp,
                    )
                    await db.users.update_one(
                        {"user_id": user.user_id},
                        {"$set": {"subscription_status": "active"}, "$unset": {"pending_plan_id": ""}},
                    )
            except Exception as heal_err:
                logger.warning(f"double-bill guard self-heal failed: {heal_err}")

            if existing_status in ("active", "trialing"):
                raise HTTPException(
                    status_code=409,
                    detail="You already have an active subscription. Use the Plans page to change your plan instead of subscribing again.",
                )
            if existing_status == "incomplete":
                raise HTTPException(
                    status_code=409,
                    detail="You have a payment already in progress. Please complete or cancel it before starting a new one.",
                )
            raise HTTPException(
                status_code=409,
                detail="Your existing subscription needs payment attention. Please update your billing method before subscribing again.",
            )

        # Build session kwargs — optionally apply a promo/coupon code.
        # ui_mode="embedded" + redirect_on_completion="never" is REQUIRED for the
        # frontend <EmbeddedCheckout> component to fire its onComplete callback
        # (instead of redirecting). Without this the payment succeeds on Stripe's
        # side but the browser never learns, so the modal spins forever.
        sess_kwargs: dict = dict(
            customer=stripe_customer_id,
            mode="subscription",
            line_items=[{"price": plan["stripe_price_id"], "quantity": 1}],
            ui_mode="embedded",
            redirect_on_completion="never",
            metadata=metadata,
        )
        if payload.coupon_code:
            promo = await _validate_published_promo(payload.coupon_code, payload.plan_id)
            promotion_code = await _stripe_promotion_code(payload.coupon_code)
            _validate_stripe_promotion_terms(promotion_code, promo, payload.plan_id)
            sess_kwargs["discounts"] = [{"promotion_code": promotion_code.id}]
            metadata["promo_code"] = payload.coupon_code.strip().upper()

        try:
            sess = await asyncio.to_thread(
                stripe_sdk.checkout.Session.create,
                **sess_kwargs,
            )
        except stripe_sdk.error.InvalidRequestError as e:
            if not _is_missing_customer_error(e):
                raise

            await _clear_stale_missing_customer(user.user_id, stripe_customer_id)
            stripe_customer_id = await _get_or_create_stripe_customer(user)
            sess_kwargs["customer"] = stripe_customer_id
            sess = await asyncio.to_thread(
                stripe_sdk.checkout.Session.create,
                **sess_kwargs,
            )

    except HTTPException:
        # Promo validation (and other deliberate 4xx) must reach the client with
        # their real status + message — never get masked as a generic 502.
        raise
    except stripe_sdk.error.InvalidRequestError as e:
        # Coupon not found or expired — give a user-friendly message
        err_str = str(e).lower()
        if "coupon" in err_str or "discount" in err_str or "promo" in err_str:
            raise HTTPException(
                status_code=400,
                detail="That promo code is invalid or has expired. Please try without it.",
            )
        logger.exception(f"Subscription checkout failed: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not create checkout session. Please try again.",
        )
    except Exception as e:
        logger.exception(f"Subscription checkout failed: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not create checkout session. Please try again.",
        )

    await db.payment_transactions.insert_one({
        "session_id": sess.id,
        "user_id": user.user_id,
        "user_email": user.email,
        "plan_id": payload.plan_id,
        "plan_label": plan["label"],
        "kind": plan["kind"],
        "mode": "subscription",
        "amount": float(plan["amount"]),
        "currency": plan["currency"],
        "status": "initiated",
        "payment_status": "pending",
        "metadata": metadata,
        "stripe_customer_id": stripe_customer_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entitled": False,
    })

    return {
        "client_secret": sess.client_secret,
        "session_id":    sess.id,
        "mode":          "subscription",
    }


# ── Promo validation — single source of truth for the frontend ───────────────
class ValidatePromoRequest(BaseModel):
    code:    str
    plan_id: str


@router.post("/billing/validate-promo")
async def billing_validate_promo(
    payload: ValidatePromoRequest,
    user: User = Depends(get_current_user),
):
    """
    Authoritatively validate a promo code for a given plan BEFORE checkout.
    The frontend must call this and only show a discount when valid=True.
    Runs the exact same checks the checkout endpoint enforces:
      1. Code matches an enabled, in-window admin promo banner
      2. The code exists as an active Stripe promotion code
      3. The Stripe coupon's terms match the advertised offer
    Raises 400 with a specific reason if any check fails.
    """
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter a promo code.")
    if payload.plan_id not in PLANS:
        raise HTTPException(status_code=400, detail="Unknown plan.")

    # 1) Admin gating — this raises 400 if the code isn't the live published promo
    promo = await _validate_published_promo(code, payload.plan_id)
    # 2) Must be a real, active Stripe promotion code
    promotion_code = await _stripe_promotion_code(code)
    # 3) Stripe coupon terms must match the advertised offer
    _validate_stripe_promotion_terms(promotion_code, promo, payload.plan_id)

    return {
        "valid":            True,
        "promo_code":       code,
        "discount_display": promo.get("discount_display") or "",
        "plan_scope":       (promo.get("plan_scope") or "all"),
        "required_percent_off":     promo.get("required_percent_off"),
        "required_duration_months": promo.get("required_duration_months"),
    }


# ── PaymentElement-based subscription (no Stripe-hosted page) ────────────────

class SubscribeRequest(BaseModel):
    plan_id: str


@router.post("/billing/subscribe")
async def billing_create_subscription(
    payload: SubscribeRequest,
    user: User = Depends(get_current_user),
):
    """
    Creates (or reuses) a Stripe Customer, then creates a Subscription
    with payment_behavior='default_incomplete'.  Returns the client_secret
    from the latest invoice's PaymentIntent so the frontend can confirm
    payment inline using Stripe's PaymentElement — no redirect to Stripe.
    """
    plan = PLANS.get(payload.plan_id)
    if not plan or plan.get("kind") != "subscription":
        raise HTTPException(status_code=400, detail="Unknown plan")

    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(
            status_code=503,
            detail="Subscriptions require a real Stripe API key.",
        )

    price_id = plan.get("stripe_price_id")
    if not price_id:
        raise HTTPException(
            status_code=500,
            detail=f"Stripe price ID missing for plan '{payload.plan_id}'",
        )

    # Guard: do not create duplicate or conflicting subscriptions
    caller_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    resumed = await _resume_incomplete_subscription(caller_doc, payload.plan_id)
    if resumed:
        return resumed

    local_subscription_id = caller_doc.get("stripe_subscription_id")
    local_subscription_status = (caller_doc.get("subscription_status") or "").strip().lower()
    if local_subscription_id and local_subscription_status in _BLOCKING_SUBSCRIPTION_STATUSES:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"
        try:
            await asyncio.to_thread(
                stripe_sdk.Subscription.retrieve,
                local_subscription_id,
                expand=["latest_invoice.payments"],
            )
        except Exception as e:
            if _is_missing_subscription_error(e):
                await _clear_stale_missing_subscription(user.user_id, local_subscription_id)
                caller_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
            else:
                logger.warning(
                    f"subscribe: could not verify local subscription {local_subscription_id}: {e}"
                )

    conflict_detail = _subscription_creation_conflict_detail(caller_doc)
    if conflict_detail:
        raise HTTPException(status_code=409, detail=conflict_detail)

    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    # ── Get or create Stripe Customer ──────────────────────────────────────
    stripe_customer_id = caller_doc.get("stripe_customer_id")
    try:
        stripe_customer_id = await _get_or_create_stripe_customer(
            user,
            stripe_customer_id,
        )
    except Exception as e:
        logger.exception(f"Stripe Customer.create failed: {e}")
        raise HTTPException(status_code=502, detail="Could not create Stripe customer.")

    # ── Create Subscription (incomplete — confirmed by frontend) ───────────
    # NOTE: Stripe SDK ≥ v15 (API 2025-03-31) removed invoice.payment_intent.
    # We now expand latest_invoice.payments and retrieve the PaymentIntent
    # separately to get the client_secret.
    try:
        subscription = await asyncio.to_thread(
            stripe_sdk.Subscription.create,
            customer=stripe_customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            payment_settings={"save_default_payment_method": "on_subscription"},
            expand=["latest_invoice.payments"],
            metadata={
                "user_id":    user.user_id,
                "plan_id":    payload.plan_id,
                "plan_label": plan["label"],
            },
        )
    except Exception as e:
        logger.exception(f"Stripe Subscription.create failed: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not create subscription. Please try again.",
        )

    # Pull client_secret via the new payments list (SDK ≥ v15 / API 2025-03-31)
    try:
        inv_data          = subscription.latest_invoice._data
        payments_list     = inv_data["payments"]["data"]
        payment_intent_id = payments_list[0]["payment"]["payment_intent"]
    except (KeyError, IndexError, AttributeError, TypeError) as e:
        logger.error(f"Could not extract payment_intent_id from subscription: {e}")
        raise HTTPException(status_code=502, detail="Stripe returned an unexpected response.")

    try:
        pi            = await asyncio.to_thread(stripe_sdk.PaymentIntent.retrieve, payment_intent_id)
        client_secret = pi.client_secret
    except Exception as e:
        logger.exception(f"Stripe PaymentIntent.retrieve failed: {e}")
        raise HTTPException(status_code=502, detail="Could not retrieve payment details from Stripe.")

    # Store the pending subscription so webhooks can find this user
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "stripe_customer_id":    stripe_customer_id,
            "stripe_subscription_id": subscription.id,
            "subscription_status":   "incomplete",
            "pending_plan_id":       payload.plan_id,
        }},
    )

    # Also log in payment_transactions for audit trail
    await db.payment_transactions.insert_one({
        "payment_intent_id":      payment_intent_id,
        "subscription_id":        subscription.id,
        "user_id":                user.user_id,
        "user_email":             user.email,
        "plan_id":                payload.plan_id,
        "plan_label":             plan["label"],
        "kind":                   plan["kind"],
        "mode":                   "subscription",
        "amount":                 float(plan["amount"]),
        "currency":               plan["currency"],
        "status":                 "incomplete",
        "payment_status":         "pending",
        "stripe_customer_id":     stripe_customer_id,
        "stripe_subscription_id": subscription.id,
        "entitled":               False,
        "created_at":             datetime.now(timezone.utc).isoformat(),
        "updated_at":             datetime.now(timezone.utc).isoformat(),
    })

    return {
        "client_secret":   client_secret,
        "subscription_id": subscription.id,
        "payment_intent_id": payment_intent_id,
        "plan_id":         payload.plan_id,
    }


# ── Payment confirmation — called by frontend after stripe.confirmPayment() ──
# This is the authoritative activation path. Instead of relying on webhooks
# (which don't fire in local dev) or polling subscription status (which has
# a race window), we verify the PaymentIntent directly with Stripe — if it
# has succeeded, the payment is real and we grant the entitlement immediately.

class ConfirmPaymentRequest(BaseModel):
    payment_intent_id: str
    subscription_id: str


@router.post("/billing/confirm-payment")
async def billing_confirm_payment(
    payload: ConfirmPaymentRequest,
    user: User = Depends(get_current_user),
):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    # ── 1. Verify the PaymentIntent with Stripe ──────────────────────────────
    try:
        pi = await asyncio.to_thread(
            stripe_sdk.PaymentIntent.retrieve, payload.payment_intent_id
        )
    except Exception as e:
        logger.error(f"confirm-payment: could not retrieve PaymentIntent: {e}")
        raise HTTPException(status_code=502, detail="Could not verify payment with Stripe.")

    pi_status = stripe_value(pi, "status", "")
    pi_customer = stripe_value(pi, "customer", None)

    if pi_status != "succeeded":
        raise HTTPException(
            status_code=400,
            detail=f"Payment is not complete yet (status: {pi_status}). Please try again in a moment.",
        )

    # ── 2. Ensure the PaymentIntent belongs to this user's customer ──────────
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stored_customer_id = user_doc.get("stripe_customer_id")
    if stored_customer_id and pi_customer and stored_customer_id != pi_customer:
        logger.warning(
            f"confirm-payment: customer mismatch for user {user.user_id} "
            f"(stored={stored_customer_id}, pi={pi_customer})"
        )
        raise HTTPException(status_code=403, detail="Payment does not belong to this account.")

    stored_subscription_id = user_doc.get("stripe_subscription_id")
    if stored_subscription_id and stored_subscription_id != payload.subscription_id:
        logger.warning(
            f"confirm-payment: subscription mismatch for user {user.user_id} "
            f"(stored={stored_subscription_id}, payload={payload.subscription_id})"
        )
        raise HTTPException(status_code=403, detail="Subscription does not belong to this account.")

    # ── 3. Resolve the plan ──────────────────────────────────────────────────
    plan_id = user_doc.get("pending_plan_id") or user_doc.get("plan_id")

    # Fallback: read from subscription items
    if not plan_id or plan_id in ("free", "free_tier"):
        try:
            sub = await asyncio.to_thread(
                stripe_sdk.Subscription.retrieve, payload.subscription_id
            )
            items_raw = stripe_value(sub, "items", {})
            items_data = (
                items_raw.data if hasattr(items_raw, "data")
                else items_raw.get("data", []) if isinstance(items_raw, dict)
                else []
            )
            if items_data:
                price_obj = stripe_value(items_data[0], "price", {})
                price_id = (
                    price_obj.get("id") if isinstance(price_obj, dict)
                    else getattr(price_obj, "id", None)
                )
                plan_id = _PRICE_TO_PLAN.get(price_id) or plan_id
        except Exception as e:
            logger.warning(f"confirm-payment: could not read subscription items: {e}")

    if not plan_id or plan_id in ("free", "free_tier"):
        raise HTTPException(status_code=400, detail="Could not determine the subscribed plan.")

    # ── 4. Grant entitlement ─────────────────────────────────────────────────
    await _grant_entitlement(
        user_id=user.user_id,
        plan_id=plan_id,
        stripe_customer_id=stored_customer_id or pi_customer,
        stripe_subscription_id=payload.subscription_id,
    )

    # Mark the subscription as active in our DB and clear the pending flag
    await db.users.update_one(
        {"user_id": user.user_id},
        {
            "$set":   {"subscription_status": "active"},
            "$unset": {"pending_plan_id": ""},
        },
    )

    logger.info(
        f"confirm-payment: granted '{plan_id}' to user {user.user_id} "
        f"via PI {payload.payment_intent_id}"
    )

    # ── 5. Return fresh billing state ────────────────────────────────────────
    updated = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    # Welcome email
    asyncio.create_task(email_welcome(
        email=user.email,
        name=getattr(user, "name", ""),
        plan_label=PLANS.get(plan_id, {}).get("label", plan_id),
        plan_id=plan_id,
        expires_at=updated.get("entitlement_expires_at"),
    ))
    plan_meta = PLANS.get(plan_id) or {}
    return {
        "active":                  True,
        "plan_id":                 plan_id,
        "plan_label":              plan_meta.get("label", plan_id),
        "entitlement_expires_at":  updated.get("entitlement_expires_at"),
        "subscription_status":     "active",
    }


async def _grant_entitlement(
    user_id: str,
    plan_id: str,
    stripe_customer_id: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    expires_at_override: Optional[str] = None,
):
    plan = PLANS.get(plan_id) or {}
    period_days = plan.get("period_days") or 30

    current_user = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0}
    ) or {}

    existing_active_pet_ids = current_user.get("active_pet_ids", [])
    existing_active_set     = set(existing_active_pet_ids)

    # Fetch all pets with creation date so we can rank them
    all_user_pets_raw = await db.pets.find(
        {"user_id": user_id},
        {"_id": 0, "pet_id": 1, "created_at": 1, "name": 1},
    ).to_list(1000)

    all_pet_ids = [p["pet_id"] for p in all_user_pets_raw]
    limit = get_pet_limit_for_plan(plan_id)

    if limit is None:
        # Unlimited plan (Rescue/Foster) — every pet is active
        new_active_pet_ids = all_pet_ids

    elif len(all_pet_ids) <= limit:
        # Upgrading or already within the new limit — all pets active
        new_active_pet_ids = all_pet_ids

    else:
        # ── Downgrade: must select which pets stay active ────────────────────
        # Rank pets by most recent usage (last bill analysis), falling back to
        # creation date.  Most-used pets get to keep their active status.

        # Build a map: pet_id → ISO timestamp of most recent activity
        pet_activity: dict[str, str] = {}
        for pet in all_user_pets_raw:
            pid = pet["pet_id"]
            last_est = await db.estimates.find_one(
                {"user_id": user_id, "pet_id": pid},
                {"_id": 0, "created_at": 1},
                sort=[("created_at", -1)],
            )
            if last_est and last_est.get("created_at"):
                pet_activity[pid] = str(last_est["created_at"])
            else:
                # Fall back to pet's own creation date
                pet_activity[pid] = str(pet.get("created_at") or "")

        # Sort all pets: most recently active first
        all_pet_ids_ranked = sorted(
            all_pet_ids,
            key=lambda pid: pet_activity.get(pid, ""),
            reverse=True,
        )

        # Priority order:
        #   1. Currently active pets (preserve continuity for the user),
        #      sorted by most recent activity first
        #   2. Currently inactive pets, sorted by most recent activity
        # Take the first `limit` from this combined list.
        active_ranked   = [pid for pid in all_pet_ids_ranked if pid in existing_active_set]
        inactive_ranked = [pid for pid in all_pet_ids_ranked if pid not in existing_active_set]

        new_active_pet_ids = (active_ranked + inactive_ranked)[:limit]

        # ── Build downgrade notice for the user ──────────────────────────────
        new_active_set   = set(new_active_pet_ids)
        deactivated_ids  = [
            pid for pid in all_pet_ids if pid not in new_active_set
        ]

        if deactivated_ids:
            logger.info(
                f"Downgrade for user {user_id} to '{plan_id}': "
                f"deactivated {len(deactivated_ids)} pet(s): {deactivated_ids}"
            )

            # Build a pet_id → info map for the notice
            pet_info = {p["pet_id"]: p for p in all_user_pets_raw}

            def _activity_label(pid: str) -> str:
                """Human-readable last-activity label for a pet."""
                ts = pet_activity.get(pid, "")
                if not ts:
                    return "no analyses yet"
                try:
                    dt = datetime.fromisoformat(ts)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    delta = datetime.now(timezone.utc) - dt
                    days = delta.days
                    if days == 0:
                        return "analyzed today"
                    if days == 1:
                        return "analyzed yesterday"
                    if days < 30:
                        return f"analyzed {days} days ago"
                    months = days // 30
                    return f"analyzed {months} month{'s' if months > 1 else ''} ago"
                except Exception:
                    return "recently active"

            kept_pets = [
                {
                    "pet_id": pid,
                    "name":   pet_info.get(pid, {}).get("name", "Unknown"),
                    "reason": _activity_label(pid),
                }
                for pid in new_active_pet_ids
            ]
            deactivated_pets = [
                {
                    "pet_id": pid,
                    "name":   pet_info.get(pid, {}).get("name", "Unknown"),
                }
                for pid in deactivated_ids
            ]

            old_plan_label = current_user.get("plan_label", current_user.get("plan_id", "previous plan"))
            new_plan_label = plan.get("label", plan_id)

            await db.downgrade_notices.insert_one({
                "notice_id":        f"dn_{uuid.uuid4().hex[:10]}",
                "user_id":          user_id,
                "old_plan_label":   old_plan_label,
                "new_plan_label":   new_plan_label,
                "pet_limit":        limit,
                "kept_pets":        kept_pets,
                "deactivated_pets": deactivated_pets,
                "selection_rule":   "most recently analyzed bill",
                "shown_count":      0,           # incremented each login it's shown
                "dismissed":        False,
                "created_at":       datetime.now(timezone.utc).isoformat(),
            })

    if expires_at_override:
        expires_at = expires_at_override
    else:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(days=int(period_days))
        ).isoformat()

    update = {
        "plan_id": plan_id,
        "plan_label": plan.get("label", plan_id),
        "plan_kind": "subscription",
        "entitlement_expires_at": expires_at,
        "subscription_status": "active",
        "upgraded_at": datetime.now(timezone.utc).isoformat(),
        "active_pet_ids": new_active_pet_ids,
        "pet_limit": limit,
    }

    if stripe_customer_id:
        update["stripe_customer_id"] = stripe_customer_id

    if stripe_subscription_id:
        update["stripe_subscription_id"] = stripe_subscription_id

    await db.users.update_one(
        {"user_id": user_id},
        {"$set": update}
    )


# ══════════════════════════════════════════════════════════════════════════════
# Billing email helpers
# All emails are fire-and-forget — never raise, always log failures.
# ══════════════════════════════════════════════════════════════════════════════

def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso)
        return dt.strftime("%B %d, %Y")
    except Exception:
        return iso[:10] if iso else "—"


def _pending_downgrade_is_due(user_doc: dict, now: Optional[datetime] = None) -> bool:
    """
    Returns True only once the scheduled downgrade date has actually arrived.

    Stripe may emit `customer.subscription.updated` immediately after the
    subscription price is pointed at a lower tier. We intentionally keep the
    user's current entitlement until period-end, so webhook handlers must not
    apply the lower access level early.
    """
    pending_at = user_doc.get("pending_downgrade_at")
    if not pending_at:
        return False

    try:
        due_at = datetime.fromisoformat(str(pending_at).replace("Z", "+00:00"))
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
    except Exception:
        return False

    return due_at <= (now or datetime.now(timezone.utc))


_BLOCKING_SUBSCRIPTION_STATUSES = {
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "incomplete",
}


async def _resume_open_checkout_session(user_id: str, requested_plan_id: str) -> Optional[dict]:
    """
    Reuses an open Checkout Session for the same user/plan when one exists.

    This prevents users from getting stuck in a loop of "in progress" attempts
    while still letting us discard expired or already-paid sessions cleanly.
    """
    if not user_id or not requested_plan_id or not STRIPE_API_KEY:
        return None

    tx = await db.payment_transactions.find_one(
        {
            "user_id": user_id,
            "plan_id": requested_plan_id,
            "session_id": {"$exists": True, "$ne": None},
            "entitled": {"$ne": True},
            "payment_status": {"$in": ["pending", "unpaid", None]},
        },
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not tx or not tx.get("session_id"):
        return None

    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        sess = await asyncio.to_thread(
            stripe_sdk.checkout.Session.retrieve,
            tx["session_id"],
        )
    except Exception as e:
        logger.warning(
            f"resume-checkout: could not retrieve session {tx.get('session_id')}: {e}"
        )
        return None

    session_status = stripe_value(sess, "status", "") or ""
    payment_status = stripe_value(sess, "payment_status", "") or ""
    session_ui_mode = stripe_value(sess, "ui_mode", "") or ""

    # Only resume sessions created with the CURRENT integration (embedded).
    # A session created under an older ui_mode hands back a client_secret that
    # the current <EmbeddedCheckout> frontend can't use — which manifests as a
    # checkout that spins forever. Discard it so a fresh session is created.
    if session_status == "open" and payment_status != "paid" and session_ui_mode == "embedded":
        client_secret = stripe_value(sess, "client_secret", None)
        if client_secret:
            return {
                "client_secret": client_secret,
                "session_id": tx["session_id"],
                "mode": "subscription",
                "reused_existing": True,
            }
        return None

    # Stale / mismatched session — mark the local record so we stop resuming it.
    if session_ui_mode and session_ui_mode != "embedded":
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {"$set": {"payment_status": "expired", "status": "stale_ui_mode"}},
        )
        return None

    # Keep our local audit trail in sync when the session can no longer be used.
    if session_status or payment_status:
        await db.payment_transactions.update_one(
            {"session_id": tx["session_id"]},
            {
                "$set": {
                    "status": session_status or tx.get("status") or "initiated",
                    "payment_status": payment_status or tx.get("payment_status") or "pending",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )

    return None


async def _clear_local_incomplete_subscription(user_id: str):
    """Drops locally tracked incomplete subscription state so checkout can restart cleanly."""
    if not user_id:
        return
    await db.users.update_one(
        {"user_id": user_id},
        {
            "$unset": {
                "stripe_subscription_id": "",
                "subscription_status": "",
                "pending_plan_id": "",
            }
        },
    )


async def _clear_stale_missing_subscription(user_id: str, subscription_id: Optional[str] = None):
    """
    Clears locally stored Stripe subscription state when Stripe reports that
    the subscription no longer exists.

    This most often happens after switching environments or when a previously
    incomplete checkout was deleted remotely. We intentionally keep entitlement
    history intact and only remove the blocking Stripe linkage/state.
    """
    if not user_id:
        return

    logger.info(
        f"billing self-heal: clearing stale Stripe subscription state for "
        f"user {user_id} subscription {subscription_id or 'unknown'}"
    )

    await db.users.update_one(
        {"user_id": user_id},
        {
            "$unset": {
                "stripe_subscription_id": "",
                "subscription_status": "",
                "pending_plan_id": "",
                "cancel_at_period_end": "",
                "cancel_at": "",
                "pending_downgrade_plan_id": "",
                "pending_downgrade_label": "",
                "pending_downgrade_at": "",
            }
        },
    )


async def _clear_stale_missing_customer(user_id: str, customer_id: Optional[str] = None):
    """
    Clears locally stored Stripe customer state when Stripe reports that the
    customer no longer exists. This can happen when moving from test to live
    mode because test customers are not available to the live API.
    """
    if not user_id:
        return

    logger.info(
        f"billing self-heal: clearing stale Stripe customer state for "
        f"user {user_id} customer {customer_id or 'unknown'}"
    )

    await db.users.update_one(
        {"user_id": user_id},
        {
            "$unset": {
                "stripe_customer_id": "",
                "stripe_subscription_id": "",
                "subscription_status": "",
                "pending_plan_id": "",
                "cancel_at_period_end": "",
                "cancel_at": "",
                "pending_downgrade_plan_id": "",
                "pending_downgrade_label": "",
                "pending_downgrade_at": "",
            }
        },
    )


def _is_missing_subscription_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "no such subscription" in message
        or "resource_missing" in message
        or "invalid_request_error" in message and "subscription" in message
    )


def _is_missing_customer_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "no such customer" in message
        or ("resource_missing" in message and "customer" in message)
        or ("invalid_request_error" in message and "customer" in message)
    )


async def _get_or_create_stripe_customer(user: User, existing_customer_id: Optional[str] = None) -> str:
    """
    Returns a valid Stripe customer ID for the current Stripe environment.

    Local users can retain test-mode customer IDs after switching to live mode.
    We verify the saved customer before reuse and create a fresh one when Stripe
    says it does not exist.
    """
    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    if existing_customer_id:
        try:
            existing = await asyncio.to_thread(stripe_sdk.Customer.retrieve, existing_customer_id)
            if stripe_value(existing, "deleted", False):
                await _clear_stale_missing_customer(user.user_id, existing_customer_id)
            else:
                return existing_customer_id
        except Exception as e:
            if not _is_missing_customer_error(e):
                raise
            await _clear_stale_missing_customer(user.user_id, existing_customer_id)

    customer = await asyncio.to_thread(
        stripe_sdk.Customer.create,
        email=user.email,
        metadata={"user_id": user.user_id},
    )
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {"stripe_customer_id": customer.id}},
    )
    return customer.id


async def _resume_incomplete_subscription(doc: dict, requested_plan_id: str) -> Optional[dict]:
    """
    Reuses an existing incomplete Stripe subscription when possible.

    If the tracked subscription is stale, missing, or belongs to a different
    requested plan, we clear the local incomplete state and let checkout create
    a fresh subscription instead.
    """
    subscription_id = doc.get("stripe_subscription_id")
    if not subscription_id:
        return None

    local_status = (doc.get("subscription_status") or "").strip().lower()
    if local_status != "incomplete":
        return None

    stripe_sdk.api_key = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        subscription = await asyncio.to_thread(
            stripe_sdk.Subscription.retrieve,
            subscription_id,
            expand=["latest_invoice.payments"],
        )
    except Exception as e:
        logger.warning(
            f"resume-incomplete: could not retrieve subscription {subscription_id}: {e}"
        )
        await _clear_local_incomplete_subscription(doc.get("user_id"))
        return None

    stripe_status = (stripe_value(subscription, "status", "") or "").strip().lower()
    tracked_plan_id = doc.get("pending_plan_id") or doc.get("plan_id")

    if stripe_status in {"canceled", "incomplete_expired"}:
        await _clear_local_incomplete_subscription(doc.get("user_id"))
        return None

    # If the user chose a different plan than the stranded incomplete
    # subscription, restart cleanly on the newly requested plan.
    if requested_plan_id and tracked_plan_id and requested_plan_id != tracked_plan_id:
        logger.info(
            f"resume-incomplete: clearing mismatched incomplete subscription "
            f"{subscription_id} for user {doc.get('user_id')} "
            f"(tracked={tracked_plan_id}, requested={requested_plan_id})"
        )
        await _clear_local_incomplete_subscription(doc.get("user_id"))
        return None

    if stripe_status in {"active", "trialing"}:
        healed_plan_id = tracked_plan_id or requested_plan_id
        if healed_plan_id and healed_plan_id not in {"free", "free_tier"}:
            await _grant_entitlement(
                user_id=doc.get("user_id"),
                plan_id=healed_plan_id,
                stripe_customer_id=doc.get("stripe_customer_id"),
                stripe_subscription_id=subscription_id,
            )
        await db.users.update_one(
            {"user_id": doc.get("user_id")},
            {
                "$set": {"subscription_status": stripe_status},
                "$unset": {"pending_plan_id": ""},
            },
        )
        return {
            "already_active": True,
            "plan_id": healed_plan_id,
            "subscription_id": subscription_id,
        }

    if stripe_status not in {"incomplete", "past_due", "unpaid"}:
        await _clear_local_incomplete_subscription(doc.get("user_id"))
        return None

    try:
        inv_data = subscription.latest_invoice._data
        payments_list = inv_data["payments"]["data"]
        payment_intent_id = payments_list[0]["payment"]["payment_intent"]
        payment_intent = await asyncio.to_thread(
            stripe_sdk.PaymentIntent.retrieve, payment_intent_id
        )
        client_secret = payment_intent.client_secret
    except (KeyError, IndexError, AttributeError, TypeError, Exception) as e:
        logger.warning(
            f"resume-incomplete: could not extract payment details from {subscription_id}: {e}"
        )
        await _clear_local_incomplete_subscription(doc.get("user_id"))
        return None

    if requested_plan_id and requested_plan_id != tracked_plan_id:
        tracked_plan_id = requested_plan_id

    if tracked_plan_id:
        await db.users.update_one(
            {"user_id": doc.get("user_id")},
            {"$set": {"pending_plan_id": tracked_plan_id}},
        )

    return {
        "client_secret": client_secret,
        "subscription_id": subscription_id,
        "payment_intent_id": payment_intent_id,
        "plan_id": tracked_plan_id or requested_plan_id,
        "reused_existing": True,
    }


async def _stripe_blocking_subscription(customer_id: str) -> Optional[dict]:
    """
    Authoritative double-billing guard. Asks Stripe directly whether this
    customer already has a subscription that should block a new checkout.
    Returns the offending subscription dict, or None if it's safe to proceed.

    This does NOT trust the local DB flag (which can be stale if a webhook or
    onComplete was missed) — it is the source of truth that prevents a user
    from ever being billed twice for overlapping subscriptions.
    """
    if not customer_id:
        return None
    try:
        subs = await asyncio.to_thread(
            stripe_sdk.Subscription.list,
            customer=customer_id,
            status="all",
            limit=20,
        )
    except Exception as e:
        # If Stripe is unreachable, fail OPEN is risky (double-bill) but failing
        # closed blocks legitimate first-time buyers. We log and allow, because
        # the post-payment webhook + local guards still catch most cases.
        logger.warning(f"double-bill guard: could not list subscriptions for {customer_id}: {e}")
        return None

    blocking_states = {"active", "trialing", "past_due", "unpaid", "incomplete"}
    for s in subs.data:
        if stripe_value(s, "status", "") in blocking_states:
            return s
    return None


def _subscription_creation_conflict_detail(doc: dict) -> Optional[str]:
    """
    Returns a user-facing blocker message when creating a new subscription
    would conflict with one already tracked on the account.
    """
    if not doc.get("stripe_subscription_id"):
        return None

    status = (doc.get("subscription_status") or "").strip().lower()
    if status not in _BLOCKING_SUBSCRIPTION_STATUSES:
        return None

    if status in {"active", "trialing"}:
        return (
            "You already have an active subscription. "
            "Use POST /billing/switch to change your plan mid-cycle."
        )
    if status == "incomplete":
        return (
            "You already have a subscription checkout in progress. "
            "Please finish that payment before starting a new one."
        )
    return (
        "Your subscription needs payment attention before you start a new one. "
        "Please update your billing method or retry the existing invoice first."
    )


def _should_send_renewal_success_email(invoice_obj: dict, old_expires: Optional[str]) -> bool:
    """
    Renewal emails are only for actual cycle renewals.
    Stripe also emits invoice.paid for first-time subscriptions and for
    mid-cycle subscription updates with proration.
    """
    billing_reason = (invoice_obj or {}).get("billing_reason")
    return bool(old_expires) and billing_reason == "subscription_cycle"

def _fmt_usd(amount) -> str:
    try:
        return f"${float(amount):.2f}"
    except Exception:
        return str(amount)

_EMAIL_BASE = """
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{{font-family:'Helvetica Neue',Arial,sans-serif;background:#FAF9F6;margin:0;padding:0;color:#2D2C28}}
  .wrap{{max-width:540px;margin:32px auto;background:#fff;border-radius:20px;border:1px solid #E5E2D9;overflow:hidden}}
  .header{{background:#2D2C28;padding:28px 36px;text-align:center}}
  .logo{{color:#FAF9F6;font-size:20px;font-weight:700;letter-spacing:-0.3px}}
  .logo span{{color:#D26D53}}
  .body{{padding:36px}}
  .badge{{display:inline-block;background:#D26D53;color:#fff;border-radius:30px;padding:4px 14px;font-size:12px;font-weight:600;margin-bottom:18px}}
  .badge.green{{background:#556045}}
  .badge.amber{{background:#E6AE2E;color:#2D2C28}}
  .badge.red{{background:#C0392B}}
  h2{{margin:0 0 12px;font-size:24px;line-height:1.2;color:#2D2C28}}
  p{{margin:0 0 16px;font-size:15px;color:#65635C;line-height:1.6}}
  .card{{background:#FAF9F6;border:1px solid #E5E2D9;border-radius:14px;padding:18px 22px;margin:20px 0}}
  .card-row{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F0EDE8;font-size:14px}}
  .card-row:last-child{{border-bottom:none}}
  .card-label{{color:#8A887F}}
  .card-value{{font-weight:600;color:#2D2C28}}
  .btn{{display:inline-block;background:#D26D53;color:#fff;padding:13px 28px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0}}
  .btn.ghost{{background:transparent;border:2px solid #E5E2D9;color:#65635C}}
  .footer{{background:#F2F0E9;padding:20px 36px;text-align:center;font-size:12px;color:#8A887F}}
  .divider{{height:1px;background:#E5E2D9;margin:20px 0}}
  .alert{{background:#FEF6E4;border:1px solid #E6AE2E;border-radius:12px;padding:14px 18px;margin:16px 0;font-size:14px;color:#8A5A24}}
  .alert.red{{background:#FEF0EE;border-color:#F2C5B7;color:#8C2D14}}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">PetBill <span>Shield</span></div></div>
  <div class="body">{body}</div>
  <div class="footer">
    PetBill Shield · Protecting pet owners since day one<br>
    <a href="{frontend_url}/dashboard/pricing" style="color:#D26D53;text-decoration:none">Manage subscription</a>
    &nbsp;·&nbsp;
    <a href="{frontend_url}/contact" style="color:#D26D53;text-decoration:none">Contact support</a>
  </div>
</div></body></html>
"""

def _build_email(body: str) -> str:
    return _EMAIL_BASE.format(body=body, frontend_url=FRONTEND_URL)

async def email_welcome(email: str, name: str, plan_label: str,
                        plan_id: str, expires_at: Optional[str]) -> None:
    plan = PLANS.get(plan_id) or {}
    price = _fmt_usd(plan.get("amount", 0))
    freq  = "month" if "monthly" in plan_id else "year"
    first_name = (name or "there").split()[0]
    html = _build_email(f"""
<div class="badge green">Welcome aboard 🎉</div>
<h2>You're subscribed to {plan_label}!</h2>
<p>Hi {first_name}, your subscription is active. Here's a summary:</p>
<div class="card">
  <div class="card-row"><span class="card-label">Plan</span><span class="card-value">{plan_label}</span></div>
  <div class="card-row"><span class="card-label">Billing</span><span class="card-value">{price} / {freq}</span></div>
  <div class="card-row"><span class="card-label">Next renewal</span><span class="card-value">{_fmt_date(expires_at)}</span></div>
</div>
<p>You now have access to all {plan_label} features — unlimited bill analyses, your pet vault, insurance claim help, and more.</p>
<a href="{FRONTEND_URL}/dashboard/analyze" class="btn">Analyze your first bill →</a>
<div class="divider"></div>
<p style="font-size:13px;color:#8A887F">Questions? Just reply to this email or visit our <a href="{FRONTEND_URL}/contact" style="color:#D26D53">contact page</a>. You can manage or cancel your plan at any time from your account.</p>
""")
    await send_resend_email(
        to=email,
        subject=f"Welcome to {plan_label} — PetBill Shield",
        html=html,
        template_key="welcome",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "plan_id": plan_id,
            "price": price,
            "billing_frequency": freq,
            "expires_at": _fmt_date(expires_at),
            "dashboard_url": f"{FRONTEND_URL}/dashboard",
            "analyze_url": f"{FRONTEND_URL}/dashboard/analyze",
            "contact_url": f"{FRONTEND_URL}/contact",
        },
    )


async def _queue_welcome_email_once(
    *,
    session_id: str,
    user_id: str,
    plan_id: str,
    user_doc: Optional[dict] = None,
) -> bool:
    """
    Sends the welcome email at most once per Checkout Session.

    Checkout success can be observed from either the client-side polling path
    or the Stripe webhook path. We guard on the transaction row so both routes
    can safely attempt to queue the email without double-sending it.
    """
    if not session_id or not user_id or not plan_id:
        return False

    if user_doc is None:
        user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}

    email = (user_doc or {}).get("email", "")
    if not email:
        return False

    marked = await db.payment_transactions.update_one(
        {
            "session_id": session_id,
            "user_id": user_id,
            "welcome_email_sent_at": {"$exists": False},
        },
        {
            "$set": {
                "welcome_email_sent_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    if not marked.modified_count:
        return False

    asyncio.create_task(email_welcome(
        email=email,
        name=(user_doc or {}).get("name", ""),
        plan_label=(user_doc or {}).get("plan_label") or plan_id,
        plan_id=plan_id,
        expires_at=(user_doc or {}).get("entitlement_expires_at"),
    ))
    return True


async def email_renewal_success(email: str, name: str, plan_label: str,
                                plan_id: str, next_renewal: Optional[str]) -> None:
    plan = PLANS.get(plan_id) or {}
    price = _fmt_usd(plan.get("amount", 0))
    freq  = "month" if "monthly" in plan_id else "year"
    first_name = (name or "there").split()[0]
    html = _build_email(f"""
<div class="badge green">Renewed ✓</div>
<h2>Your subscription has renewed</h2>
<p>Hi {first_name}, your {plan_label} subscription has automatically renewed. Your access continues uninterrupted.</p>
<div class="card">
  <div class="card-row"><span class="card-label">Plan</span><span class="card-value">{plan_label}</span></div>
  <div class="card-row"><span class="card-label">Amount charged</span><span class="card-value">{price}</span></div>
  <div class="card-row"><span class="card-label">Next renewal</span><span class="card-value">{_fmt_date(next_renewal)}</span></div>
</div>
<a href="{FRONTEND_URL}/dashboard" class="btn">Go to dashboard →</a>
<div class="divider"></div>
<p style="font-size:13px;color:#8A887F">If you didn't expect this charge, <a href="{FRONTEND_URL}/contact" style="color:#D26D53">contact us</a> and we'll help you out.</p>
""")
    await send_resend_email(
        to=email,
        subject=f"Your {plan_label} subscription has renewed — PetBill Shield",
        html=html,
        template_key="renewal_success",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "plan_id": plan_id,
            "price": price,
            "billing_frequency": freq,
            "next_renewal": _fmt_date(next_renewal),
            "dashboard_url": f"{FRONTEND_URL}/dashboard",
            "pricing_url": f"{FRONTEND_URL}/dashboard/pricing",
        },
    )


async def email_renewal_reminder(email: str, name: str, plan_label: str,
                                 plan_id: str, days_left: int, renewal_date: Optional[str]) -> None:
    plan = PLANS.get(plan_id) or {}
    price = _fmt_usd(plan.get("amount", 0))
    freq  = "month" if "monthly" in plan_id else "year"
    first_name = (name or "there").split()[0]
    html = _build_email(f"""
<div class="badge amber">Renewing in {days_left} day{"s" if days_left != 1 else ""}</div>
<h2>Your subscription renews soon</h2>
<p>Hi {first_name}, just a heads-up — your <strong>{plan_label}</strong> subscription will renew in <strong>{days_left} day{"s" if days_left != 1 else ""}</strong>.</p>
<div class="card">
  <div class="card-row"><span class="card-label">Plan</span><span class="card-value">{plan_label}</span></div>
  <div class="card-row"><span class="card-label">Renewal amount</span><span class="card-value">{price} / {freq}</span></div>
  <div class="card-row"><span class="card-label">Renewal date</span><span class="card-value">{_fmt_date(renewal_date)}</span></div>
</div>
<p>Renewal happens automatically — no action needed. If you want to make changes, you can do so from your account before the renewal date.</p>
<a href="{FRONTEND_URL}/dashboard/pricing" class="btn">Manage subscription →</a>
""")
    await send_resend_email(
        to=email,
        subject=f"Your {plan_label} subscription renews in {days_left} days — PetBill Shield",
        html=html,
        template_key="renewal_reminder",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "plan_id": plan_id,
            "price": price,
            "billing_frequency": freq,
            "days_left": days_left,
            "renewal_date": _fmt_date(renewal_date),
            "pricing_url": f"{FRONTEND_URL}/dashboard/pricing",
        },
    )


async def email_payment_failed(email: str, name: str, plan_label: str,
                               next_attempt: Optional[str] = None) -> None:
    first_name = (name or "there").split()[0]
    attempt_line = f"<div class='card-row'><span class='card-label'>Next retry</span><span class='card-value'>{_fmt_date(next_attempt)}</span></div>" if next_attempt else ""
    html = _build_email(f"""
<div class="badge red">Action required</div>
<h2>We couldn't process your payment</h2>
<p>Hi {first_name}, your payment for <strong>{plan_label}</strong> didn't go through. Your access continues for now, but please update your payment method to avoid losing access.</p>
<div class="card">
  <div class="card-row"><span class="card-label">Plan</span><span class="card-value">{plan_label}</span></div>
  {attempt_line}
</div>
<div class="alert red">If payment continues to fail, your subscription will be paused and your account will revert to the free tier.</div>
<p>Common fixes: make sure your card hasn't expired and you have sufficient funds. Stripe will retry automatically.</p>
<a href="{FRONTEND_URL}/dashboard/pricing" class="btn">Update payment method →</a>
""")
    await send_resend_email(
        to=email,
        subject=f"Payment failed for your {plan_label} subscription — PetBill Shield",
        html=html,
        template_key="payment_failed",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "next_attempt": _fmt_date(next_attempt),
            "pricing_url": f"{FRONTEND_URL}/dashboard/pricing",
        },
    )


async def email_subscription_canceled(email: str, name: str, plan_label: str,
                                      access_until: Optional[str]) -> None:
    first_name = (name or "there").split()[0]
    html = _build_email(f"""
<div class="badge">Subscription cancelled</div>
<h2>Your subscription has been cancelled</h2>
<p>Hi {first_name}, we've cancelled your <strong>{plan_label}</strong> subscription as requested.</p>
<div class="card">
  <div class="card-row"><span class="card-label">Access until</span><span class="card-value">{_fmt_date(access_until)}</span></div>
  <div class="card-row"><span class="card-label">After that</span><span class="card-value">Free tier (data kept)</span></div>
</div>
<p>You'll keep full {plan_label} access until the end of your billing period. After that, your account automatically moves to the free tier — your pet data and history are never deleted.</p>
<p>Changed your mind? You can reactivate before the end date.</p>
<a href="{FRONTEND_URL}/dashboard/pricing" class="btn">Reactivate subscription →</a>
<div class="divider"></div>
<p style="font-size:13px;color:#8A887F">We'd love to know what we could do better. <a href="{FRONTEND_URL}/contact" style="color:#D26D53">Leave us a note</a> — it really helps.</p>
""")
    await send_resend_email(
        to=email,
        subject=f"Subscription cancelled — your access continues until {_fmt_date(access_until)}",
        html=html,
        template_key="subscription_canceled",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "access_until": _fmt_date(access_until),
            "pricing_url": f"{FRONTEND_URL}/dashboard/pricing",
            "contact_url": f"{FRONTEND_URL}/contact",
        },
    )


async def email_subscription_reactivated(email: str, name: str, plan_label: str,
                                         renews_at: Optional[str]) -> None:
    first_name = (name or "there").split()[0]
    html = _build_email(f"""
<div class="badge green">Reactivated ✓</div>
<h2>Your subscription is back on!</h2>
<p>Hi {first_name}, great news — your <strong>{plan_label}</strong> subscription has been reactivated. The scheduled cancellation has been removed.</p>
<div class="card">
  <div class="card-row"><span class="card-label">Plan</span><span class="card-value">{plan_label}</span></div>
  <div class="card-row"><span class="card-label">Next renewal</span><span class="card-value">{_fmt_date(renews_at)}</span></div>
</div>
<p>Everything continues as normal. Your access is fully active and will auto-renew.</p>
<a href="{FRONTEND_URL}/dashboard" class="btn">Back to dashboard →</a>
""")
    await send_resend_email(
        to=email,
        subject=f"Your {plan_label} subscription is reactivated — PetBill Shield",
        html=html,
        template_key="subscription_reactivated",
        template_variables={
            "first_name": first_name,
            "plan_label": plan_label,
            "renews_at": _fmt_date(renews_at),
            "dashboard_url": f"{FRONTEND_URL}/dashboard",
        },
    )


async def email_plan_changed(email: str, name: str,
                             old_label: str, new_label: str,
                             is_upgrade: bool, effective_date: Optional[str]) -> None:
    first_name = (name or "there").split()[0]
    if is_upgrade:
        badge = '<div class="badge green">Plan upgraded ↑</div>'
        heading = f"You've upgraded to {new_label}"
        timing = "<p>Your new plan is <strong>active immediately</strong>. Enjoy all the extra features!</p>"
        date_label = "Access from"
    else:
        badge = '<div class="badge amber">Plan change scheduled</div>'
        heading = f"Plan change to {new_label} scheduled"
        timing = f"<p>You'll keep <strong>{old_label}</strong> access until your current billing period ends. After that, your plan switches to <strong>{new_label}</strong>.</p>"
        date_label = "Switches on"
    html = _build_email(f"""
{badge}
<h2>{heading}</h2>
<div class="card">
  <div class="card-row"><span class="card-label">Previous plan</span><span class="card-value">{old_label}</span></div>
  <div class="card-row"><span class="card-label">New plan</span><span class="card-value">{new_label}</span></div>
  <div class="card-row"><span class="card-label">{date_label}</span><span class="card-value">{_fmt_date(effective_date) if effective_date else "Immediately"}</span></div>
</div>
{timing}
<a href="{FRONTEND_URL}/dashboard/pricing" class="btn">View plan details →</a>
""")
    subject = f"{'Upgraded to' if is_upgrade else 'Plan switching to'} {new_label} — PetBill Shield"
    await send_resend_email(
        to=email,
        subject=subject,
        html=html,
        template_key="plan_changed",
        template_variables={
            "first_name": first_name,
            "old_label": old_label,
            "new_label": new_label,
            "is_upgrade": is_upgrade,
            "effective_date": _fmt_date(effective_date) if effective_date else "Immediately",
            "pricing_url": f"{FRONTEND_URL}/dashboard/pricing",
        },
    )


# ── Scheduled renewal reminder dispatch ──────────────────────────────────────

async def dispatch_renewal_reminders() -> None:
    """
    Runs daily.  Finds subscribers whose billing period ends in exactly 7 days
    (±12 h window) and sends a renewal reminder if one hasn't been sent yet for
    this period.
    """
    now      = datetime.now(timezone.utc)
    window_a = (now + timedelta(days=6, hours=12)).isoformat()
    window_b = (now + timedelta(days=7, hours=12)).isoformat()

    candidates = await db.users.find(
        {
            "subscription_status":   "active",
            "cancel_at_period_end":  {"$ne": True},
            "entitlement_expires_at": {"$gte": window_a, "$lte": window_b},
        },
        {"_id": 0, "user_id": 1, "email": 1, "name": 1,
         "plan_id": 1, "plan_label": 1,
         "entitlement_expires_at": 1, "renewal_reminder_7d_sent": 1},
    ).to_list(500)

    sent = 0
    for u in candidates:
        expires = u.get("entitlement_expires_at", "")
        # Only send once per billing period
        if u.get("renewal_reminder_7d_sent") == expires:
            continue
        days_left = max(1, int((datetime.fromisoformat(expires) - now).days + 1))
        plan_label = u.get("plan_label") or u.get("plan_id", "your plan")
        await email_renewal_reminder(
            email=u["email"],
            name=u.get("name", ""),
            plan_label=plan_label,
            plan_id=u.get("plan_id", ""),
            days_left=days_left,
            renewal_date=expires,
        )
        await db.users.update_one(
            {"user_id": u["user_id"]},
            {"$set": {"renewal_reminder_7d_sent": expires}},
        )
        sent += 1

    if sent:
        logger.info(f"Renewal reminders sent: {sent}")


@router.get("/billing/status/{session_id}")
async def billing_status(session_id: str, user: User = Depends(get_current_user)):
    tx = await db.payment_transactions.find_one(
        {"session_id": session_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    granted_now = False

    try:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"

        sess = await asyncio.to_thread(
            stripe_sdk.checkout.Session.retrieve,
            session_id
        )

        payment_status = getattr(sess, "payment_status", None)
        status = getattr(sess, "status", None)

        stripe_customer_id = getattr(sess, "customer", None)
        stripe_subscription_id = getattr(sess, "subscription", None)

        if payment_status == "paid" and not tx.get("entitled"):
            await _grant_entitlement(
                user_id=user.user_id,
                plan_id=tx["plan_id"],
                stripe_customer_id=stripe_customer_id,
                stripe_subscription_id=stripe_subscription_id,
            )

            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {
                    "$set": {
                        "payment_status": "paid",
                        "status": status or "complete",
                        "entitled": True,
                        "stripe_customer_id": stripe_customer_id,
                        "stripe_subscription_id": stripe_subscription_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )

            tx["payment_status"] = "paid"
            tx["status"] = status or "complete"
            tx["entitled"] = True
            granted_now = True
            refreshed_user = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
            await _queue_welcome_email_once(
                session_id=session_id,
                user_id=user.user_id,
                plan_id=tx["plan_id"],
                user_doc=refreshed_user,
            )

    except Exception as e:
        logger.warning(f"Stripe session retrieve failed: {e}")

    return {
        "payment_status": tx.get("payment_status", "pending"),
        "status": tx.get("status", "initiated"),
        "plan_id": tx.get("plan_id"),
        "amount": tx.get("amount"),
        "currency": tx.get("currency"),
        "entitled": bool(tx.get("entitled", False)),
        "granted_now": granted_now,
    }


STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()

    # ── Verify Stripe signature (CRITICAL security check) ────────────────────
    # Without this, anyone can POST fake events to grant themselves free access.
    if STRIPE_WEBHOOK_SECRET:
        sig_header = request.headers.get("stripe-signature", "")
        try:
            stripe_sdk.api_key = STRIPE_API_KEY
            event = await asyncio.to_thread(
                stripe_sdk.Webhook.construct_event,
                body,
                sig_header,
                STRIPE_WEBHOOK_SECRET,
            )
            payload    = event
            event_type = event["type"]
            obj        = event.get("data", {}).get("object", {}) or {}
        except stripe_sdk.error.SignatureVerificationError:
            logger.warning("Stripe webhook: invalid signature — request rejected")
            return JSONResponse({"received": False}, status_code=400)
        except Exception as e:
            logger.warning(f"Stripe webhook construct_event failed: {e}")
            return JSONResponse({"received": False}, status_code=400)
    else:
        # No webhook secret configured — fall back to raw parsing (dev only)
        logger.warning("STRIPE_WEBHOOK_SECRET not set — webhook signature not verified (dev mode)")
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except Exception:
            return JSONResponse({"received": False}, status_code=400)
        event_type = payload.get("type")
        obj = payload.get("data", {}).get("object", {}) or {}

    if event_type == "checkout.session.completed":
        session_id = obj.get("id")
        payment_status = obj.get("payment_status")
        metadata = obj.get("metadata", {}) or {}

        user_id = metadata.get("user_id")
        plan_id = metadata.get("plan_id")

        stripe_customer_id = obj.get("customer")
        stripe_subscription_id = obj.get("subscription")

        if session_id and user_id and plan_id and payment_status == "paid":
            await _grant_entitlement(
                user_id=user_id,
                plan_id=plan_id,
                stripe_customer_id=stripe_customer_id,
                stripe_subscription_id=stripe_subscription_id,
            )
            user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0}) or {}

            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {
                    "$set": {
                        "payment_status": "paid",
                        "status": "complete",
                        "entitled": True,
                        "stripe_customer_id": stripe_customer_id,
                        "stripe_subscription_id": stripe_subscription_id,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
            await _queue_welcome_email_once(
                session_id=session_id,
                user_id=user_id,
                plan_id=plan_id,
                user_doc=user_doc,
            )

    elif event_type == "customer.subscription.deleted":
        subscription_id = obj.get("id")

        if subscription_id:
            deleted_user = await db.users.find_one(
                {"stripe_subscription_id": subscription_id}, {"_id": 0}
            ) or {}
            await db.users.update_one(
                {"stripe_subscription_id": subscription_id},
                {
                    "$set": {
                        "subscription_status": "canceled",
                        "active": False,
                        "entitlement_expires_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    "$unset": {
                        "pending_plan_id": "",
                        "pending_downgrade_plan_id": "",
                        "pending_downgrade_plan_label": "",
                        "pending_downgrade_at": "",
                    },
                },
            )
            if deleted_user.get("email"):
                asyncio.create_task(email_subscription_canceled(
                    email=deleted_user["email"],
                    name=deleted_user.get("name", ""),
                    plan_label=deleted_user.get("plan_label") or deleted_user.get("plan_id", "your plan"),
                    access_until=deleted_user.get("entitlement_expires_at"),
                ))

    elif event_type == "invoice.payment_failed":
        subscription_id = obj.get("subscription")

        if subscription_id:
            await db.users.update_one(
                {"stripe_subscription_id": subscription_id},
                {
                    "$set": {
                        "subscription_status": "past_due",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
            # Payment failed email
            failed_user = await db.users.find_one(
                {"stripe_subscription_id": subscription_id}, {"_id": 0}
            ) or {}
            if failed_user.get("email"):
                next_attempt_ts = obj.get("next_payment_attempt")
                next_attempt = (
                    datetime.fromtimestamp(int(next_attempt_ts), tz=timezone.utc).isoformat()
                    if next_attempt_ts else None
                )
                asyncio.create_task(email_payment_failed(
                    email=failed_user["email"],
                    name=failed_user.get("name", ""),
                    plan_label=failed_user.get("plan_label") or failed_user.get("plan_id", "your plan"),
                    next_attempt=next_attempt,
                ))

    elif event_type == "invoice.paid":
        subscription_id = obj.get("subscription")

        if subscription_id:
            user_doc = await db.users.find_one(
                {"stripe_subscription_id": subscription_id},
                {"_id": 0},
            )

            if user_doc:
                # ── Detect plan from invoice line-item price (most reliable) ──
                lines = (obj.get("lines") or {}).get("data") or []
                invoice_price_id = None
                for line in lines:
                    price_obj = line.get("price") or {}
                    pid = (
                        price_obj.get("id")
                        if isinstance(price_obj, dict)
                        else getattr(price_obj, "id", None)
                    )
                    if pid:
                        invoice_price_id = pid
                        break

                detected_plan_id = _PRICE_TO_PLAN.get(invoice_price_id) if invoice_price_id else None
                stored_plan_id   = user_doc.get("plan_id")
                pending_plan_id  = user_doc.get("pending_downgrade_plan_id")

                # Priority: detected from invoice > pending downgrade > stored plan
                if detected_plan_id:
                    plan_to_grant = detected_plan_id
                elif pending_plan_id:
                    plan_to_grant = pending_plan_id
                else:
                    plan_to_grant = stored_plan_id

                if plan_to_grant:
                    old_expires = user_doc.get("entitlement_expires_at")
                    await _grant_entitlement(
                        user_id=user_doc["user_id"],
                        plan_id=plan_to_grant,
                        stripe_customer_id=user_doc.get("stripe_customer_id"),
                        stripe_subscription_id=subscription_id,
                    )
                    # Renewal email (skip for the very first invoice — that's the welcome email)
                    if _should_send_renewal_success_email(obj, old_expires):
                        refreshed = await db.users.find_one({"user_id": user_doc["user_id"]}, {"_id": 0}) or {}
                        asyncio.create_task(email_renewal_success(
                            email=user_doc.get("email", ""),
                            name=user_doc.get("name", ""),
                            plan_label=refreshed.get("plan_label") or plan_to_grant,
                            plan_id=plan_to_grant,
                            next_renewal=refreshed.get("entitlement_expires_at"),
                        ))

                # Clear pending downgrade if it just took effect
                if pending_plan_id and plan_to_grant == pending_plan_id:
                    await db.users.update_one(
                        {"user_id": user_doc["user_id"]},
                        {"$unset": {
                            "pending_downgrade_plan_id":    "",
                            "pending_downgrade_plan_label": "",
                            "pending_downgrade_at":         "",
                        }},
                    )

    elif event_type == "customer.subscription.updated":
        subscription_id      = obj.get("id")
        cancel_at_period_end = obj.get("cancel_at_period_end", False)
        sub_status           = obj.get("status")

        if subscription_id:
            user_doc = await db.users.find_one(
                {"stripe_subscription_id": subscription_id},
                {"_id": 0},
            )

            base_update = {
                "cancel_at_period_end": cancel_at_period_end,
                "subscription_status":  sub_status,
                "updated_at":           datetime.now(timezone.utc).isoformat(),
            }

            if user_doc:
                # Detect plan change by inspecting current subscription items
                items_obj  = obj.get("items") or {}
                items_data = items_obj.get("data") or []
                if items_data:
                    price_obj    = items_data[0].get("price") or {}
                    new_price_id = (
                        price_obj.get("id")
                        if isinstance(price_obj, dict)
                        else getattr(price_obj, "id", None)
                    )
                    new_plan_id  = _PRICE_TO_PLAN.get(new_price_id)
                    pending_plan = user_doc.get("pending_downgrade_plan_id")
                    current_plan = user_doc.get("plan_id")

                    # Stripe can surface the lower price before the current
                    # billing period ends. Only apply the pending downgrade
                    # when its scheduled effective date has arrived.
                    if (
                        new_plan_id
                        and pending_plan
                        and new_plan_id == pending_plan
                        and new_plan_id != current_plan
                        and _pending_downgrade_is_due(user_doc)
                    ):
                        await _grant_entitlement(
                            user_id                = user_doc["user_id"],
                            plan_id                = new_plan_id,
                            stripe_customer_id     = user_doc.get("stripe_customer_id"),
                            stripe_subscription_id = subscription_id,
                        )
                        await db.users.update_one(
                            {"user_id": user_doc["user_id"]},
                            {"$unset": {
                                "pending_downgrade_plan_id":    "",
                                "pending_downgrade_plan_label": "",
                                "pending_downgrade_at":         "",
                            }},
                        )

            await db.users.update_one(
                {"stripe_subscription_id": subscription_id},
                {"$set": base_update},
            )

    return {"received": True}


def stripe_value(obj, key, default=None):
    try:
        return obj[key]
    except Exception:
        return getattr(obj, key, default)


@router.get("/billing/me")
async def billing_me(user: User = Depends(get_current_user)):
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    plan_id = doc.get("plan_id")
    expires_at = doc.get("entitlement_expires_at")
    subscription_status = doc.get("subscription_status")
    cancel_at_period_end = doc.get("cancel_at_period_end", False)
    cancel_at = doc.get("cancel_at", None)
    is_canceling = cancel_at_period_end or bool(cancel_at)

    stripe_subscription_id = doc.get("stripe_subscription_id")

    if stripe_subscription_id and STRIPE_API_KEY:
        try:
            stripe_sdk.api_key = STRIPE_API_KEY
            stripe_sdk.api_base = "https://api.stripe.com"

            sub = await asyncio.to_thread(
                stripe_sdk.Subscription.retrieve,
                stripe_subscription_id,
            )

            cancel_at_period_end = bool(stripe_value(sub, "cancel_at_period_end", False))
            cancel_at = stripe_value(sub, "cancel_at", None)

            subscription_status = stripe_value(
                sub,
                "status",
                subscription_status,
            )

            current_period_end = stripe_value(sub, "current_period_end", None)

            # If Stripe gives cancel_at, treat it as scheduled cancellation
            is_canceling = cancel_at_period_end or bool(cancel_at)

            # Use current_period_end first, then cancel_at
            end_timestamp = current_period_end or cancel_at

            if end_timestamp:
                expires_at = datetime.fromtimestamp(
                    int(end_timestamp),
                    tz=timezone.utc,
                ).isoformat()

            # Build the DB update — NEVER overwrite a valid entitlement_expires_at
            # with None.  If the Stripe subscription doesn't provide a period end
            # (e.g. it's still "incomplete"), keep whatever is already stored.
            db_update: dict = {
                "cancel_at_period_end": is_canceling,
                "cancel_at":            cancel_at,
                "subscription_status":  subscription_status,
                "updated_at":           datetime.now(timezone.utc).isoformat(),
            }
            if expires_at:
                db_update["entitlement_expires_at"] = expires_at

            await db.users.update_one(
                {"user_id": user.user_id},
                {"$set": db_update},
            )

            # ── Self-heal: Stripe says active but webhook hasn't fired yet ──
            # The subscribe endpoint stores pending_plan_id but not plan_id.
            # If Stripe confirms the subscription is active and we still have
            # no plan_id (or only a free tier plan), resolve it now so the
            # user isn't stuck on free after paying.
            if subscription_status == "active" and (
                not plan_id or plan_id in ("free", "free_tier")
            ):
                # Prefer pending_plan_id set by /billing/subscribe
                heal_plan_id = doc.get("pending_plan_id")

                # Fallback: derive plan from the subscription's price item
                if not heal_plan_id:
                    try:
                        items_data = stripe_value(sub, "items", {})
                        if hasattr(items_data, "data"):
                            items_data = items_data.data
                        elif isinstance(items_data, dict):
                            items_data = items_data.get("data", [])
                        if items_data:
                            first_item = items_data[0]
                            price_obj  = stripe_value(first_item, "price", {})
                            price_id   = (
                                price_obj.get("id")
                                if isinstance(price_obj, dict)
                                else getattr(price_obj, "id", None)
                            )
                            heal_plan_id = _PRICE_TO_PLAN.get(price_id)
                    except Exception:
                        pass

                if heal_plan_id:
                    logger.info(
                        f"billing/me self-heal: granting '{heal_plan_id}' "
                        f"to user {user.user_id} (webhook may be delayed)"
                    )
                    await _grant_entitlement(
                        user_id=user.user_id,
                        plan_id=heal_plan_id,
                        stripe_customer_id=doc.get("stripe_customer_id"),
                        stripe_subscription_id=stripe_subscription_id,
                        expires_at_override=expires_at,
                    )
                    # Clear the pending_plan_id now that it's been applied
                    await db.users.update_one(
                        {"user_id": user.user_id},
                        {"$unset": {"pending_plan_id": ""}},
                    )
                    # Update local vars so the response reflects the new state
                    plan_id = heal_plan_id
                    healed_plan = PLANS.get(heal_plan_id) or {}
                    doc["plan_label"] = healed_plan.get("label", heal_plan_id)
                    doc["plan_kind"]  = "subscription"

        except Exception as e:
            if _is_missing_subscription_error(e):
                await _clear_stale_missing_subscription(user.user_id, stripe_subscription_id)
                doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
                subscription_status = (doc.get("subscription_status") or "").strip().lower()
                stripe_subscription_id = doc.get("stripe_subscription_id")
                cancel_at_period_end = doc.get("cancel_at_period_end", False)
                cancel_at = doc.get("cancel_at", None)
                is_canceling = cancel_at_period_end or bool(cancel_at)
            else:
                logger.warning(f"Could not refresh Stripe subscription status: {e}")

    active = False

    if plan_id and expires_at:
        try:
            dt = datetime.fromisoformat(expires_at)

            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)

            active = (
                dt > datetime.now(timezone.utc)
                and subscription_status != "canceled"
            )

        except Exception:
            active = False

    return {
        "plan_id":                      plan_id,
        "plan_label":                   doc.get("plan_label"),
        "plan_kind":                    doc.get("plan_kind"),
        "subscription_status":          subscription_status,
        "entitlement_expires_at":       expires_at,
        "cancel_at_period_end":         is_canceling,
        "cancel_at":                    cancel_at,
        "active":                       active,
        "plans":                        _public_plans(),
        # Pending midcycle downgrade (scheduled for period-end)
        "pending_downgrade_plan_id":    doc.get("pending_downgrade_plan_id"),
        "pending_downgrade_plan_label": doc.get("pending_downgrade_plan_label"),
        "pending_downgrade_at":         doc.get("pending_downgrade_at"),
    }


@router.get("/billing/plans")
async def billing_plans():
    return {"plans": _public_plans()}


# ── Downgrade notices ─────────────────────────────────────────────────────────

@router.get("/billing/downgrade-notice")
async def get_downgrade_notice(user: User = Depends(get_current_user)):
    """
    Return the latest unread downgrade notice for this user (shown_count < 2).
    The frontend increments shown_count on each login it's displayed.
    After 2 displays the notice is never returned again.
    """
    notice = await db.downgrade_notices.find_one(
        {"user_id": user.user_id, "shown_count": {"$lt": 2}, "dismissed": False},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    return {"notice": notice}


@router.post("/billing/downgrade-notice/{notice_id}/seen")
async def mark_notice_seen(
    notice_id: str,
    user: User = Depends(get_current_user),
):
    """Increment the shown_count for a notice. After 2 it will no longer be returned."""
    await db.downgrade_notices.update_one(
        {"notice_id": notice_id, "user_id": user.user_id},
        {"$inc": {"shown_count": 1}},
    )
    return {"ok": True}


@router.post("/billing/downgrade-notice/{notice_id}/dismiss")
async def dismiss_notice(
    notice_id: str,
    user: User = Depends(get_current_user),
):
    """User explicitly dismissed the notice — mark it so it never shows again."""
    await db.downgrade_notices.update_one(
        {"notice_id": notice_id, "user_id": user.user_id},
        {"$set": {"dismissed": True}},
    )
    return {"ok": True}


# ── Payment method management (on-page, no Stripe portal) ───────────────────

@router.post("/billing/setup-intent")
async def billing_setup_intent(user: User = Depends(get_current_user)):
    """
    Create a Stripe SetupIntent so the frontend can collect a new card using
    PaymentElement in setup mode.  Returns the client_secret.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    stripe_sdk.api_key   = STRIPE_API_KEY
    stripe_sdk.api_base  = "https://api.stripe.com"

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stripe_customer_id = doc.get("stripe_customer_id")

    try:
        stripe_customer_id = await _get_or_create_stripe_customer(
            user,
            stripe_customer_id,
        )
    except Exception as e:
        logger.exception(f"Customer.create failed in setup-intent: {e}")
        raise HTTPException(status_code=502, detail="Could not create Stripe customer.")

    try:
        si = await asyncio.to_thread(
            stripe_sdk.SetupIntent.create,
            customer=stripe_customer_id,
            payment_method_types=["card"],
            usage="off_session",
        )
        return {"client_secret": si.client_secret}
    except Exception as e:
        logger.exception(f"SetupIntent.create failed: {e}")
        raise HTTPException(status_code=502, detail="Could not create setup intent.")


class UpdatePaymentMethodRequest(BaseModel):
    setup_intent_id: str


@router.post("/billing/update-payment-method")
async def billing_update_payment_method(
    payload: UpdatePaymentMethodRequest,
    user: User = Depends(get_current_user),
):
    """
    After the frontend confirms a SetupIntent, call this endpoint to:
    1. Retrieve the new payment method from the SetupIntent
    2. Set it as default on the Stripe Customer
    3. Attach it to the active Subscription if one exists
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    stripe_sdk.api_key   = STRIPE_API_KEY
    stripe_sdk.api_base  = "https://api.stripe.com"

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stripe_customer_id    = doc.get("stripe_customer_id")
    stripe_subscription_id = doc.get("stripe_subscription_id")

    try:
        si = await asyncio.to_thread(
            stripe_sdk.SetupIntent.retrieve, payload.setup_intent_id
        )
    except Exception as e:
        logger.exception(f"SetupIntent.retrieve failed: {e}")
        raise HTTPException(status_code=502, detail="Could not verify the new payment method.")

    pm_id = stripe_value(si, "payment_method", None)
    si_customer = stripe_value(si, "customer", None)

    if not pm_id:
        raise HTTPException(status_code=400, detail="Setup intent has no payment method attached.")

    # Security: ensure setup intent belongs to this user's customer
    if si_customer and stripe_customer_id and si_customer != stripe_customer_id:
        logger.warning(f"update-payment-method: customer mismatch for user {user.user_id}")
        raise HTTPException(status_code=403, detail="Payment method does not belong to this account.")

    try:
        # Set as default on customer
        if stripe_customer_id:
            await asyncio.to_thread(
                stripe_sdk.Customer.modify,
                stripe_customer_id,
                invoice_settings={"default_payment_method": pm_id},
            )

        # Attach to active subscription
        if stripe_subscription_id:
            await asyncio.to_thread(
                stripe_sdk.Subscription.modify,
                stripe_subscription_id,
                default_payment_method=pm_id,
            )

        logger.info(f"Payment method updated for user {user.user_id}")
        return {"ok": True, "message": "Payment method updated successfully."}

    except Exception as e:
        logger.exception(f"update-payment-method failed: {e}")
        raise HTTPException(status_code=502, detail="Could not update payment method. Please try again.")


@router.get("/billing/payment-methods")
async def billing_list_payment_methods(user: User = Depends(get_current_user)):
    """Return the customer's saved payment methods (cards) from Stripe."""
    if not STRIPE_API_KEY:
        return {"methods": []}

    stripe_sdk.api_key  = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stripe_customer_id = doc.get("stripe_customer_id")
    if not stripe_customer_id:
        return {"methods": []}

    try:
        pms = await asyncio.to_thread(
            stripe_sdk.PaymentMethod.list,
            customer=stripe_customer_id,
            type="card",
        )
        methods = []
        for pm in pms.data:
            card = stripe_value(pm, "card", {})
            methods.append({
                "id":       pm.id,
                "brand":    stripe_value(card, "brand",    "card"),
                "last4":    stripe_value(card, "last4",    "••••"),
                "exp_month":stripe_value(card, "exp_month", ""),
                "exp_year": stripe_value(card, "exp_year",  ""),
            })
        return {"methods": methods}
    except Exception as e:
        logger.warning(f"billing_list_payment_methods failed: {e}")
        return {"methods": []}


# -------------------- Stripe Customer Portal --------------------
@router.post("/billing/portal")
async def billing_portal(http_request: Request, user: User = Depends(get_current_user)):
    """Returns a Stripe Customer Portal URL for self-serve subscription management
    (cancellation, payment method update, invoice history, refund request).

    Only meaningful when running against real Stripe (not the Emergent test proxy).
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(
            status_code=503,
            detail="Customer Portal requires a real Stripe key. Set STRIPE_API_KEY to a live/test key in production.",
        )

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    # Use the user's existing Stripe customer (created at the most recent paid subscription)
    last_tx = await db.payment_transactions.find_one(
        {"user_id": user.user_id, "payment_status": "paid"},
        {"_id": 0},
        sort=[("updated_at", -1)],
    )
    stripe_customer_id = doc.get("stripe_customer_id")
    if last_tx:
        stripe_customer_id = stripe_customer_id or last_tx.get("stripe_customer_id")

    try:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"

        if stripe_customer_id:
            stripe_customer_id = await _get_or_create_stripe_customer(
                user,
                stripe_customer_id,
            )
        else:
            existing = await asyncio.to_thread(stripe_sdk.Customer.list, email=user.email, limit=1)
            if existing.data:
                stripe_customer_id = existing.data[0].id
                await db.users.update_one(
                    {"user_id": user.user_id},
                    {"$set": {"stripe_customer_id": stripe_customer_id}},
                )
            else:
                stripe_customer_id = await _get_or_create_stripe_customer(user)
    except Exception as e:
        logger.warning(f"Stripe customer lookup failed: {e}")
        raise HTTPException(status_code=502, detail="Could not reach Stripe to open the portal")

    origin = (http_request.headers.get("origin") or "").rstrip("/") or str(http_request.base_url).rstrip("/")
    return_url = f"{origin}/dashboard/pricing"

    try:
        stripe_sdk.api_key = STRIPE_API_KEY
        stripe_sdk.api_base = "https://api.stripe.com"
        portal = await asyncio.to_thread(
            stripe_sdk.billing_portal.Session.create,
            customer=stripe_customer_id,
            return_url=return_url,
        )
        return {"url": portal.url}
    except Exception as e:
        logger.warning(f"Stripe portal create failed: {e}")
        raise HTTPException(status_code=502, detail="Could not open the billing portal. Please try again.")


# ── Midcycle plan switch ───────────────────────────────────────────────────────

class PlanSwitchRequest(BaseModel):
    plan_id: str


@router.post("/billing/switch")
async def billing_switch_plan(
    payload: PlanSwitchRequest,
    user: User = Depends(get_current_user),
):
    """
    Switch an active subscriber to a different plan mid-cycle.

    Upgrade (higher tier, or same-tier monthly → yearly):
      Stripe subscription item is updated immediately with proration_behavior=
      "create_prorations". The user gets access to the new plan right away;
      a prorated amount appears on their next invoice.

    Downgrade (lower tier, or same-tier yearly → monthly):
      Stripe subscription item is updated with proration_behavior="none" so
      the user is billed at the new (lower) price at their next renewal but
      retains their current plan until the billing period ends.
      A pending_downgrade_* triple is stored on the user doc; it is applied
      by the renewal webhook flow once the effective date has actually arrived.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured.")
    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(
            status_code=503,
            detail="Plan switching requires a real Stripe API key.",
        )

    target_plan = PLANS.get(payload.plan_id)
    if not target_plan:
        raise HTTPException(status_code=400, detail="Unknown plan.")
    if not target_plan.get("stripe_price_id"):
        raise HTTPException(
            status_code=500,
            detail=f"No Stripe price ID configured for plan '{payload.plan_id}'.",
        )

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    stripe_subscription_id = doc.get("stripe_subscription_id")
    current_plan_id        = doc.get("plan_id") or "free"
    subscription_status    = doc.get("subscription_status")

    if not stripe_subscription_id or subscription_status == "canceled":
        raise HTTPException(
            status_code=400,
            detail="No active subscription found. Please subscribe first.",
        )

    if current_plan_id == payload.plan_id:
        raise HTTPException(status_code=400, detail="You are already on this plan.")

    # Also block if the requested plan is already the pending downgrade
    if doc.get("pending_downgrade_plan_id") == payload.plan_id:
        raise HTTPException(
            status_code=400,
            detail="This plan switch is already scheduled for your next renewal.",
        )

    is_upgrade = _is_plan_upgrade(current_plan_id, payload.plan_id)

    stripe_sdk.api_key  = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        # ── Retrieve the subscription to find the current item ID ────────────
        sub = await asyncio.to_thread(
            stripe_sdk.Subscription.retrieve, stripe_subscription_id
        )

        # Validate it's still active on Stripe's side
        live_status = stripe_value(sub, "status", None)
        if live_status == "canceled":
            raise HTTPException(
                status_code=400,
                detail="Your subscription has been cancelled in Stripe. Please subscribe again.",
            )
        if doc.get("cancel_at_period_end") or stripe_value(sub, "cancel_at_period_end", False):
            raise HTTPException(
                status_code=400,
                detail="Your subscription is scheduled to end. Reactivate it before changing plans.",
            )

        items_obj  = stripe_value(sub, "items", {})
        items_data = stripe_value(items_obj, "data", [])
        if not items_data:
            raise HTTPException(status_code=500, detail="Subscription has no line items.")
        item_id = stripe_value(items_data[0], "id", None)
        if not item_id:
            raise HTTPException(status_code=500, detail="Could not identify subscription item.")

        proration = "create_prorations" if is_upgrade else "none"

        # ── Modify the subscription ──────────────────────────────────────────
        updated_sub = await asyncio.to_thread(
            stripe_sdk.Subscription.modify,
            stripe_subscription_id,
            items=[{"id": item_id, "price": target_plan["stripe_price_id"]}],
            proration_behavior=proration,
        )

        # Capture Stripe's authoritative period-end
        current_period_end = stripe_value(updated_sub, "current_period_end", None)
        new_expires_at: Optional[str] = None
        if current_period_end:
            new_expires_at = datetime.fromtimestamp(
                int(current_period_end), tz=timezone.utc
            ).isoformat()

        # ── Update our DB ────────────────────────────────────────────────────
        if is_upgrade:
            # Immediate access: grant new plan and wipe any stale pending downgrade
            await _grant_entitlement(
                user_id                = user.user_id,
                plan_id                = payload.plan_id,
                stripe_customer_id     = doc.get("stripe_customer_id"),
                stripe_subscription_id = stripe_subscription_id,
                expires_at_override    = new_expires_at,
            )
            await db.users.update_one(
                {"user_id": user.user_id},
                {"$unset": {
                    "pending_downgrade_plan_id":    "",
                    "pending_downgrade_plan_label": "",
                    "pending_downgrade_at":         "",
                }},
            )
        else:
            # Deferred: keep existing entitlement, store pending change
            await db.users.update_one(
                {"user_id": user.user_id},
                {"$set": {
                    "pending_downgrade_plan_id":    payload.plan_id,
                    "pending_downgrade_plan_label": target_plan.get("label", payload.plan_id),
                    "pending_downgrade_at":         new_expires_at or doc.get("entitlement_expires_at"),
                    "updated_at":                   datetime.now(timezone.utc).isoformat(),
                }},
            )

        # ── Audit log ────────────────────────────────────────────────────────
        await db.plan_switches.insert_one({
            "switch_id":               f"sw_{uuid.uuid4().hex[:12]}",
            "user_id":                 user.user_id,
            "user_email":              user.email,
            "from_plan":               current_plan_id,
            "to_plan":                 payload.plan_id,
            "is_upgrade":              is_upgrade,
            "proration_behavior":      proration,
            "stripe_subscription_id":  stripe_subscription_id,
            "created_at":              datetime.now(timezone.utc).isoformat(),
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Plan switch failed for user {user.user_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not switch plans. Please try again.",
        )

    # Plan change email
    asyncio.create_task(email_plan_changed(
        email=user.email,
        name=getattr(user, "name", ""),
        old_label=doc.get("plan_label") or PLANS.get(current_plan_id, {}).get("label", current_plan_id),
        new_label=PLANS.get(payload.plan_id, {}).get("label", payload.plan_id),
        is_upgrade=is_upgrade,
        effective_date=None if is_upgrade else new_expires_at,
    ))

    return {
        "switched":              True,
        "from_plan":             current_plan_id,
        "to_plan":               payload.plan_id,
        "is_upgrade":            is_upgrade,
        "effective_immediately": is_upgrade,
        "effective_at":          None if is_upgrade else new_expires_at,
        "entitlement_expires_at": new_expires_at,
    }


@router.post("/billing/cancel-switch")
async def billing_cancel_switch(user: User = Depends(get_current_user)):
    """
    Cancels a pending (end-of-period) plan downgrade.

    When a downgrade is scheduled:
      • Our DB stores pending_downgrade_plan_id/label/at
      • Stripe's subscription is already pointing at the lower-tier price
        (with proration_behavior="none", so no charge yet)

    To revert:
      • Switch the Stripe subscription item back to the CURRENT plan's price
        (same one the user is entitled to — no proration)
      • Clear the pending_downgrade_* fields from the user document

    Upgrades are applied immediately and have no pending state; to undo an
    upgrade the user simply downgrades back through the normal switch flow.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured.")
    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(status_code=503, detail="Requires a real Stripe API key.")

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}

    pending_plan_id = doc.get("pending_downgrade_plan_id")
    if not pending_plan_id:
        raise HTTPException(
            status_code=400,
            detail="No pending plan switch to cancel. Nothing has changed.",
        )

    current_plan_id      = doc.get("plan_id") or "free"
    stripe_subscription_id = doc.get("stripe_subscription_id")

    if not stripe_subscription_id or doc.get("subscription_status") == "canceled":
        raise HTTPException(status_code=400, detail="No active subscription found.")

    current_plan  = PLANS.get(current_plan_id)
    if not current_plan or not current_plan.get("stripe_price_id"):
        raise HTTPException(
            status_code=500,
            detail="Could not find the Stripe price for your current plan.",
        )

    current_price_id = current_plan["stripe_price_id"]

    stripe_sdk.api_key  = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        # Retrieve subscription to get the item ID
        sub = await asyncio.to_thread(
            stripe_sdk.Subscription.retrieve, stripe_subscription_id
        )

        live_status = stripe_value(sub, "status", None)
        if live_status == "canceled":
            raise HTTPException(
                status_code=400,
                detail="Your subscription has been cancelled in Stripe.",
            )

        items_obj  = stripe_value(sub, "items", {})
        items_data = stripe_value(items_obj, "data", [])
        if not items_data:
            raise HTTPException(status_code=500, detail="Subscription has no line items.")

        item_id = stripe_value(items_data[0], "id", None)
        if not item_id:
            raise HTTPException(status_code=500, detail="Could not identify subscription item.")

        # Revert to the current plan's price — no proration since there's no charge change
        await asyncio.to_thread(
            stripe_sdk.Subscription.modify,
            stripe_subscription_id,
            items=[{"id": item_id, "price": current_price_id}],
            proration_behavior="none",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cancel-switch failed for user {user.user_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not cancel the scheduled plan switch. Please try again.",
        )

    # Clear pending downgrade from DB
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$unset": {
            "pending_downgrade_plan_id":    "",
            "pending_downgrade_plan_label": "",
            "pending_downgrade_at":         "",
        }},
    )

    # Audit log
    await db.plan_switches.insert_one({
        "switch_id":               f"sw_{uuid.uuid4().hex[:12]}",
        "user_id":                 user.user_id,
        "user_email":              user.email,
        "action":                  "cancel_switch",
        "reverted_to_plan":        current_plan_id,
        "cancelled_pending_plan":  pending_plan_id,
        "stripe_subscription_id":  stripe_subscription_id,
        "created_at":              datetime.now(timezone.utc).isoformat(),
    })

    return {
        "cancelled":   True,
        "staying_on":  current_plan_id,
        "plan_label":  current_plan.get("label", current_plan_id),
    }


# ── Cancel subscription (schedule for end-of-period) ─────────────────────────

@router.post("/billing/cancel")
async def billing_cancel_subscription(user: User = Depends(get_current_user)):
    """
    Schedules the subscription to cancel at the end of the current billing period.
    The user keeps their current plan access until period end, then reverts to free.
    Sets cancel_at_period_end=True via Stripe — no access is lost immediately.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured.")
    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(status_code=503, detail="Requires a real Stripe API key.")

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    subscription_id = doc.get("stripe_subscription_id")

    if not subscription_id or doc.get("subscription_status") == "canceled":
        raise HTTPException(status_code=400, detail="No active subscription to cancel.")

    if doc.get("cancel_at_period_end"):
        raise HTTPException(
            status_code=400,
            detail="Subscription is already scheduled to cancel at the end of the billing period.",
        )

    stripe_sdk.api_key  = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        sub = await asyncio.to_thread(
            stripe_sdk.Subscription.modify,
            subscription_id,
            cancel_at_period_end=True,
        )
        period_end = stripe_value(sub, "current_period_end", None)
        ends_at = (
            datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
            if period_end else None
        )
    except Exception as e:
        logger.exception(f"Cancel subscription failed for {user.user_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not cancel subscription. Please try again.",
        )

    await db.users.update_one(
        {"user_id": user.user_id},
        {
            "$set": {
                "cancel_at_period_end":   True,
                "entitlement_expires_at": ends_at or doc.get("entitlement_expires_at"),
                "updated_at":             datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {
                "pending_downgrade_plan_id": "",
                "pending_downgrade_plan_label": "",
                "pending_downgrade_at": "",
            },
        },
    )

    await db.plan_switches.insert_one({
        "switch_id":               f"sw_{uuid.uuid4().hex[:12]}",
        "user_id":                 user.user_id,
        "user_email":              user.email,
        "action":                  "cancel_subscription",
        "plan_id":                 doc.get("plan_id"),
        "stripe_subscription_id":  subscription_id,
        "ends_at":                 ends_at,
        "created_at":              datetime.now(timezone.utc).isoformat(),
    })

    asyncio.create_task(email_subscription_canceled(
        email=user.email,
        name=getattr(user, "name", ""),
        plan_label=doc.get("plan_label") or doc.get("plan_id", "your plan"),
        access_until=ends_at or doc.get("entitlement_expires_at"),
    ))

    return {
        "scheduled_cancellation": True,
        "ends_at":                ends_at,
        "plan_label":             doc.get("plan_label") or doc.get("plan_id"),
    }


# ── Reactivate (undo a scheduled cancellation before period ends) ─────────────

@router.post("/billing/reactivate")
async def billing_reactivate_subscription(user: User = Depends(get_current_user)):
    """
    Removes the end-of-period cancellation, keeping the subscription active.
    Only callable while the subscription is still in the grace period
    (cancel_at_period_end=True but not yet expired).
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured.")
    if STRIPE_API_KEY.endswith("_emergent"):
        raise HTTPException(status_code=503, detail="Requires a real Stripe API key.")

    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    subscription_id = doc.get("stripe_subscription_id")

    if not subscription_id:
        raise HTTPException(status_code=400, detail="No subscription found.")

    if not doc.get("cancel_at_period_end"):
        raise HTTPException(
            status_code=400,
            detail="Subscription is not scheduled for cancellation — nothing to revert.",
        )

    stripe_sdk.api_key  = STRIPE_API_KEY
    stripe_sdk.api_base = "https://api.stripe.com"

    try:
        sub = await asyncio.to_thread(
            stripe_sdk.Subscription.modify,
            subscription_id,
            cancel_at_period_end=False,
        )
        period_end = stripe_value(sub, "current_period_end", None)
        renews_at = (
            datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
            if period_end else None
        )
    except Exception as e:
        logger.exception(f"Reactivate subscription failed for {user.user_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Could not reactivate subscription. Please try again.",
        )

    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "cancel_at_period_end":   False,
            "entitlement_expires_at": renews_at or doc.get("entitlement_expires_at"),
            "updated_at":             datetime.now(timezone.utc).isoformat(),
        }},
    )

    await db.plan_switches.insert_one({
        "switch_id":               f"sw_{uuid.uuid4().hex[:12]}",
        "user_id":                 user.user_id,
        "user_email":              user.email,
        "action":                  "reactivate_subscription",
        "plan_id":                 doc.get("plan_id"),
        "stripe_subscription_id":  subscription_id,
        "renews_at":               renews_at,
        "created_at":              datetime.now(timezone.utc).isoformat(),
    })

    asyncio.create_task(email_subscription_reactivated(
        email=user.email,
        name=getattr(user, "name", ""),
        plan_label=doc.get("plan_label") or doc.get("plan_id", "your plan"),
        renews_at=renews_at or doc.get("entitlement_expires_at"),
    ))

    return {
        "reactivated": True,
        "renews_at":   renews_at,
        "plan_label":  doc.get("plan_label") or doc.get("plan_id"),
    }
