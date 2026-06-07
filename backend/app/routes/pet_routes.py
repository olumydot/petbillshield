from fastapi import APIRouter
from app.shared import *

router = APIRouter()

# -------------------- Pet Endpoints --------------------
@router.post("/pets", response_model=Pet)
async def create_pet(payload: PetCreate, user: User = Depends(get_current_user)):
    doc_user = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0}
    ) or {}

    plan_id = doc_user.get("plan_id")
    active_pet_ids = doc_user.get("active_pet_ids", [])

    limit = get_pet_limit_for_plan(plan_id)

    if limit is not None and len(active_pet_ids) >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Your current plan allows up to {limit} active pet profile(s). Upgrade to add more active pets.",
        )

    pet = Pet(user_id=user.user_id, **payload.model_dump())

    doc = pet.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()

    await db.pets.insert_one(doc)

    await db.users.update_one(
        {"user_id": user.user_id},
        {"$addToSet": {"active_pet_ids": pet.pet_id}}
    )

    return pet


# POST /pets/active is intentionally removed.
# Active pet selection is managed exclusively by the backend in _grant_entitlement()
# (called on subscribe, upgrade, downgrade, and renewal). Users cannot manually
# swap active pets — that would defeat plan limits. The only way to get more
# active pets is to upgrade the plan.


@router.get("/pets/{pet_id}/records", response_model=List[PetRecord])
async def list_records(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    rows = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    ).sort("date", -1).to_list(500)

    cleaned = []

    valid_types = {
        "vaccine",
        "medication",
        "invoice",
        "reminder",
        "lab",
        "visit",
        "policy",
        "note",
    }

    for r in rows:
        if not r.get("record_type") or r.get("record_type") not in valid_types:
            r["record_type"] = "note"

        if not r.get("title"):
            r["title"] = "Saved pet record"

        if "amount_usd" not in r:
            r["amount_usd"] = None

        if "category" not in r or not r.get("category"):
            r["category"] = "other"

        if "metadata" not in r or not isinstance(r.get("metadata"), dict):
            r["metadata"] = {}

        cleaned.append(PetRecord(**r))

    return cleaned


