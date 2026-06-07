from fastapi import APIRouter, Query
from datetime import timedelta
from app.shared import *

router = APIRouter()

# -------------------- Stats --------------------
@router.get("/stats/overview")
async def stats_overview(user: User = Depends(get_current_user)):
    total_pets = await db.pets.count_documents({"user_id": user.user_id})
    total_estimates = await db.estimates.count_documents({"user_id": user.user_id})
    total_claims = await db.claims.count_documents({"user_id": user.user_id})
    # sum of invoice records this year
    records = await db.pet_records.find(
        {"user_id": user.user_id, "record_type": "invoice"}, {"_id": 0}
    ).to_list(2000)
    annual = 0.0
    for r in records:
        if r.get("amount_usd"):
            annual += float(r["amount_usd"])
    return {
        "total_pets": total_pets,
        "total_estimates": total_estimates,
        "total_claims": total_claims,
        "annual_spent_usd": round(annual, 2),
    }


# -------------------- Reimbursement stats --------------------
@router.get("/stats/reimbursements")
async def stats_reimbursements(
    months: int = Query(default=6, ge=1, le=24),
    user: User = Depends(get_current_user),
):
    """
    Return insurance reimbursement totals for the current user over the
    requested window (3 / 6 / 12 months), plus the previous equal-length
    window for trend comparison, and a month-by-month breakdown.
    """
    now         = datetime.now(timezone.utc)
    cutoff      = now - timedelta(days=months * 30)
    prev_cutoff = cutoff - timedelta(days=months * 30)

    cutoff_str      = cutoff.isoformat()
    prev_cutoff_str = prev_cutoff.isoformat()

    # ── Current-period claims ──────────────────────────────────────────────
    claims = await db.claims.find(
        {"user_id": user.user_id, "created_at": {"$gte": cutoff_str}},
        {"_id": 0, "estimated_reimbursement_usd": 1, "created_at": 1,
         "pet_name": 1, "insurer": 1},
    ).to_list(500)

    total = sum(float(c.get("estimated_reimbursement_usd") or 0) for c in claims)

    # ── Previous-period claims (for trend comparison) ──────────────────────
    prev_claims = await db.claims.find(
        {"user_id": user.user_id,
         "created_at": {"$gte": prev_cutoff_str, "$lt": cutoff_str}},
        {"_id": 0, "estimated_reimbursement_usd": 1},
    ).to_list(500)

    prev_total = sum(float(c.get("estimated_reimbursement_usd") or 0) for c in prev_claims)

    # ── Monthly breakdown for sparkline ───────────────────────────────────
    # Bucket each claim into a calendar month
    monthly_map: dict = {}
    for c in claims:
        raw = c.get("created_at", "")
        try:
            dt  = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            key = dt.strftime("%Y-%m")
            monthly_map[key] = monthly_map.get(key, 0) + float(c.get("estimated_reimbursement_usd") or 0)
        except Exception:
            pass

    # Build a full ordered list from oldest to newest month in the window,
    # filling zeros for months with no claims.
    monthly_list = []
    for i in range(months - 1, -1, -1):
        dt  = now - timedelta(days=i * 30)
        key = dt.strftime("%Y-%m")
        monthly_list.append({
            "month":     dt.strftime("%b %y"),   # "Jan 25"
            "month_key": key,
            "amount":    round(monthly_map.get(key, 0), 2),
        })

    return {
        "total_reimbursement_usd": round(total, 2),
        "prev_period_usd":         round(prev_total, 2),
        "total_claims":            len(claims),
        "prev_claims":             len(prev_claims),
        "monthly":                 monthly_list,
        "months":                  months,
    }


# -------------------- Savings tracker --------------------
@router.get("/stats/savings")
async def stats_savings(user: User = Depends(get_current_user)):
    """
    The headline "value for money" metric. Combines:
      • bills_reviewed / total_reviewed_usd — everything PetBill Shield has read
      • items_flagged — questions surfaced for the user to raise with their vet
      • confirmed_savings_usd — what the user has actually saved, from outcomes
        they logged on individual bills (estimated_total − amount_paid)
      • reimbursements_usd — total insurance reimbursement estimated from claims
    """
    estimates = await db.estimates.find(
        {"user_id": user.user_id},
        {"_id": 0, "estimated_total_usd": 1, "red_flags": 1, "outcome": 1},
    ).to_list(5000)

    bills_reviewed   = len(estimates)
    total_reviewed   = 0.0
    items_flagged    = 0
    confirmed_saving = 0.0
    outcomes_logged  = 0

    for e in estimates:
        if e.get("estimated_total_usd"):
            total_reviewed += float(e["estimated_total_usd"])
        items_flagged += len(e.get("red_flags") or [])
        outcome = e.get("outcome") or {}
        if outcome:
            outcomes_logged += 1
            if outcome.get("saved_usd"):
                confirmed_saving += float(outcome["saved_usd"])

    # Insurance reimbursements logged via claims (actual where present, else estimated)
    claims = await db.claims.find(
        {"user_id": user.user_id},
        {"_id": 0, "actual_reimbursement_usd": 1, "estimated_reimbursement_usd": 1},
    ).to_list(2000)
    reimbursements = 0.0
    for c in claims:
        amt = c.get("actual_reimbursement_usd")
        if amt is None:
            amt = c.get("estimated_reimbursement_usd")
        if amt:
            reimbursements += float(amt)

    total_value = round(confirmed_saving + reimbursements, 2)

    return {
        "bills_reviewed":        bills_reviewed,
        "total_reviewed_usd":    round(total_reviewed, 2),
        "items_flagged":         items_flagged,
        "confirmed_savings_usd": round(confirmed_saving, 2),
        "outcomes_logged":       outcomes_logged,
        "reimbursements_usd":    round(reimbursements, 2),
        "total_value_usd":       total_value,
    }


