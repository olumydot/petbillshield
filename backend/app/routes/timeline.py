from datetime import datetime, timezone
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import json

from app.shared import db, User, get_current_user, call_claude_json, require_paid_plan, enforce_ai_usage_limit, record_ai_usage, logger

router = APIRouter()

# ---------------------------------------------------------------------------
# In-process cache so identical (marker, value, species) combos never hit
# Claude twice in the same server process.
# ---------------------------------------------------------------------------
_interp_cache: dict = {}

MARKER_INTERPRET_PROMPT = """You are a veterinary health educator for PetBill Shield.

A pet owner is viewing one of their pet's lab values and wants to understand what it means.

Guidelines:
- Use the pet's species when describing reference ranges.
- State the typical healthy reference range for this species up front.
- Clearly say whether this value is within normal range, borderline, low, or elevated.
- In 1-2 sentences explain what this marker measures and what an out-of-range value might suggest.
- Close with exactly: "Discuss this with your vet."
- Never diagnose. Never alarm. Be calm, plain-English, and concise (3-5 sentences total).

Return STRICT JSON only — no markdown fences:
{
  "status": "normal" | "low" | "borderline_low" | "borderline_high" | "elevated",
  "range_note": "string — e.g. 'Typical range for dogs: 100-300 mg/dL'",
  "interpretation": "string — 3-5 plain-English sentences"
}"""


class InterpretRequest(BaseModel):
    marker_key: str
    value: float
    pet_species: Optional[str] = "dog"


@router.post("/health-markers/interpret")
async def interpret_health_marker(
    payload: InterpretRequest,
    user: User = Depends(get_current_user),
):
    """
    Return a plain-English interpretation of a single health-marker value.
    Results are cached by (marker_key, rounded_value, species) so Claude is
    called at most once per unique combination across all users.
    """
    key     = payload.marker_key.strip().lower()
    value   = round(payload.value, 1)
    species = (payload.pet_species or "dog").strip().lower()

    if not key:
        raise HTTPException(status_code=400, detail="marker_key is required.")

    cache_key = f"{key}:{value}:{species}"

    # 1. In-process memory cache
    if cache_key in _interp_cache:
        return _interp_cache[cache_key]

    # 2. Persistent DB cache
    cached = await db.marker_interp_cache.find_one({"cache_key": cache_key}, {"_id": 0, "cache_key": 0})
    if cached:
        _interp_cache[cache_key] = cached
        return cached

    # 3. Call Claude
    prompt = (
        f"Marker: {key}\n"
        f"Value: {value}\n"
        f"Species: {species}\n\n"
        "Interpret this health-marker value for the owner."
    )
    try:
        result = await call_claude_json(MARKER_INTERPRET_PROMPT, prompt, max_tokens=400)
    except Exception as e:
        logger.warning(f"Marker interpretation failed for {cache_key}: {e}")
        raise HTTPException(status_code=500, detail="Could not generate interpretation.")

    # Ensure required fields exist
    result.setdefault("status", "unknown")
    result.setdefault("range_note", "")
    result.setdefault("interpretation", "")

    # Persist to DB so future calls are free
    try:
        await db.marker_interp_cache.insert_one({"cache_key": cache_key, **result})
    except Exception:
        pass

    _interp_cache[cache_key] = result
    return result


