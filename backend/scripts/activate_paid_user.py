"""
Manually activate a user who paid on Stripe but didn't get their entitlement
(e.g. the embedded-checkout onComplete bug).

Usage:
    cd backend
    source ../venv/bin/activate
    python3 scripts/activate_paid_user.py user@email.com           # dry-run (shows what it would do)
    python3 scripts/activate_paid_user.py user@email.com --apply    # actually grant

It finds the user's Stripe customer, looks up their most recent paid/active
subscription, maps the price back to your plan_id, and grants the entitlement.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import stripe as stripe_sdk
from app.shared import db, PLANS
from app.routes.billing_routes import _grant_entitlement, _PRICE_TO_PLAN


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/activate_paid_user.py <email> [--apply]")
        return
    email = sys.argv[1].lower().strip()
    apply = "--apply" in sys.argv

    stripe_sdk.api_key = os.environ["STRIPE_API_KEY"]
    stripe_sdk.api_base = "https://api.stripe.com"

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        print(f"❌ No user found with email {email}")
        return
    user_id = user["user_id"]
    print(f"User: {email}  ({user_id})")
    print(f"  Current plan_id: {user.get('plan_id')}  status: {user.get('subscription_status')}")

    # Find the Stripe customer
    cust_id = user.get("stripe_customer_id")
    if not cust_id:
        found = stripe_sdk.Customer.list(email=email, limit=1)
        cust_id = found.data[0].id if found.data else None
    if not cust_id:
        print("❌ No Stripe customer found for this email.")
        return
    print(f"  Stripe customer: {cust_id}")

    # Look up their subscriptions
    subs = stripe_sdk.Subscription.list(customer=cust_id, status="all", limit=10)
    live = [s for s in subs.data if s.status in ("active", "trialing", "past_due")]
    if not live:
        print("❌ No active/trialing subscription on Stripe. Nothing to grant.")
        print(f"   (Subscriptions seen: {[(s.id, s.status) for s in subs.data]})")
        return

    sub = sorted(live, key=lambda s: s.created, reverse=True)[0]
    price_id = sub["items"]["data"][0]["price"]["id"]
    plan_id = _PRICE_TO_PLAN.get(price_id)
    print(f"  Stripe subscription: {sub.id}  status={sub.status}")
    print(f"  Price {price_id}  ->  plan_id={plan_id}")

    if not plan_id:
        print("❌ Could not map this Stripe price to a plan_id. Check STRIPE_PRICE_* env vars.")
        return

    period_end = sub.get("current_period_end")
    expires_at = (
        datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
        if period_end else None
    )

    print(f"\n  Will grant: {PLANS.get(plan_id, {}).get('label', plan_id)}  (expires {expires_at})")
    if not apply:
        print("\n(dry-run) Re-run with --apply to actually grant.")
        return

    await _grant_entitlement(
        user_id=user_id,
        plan_id=plan_id,
        stripe_customer_id=cust_id,
        stripe_subscription_id=sub.id,
        expires_at_override=expires_at,
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"subscription_status": "active"}, "$unset": {"pending_plan_id": ""}},
    )
    print("✅ Entitlement granted. Ask the user to refresh their dashboard.")


if __name__ == "__main__":
    asyncio.run(main())
