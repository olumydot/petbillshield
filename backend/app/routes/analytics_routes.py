from datetime import datetime, timezone
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException

from app.shared import db, User, get_current_user

router = APIRouter()


@router.get("/analytics/test")
async def analytics_test():
    return {"ok": True, "message": "analytics router is loaded"}


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


@router.get("/analytics/pet/{pet_id}")
async def pet_analytics(
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
    ).to_list(2000)

    estimates = await db.estimates.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).to_list(1000)

    claims = await db.claims.find(
        {
            "$or": [
                {"pet_id": pet_id, "user_id": user.user_id},
                {"saved_pet_id": pet_id, "user_id": user.user_id},
            ]
        },
        {"_id": 0}
    ).to_list(1000)

    total_spent = 0.0
    total_estimated = 0.0
    total_reimbursed = 0.0

    by_category = defaultdict(float)
    by_month = defaultdict(float)
    medication_spend = 0.0
    emergency_like_spend = 0.0
    recurring_items = defaultdict(int)

    first_date = None
    last_date = None

    for r in records:
        amount = float(r.get("amount_usd") or 0)
        category = r.get("category") or "other"
        title = r.get("title") or "Untitled record"
        dt = parse_date(r.get("date")) or parse_date(r.get("created_at"))

        if amount:
            total_spent += amount
            by_category[category] += amount

            if dt:
                by_month[dt.strftime("%Y-%m")] += amount

            if category == "medication":
                medication_spend += amount

            if category in ["hospitalization", "surgery", "diagnostic", "imaging"]:
                emergency_like_spend += amount

        recurring_items[title.lower().strip()] += 1

        if dt:
            first_date = dt if first_date is None or dt < first_date else first_date
            last_date = dt if last_date is None or dt > last_date else last_date

    for e in estimates:
        amount = float(e.get("estimated_total_usd") or 0)
        total_estimated += amount

    for c in claims:
        amount = float(c.get("estimated_reimbursement_usd") or 0)
        total_reimbursed += amount

    net_cost = total_spent - total_reimbursed

    months_tracked = max(len(by_month), 1)
    average_monthly_spend = total_spent / months_tracked
    predicted_annual_cost = average_monthly_spend * 12

    insurance_efficiency = 0
    if total_spent > 0:
        insurance_efficiency = (total_reimbursed / total_spent) * 100

    recurring_care = [
        {"item": name.title(), "count": count}
        for name, count in recurring_items.items()
        if count >= 2
    ]

    risk_flags = []

    if predicted_annual_cost > 2000:
        risk_flags.append({
            "level": "warning",
            "title": "High projected annual cost",
            "message": "This pet may be trending toward a high yearly care cost."
        })

    if medication_spend > 300:
        risk_flags.append({
            "level": "info",
            "title": "Recurring medication cost",
            "message": "Medication spending is becoming a meaningful part of this pet’s care history."
        })

    if emergency_like_spend > total_spent * 0.5 and total_spent > 0:
        risk_flags.append({
            "level": "warning",
            "title": "Emergency-heavy spending",
            "message": "A large share of spending appears tied to diagnostics, imaging, surgery, or hospitalization."
        })

    if insurance_efficiency < 25 and total_spent > 500:
        risk_flags.append({
            "level": "info",
            "title": "Low reimbursement recovery",
            "message": "Insurance reimbursement appears low compared with tracked spending."
        })

    return {
        "pet": {
            "pet_id": pet.get("pet_id"),
            "name": pet.get("name"),
            "species": pet.get("species"),
            "breed": pet.get("breed"),
            "age_years": pet.get("age_years"),
            "picture": pet.get("picture"),
        },
        "summary": {
            "total_spent_usd": round(total_spent, 2),
            "total_estimated_usd": round(total_estimated, 2),
            "total_reimbursed_usd": round(total_reimbursed, 2),
            "net_cost_usd": round(net_cost, 2),
            "average_monthly_spend_usd": round(average_monthly_spend, 2),
            "predicted_annual_cost_usd": round(predicted_annual_cost, 2),
            "insurance_efficiency_percent": round(insurance_efficiency, 1),
            "records_count": len(records),
            "estimates_count": len(estimates),
            "claims_count": len(claims),
        },
        "by_category": [
            {"category": k, "amount_usd": round(v, 2)}
            for k, v in sorted(by_category.items(), key=lambda x: x[1], reverse=True)
        ],
        "by_month": [
            {"month": k, "amount_usd": round(v, 2)}
            for k, v in sorted(by_month.items())
        ],
        "recurring_care": recurring_care,
        "risk_flags": risk_flags,
    }