@router.get("/pets")
async def list_pets(user: User = Depends(get_current_user)):

    user_doc = await db.users.find_one(
        {"user_id": user.user_id},
        {"_id": 0}
    ) or {}

    plan_id = user_doc.get("plan_id")

    if plan_id in ["rescue_monthly", "rescue_yearly"]:
        active_pet_ids = None
    else:
        active_pet_ids = set(user_doc.get("active_pet_ids", []))

    rows = await db.pets.find(
        {"user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)

    cleaned = []

    for row in rows:
        if isinstance(row.get("created_at"), str):
            row["created_at"] = datetime.fromisoformat(row["created_at"])

        pet = Pet(**row).model_dump()

        pet["is_active"] = (
            True
            if active_pet_ids is None
            else pet["pet_id"] in active_pet_ids
        )

        cleaned.append(pet)

    return cleaned


@router.get("/pets/{pet_id}")
async def get_pet(pet_id: str, user: User = Depends(get_current_user)):
    row = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Pet not found")
    if isinstance(row.get("created_at"), str):
        row["created_at"] = datetime.fromisoformat(row["created_at"])
    return Pet(**row)


@router.put("/pets/{pet_id}", response_model=Pet)
async def update_pet(pet_id: str, payload: PetCreate, user: User = Depends(get_current_user)):
    row = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Pet not found")
    update = payload.model_dump()
    await db.pets.update_one({"pet_id": pet_id, "user_id": user.user_id}, {"$set": update})
    row.update(update)
    if isinstance(row.get("created_at"), str):
        row["created_at"] = datetime.fromisoformat(row["created_at"])
    return Pet(**row)


@router.delete("/pets/{pet_id}")
async def delete_pet(pet_id: str, user: User = Depends(get_current_user)):
    await db.pets.delete_one({"pet_id": pet_id, "user_id": user.user_id})
    await db.pet_records.delete_many({"pet_id": pet_id, "user_id": user.user_id})
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$pull": {"active_pet_ids": pet_id}},
    )
    return {"ok": True}


@router.post("/claims/save-to-vault")
async def save_claim_to_vault(
    payload: SaveClaimToVaultRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    pet = await db.pets.find_one(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    claim = await db.claims.find_one(
        {"claim_id": payload.claim_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    if claim.get("saved_to_pet_vault"):
        return {
            "ok": True,
            "already_saved": True,
            "record_id": claim.get("saved_record_id"),
            "pet_id": claim.get("saved_pet_id") or payload.pet_id,
        }

    title = f"Insurance claim analysis - {claim.get('insurer') or 'Unknown insurer'}"

    details = json.dumps(
        {
            "claim_id": claim.get("claim_id"),
            "insurer": claim.get("insurer"),
            "estimated_reimbursement_usd": claim.get("estimated_reimbursement_usd"),
            "deductible_note": claim.get("deductible_note"),
            "likely_reimbursable_categories": claim.get("likely_reimbursable_categories", []),
            "likely_excluded": claim.get("likely_excluded", []),
            "missing_documents": claim.get("missing_documents", []),
            "next_steps": claim.get("next_steps", []),
            "appeal_draft": claim.get("appeal_draft", ""),
        },
        default=str
    )

    record = PetRecord(
        pet_id=payload.pet_id,
        user_id=user.user_id,
        record_type="note",
        title=title,
        details=details,
        amount_usd=claim.get("estimated_reimbursement_usd"),
        date=datetime.now(timezone.utc).date().isoformat(),
        category="other",
    )

    doc = record.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()

    await db.pet_records.insert_one(doc)

    await db.claims.update_one(
        {"claim_id": payload.claim_id, "user_id": user.user_id},
        {
            "$set": {
                "saved_to_pet_vault": True,
                "saved_pet_id": payload.pet_id,
                "saved_record_id": record.record_id,
                "saved_to_pet_vault_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    return {
        "ok": True,
        "record_id": record.record_id,
        "pet_id": payload.pet_id,
    }


# -------------------- Pet Records --------------------
@router.post("/pets/{pet_id}/records", response_model=PetRecord)
async def add_record(pet_id: str, payload: PetRecordCreate, user: User = Depends(get_current_user)):
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    record = PetRecord(pet_id=pet_id, user_id=user.user_id, **payload.model_dump())
    doc = record.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.pet_records.insert_one(doc)

    # Auto-create a reminder if this is a "reminder" type with a future date
    if record.record_type == "reminder" and record.date:
        try:
            # Accept either ISO date (YYYY-MM-DD) or full ISO datetime
            dt = datetime.fromisoformat(record.date)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt > datetime.now(timezone.utc):
                rem = Reminder(
                    user_id=user.user_id,
                    pet_id=pet_id,
                    pet_name=pet.get("name", ""),
                    title=record.title,
                    message=record.details or "",
                    scheduled_for=dt.isoformat(),
                    email=user.email,
                    repeat=None,
                )
                await db.reminders.insert_one(rem.model_dump())
        except Exception as e:
            logger.warning(f"auto-reminder skip: {e}")
    return record


# @router.get("/pets/{pet_id}/records", response_model=List[PetRecord])
# async def list_records(pet_id: str, user: User = Depends(get_current_user)):
#     rows = await db.pet_records.find(
#         {"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0}
#     ).sort("created_at", -1).to_list(1000)
#     for r in rows:
#         if isinstance(r.get("created_at"), str):
#             r["created_at"] = datetime.fromisoformat(r["created_at"])
#     return [PetRecord(**r) for r in rows]


@router.delete("/pets/{pet_id}/records/{record_id}")
async def delete_record(pet_id: str, record_id: str, user: User = Depends(get_current_user)):
    await db.pet_records.delete_one(
        {"record_id": record_id, "pet_id": pet_id, "user_id": user.user_id}
    )
    return {"ok": True}


@router.post("/pets/{pet_id}/records/import-csv")
async def import_records_csv(
    pet_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Bulk-import invoice records for a pet from a CSV file.
    Expected columns (case-insensitive, at least one of: title/description):
      title, date, amount_usd OR amount, category, details, record_type (optional, default 'invoice')
    """
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty CSV file")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="ignore")

    reader = csv_module.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")
    headers = [(h or "").strip().lower() for h in reader.fieldnames]
    reader.fieldnames = headers

    def pick(row, *keys):
        for k in keys:
            if k in row and (row[k] or "").strip() != "":
                return row[k].strip()
        return ""

    imported = 0
    skipped = 0
    errors = []
    now_iso = datetime.now(timezone.utc).isoformat()
    docs = []

    for idx, row in enumerate(reader, start=2):  # 1 is header
        try:
            title = pick(row, "title", "description", "name", "item")
            if not title:
                skipped += 1
                errors.append({"row": idx, "reason": "missing title/description"})
                continue
            amount_raw = pick(row, "amount_usd", "amount", "price", "total")
            try:
                amount = float(amount_raw.replace("$", "").replace(",", "")) if amount_raw else None
            except ValueError:
                amount = None
            date_str = pick(row, "date", "invoice_date") or ""
            details = pick(row, "details", "note", "notes") or ""
            category = (pick(row, "category", "type") or "other").lower()
            if category not in RECORD_CATEGORIES:
                category = "other"
            record_type = (pick(row, "record_type") or "invoice").lower()
            if record_type not in ["vaccine", "medication", "invoice", "reminder", "lab", "visit", "policy", "note"]:
                record_type = "invoice"

            doc = {
                "record_id": f"rec_{uuid.uuid4().hex[:12]}",
                "pet_id": pet_id,
                "user_id": user.user_id,
                "record_type": record_type,
                "title": title[:300],
                "details": details[:2000],
                "amount_usd": amount,
                "date": date_str,
                "category": category,
                "metadata": {},
                "created_at": now_iso,
            }
            docs.append(doc)
            imported += 1
        except Exception as e:
            skipped += 1
            errors.append({"row": idx, "reason": str(e)[:120]})

    if docs:
        await db.pet_records.insert_many([dict(d) for d in docs])

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:50],
        "categories": RECORD_CATEGORIES,
    }


# -------------------- Year in Review --------------------
@router.get("/pets/{pet_id}/year-in-review")
async def pet_year_in_review(
    pet_id: str,
    year: Optional[int] = None,
    user: User = Depends(get_current_user),
):
    """A warm annual recap for one pet: spend, visits, care milestones, savings."""
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    yr = year or datetime.now(timezone.utc).year

    def _eff_date(rec):
        raw = (rec.get("date") or "").strip()
        if not raw:
            raw = rec.get("created_at") or ""
            if not isinstance(raw, str):
                try:
                    raw = raw.isoformat()
                except Exception:
                    raw = ""
        return raw

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0},
    ).to_list(10000)

    total_spent = 0.0
    by_category: dict = {}
    by_month = [0.0] * 12
    visits = vaccines = meds = labs = 0
    biggest = None

    for rec in records:
        eff = _eff_date(rec)
        try:
            dt = datetime.fromisoformat(eff.replace("Z", "+00:00"))
        except Exception:
            continue
        if dt.year != yr:
            continue

        rtype = rec.get("record_type") or "note"
        if rtype == "visit":   visits += 1
        if rtype == "vaccine": vaccines += 1
        if rtype == "medication": meds += 1
        if rtype == "lab":     labs += 1

        amt = rec.get("amount_usd")
        if amt:
            try:
                amt = float(amt)
            except (TypeError, ValueError):
                amt = 0.0
            if amt > 0:
                total_spent += amt
                cat = (rec.get("category") or "other").strip() or "other"
                by_category[cat] = by_category.get(cat, 0.0) + amt
                by_month[dt.month - 1] += amt
                if not biggest or amt > biggest["amount_usd"]:
                    biggest = {"title": rec.get("title") or "Vet bill", "amount_usd": round(amt, 2), "date": eff[:10]}

    # Savings logged via bill outcomes this year
    estimates = await db.estimates.find(
        {"user_id": user.user_id, "pet_id": pet_id}, {"_id": 0, "outcome": 1, "created_at": 1},
    ).to_list(2000)
    saved = 0.0
    analyses = 0
    for e in estimates:
        analyses += 1
        out = e.get("outcome") or {}
        if out.get("saved_usd"):
            saved += float(out["saved_usd"])

    top_categories = sorted(by_category.items(), key=lambda x: -x[1])[:5]

    return {
        "year": yr,
        "pet_name": pet.get("name") or "your pet",
        "species": pet.get("species") or "",
        "total_spent_usd": round(total_spent, 2),
        "records_count": sum(1 for r in records if _eff_date(r)[:4] == str(yr)),
        "visits": visits,
        "vaccines": vaccines,
        "medications": meds,
        "labs": labs,
        "analyses": analyses,
        "saved_usd": round(saved, 2),
        "biggest_bill": biggest,
        "by_month": [round(m, 2) for m in by_month],
        "top_categories": [{"category": k, "total_usd": round(v, 2)} for k, v in top_categories],
        "has_data": total_spent > 0 or visits or vaccines or analyses,
    }