def parse_date(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def safe_float(value):
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def percent(part, whole):
    if not whole:
        return 0
    return round((part / whole) * 100, 1)


def trend_direction(monthly_values, pet_name="This pet"):
    if len(monthly_values) < 2:
        return f"Still learning {pet_name.capitalize()}'s spending habits"

    first = monthly_values[0]
    last = monthly_values[-1]

    if last > first * 1.2:
        return "increasing"
    if last < first * 0.8:
        return "decreasing"
    return "stable"


def build_cost_insights(
    total_spent,
    total_estimated,
    total_reimbursement,
    category_spend,
    monthly_spend,
    events,
):
    insights = []

    net_cost = total_spent - total_reimbursement
    reimbursement_rate = percent(total_reimbursement, total_spent)

    monthly_values = [amount for _, amount in sorted(monthly_spend.items())]
    direction = trend_direction(monthly_values)

    if total_spent > 0 and reimbursement_rate < 25:
        insights.append({
            "type": "insurance",
            "level": "info",
            "title": "Low reimbursement recovery",
            "message": f"Only about {reimbursement_rate}% of tracked spending appears reimbursed so far."
        })

    if direction == "increasing":
        insights.append({
            "type": "trend",
            "level": "warning",
            "title": "Spending is trending upward",
            "message": "Recent monthly costs appear higher than earlier months."
        })

    if category_spend:
        top_category, top_amount = max(category_spend.items(), key=lambda x: x[1])
        insights.append({
            "type": "category",
            "level": "info",
            "title": f"Top cost category: {top_category.title()}",
            "message": f"{top_category.title()} accounts for about {percent(top_amount, total_spent)}% of tracked spending."
        })

    emergency_categories = ["hospitalization", "surgery", "diagnostic", "imaging"]
    emergency_spend = sum(category_spend.get(c, 0) for c in emergency_categories)

    if total_spent > 0 and emergency_spend / total_spent >= 0.5:
        insights.append({
            "type": "risk",
            "level": "warning",
            "title": "Emergency-heavy spending pattern",
            "message": "A large share of spending is tied to diagnostics, imaging, surgery, or hospitalization."
        })

    if total_estimated > total_spent * 1.5 and total_estimated > 0:
        insights.append({
            "type": "estimate",
            "level": "info",
            "title": "Estimated care exceeds logged spending",
            "message": "Some analyzed estimates may not yet be saved as actual paid records."
        })

    if not insights:
        insights.append({
            "type": "general",
            "level": "info",
            "title": "Not enough cost history yet",
            "message": "Add more invoices, estimates, and claims to unlock stronger insights."
        })

    return insights


@router.get("/pets/{pet_id}/timeline")
async def pet_health_cost_timeline(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).to_list(1000)

    estimates = await db.estimates.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).to_list(500)

    claims = await db.claims.find(
        {
            "$or": [
                {"pet_id": pet_id, "user_id": user.user_id},
                {"saved_pet_id": pet_id, "user_id": user.user_id},
            ]
        },
        {"_id": 0}
    ).to_list(500)

    events = []
    monthly_spend = defaultdict(float)
    category_spend = defaultdict(float)
    total_spent = 0.0
    total_estimated = 0.0
    total_reimbursement = 0.0

    for r in records:
        dt = parse_date(r.get("date")) or parse_date(r.get("created_at"))
        amount = float(r.get("amount_usd") or 0)

        if amount:
            total_spent += amount
            if dt:
                monthly_spend[dt.strftime("%Y-%m")] += amount
            category_spend[r.get("category") or "other"] += amount

        events.append({
            "type": "record",
            "date": dt.isoformat() if dt else r.get("date") or r.get("created_at"),
            "title": r.get("title"),
            "category": r.get("category") or "other",
            "amount_usd": amount,
            "details": r.get("details") or "",
        })

    for e in estimates:
        dt = parse_date(e.get("created_at"))
        amount = float(e.get("estimated_total_usd") or 0)

        if amount:
            total_estimated += amount

        events.append({
            "type": "estimate_analysis",
            "date": dt.isoformat() if dt else e.get("created_at"),
            "title": e.get("summary") or "Estimate analysis",
            "amount_usd": amount,
            "urgent_now": e.get("urgent_now", []),
            "questions_to_ask_vet": e.get("questions_to_ask_vet", []),
            "analysis_id": e.get("analysis_id"),
        })

    for c in claims:
        dt = parse_date(c.get("created_at"))
        amount = float(c.get("estimated_reimbursement_usd") or 0)

        if amount:
            total_reimbursement += amount

        events.append({
            "type": "claim_analysis",
            "date": dt.isoformat() if dt else c.get("created_at"),
            "title": f"Claim review - {c.get('insurer') or 'Unknown insurer'}",
            "amount_usd": amount,
            "missing_documents": c.get("missing_documents", []),
            "next_steps": c.get("next_steps", []),
            "claim_id": c.get("claim_id"),
        })

    events.sort(key=lambda x: x.get("date") or "", reverse=True)

    net_cost = total_spent - total_reimbursement

    monthly_values = [v for _, v in sorted(monthly_spend.items())]
    months_tracked = max(len(monthly_values), 1)

    average_monthly_spend = total_spent / months_tracked
    predicted_annual_cost = average_monthly_spend * 12
    reimbursement_rate = percent(total_reimbursement, total_spent)

    highest_month = None
    if monthly_spend:
        highest_month_key, highest_month_amount = max(monthly_spend.items(), key=lambda x: x[1])
        highest_month = {
            "month": highest_month_key,
            "amount_usd": round(highest_month_amount, 2),
        }

    top_category = None
    if category_spend:
        top_category_key, top_category_amount = max(category_spend.items(), key=lambda x: x[1])
        top_category = {
            "category": top_category_key,
            "amount_usd": round(top_category_amount, 2),
            "percent_of_total": percent(top_category_amount, total_spent),
        }

    analytics = {
        "average_monthly_spend_usd": round(average_monthly_spend, 2),
        "predicted_annual_cost_usd": round(predicted_annual_cost, 2),
        "reimbursement_rate_percent": reimbursement_rate,
        "trend_direction": trend_direction(monthly_values, pet.get("name") or "This pet"),
        "highest_spend_month": highest_month,
        "top_category": top_category,
        "insights": build_cost_insights(
            total_spent=total_spent,
            total_estimated=total_estimated,
            total_reimbursement=total_reimbursement,
            category_spend=category_spend,
            monthly_spend=monthly_spend,
            events=events,
        ),
    }

    return {
        "pet": {
            "pet_id": pet.get("pet_id"),
            "name": pet.get("name"),
            "species": pet.get("species"),
            "breed": pet.get("breed"),
            "age_years": pet.get("age_years"),
        },
        "summary": {
            "total_spent_usd": round(total_spent, 2),
            "total_estimated_usd": round(total_estimated, 2),
            "total_reimbursement_usd": round(total_reimbursement, 2),
            "net_cost_usd": round(net_cost, 2),
            "event_count": len(events),
        },
        "analytics": analytics,
        "monthly_spend": [
            {"month": k, "amount_usd": round(v, 2)}
            for k, v in sorted(monthly_spend.items())
        ],
        "category_spend": [
            {"category": k, "amount_usd": round(v, 2)}
            for k, v in sorted(category_spend.items(), key=lambda x: x[1], reverse=True)
        ],
        "events": events,

    }

@router.post("/pets/{pet_id}/timeline/ai-summary")
async def generate_timeline_ai_summary(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "timeline_summary")
    timeline = await pet_health_cost_timeline(pet_id, user)

    system_prompt = """
You are PetBill Shield.

Write a short, calm, plain-English cost insight summary for a pet owner.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not tell the user to refuse care.
- Focus on spending patterns, reimbursements, recurring costs, and useful next steps.
- Be practical and reassuring.
- Return JSON only:
{
  "summary": "string",
  "key_points": ["string"],
  "suggested_next_steps": ["string"]
}
"""

    user_prompt = f"""
Pet timeline analytics:
{json.dumps(timeline, default=str)}

Write a helpful cost insight summary.
"""

    result = await call_claude_json(system_prompt, user_prompt, max_tokens=1000)
    await record_ai_usage(user, "timeline_summary", linked_id=pet_id)

    return {
        "summary": result.get("summary", ""),
        "key_points": result.get("key_points", []),
        "suggested_next_steps": result.get("suggested_next_steps", []),
    }


@router.get("/pets/{pet_id}/health-markers")
async def get_pet_health_markers(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    """Return all extracted health markers for a pet, sorted by date asc."""
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    rows = await db.pet_health_markers.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    return {"markers": rows}