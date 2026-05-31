from datetime import datetime, timezone
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException

from app.shared import db, User, get_current_user

router = APIRouter()


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


@router.get("/analytics/pet/{pet_id}/forecast")
async def pet_forecast(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    pet = await db.pets.find_one(
        {
            "pet_id": pet_id,
            "user_id": user.user_id,
        },
        {"_id": 0},
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {
            "pet_id": pet_id,
            "user_id": user.user_id,
        },
        {"_id": 0},
    ).to_list(5000)

    monthly_totals = defaultdict(float)

    for r in records:
        amount = float(r.get("amount_usd") or 0)

        dt = parse_date(r.get("date")) or parse_date(
            r.get("created_at")
        )

        if not dt:
            continue

        month_key = dt.strftime("%Y-%m")

        monthly_totals[month_key] += amount

    sorted_months = sorted(monthly_totals.items())

    values = [v for _, v in sorted_months]

    if len(values) == 0:
        return {
            "forecast": {
                "next_month_usd": 0,
                "next_3_months_usd": 0,
                "projected_annual_usd": 0,
            },
            "trend": "stable",
            "confidence": "low",
            "drivers": [],
            "monthly_projection": [],
        }

    recent_values = values[-3:]

    avg_recent = sum(recent_values) / len(recent_values)

    next_month = round(avg_recent, 2)

    next_3_months = round(next_month * 3, 2)

    projected_annual = round(next_month * 12, 2)

    trend = "stable"

    if len(values) >= 2:
        if values[-1] > values[-2] * 1.15:
            trend = "increasing"

        elif values[-1] < values[-2] * 0.85:
            trend = "decreasing"

    confidence = "low"

    if len(values) >= 6:
        confidence = "high"

    elif len(values) >= 3:
        confidence = "moderate"

    medication_total = 0
    emergency_total = 0

    for r in records:
        category = r.get("category") or ""

        amount = float(r.get("amount_usd") or 0)

        if category == "medication":
            medication_total += amount

        if category in [
            "hospitalization",
            "surgery",
            "diagnostic",
            "imaging",
        ]:
            emergency_total += amount

    drivers = []

    if medication_total > 300:
        drivers.append("Recurring medication purchases")

    if emergency_total > 500:
        drivers.append("Frequent diagnostics or emergency care")

    if projected_annual > 2000:
        drivers.append("Overall care costs are trending upward")

    projections = []

    current = datetime.now(timezone.utc)

    for i in range(1, 7):
        month_dt = datetime(
            current.year + ((current.month + i - 1) // 12),
            ((current.month + i - 1) % 12) + 1,
            1,
            tzinfo=timezone.utc,
        )

        projections.append({
            "month": month_dt.strftime("%Y-%m"),
            "predicted_usd": next_month,
        })

    return {
        "forecast": {
            "next_month_usd": next_month,
            "next_3_months_usd": next_3_months,
            "projected_annual_usd": projected_annual,
        },
        "trend": trend,
        "confidence": confidence,
        "drivers": drivers,
        "monthly_projection": projections,
    }