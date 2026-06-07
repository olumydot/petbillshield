from fastapi import APIRouter
from app.shared import *

router = APIRouter()

# -------------------- Feedback --------------------
class FeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    category: Optional[str] = "general"  # general | bug | idea | praise | complaint
    comment: Optional[str] = ""
    page: Optional[str] = ""
    # Honeypot — bots fill this in. Real users never see/touch it.
    website: Optional[str] = ""


@router.post("/feedback")
@limiter.limit("10/minute")
async def create_feedback(payload: FeedbackCreate, request: Request):
    # Honeypot trap
    if payload.website and payload.website.strip():
        logger.info("feedback honeypot triggered — silently dropping")
        return {"ok": True, "feedback_id": ""}

    # Best-effort auth: capture user if authenticated, otherwise anonymous
    user_id = None
    user_email = None
    try:
        u = await get_current_user(request)
        user_id, user_email = u.user_id, u.email
    except Exception:
        pass

    doc = {
        "feedback_id": f"fb_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "user_email": user_email,
        "rating": int(payload.rating),
        "category": (payload.category or "general").lower(),
        "comment": (payload.comment or "").strip()[:4000],
        "page": (payload.page or "")[:200],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.feedback.insert_one(doc)
    return {"ok": True, "feedback_id": doc["feedback_id"]}


@router.get("/feedback/mine")
async def list_my_feedback(user: User = Depends(get_current_user)):
    rows = await db.feedback.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


# -------------------- Rescue / Foster AI summaries --------------------
class RescueAiSummaryRequest(BaseModel):
    report_type: Optional[str] = "care_summary"
    title: Optional[str] = "Rescue / Foster Care Summary"
    pets: list = Field(default_factory=list)
    records: list = Field(default_factory=list)
    reminders: list = Field(default_factory=list)
    timelines: dict = Field(default_factory=dict)
    local_draft: Optional[str] = ""
    instruction: Optional[str] = ""


class FosterAssignmentPayload(BaseModel):
    pet_id: str
    foster_name: str
    foster_email: Optional[str] = ""
    start_date: Optional[str] = ""
    location: Optional[str] = ""
    comfort_level: Optional[str] = "routine"
    capacity_notes: Optional[str] = ""
    notes: Optional[str] = ""
    status: Optional[str] = "active"


class FosterAssignmentStatusPayload(BaseModel):
    status: str = "active"


class FosterWeeklyUpdatePayload(BaseModel):
    pet_id: str
    week_of: Optional[str] = ""
    appetite: Optional[str] = ""
    energy: Optional[str] = ""
    behavior: Optional[str] = ""
    meds_given: Optional[str] = ""
    concerns: Optional[str] = ""
    wins: Optional[str] = ""
    supplies_needed: Optional[str] = ""
    notes: Optional[str] = ""


class SupplyRequestPayload(BaseModel):
    pet_id: Optional[str] = ""
    item: str
    quantity: Optional[str] = ""
    urgency: Optional[str] = "normal"
    notes: Optional[str] = ""
    status: Optional[str] = "requested"


class SupplyRequestStatusPayload(BaseModel):
    status: str = "requested"


class PublicBioPayload(BaseModel):
    pet_id: str
    tone: Optional[str] = "warm"
    notes: Optional[str] = ""


RESCUE_AI_SUMMARY_SYSTEM_PROMPT = """
You are PetBill Shield's Rescue / Foster care coordinator.

Write a comprehensive, field-ready care summary for rescue and foster subscribers.
Use ONLY the provided animals, records, reminders, timeline summaries, invoices, and draft text.
Do not diagnose, do not imply certainty that is not in the records, and do not replace a veterinarian.
When information is missing, say "Not documented" or "Needs confirmation" instead of inventing it.

The output should be useful for foster parents, rescue coordinators, adopters, partner vets,
board members, and donors. It should be detailed enough to support handoff, reimbursement,
care planning, and follow-up coordination.

For a care_summary, include these sections in the summary string:
1. Executive Snapshot
   - selected animal count, tracked spend, invoices, vaccine/medication/visit/lab records,
     upcoming and overdue reminders, and urgent gaps.
2. Animal-by-Animal Care Summary
   For each animal include:
   - basic profile from the pet data
   - recent care history from records and timeline
   - medications, vaccines, labs, invoices, procedures, and visits if documented
   - current follow-ups or reminders
   - financial/claim notes where present
   - record gaps or items needing confirmation
   - foster/adopter/vet handoff notes
3. Care Load and Priority Review
   - group animals by high/medium/routine administrative attention based on reminders,
     missing records, recent invoices, overdue items, and care volume. Do not diagnose.
4. Cost and Resource Pressure
   - summarize spend by animal where available, high-cost animals, reimbursement/claim context,
     and donor/reimbursement documentation needs.
5. Record Completeness and Missing Documents
   - vaccine gaps, medication gaps, invoice gaps, lab gaps, microchip/spay-neuter/dental/behavior
     notes if absent or unclear.
6. Next 7 / 30 / 60 / 90 Day Plan
   - practical rescue/foster operations tasks, not medical instructions.
7. Questions to Confirm
   - questions for the rescue coordinator, foster parent, insurer, or veterinarian.
8. Shareable Handoff Summary
   - concise paragraph suitable for an adopter, foster, vet, or partner rescue.

For expense reports, include these sections:
1. Executive Financial Snapshot
   - total tracked spend, invoice count, selected animals, date coverage if inferable,
     highest-cost animals, and documentation gaps.
2. Animal-by-Animal Expense Detail
   - each animal's invoice total, invoice count, timeline net cost if present,
     itemized invoices with date/title/amount/category/details, and reimbursement/claim notes when present.
3. Spending Categories and Cost Drivers
   - summarize categories, repeat costs, high-cost events, medications, procedures, labs, and follow-ups.
4. Reimbursement / Donor Documentation Checklist
   - missing invoices, receipts, claim decisions, appeal notes, insurer details, and proof needed.
5. Board / Donor Narrative
   - plain-English explanation of why costs occurred, without diagnosis or unsupported claims.
6. Next Finance Actions
   - practical next steps for reimbursement, donor reporting, budgeting, and missing documentation.

For adoption or foster transfer packets, include these sections:
1. Transfer Readiness Snapshot
   - selected animals, upcoming reminders, overdue items, missing records, and handoff risk items.
2. Animal-by-Animal Transfer Packet
   - profile, care history, vaccines, medications, labs, visits, invoices, diet/behavior/restriction notes if documented,
     insurance/vet clinic details, timeline summary, current reminders, and record gaps.
3. Foster / Adopter Instructions
   - practical non-medical care admin notes, what to monitor administratively, and what records to bring to a vet.
4. Vet / Partner Rescue Handoff
   - concise clinic-facing record summary and questions to confirm.
5. Missing Documents Before Transfer
   - vaccine proof, microchip, spay/neuter, medications, invoices, lab reports, behavior notes, and claim files if absent.
6. First 7 / 30 / 60 Day Follow-up Plan
   - operational reminders and confirmation tasks.
7. Shareable Placement Summary
   - concise adopter/foster-safe paragraph.

For vaccine reports, adapt the same comprehensive style to vaccine history, missing proof, due/overdue reminders,
and confirmation questions.
Keep language calm, organized, specific, and non-alarmist.

Return strict JSON only:
{
  "summary": "A detailed markdown-style report string with clear section headings"
}
"""


RESCUE_PUBLIC_BIO_SYSTEM_PROMPT = """
You are PetBill Shield's rescue adoption copywriter.

Create an adopter-safe public bio using ONLY the supplied animal profile, records,
reminders, timeline summary, foster updates, and coordinator notes.
Do not diagnose. Do not include private financial details, claim details, internal
case notes, exact addresses, or unsupported medical claims.

The bio should be warm, practical, specific, and honest. Mention care needs only as
documented or as items to confirm with the rescue. If something is missing, say it
needs confirmation rather than inventing it.

Return strict JSON only:
{
  "headline": "Short listing headline",
  "bio": "Public-facing bio, 2-4 concise paragraphs",
  "good_fit": ["Specific home or adopter qualities"],
  "care_notes": ["Documented care or routine notes safe to share"],
  "disclosure_notes": ["Items the rescue should verify before publishing"]
}
"""


async def require_rescue_plan(user: User):
    await require_paid_plan(user)
    doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    plan_id = (doc.get("plan_id") or "").lower()
    if "rescue" not in plan_id:
        raise HTTPException(status_code=403, detail="Rescue / Foster plan required")
    return doc


@router.post("/rescue/ai-summary")
async def rescue_ai_summary(payload: RescueAiSummaryRequest, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    await enforce_ai_usage_limit(user, "timeline_summary")

    compact_pets = payload.pets[:100]
    compact_records = payload.records[:1500]
    compact_reminders = payload.reminders[:500]
    compact_timelines = payload.timelines or {}

    user_prompt = f"""
Report type: {payload.report_type or "care_summary"}
Requested title: {payload.title or "Rescue / Foster Care Summary"}
Extra instruction from UI:
{payload.instruction or "Generate a comprehensive care summary for selected rescue/foster animals."}

Selected animals:
{json.dumps(compact_pets, default=str)}

Records:
{json.dumps(compact_records, default=str)}

Reminders:
{json.dumps(compact_reminders, default=str)}

Timeline summaries and grouped timelines:
{json.dumps(compact_timelines, default=str)}

Existing local draft, if any:
{payload.local_draft or ""}

Generate a detailed, practical, non-diagnostic rescue/foster report. Return JSON only.
"""

    result = await call_claude_json(
        RESCUE_AI_SUMMARY_SYSTEM_PROMPT,
        user_prompt,
        max_tokens=5000,
    )

    await record_ai_usage(user, "timeline_summary", linked_id="rescue_ai_summary")

    return {
        "ok": True,
        "summary": result.get("summary", ""),
    }


async def _require_user_pet(user: User, pet_id: str):
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    return pet


async def _pet_name_map(user: User):
    pets = await db.pets.find({"user_id": user.user_id}, {"_id": 0, "pet_id": 1, "name": 1, "species": 1}).to_list(1000)
    return {
        p.get("pet_id"): {
            "pet_name": p.get("name") or "Animal",
            "pet_species": p.get("species") or "",
        }
        for p in pets
    }


def _decorate_pet_rows(rows, pet_names):
    decorated = []
    for row in rows:
        pet_info = pet_names.get(row.get("pet_id"), {})
        decorated.append({**row, **pet_info})
    return decorated


def _as_string_list(value):
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


@router.get("/rescue/foster-ops")
async def list_foster_ops(user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    pet_names = await _pet_name_map(user)

    assignments = await db.rescue_foster_assignments.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    weekly_updates = await db.rescue_foster_weekly_updates.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    supply_requests = await db.rescue_supply_requests.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    bios = await db.rescue_public_bios.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    return {
        "assignments": _decorate_pet_rows(assignments, pet_names),
        "weekly_updates": _decorate_pet_rows(weekly_updates, pet_names),
        "supply_requests": _decorate_pet_rows(supply_requests, pet_names),
        "bios": _decorate_pet_rows(bios, pet_names),
    }


@router.post("/rescue/foster-assignments")
async def create_foster_assignment(payload: FosterAssignmentPayload, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    pet = await _require_user_pet(user, payload.pet_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "assignment_id": f"fas_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": payload.pet_id,
        "pet_name": pet.get("name") or "Animal",
        "foster_name": (payload.foster_name or "").strip()[:200],
        "foster_email": (payload.foster_email or "").strip()[:200],
        "start_date": (payload.start_date or "").strip()[:40],
        "location": (payload.location or "").strip()[:200],
        "comfort_level": (payload.comfort_level or "routine").strip()[:80],
        "capacity_notes": (payload.capacity_notes or "").strip()[:2000],
        "notes": (payload.notes or "").strip()[:3000],
        "status": (payload.status or "active").strip().lower()[:40],
        "created_at": now,
        "updated_at": now,
    }
    if not doc["foster_name"]:
        raise HTTPException(status_code=400, detail="Foster name is required")
    await db.rescue_foster_assignments.insert_one(doc)
    return {"ok": True, "assignment": {k: v for k, v in doc.items() if k != "_id"}}


@router.patch("/rescue/foster-assignments/{assignment_id}")
async def update_foster_assignment_status(
    assignment_id: str,
    payload: FosterAssignmentStatusPayload,
    user: User = Depends(get_current_user),
):
    await require_rescue_plan(user)
    status = (payload.status or "active").strip().lower()[:40]
    result = await db.rescue_foster_assignments.update_one(
        {"assignment_id": assignment_id, "user_id": user.user_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}


@router.post("/rescue/weekly-updates")
async def create_foster_weekly_update(payload: FosterWeeklyUpdatePayload, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    pet = await _require_user_pet(user, payload.pet_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "update_id": f"fup_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": payload.pet_id,
        "pet_name": pet.get("name") or "Animal",
        "week_of": (payload.week_of or "").strip()[:40],
        "appetite": (payload.appetite or "").strip()[:500],
        "energy": (payload.energy or "").strip()[:500],
        "behavior": (payload.behavior or "").strip()[:1000],
        "meds_given": (payload.meds_given or "").strip()[:1000],
        "concerns": (payload.concerns or "").strip()[:1500],
        "wins": (payload.wins or "").strip()[:1000],
        "supplies_needed": (payload.supplies_needed or "").strip()[:1000],
        "notes": (payload.notes or "").strip()[:3000],
        "created_at": now,
        "updated_at": now,
    }
    await db.rescue_foster_weekly_updates.insert_one(doc)
    return {"ok": True, "update": {k: v for k, v in doc.items() if k != "_id"}}


@router.post("/rescue/supply-requests")
async def create_supply_request(payload: SupplyRequestPayload, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    pet = None
    if payload.pet_id:
        pet = await _require_user_pet(user, payload.pet_id)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "request_id": f"sup_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": payload.pet_id or "",
        "pet_name": (pet or {}).get("name") or "",
        "item": (payload.item or "").strip()[:200],
        "quantity": (payload.quantity or "").strip()[:100],
        "urgency": (payload.urgency or "normal").strip().lower()[:40],
        "notes": (payload.notes or "").strip()[:2000],
        "status": (payload.status or "requested").strip().lower()[:40],
        "created_at": now,
        "updated_at": now,
    }
    if not doc["item"]:
        raise HTTPException(status_code=400, detail="Supply item is required")
    await db.rescue_supply_requests.insert_one(doc)
    return {"ok": True, "request": {k: v for k, v in doc.items() if k != "_id"}}


@router.patch("/rescue/supply-requests/{request_id}")
async def update_supply_request_status(
    request_id: str,
    payload: SupplyRequestStatusPayload,
    user: User = Depends(get_current_user),
):
    await require_rescue_plan(user)
    status = (payload.status or "requested").strip().lower()[:40]
    result = await db.rescue_supply_requests.update_one(
        {"request_id": request_id, "user_id": user.user_id},
        {"$set": {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supply request not found")
    return {"ok": True}


@router.post("/rescue/public-bio")
async def generate_public_bio(payload: PublicBioPayload, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    await enforce_ai_usage_limit(user, "pet_question")
    pet = await _require_user_pet(user, payload.pet_id)

    records = await db.pet_records.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(250)
    reminders = await db.reminders.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("scheduled_for", 1).to_list(100)
    updates = await db.rescue_foster_weekly_updates.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(20)

    user_prompt = f"""
Tone requested: {payload.tone or "warm"}
Coordinator notes:
{payload.notes or ""}

Animal profile:
{json.dumps(pet, default=str)}

Records:
{json.dumps(records, default=str)}

Reminders:
{json.dumps(reminders, default=str)}

Recent foster updates:
{json.dumps(updates, default=str)}

Generate a public-facing adoption or foster bio. Return JSON only.
"""
    result = await call_claude_json(
        RESCUE_PUBLIC_BIO_SYSTEM_PROMPT,
        user_prompt,
        max_tokens=1800,
    )
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "bio_id": f"bio_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": payload.pet_id,
        "pet_name": pet.get("name") or "Animal",
        "tone": payload.tone or "warm",
        "notes": (payload.notes or "").strip()[:2000],
        "headline": result.get("headline") or f"Meet {pet.get('name') or 'this animal'}",
        "bio": result.get("bio") or "",
        "good_fit": _as_string_list(result.get("good_fit")),
        "care_notes": _as_string_list(result.get("care_notes")),
        "disclosure_notes": _as_string_list(result.get("disclosure_notes")),
        "created_at": now,
    }
    await db.rescue_public_bios.insert_one(doc)
    await record_ai_usage(user, "pet_question", linked_id=payload.pet_id)
    return {"ok": True, "bio": {k: v for k, v in doc.items() if k != "_id"}}


# -------------------- Rescue / Foster expense report (donor & tax) --------------------
def _record_effective_date(rec: dict) -> str:
    """Best-effort ISO date for a record: explicit date, else created_at."""
    raw = (rec.get("date") or "").strip()
    if not raw:
        raw = rec.get("created_at") or ""
        if not isinstance(raw, str):
            try:
                raw = raw.isoformat()
            except Exception:
                raw = ""
    return raw


def _build_expense_report(records: list, pet_names: dict, year: int | None):
    """Aggregate priced records into a donor/tax-ready expense report."""
    line_items = []
    by_pet: dict = {}
    by_category: dict = {}
    total = 0.0

    for rec in records:
        amt = rec.get("amount_usd")
        if not amt:
            continue
        try:
            amt = float(amt)
        except (TypeError, ValueError):
            continue
        if amt <= 0:
            continue

        eff = _record_effective_date(rec)
        rec_year = None
        if eff:
            try:
                rec_year = datetime.fromisoformat(eff.replace("Z", "+00:00")).year
            except Exception:
                rec_year = None
        if year and rec_year != year:
            continue

        pet_info = pet_names.get(rec.get("pet_id"), {})
        pet_name = pet_info.get("pet_name", "Unassigned")
        category = (rec.get("category") or "other").strip() or "other"

        total += amt
        by_pet[pet_name] = by_pet.get(pet_name, 0.0) + amt
        by_category[category] = by_category.get(category, 0.0) + amt
        line_items.append({
            "date":     (eff or "")[:10],
            "pet_name": pet_name,
            "species":  pet_info.get("pet_species", ""),
            "type":     rec.get("record_type") or "note",
            "category": category,
            "title":    rec.get("title") or "",
            "amount_usd": round(amt, 2),
        })

    line_items.sort(key=lambda r: r["date"], reverse=True)

    return {
        "year":        year,
        "total_usd":   round(total, 2),
        "count":       len(line_items),
        "by_pet":      [{"pet_name": k, "total_usd": round(v, 2)} for k, v in sorted(by_pet.items(), key=lambda x: -x[1])],
        "by_category": [{"category": k, "total_usd": round(v, 2)} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
        "line_items":  line_items,
    }


@router.get("/rescue/expense-report")
async def rescue_expense_report(year: int | None = None, user: User = Depends(get_current_user)):
    """Donor- and tax-ready expense summary for the rescue/foster org."""
    doc = await require_rescue_plan(user)
    pet_names = await _pet_name_map(user)
    records = await db.pet_records.find(
        {"user_id": user.user_id, "amount_usd": {"$gt": 0}},
        {"_id": 0},
    ).to_list(10000)

    report = _build_expense_report(records, pet_names, year)
    report["org_name"] = doc.get("org_name") or doc.get("name") or ""
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    return report


@router.get("/rescue/expense-report.csv")
async def rescue_expense_report_csv(year: int | None = None, user: User = Depends(get_current_user)):
    await require_rescue_plan(user)
    pet_names = await _pet_name_map(user)
    records = await db.pet_records.find(
        {"user_id": user.user_id, "amount_usd": {"$gt": 0}},
        {"_id": 0},
    ).to_list(10000)

    report = _build_expense_report(records, pet_names, year)

    buf = io.StringIO()
    writer = csv_module.writer(buf)
    writer.writerow(["Date", "Animal", "Species", "Type", "Category", "Description", "Amount (USD)"])
    for r in report["line_items"]:
        writer.writerow([r["date"], r["pet_name"], r["species"], r["type"], r["category"], r["title"], f'{r["amount_usd"]:.2f}'])
    writer.writerow([])
    writer.writerow(["", "", "", "", "", "TOTAL", f'{report["total_usd"]:.2f}'])

    label = str(year) if year else "all-time"
    filename = f"petbill-expense-report-{label}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# -------------------- Shareable Analysis Links --------------------
class AnalysisShare(BaseModel):
    model_config = ConfigDict(extra="ignore")
    share_id: str
    user_id: str
    analysis_id: str
    slug: str
    revoked: bool = False
    view_count: int = 0
    created_at: str


@router.post("/estimates/{analysis_id}/share")
async def create_share(analysis_id: str, user: User = Depends(get_current_user)):
    row = await db.estimates.find_one({"analysis_id": analysis_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    # Reuse existing non-revoked share if any
    existing = await db.shares.find_one({"analysis_id": analysis_id, "user_id": user.user_id, "revoked": False}, {"_id": 0})
    if existing:
        return existing
    share = {
        "share_id": f"shr_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "analysis_id": analysis_id,
        "slug": uuid.uuid4().hex[:18],
        "revoked": False,
        "view_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.shares.insert_one(dict(share))
    return share


@router.get("/shares")
async def list_shares(user: User = Depends(get_current_user)):
    rows = await db.shares.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows


@router.delete("/shares/{share_id}")
async def revoke_share(share_id: str, user: User = Depends(get_current_user)):
    result = await db.shares.update_one(
        {"share_id": share_id, "user_id": user.user_id},
        {"$set": {"revoked": True}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Share not found")
    return {"ok": True}


@router.get("/public/analysis/{slug}")
async def public_analysis_by_slug(slug: str):
    share = await db.shares.find_one({"slug": slug, "revoked": False}, {"_id": 0})
    if not share:
        raise HTTPException(status_code=404, detail="This link is not available")
    row = await db.estimates.find_one({"analysis_id": share["analysis_id"]}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Analysis no longer exists")
    # Track view (best-effort)
    await db.shares.update_one({"share_id": share["share_id"]}, {"$inc": {"view_count": 1}})
    # Strip user_id from response
    row.pop("user_id", None)
    return {
        "analysis": row,
        "share": {"slug": share["slug"], "created_at": share["created_at"], "view_count": share.get("view_count", 0) + 1},
    }


# -------------------- Spend trends --------------------
@router.get("/stats/trends")
async def stats_trends(months: int = 6, user: User = Depends(get_current_user)):
    months = max(1, min(int(months or 6), 24))
    now = datetime.now(timezone.utc)
    # Build month buckets back from current month
    buckets = []
    for i in range(months - 1, -1, -1):
        y = now.year
        m = now.month - i
        while m <= 0:
            m += 12
            y -= 1
        buckets.append({
            "key": f"{y:04d}-{m:02d}",
            "year": y, "month": m,
            "label": datetime(y, m, 1).strftime("%b %Y"),
            "total_usd": 0.0,
            "by_pet": {},
            "by_category": {},
        })

    # Build a map for quick lookup
    by_key = {b["key"]: b for b in buckets}
    earliest = buckets[0]
    cutoff = datetime(earliest["year"], earliest["month"], 1, tzinfo=timezone.utc).isoformat()

    pets = await db.pets.find({"user_id": user.user_id}, {"_id": 0, "pet_id": 1, "name": 1}).to_list(500)
    pet_name_by_id = {p["pet_id"]: p["name"] for p in pets}

    records = await db.pet_records.find(
        {"user_id": user.user_id, "record_type": "invoice", "amount_usd": {"$ne": None}},
        {"_id": 0}
    ).to_list(5000)

    for r in records:
        amt = r.get("amount_usd")
        if not amt:
            continue
        # Prefer the record `date` field; fall back to created_at
        when = r.get("date") or r.get("created_at") or ""
        try:
            dt = datetime.fromisoformat(when) if when else None
        except Exception:
            dt = None
        if not dt:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt.isoformat() < cutoff:
            continue
        key = f"{dt.year:04d}-{dt.month:02d}"
        b = by_key.get(key)
        if not b:
            continue
        amount = float(amt)
        b["total_usd"] = round(b["total_usd"] + amount, 2)
        pid = r.get("pet_id") or "unknown"
        pname = pet_name_by_id.get(pid, pname_fallback(pid))
        b["by_pet"][pname] = round(b["by_pet"].get(pname, 0.0) + amount, 2)
        cat = (r.get("category") or "other").lower()
        if cat not in RECORD_CATEGORIES:
            cat = "other"
        b["by_category"][cat] = round(b["by_category"].get(cat, 0.0) + amount, 2)

    total = round(sum(b["total_usd"] for b in buckets), 2)
    pet_totals = {}
    cat_totals = {}
    for b in buckets:
        for pname, v in b["by_pet"].items():
            pet_totals[pname] = round(pet_totals.get(pname, 0.0) + v, 2)
        for c, v in b["by_category"].items():
            cat_totals[c] = round(cat_totals.get(c, 0.0) + v, 2)
    return {
        "months": months,
        "total_usd": total,
        "buckets": buckets,
        "by_pet_totals": pet_totals,
        "by_category_totals": cat_totals,
        "categories": RECORD_CATEGORIES,
    }


def pname_fallback(pid: str) -> str:
    return "Unassigned" if not pid or pid == "unknown" else pid[:8]


# -------------------- Compare estimates --------------------
class CompareRequest(BaseModel):
    a_id: str
    b_id: str


@router.post("/estimates/compare")
async def compare_estimates(payload: CompareRequest, user: User = Depends(get_current_user)):
    a = await db.estimates.find_one(
        {"analysis_id": payload.a_id, "user_id": user.user_id},
        {"_id": 0}
    )
    b = await db.estimates.find_one(
        {"analysis_id": payload.b_id, "user_id": user.user_id},
        {"_id": 0}
    )
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "compare")


    if not a or not b:
        raise HTTPException(status_code=404, detail="One or both analyses not found")

    def index_items(items):
        return {
            (it.get("label") or "").strip().lower(): it
            for it in (items or [])
        }

    a_items = index_items(a.get("line_items"))
    b_items = index_items(b.get("line_items"))

    all_keys = set(a_items) | set(b_items)
    rows = []

    for k in sorted(all_keys):
        ai = a_items.get(k)
        bi = b_items.get(k)

        label = (ai or bi).get("label", "")
        a_amt = ai.get("amount_usd") if ai else None
        b_amt = bi.get("amount_usd") if bi else None

        diff = None
        if a_amt is not None and b_amt is not None:
            diff = round(float(b_amt) - float(a_amt), 2)

        rows.append({
            "label": label,
            "a_amount_usd": a_amt,
            "b_amount_usd": b_amt,
            "diff_usd": diff,
            "in_both": bool(ai and bi),
            "only_in": None if (ai and bi) else ("a" if ai else "b"),
            "a_urgency": (ai or {}).get("urgency"),
            "b_urgency": (bi or {}).get("urgency"),
        })

    a_total = a.get("estimated_total_usd")
    b_total = b.get("estimated_total_usd")

    total_diff = None
    if a_total is not None and b_total is not None:
        total_diff = round(float(b_total) - float(a_total), 2)

    recommendation = {
        "recommended_side": "unclear",
        "title": "Review both estimates carefully",
        "summary": (
            "There is not enough clear information to recommend one estimate over the other. "
            "Ask both providers what is urgent, what can wait, and why each item was included."
        ),
        "reasons": [
            "Medical context matters more than price alone",
            "Some line items may not match perfectly",
            "Your veterinarian can explain urgency and necessity best",
        ],
        "questions_to_ask": [
            "Which items are urgent today?",
            "Which items can safely wait?",
            "Are there lower-cost alternatives or staged treatment options?",
        ],
        "medical_caution": (
            "This is only a comparison aid. It is not veterinary advice. "
            "The final decision rests with you and your veterinarian."
        ),
    }

    try:
        compare_prompt = f"""
Estimate A:
{json.dumps(a, default=str)}

Estimate B:
{json.dumps(b, default=str)}

Line-item comparison:
{json.dumps(rows, default=str)}

Totals:
A total: {a_total}
B total: {b_total}
B minus A: {total_diff}

Give a careful recommendation.
Return JSON only.
"""

        ai_result = await call_claude_json(
            COMPARE_RECOMMENDATION_SYSTEM_PROMPT,
            compare_prompt,
            max_tokens=1200,
        )

        if ai_result:
            recommendation = {
                "recommended_side": ai_result.get("recommended_side", "unclear"),
                "title": ai_result.get("title", recommendation["title"]),
                "summary": ai_result.get("summary", recommendation["summary"]),
                "reasons": ai_result.get("reasons", []) or recommendation["reasons"],
                "questions_to_ask": ai_result.get("questions_to_ask", []) or recommendation["questions_to_ask"],
                "medical_caution": ai_result.get("medical_caution", recommendation["medical_caution"]),
            }

    except Exception as e:
        logger.warning(f"Claude compare recommendation failed: {e}")

    pet_id = a.get("pet_id") or b.get("pet_id")
    pet_name = a.get("pet_name") or b.get("pet_name") or "Pet"

    comparison_title = f"{pet_name} estimate comparison"

    comparison = EstimateComparison(
        user_id=user.user_id,
        pet_id=pet_id,
        pet_name=pet_name,
        title=comparison_title,
        a_id=payload.a_id,
        b_id=payload.b_id,
        a_snapshot=a,
        b_snapshot=b,
        rows=rows,
        a_total=a_total,
        b_total=b_total,
        total_diff_usd=total_diff,
        recommendation=recommendation,
    )

    doc = comparison.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()

    await db.estimate_comparisons.insert_one(doc)
    await record_ai_usage(user, "compare", comparison.comparison_id)

    return {
        "a": a,
        "b": b,
        "rows": rows,
        "a_total": a_total,
        "b_total": b_total,
        "total_diff_usd": total_diff,
        "recommendation": recommendation,
        "comparison_id": comparison.comparison_id,
    }


@router.post("/estimates/compare/ask")
async def ask_about_comparison(
    payload: CompareQuestionRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    a = await db.estimates.find_one(
        {"analysis_id": payload.a_id, "user_id": user.user_id},
        {"_id": 0}
    )
    b = await db.estimates.find_one(
        {"analysis_id": payload.b_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not a or not b:
        raise HTTPException(status_code=404, detail="One or both analyses not found")

    pet_id = a.get("pet_id") or b.get("pet_id")

    pet = None
    records = []
    previous_questions = []

    if pet_id:
        pet = await db.pets.find_one(
            {"pet_id": pet_id, "user_id": user.user_id},
            {"_id": 0}
        )

        records = await db.pet_records.find(
            {"pet_id": pet_id, "user_id": user.user_id},
            {"_id": 0}
        ).sort("created_at", -1).to_list(100)

        previous_questions = await db.compare_questions.find(
            {
                "user_id": user.user_id,
                "$or": [
                    {"a_id": payload.a_id, "b_id": payload.b_id},
                    {"a_id": payload.b_id, "b_id": payload.a_id},
                ],
            },
            {"_id": 0}
        ).sort("created_at", -1).to_list(10)

    system_prompt = """
You are PetBill Shield.

Answer follow-up questions about two compared vet estimates.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not tell the user to refuse care.
- Use only the provided estimate, comparison, pet, and saved record details.
- If information is missing, say what is missing.
- Be practical, calm, and specific.
- End with a reminder that the user and veterinarian make the final care decision.
"""

    user_prompt = f"""
Estimate A:
{json.dumps(a, default=str)}

Estimate B:
{json.dumps(b, default=str)}

Current comparison result:
{json.dumps(payload.comparison or {}, default=str)}

Pet:
{json.dumps(pet, default=str) if pet else "No pet profile found."}

Saved pet records:
{json.dumps(records, default=str)}

Previous compare questions:
{json.dumps(previous_questions, default=str)}

User question:
{payload.question}
"""

    if not anthropic_client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    try:
        message = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1000,
            temperature=0.2,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ],
        )

        answer = message.content[0].text

    except Exception as e:
        logger.exception("Compare follow-up failed")
        raise HTTPException(
            status_code=500,
            detail="AI question failed. Please try again."
        )

    doc = {
        "question_id": f"cmpq_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": pet_id,
        "a_id": payload.a_id,
        "b_id": payload.b_id,
        "question": payload.question,
        "answer": answer,
        "comparison_snapshot": payload.comparison or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.compare_questions.insert_one(doc)

    return {
        "ok": True,
        "question_id": doc["question_id"],
        "answer": answer,
        "created_at": doc["created_at"],
    }

@router.get("/estimate-comparisons")
async def list_comparisons(user: User = Depends(get_current_user)):
    rows = await db.estimate_comparisons.find(
        {"user_id": user.user_id},
        {
            "_id": 0,
            "comparison_id": 1,
            "title": 1,
            "pet_id": 1,
            "pet_name": 1,
            "a_id": 1,
            "b_id": 1,
            "a_total": 1,
            "b_total": 1,
            "total_diff_usd": 1,
            "recommendation": 1,
            "created_at": 1,
        }
    ).sort("created_at", -1).to_list(200)

    return rows


@router.get("/estimate-comparisons/{comparison_id}")
async def get_comparison(
    comparison_id: str,
    user: User = Depends(get_current_user)
):
    row = await db.estimate_comparisons.find_one(
        {
            "comparison_id": comparison_id,
            "user_id": user.user_id,
        },
        {"_id": 0}
    )

    if not row:
        raise HTTPException(status_code=404, detail="Comparison not found")

    return row


@router.delete("/estimate-comparisons/{comparison_id}")
async def delete_comparison(
    comparison_id: str,
    user: User = Depends(get_current_user)
):
    result = await db.estimate_comparisons.delete_one(
        {
            "comparison_id": comparison_id,
            "user_id": user.user_id,
        }
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Comparison not found")

    return {"ok": True}


@router.get("/uploaded-files")
async def list_uploaded_files(user: User = Depends(get_current_user)):
    rows = await db.uploaded_files.find(
        {"user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(300)

    return rows


@router.delete("/uploaded-files/{file_id}")
async def delete_uploaded_file(
    file_id: str,
    user: User = Depends(get_current_user)
):
    row = await db.uploaded_files.find_one(
        {"file_id": file_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        path = Path(row.get("path", ""))
        if path.exists():
            path.unlink()
    except Exception as e:
        logger.warning(f"Could not delete file from disk: {e}")

    await db.uploaded_files.delete_one(
        {"file_id": file_id, "user_id": user.user_id}
    )

    return {"ok": True}


# -------------------- Contact --------------------
class ContactCreate(BaseModel):
    name: str
    email: EmailStr
    subject: Optional[str] = ""
    message: str
    # Honeypot — bots fill this in. Real users never see/touch it.
    website: Optional[str] = ""


def _build_contact_email_html(name: str, email: str, subject: str, message: str) -> str:
    msg = (message or "").replace("\n", "<br/>")
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:Manrope,Arial,sans-serif;background:#FAF9F6;padding:24px;">
      <tr><td>
        <table width="640" cellpadding="0" cellspacing="0" align="center" style="background:#F2F0E9;border:1px solid #E5E2D9;border-radius:8px;">
          <tr><td style="padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#65635C;">New contact message</div>
            <h1 style="font-family:Georgia,serif;font-weight:500;font-size:24px;color:#2D2C28;margin:8px 0 0 0;">{subject or '(no subject)'}</h1>
            <p style="color:#65635C;font-size:13px;margin:12px 0 0 0;"><strong>{name}</strong> · <a href="mailto:{email}" style="color:#D26D53;">{email}</a></p>
            <hr style="border:none;border-top:1px solid #E5E2D9;margin:18px 0;"/>
            <p style="color:#2D2C28;line-height:1.6;margin:0;">{msg}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """


@router.post("/contact")
@limiter.limit("5/minute")
async def post_contact(payload: ContactCreate, request: Request):
    # Honeypot — silently accept and discard if the trap was triggered
    if payload.website and payload.website.strip():
        logger.info("contact honeypot triggered — silently dropping")
        return {"ok": True, "contact_id": "", "delivered": False}

    doc = {
        "contact_id": f"ctc_{uuid.uuid4().hex[:12]}",
        "name": payload.name.strip()[:200],
        "email": payload.email,
        "subject": (payload.subject or "").strip()[:200],
        "message": payload.message.strip()[:6000],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "delivered": False,
        "delivery_error": None,
    }
    await db.contact_messages.insert_one(dict(doc))

    if RESEND_API_KEY and CONTACT_INBOX_EMAIL:
        params = {
            "from": SENDER_EMAIL,
            "to": [CONTACT_INBOX_EMAIL],
            "reply_to": payload.email,
            "subject": f"[PetBill Shield] {doc['subject'] or 'Contact message'} — from {doc['name']}",
            "html": _build_contact_email_html(doc["name"], doc["email"], doc["subject"], doc["message"]),
        }
        try:
            await asyncio.to_thread(resend.Emails.send, params)
            await db.contact_messages.update_one({"contact_id": doc["contact_id"]}, {"$set": {"delivered": True}})
            doc["delivered"] = True
        except Exception as e:
            err = str(e)[:200]
            await db.contact_messages.update_one({"contact_id": doc["contact_id"]}, {"$set": {"delivery_error": err}})
            logger.warning(f"contact email delivery failed: {err}")

    return {"ok": True, "contact_id": doc["contact_id"], "delivered": doc["delivered"]}


# -------------------- Admin --------------------
@router.get("/admin/check")
async def admin_check(user: User = Depends(get_current_user)):
    return {"is_admin": _is_admin_email(user.email)}


@router.get("/admin/feedback")
async def admin_list_feedback(limit: int = 100, _: User = Depends(require_admin)):
    rows = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    return rows


@router.get("/admin/contact-messages")
async def admin_list_contact(limit: int = 100, _: User = Depends(require_admin)):
    rows = await db.contact_messages.find({}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    return rows


@router.get("/admin/metrics")
async def admin_metrics(_: User = Depends(require_admin)):
    total_users = await db.users.count_documents({})
    total_pets = await db.pets.count_documents({})
    total_estimates = await db.estimates.count_documents({})
    total_claims = await db.claims.count_documents({})
    total_feedback = await db.feedback.count_documents({})
    avg_rating_cursor = db.feedback.aggregate([{"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}}])
    avg_rating = 0.0
    rating_count = 0
    async for row in avg_rating_cursor:
        avg_rating = round(float(row.get("avg") or 0), 2)
        rating_count = int(row.get("count") or 0)
        break

    # Reminder counts
    rem_pending = await db.reminders.count_documents({"status": "pending"})
    rem_sent = await db.reminders.count_documents({"status": "sent"})
    rem_failed = await db.reminders.count_documents({"status": "failed"})

    # Payments
    paid_tx = await db.payment_transactions.count_documents({"payment_status": "paid"})
    total_tx = await db.payment_transactions.count_documents({})
    revenue_cursor = db.payment_transactions.aggregate([
        {"$match": {"payment_status": "paid"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
    ])
    revenue = 0.0
    async for row in revenue_cursor:
        revenue = round(float(row.get("total") or 0), 2)
        break

    # Contact
    contact_count = await db.contact_messages.count_documents({})
    contact_delivered = await db.contact_messages.count_documents({"delivered": True})

    # Shares
    share_count = await db.shares.count_documents({})
    share_active = await db.shares.count_documents({"revoked": False})

    return {
        "users": total_users,
        "pets": total_pets,
        "estimates": total_estimates,
        "claims": total_claims,
        "feedback": {"total": total_feedback, "avg_rating": avg_rating, "count_rated": rating_count},
        "reminders": {"pending": rem_pending, "sent": rem_sent, "failed": rem_failed},
        "payments": {"paid": paid_tx, "total": total_tx, "revenue_usd": revenue},
        "contact_messages": {"total": contact_count, "delivered": contact_delivered},
        "shares": {"total": share_count, "active": share_active},
        "dispatcher": {
            "scheduled_every_minutes": 5,
            "sender": SENDER_EMAIL,
            "resend_configured": bool(RESEND_API_KEY),
        },
        "transparency": {
            "procedure_cost_records": await db.procedure_costs.count_documents({}),
            "cities_covered": len(await db.procedure_costs.distinct("city")),
        },
    }


# ── Vet-bill transparency — real data + AI estimate fallback ─────────────────
#
# Tier 1: Real user reports (3+ records) → authoritative stats with count
# Tier 2: AI-estimated range             → Claude-generated, clearly labelled
# Tier 3: Nothing yet                    → background task queued, returns pending
#
# AI estimates are stored in db.procedure_estimates and auto-retired once
# real data reaches the MIN_REAL_DATA threshold.

_MIN_REAL_DATA = 3   # minimum reports before real data is used instead of estimate

_AI_ESTIMATE_SYSTEM = (
    "You are a veterinary cost expert for PetBill Shield. "
    "Return ONLY a valid JSON object — no markdown, no prose."
)


async def _get_real_data(label_lower: str, city: Optional[str], state: Optional[str], species: Optional[str]):
    """Query procedure_costs with geographic fallback. Returns (amounts, scope)."""
    async def _q(city_v, state_v, species_v):
        q: dict = {"label_lower": label_lower}
        if city_v:    q["city"]        = city_v
        if state_v:   q["state"]       = state_v
        if species_v: q["pet_species"] = species_v
        docs = await db.procedure_costs.find(q, {"_id": 0, "amount_usd": 1}).to_list(2000)
        return [d["amount_usd"] for d in docs]

    amounts = await _q(city, state, species)
    scope   = "city+state" if city else ("state" if state else "national")

    if len(amounts) < _MIN_REAL_DATA and city:
        amounts = await _q(None, state, species)
        scope   = "state"
    if len(amounts) < _MIN_REAL_DATA and state:
        amounts = await _q(None, None, species)
        scope   = "national"

    return amounts, scope


async def _get_ai_estimate(label_lower: str, species: Optional[str]) -> Optional[dict]:
    """Return a stored AI estimate, or None if not yet generated."""
    return await db.procedure_estimates.find_one(
        {"label_lower": label_lower, "retired": False},
        {"_id": 0},
    )


async def _generate_and_store_estimate(
    label: str, label_lower: str,
    species: str, city: str, state: str,
) -> None:
    """
    Ask Claude for a cost range and persist it.
    Called as asyncio.create_task — fire-and-forget.
    Skipped if an estimate already exists (race-condition guard).
    """
    existing = await db.procedure_estimates.find_one(
        {"label_lower": label_lower, "retired": False}, {"_id": 1}
    )
    if existing:
        return

    location_hint = f" in {city}, {state}" if city and state else (" in " + state if state else "")
    prompt = (
        f'What is the typical cost range for "{label}" for a {species or "dog"}{location_hint}?\n\n'
        "Return ONLY this JSON (numbers, no $ signs):\n"
        '{"low_usd": <lowest typical>, "mid_usd": <most common>, '
        '"high_usd": <highest typical>, '
        '"notes": "1-2 sentences on what drives price variation"}'
    )

    try:
        result = await call_claude_json(_AI_ESTIMATE_SYSTEM, prompt, max_tokens=300)
        low  = result.get("low_usd")
        mid  = result.get("mid_usd")
        high = result.get("high_usd")
        if not (low and mid and high):
            return

        await db.procedure_estimates.insert_one({
            "estimate_id": f"est_{uuid.uuid4().hex[:10]}",
            "label":        label,
            "label_lower":  label_lower,
            "pet_species":  (species or "dog").lower(),
            "low_usd":      round(float(low),  2),
            "mid_usd":      round(float(mid),  2),
            "high_usd":     round(float(high), 2),
            "notes":        result.get("notes", ""),
            "source":       "ai_estimate",
            "retired":      False,
            "created_at":   datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"AI estimate created for '{label}' ({species}, {city}, {state})")
    except Exception as exc:
        logger.warning(f"AI estimate generation failed for '{label}': {exc}")


async def _retire_estimate_if_needed(label_lower: str) -> None:
    """Once real data is plentiful, mark the AI estimate as retired."""
    count = await db.procedure_costs.count_documents({"label_lower": label_lower})
    if count >= _MIN_REAL_DATA * 3:   # retire when 3× minimum reports exist
        await db.procedure_estimates.update_many(
            {"label_lower": label_lower, "retired": False},
            {"$set": {"retired": True, "retired_at": datetime.now(timezone.utc).isoformat()}},
        )


def _build_real_stats(amounts: list, scope: str, label: str) -> dict:
    amounts.sort()
    n   = len(amounts)
    avg = round(sum(amounts) / n, 2)
    return {
        "available":  True,
        "source":     "real_data",
        "label":      label,
        "scope":      scope,
        "count":      n,
        "avg_usd":    avg,
        "median_usd": round(amounts[n // 2], 2),
        "p25_usd":    round(amounts[n // 4], 2),
        "p75_usd":    round(amounts[3 * n // 4], 2),
        "min_usd":    round(amounts[0], 2),
        "max_usd":    round(amounts[-1], 2),
    }


def _build_ai_stats(est: dict, label: str) -> dict:
    return {
        "available": True,
        "source":    "ai_estimate",
        "label":     label,
        "low_usd":   est["low_usd"],
        "mid_usd":   est["mid_usd"],
        "high_usd":  est["high_usd"],
        "notes":     est.get("notes", ""),
    }


@router.get("/transparency/compare")
async def transparency_compare(
    label:   str,
    city:    Optional[str] = None,
    state:   Optional[str] = None,
    species: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    if not label or not label.strip():
        raise HTTPException(status_code=400, detail="label is required")

    label_lower  = label.strip().lower()
    city_norm    = city.strip().lower()        if city    and city.strip()    else None
    state_norm   = state.strip().upper()[:2]   if state   and state.strip()   else None
    species_norm = species.strip().lower()     if species and species.strip() else None

    # ── Tier 1: real user data ────────────────────────────────────────────────
    amounts, scope = await _get_real_data(label_lower, city_norm, state_norm, species_norm)
    if len(amounts) >= _MIN_REAL_DATA:
        asyncio.create_task(_retire_estimate_if_needed(label_lower))
        return _build_real_stats(amounts, scope, label)

    # ── Tier 2: stored AI estimate ────────────────────────────────────────────
    est = await _get_ai_estimate(label_lower, species_norm)
    if est:
        return _build_ai_stats(est, label)

    # ── Tier 3: queue estimate generation, return pending ────────────────────
    asyncio.create_task(
        _generate_and_store_estimate(label, label_lower, species_norm or "dog", city_norm or "", state_norm or "")
    )
    return {"available": False, "pending": True, "reason": "Price estimate is being generated — check back shortly."}


@router.post("/transparency/compare-batch")
async def transparency_compare_batch(
    payload: dict,
    user: User = Depends(get_current_user),
):
    """
    Compare up to 30 line items in one call.
    Body: { items: [{label, amount_usd}], city, state, species }
    Returns: { label → stats }  where stats.source is "real_data" | "ai_estimate" | pending/unavailable
    """
    items   = payload.get("items") or []
    city    = payload.get("city")
    state   = payload.get("state")
    species = payload.get("species")

    if not items:
        return {}

    results = {}
    for item in items[:30]:
        label = (item.get("label") or "").strip()
        if not label:
            continue
        try:
            resp = await transparency_compare(
                label=label, city=city, state=state, species=species, user=user
            )
            results[label] = resp
        except Exception:
            results[label] = {"available": False}

    return results


@router.get("/admin/transparency")
async def admin_transparency(_: User = Depends(require_admin)):
    """Admin view of transparency dataset — real data + AI estimates."""
    real_total    = await db.procedure_costs.count_documents({})
    est_total     = await db.procedure_estimates.count_documents({"retired": False})
    est_retired   = await db.procedure_estimates.count_documents({"retired": True})
    cities        = await db.procedure_costs.distinct("city")
    states        = await db.procedure_costs.distinct("state")

    top_real = await db.procedure_costs.aggregate([
        {"$group": {"_id": "$label_lower", "count": {"$sum": 1}, "avg": {"$avg": "$amount_usd"}}},
        {"$sort": {"count": -1}},
        {"$limit": 20},
        {"$project": {"label": "$_id", "count": 1, "avg_usd": {"$round": ["$avg", 2]}, "_id": 0}},
    ]).to_list(20)

    recent_estimates = await db.procedure_estimates.find(
        {"retired": False},
        {"_id": 0, "label": 1, "low_usd": 1, "mid_usd": 1, "high_usd": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(20)

    return {
        "real_data":  {"total_records": real_total, "cities": sorted(cities), "states": sorted(states), "top_procedures": top_real},
        "ai_estimates": {"active": est_total, "retired": est_retired, "recent": recent_estimates},
    }
