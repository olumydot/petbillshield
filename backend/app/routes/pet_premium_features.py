from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from collections import defaultdict
import uuid
import json

from app.shared import (
    db,
    User,
    get_current_user,
    require_paid_plan,
    enforce_ai_usage_limit,
    record_ai_usage,
    call_claude_json,
)

router = APIRouter()


# ============================================================
# Helpers
# ============================================================

def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_dt(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
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


def pct(part, whole):
    if not whole:
        return 0.0
    return round((part / whole) * 100, 1)


def record_month(record):
    dt = parse_dt(record.get("date")) or parse_dt(record.get("created_at"))
    if not dt:
        return "Undated"
    return dt.strftime("%B %Y")


def normalize_date(value):
    dt = parse_dt(value)
    return dt.isoformat() if dt else None


def make_record_id():
    return f"rec_{uuid.uuid4().hex[:12]}"


def make_reminder_id():
    return f"rem_{uuid.uuid4().hex[:12]}"


# ============================================================
# Request Models
# ============================================================

class ExtractFromAnalysisRequest(BaseModel):
    analysis_id: str


class SaveExtractedPayload(BaseModel):
    records: List[Dict[str, Any]] = Field(default_factory=list)
    reminders: List[Dict[str, Any]] = Field(default_factory=list)


class WeightEntryPayload(BaseModel):
    weight_lbs: float
    date: Optional[str] = None
    note: Optional[str] = ""


class ReimbursementPredictionPayload(BaseModel):
    claim_id: Optional[str] = None
    policy_text: Optional[str] = ""
    invoice_text: Optional[str] = ""
    deductible_remaining_usd: Optional[float] = 0
    reimbursement_percent: Optional[float] = 80


# ============================================================
# 1-4. AI BILL EXTRACTION INTO PET RECORDS
# ============================================================

BILL_EXTRACTION_SYSTEM_PROMPT = """
You are PetBill Shield.

Extract structured pet health records from a previously analyzed veterinary bill.

Rules:
- Do not diagnose.
- Do not invent medical facts.
- Only extract information clearly supported by the bill analysis.
- Use cautious wording where uncertain.
- If a vaccine, medication, lab, visit, invoice, procedure, or follow-up is present, create a record candidate.
- If a future care date or likely next step is present, create a reminder candidate.
- Return JSON only.

Return this exact shape:
{
  "extracted_records": [
    {
      "record_type": "invoice|vaccine|medication|lab|visit|note",
      "title": "string",
      "details": "string",
      "amount_usd": number_or_null,
      "date": "YYYY-MM-DD or null",
      "category": "diagnostic|treatment|medication|hospitalization|surgery|imaging|labwork|exam|vaccine|dental|boarding|other",
      "confidence": "high|medium|low",
      "source_reason": "why this was extracted"
    }
  ],
  "suggested_reminders": [
    {
      "title": "string",
      "message": "string",
      "scheduled_for": "YYYY-MM-DD or null",
      "repeat": "none|weekly|monthly|yearly",
      "confidence": "high|medium|low",
      "reason": "string"
    }
  ],
  "summary": "short plain-English summary of what was extracted"
}
"""


@router.post("/pets/{pet_id}/bill-intelligence/extract")
async def extract_bill_records_from_analysis(
    pet_id: str,
    payload: ExtractFromAnalysisRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    analysis = await db.estimates.find_one(
        {
            "analysis_id": payload.analysis_id,
            "user_id": user.user_id,
            "pet_id": pet_id,
        },
        {"_id": 0},
    )
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found for this pet")

    user_prompt = f"""
Pet:
{json.dumps(pet, default=str)}

Bill analysis:
{json.dumps(analysis, default=str)}

Extract structured records and reminders.
"""

    result = await call_claude_json(
        BILL_EXTRACTION_SYSTEM_PROMPT,
        user_prompt,
        max_tokens=1800,
    )

    extracted_records = result.get("extracted_records", []) or []
    suggested_reminders = result.get("suggested_reminders", []) or []

    # Always include an invoice record if the analysis has a total.
    if analysis.get("estimated_total_usd") is not None:
        already_invoice = any(r.get("record_type") == "invoice" for r in extracted_records)
        if not already_invoice:
            extracted_records.insert(
                0,
                {
                    "record_type": "invoice",
                    "title": analysis.get("summary") or "Veterinary invoice",
                    "details": analysis.get("raw_text_excerpt") or analysis.get("summary") or "Saved from bill analysis.",
                    "amount_usd": analysis.get("estimated_total_usd"),
                    "date": datetime.now(timezone.utc).date().isoformat(),
                    "category": guess_category_from_analysis(analysis),
                    "confidence": "high",
                    "source_reason": "Created from the analyzed bill total.",
                },
            )

    return {
        "ok": True,
        "pet_id": pet_id,
        "analysis_id": payload.analysis_id,
        "summary": result.get("summary", "Review the extracted items before saving."),
        "extracted_records": extracted_records,
        "suggested_reminders": suggested_reminders,
    }


@router.post("/pets/{pet_id}/bill-intelligence/save")
async def save_extracted_bill_items(
    pet_id: str,
    payload: SaveExtractedPayload,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    saved_records = []
    saved_reminders = []

    for item in payload.records:
        record = {
            "record_id": make_record_id(),
            "user_id": user.user_id,
            "pet_id": pet_id,
            "record_type": item.get("record_type") or "note",
            "title": item.get("title") or "Extracted record",
            "details": item.get("details") or "",
            "amount_usd": item.get("amount_usd"),
            "date": normalize_date(item.get("date")) or now_iso(),
            "category": item.get("category") or "other",
            "source": "ai_bill_extraction",
            "confidence": item.get("confidence") or "medium",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.pet_records.insert_one(record)
        saved_records.append({k: v for k, v in record.items() if k != "_id"})

    for item in payload.reminders:
        scheduled_for = normalize_date(item.get("scheduled_for"))
        if not scheduled_for:
            continue

        reminder = {
            "reminder_id": make_reminder_id(),
            "user_id": user.user_id,
            "pet_id": pet_id,
            "pet_name": pet.get("name"),
            "title": item.get("title") or "Pet care reminder",
            "message": item.get("message") or "Suggested from uploaded bill.",
            "scheduled_for": scheduled_for,
            "repeat": item.get("repeat") or "none",
            "status": "pending",
            "source": "ai_bill_extraction",
            "confidence": item.get("confidence") or "medium",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.reminders.insert_one(reminder)
        saved_reminders.append({k: v for k, v in reminder.items() if k != "_id"})

    return {
        "ok": True,
        "saved_records_count": len(saved_records),
        "saved_reminders_count": len(saved_reminders),
        "saved_records": saved_records,
        "saved_reminders": saved_reminders,
    }


def guess_category_from_analysis(analysis):
    items = analysis.get("line_items", []) or []
    cats = [str(x.get("category", "")).lower() for x in items]

    for c in ["surgery", "hospitalization", "dental", "medication", "diagnostic", "imaging", "labwork", "exam"]:
        if c in cats:
            return c
    return "treatment"


# ============================================================
# 5. TIMELINE GROUPING API
# ============================================================

@router.get("/pets/{pet_id}/timeline/grouped")
async def grouped_pet_timeline(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).to_list(1000)

    groups = defaultdict(list)

    for record in records:
        groups[record_month(record)].append(record)

    grouped = []
    for month, items in groups.items():
        items.sort(
            key=lambda r: parse_dt(r.get("date")) or parse_dt(r.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        grouped.append({"month": month, "items": items})

    grouped.sort(
        key=lambda g: parse_dt(g["items"][0].get("date")) or parse_dt(g["items"][0].get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    return {
        "pet": pet,
        "groups": grouped,
        "total_records": len(records),
    }


# ============================================================
# 6. CARE SCORE ALGORITHM
# ============================================================

@router.get("/pets/{pet_id}/care-score")
async def pet_care_score(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).to_list(1000)

    reminders = await db.reminders.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).to_list(500)

    vaccines = [r for r in records if r.get("record_type") == "vaccine"]
    meds = [r for r in records if r.get("record_type") == "medication"]
    visits = [r for r in records if r.get("record_type") == "visit"]
    invoices = [r for r in records if r.get("record_type") == "invoice"]

    score = 40
    reasons = []

    if vaccines:
        score += 15
        reasons.append("Vaccine records are present.")
    else:
        reasons.append("No vaccine records yet.")

    if meds:
        score += 10
        reasons.append("Medication history is being tracked.")

    if visits:
        score += 10
        reasons.append("Visit history is being tracked.")

    if reminders:
        score += 15
        reasons.append("Care reminders are configured.")
    else:
        reasons.append("No care reminders are configured yet.")

    if invoices:
        score += 10
        reasons.append("Cost history is being tracked.")

    score = min(score, 100)

    if score >= 85:
        label = "Excellent"
    elif score >= 70:
        label = "Strong"
    elif score >= 55:
        label = "Building"
    else:
        label = "Needs setup"

    return {
        "pet_id": pet_id,
        "score": score,
        "label": label,
        "reasons": reasons,
        "breakdown": {
            "vaccines": len(vaccines),
            "medications": len(meds),
            "visits": len(visits),
            "reminders": len(reminders),
            "invoices": len(invoices),
        },
    }


# ============================================================
# 7. AI INSIGHT GENERATION ENDPOINT
# ============================================================

PET_AI_INSIGHT_SYSTEM_PROMPT = """
You are PetBill Shield.

Write premium, calm, non-diagnostic pet care insights based only on the saved records.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not invent facts.
- Talk about patterns in records, spending, reminders, vaccines, medications, and follow-ups.
- Be warm, practical, and concise.
- Return JSON only.

Return:
{
  "summary": "string",
  "observations": [
    {"title": "string", "message": "string", "level": "info|watch|positive"}
  ],
  "next_best_actions": ["string"]
}
"""


@router.get("/pets/{pet_id}/ai-insights")
async def pet_ai_insights(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "pet_question")

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    reminders = await db.reminders.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("scheduled_for", 1).to_list(100)

    prompt = f"""
Pet:
{json.dumps(pet, default=str)}

Records:
{json.dumps(records, default=str)}

Reminders:
{json.dumps(reminders, default=str)}

Generate premium care insights.
"""

    result = await call_claude_json(
        PET_AI_INSIGHT_SYSTEM_PROMPT,
        prompt,
        max_tokens=1200,
    )
    await record_ai_usage(user, "pet_question", linked_id=pet_id)

    return {
        "summary": result.get("summary", "Not enough saved history yet."),
        "observations": result.get("observations", []),
        "next_best_actions": result.get("next_best_actions", []),
    }


# ============================================================
# 8. SPENDING ANALYTICS ENDPOINT
# ============================================================

@router.get("/pets/{pet_id}/spending-analytics")
async def pet_spending_analytics(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).to_list(1000)

    invoices = [r for r in records if r.get("record_type") == "invoice"]

    monthly = defaultdict(float)
    categories = defaultdict(float)
    total = 0.0

    for r in invoices:
        amount = safe_float(r.get("amount_usd"))
        total += amount

        dt = parse_dt(r.get("date")) or parse_dt(r.get("created_at"))
        key = dt.strftime("%Y-%m") if dt else "undated"
        monthly[key] += amount
        categories[r.get("category") or "other"] += amount

    monthly_items = [
        {"month": k, "amount_usd": round(v, 2)}
        for k, v in sorted(monthly.items())
    ]

    category_items = [
        {"category": k, "amount_usd": round(v, 2), "percent": pct(v, total)}
        for k, v in sorted(categories.items(), key=lambda x: x[1], reverse=True)
    ]

    avg_monthly = total / max(len(monthly), 1)

    return {
        "pet_id": pet_id,
        "total_spent_usd": round(total, 2),
        "average_monthly_spend_usd": round(avg_monthly, 2),
        "projected_annual_spend_usd": round(avg_monthly * 12, 2),
        "monthly": monthly_items,
        "categories": category_items,
        "top_category": category_items[0] if category_items else None,
    }


# ============================================================
# 9. INSURANCE REIMBURSEMENT PREDICTION
# ============================================================

REIMBURSEMENT_SYSTEM_PROMPT = """
You are PetBill Shield.

Estimate likely pet insurance reimbursement using only the policy, invoice, and claim information provided.

Rules:
- Do not guarantee coverage.
- Be conservative.
- Explain assumptions.
- Return JSON only.

Return:
{
  "estimated_reimbursement_usd": number,
  "confidence": "high|medium|low",
  "likely_covered": ["string"],
  "likely_excluded": ["string"],
  "missing_documents": ["string"],
  "appeal_tips": ["string"],
  "plain_english_summary": "string"
}
"""


@router.post("/insurance/reimbursement-prediction")
async def insurance_reimbursement_prediction(
    payload: ReimbursementPredictionPayload,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    claim = None
    if payload.claim_id:
        claim = await db.claims.find_one(
            {"claim_id": payload.claim_id, "user_id": user.user_id},
            {"_id": 0},
        )

    prompt = f"""
Claim:
{json.dumps(claim, default=str)}

Policy text:
{payload.policy_text or ""}

Invoice text:
{payload.invoice_text or ""}

Deductible remaining: {payload.deductible_remaining_usd}
Reimbursement percent: {payload.reimbursement_percent}

Predict likely reimbursement.
"""

    result = await call_claude_json(
        REIMBURSEMENT_SYSTEM_PROMPT,
        prompt,
        max_tokens=1200,
    )

    doc = {
        "prediction_id": f"rp_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "claim_id": payload.claim_id,
        "result": result,
        "created_at": now_iso(),
    }
    await db.reimbursement_predictions.insert_one(doc)

    return {
        "ok": True,
        "prediction_id": doc["prediction_id"],
        **result,
    }


# ============================================================
# 10. WEIGHT TREND / HISTORY TABLE
# ============================================================

@router.post("/pets/{pet_id}/weight")
async def add_weight_entry(
    pet_id: str,
    payload: WeightEntryPayload,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    date = normalize_date(payload.date) or now_iso()

    doc = {
        "weight_id": f"wgt_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": pet_id,
        "weight_lbs": payload.weight_lbs,
        "date": date,
        "note": payload.note or "",
        "created_at": now_iso(),
    }

    await db.pet_weights.insert_one(doc)

    await db.pets.update_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"$set": {"weight_lbs": payload.weight_lbs, "updated_at": now_iso()}},
    )

    return {"ok": True, "weight": {k: v for k, v in doc.items() if k != "_id"}}


@router.get("/pets/{pet_id}/weight")
async def get_weight_history(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    rows = await db.pet_weights.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("date", 1).to_list(500)

    trend = "not_enough_data"
    change_lbs = 0.0

    if len(rows) >= 2:
        first = safe_float(rows[0].get("weight_lbs"))
        last = safe_float(rows[-1].get("weight_lbs"))
        change_lbs = round(last - first, 2)

        if change_lbs > 1:
            trend = "increasing"
        elif change_lbs < -1:
            trend = "decreasing"
        else:
            trend = "stable"

    return {
        "pet_id": pet_id,
        "history": rows,
        "trend": trend,
        "change_lbs": change_lbs,
        "latest_weight_lbs": rows[-1]["weight_lbs"] if rows else pet.get("weight_lbs"),
    }


# ============================================================
# Router registration note
# ============================================================

