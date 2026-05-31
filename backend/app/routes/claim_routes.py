import json
import re
import base64
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Literal

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel

from app.shared import (
    db,
    logger,
    User,
    PetRecord,
    ClaimAnalysis,
    SAFETY_DISCLAIMER,
    get_current_user,
    require_paid_plan,
    validate_upload_size,
    extract_pdf_text,
    save_uploaded_file,
    CLAIM_UPLOAD_DIR,
    enforce_ai_usage_limit,
    record_ai_usage,
    call_claude_json,
)
router = APIRouter()

# -------------------- Insurance Claim Helper --------------------
CLAIM_SYSTEM_PROMPT = """You are PetBill Shield's insurance claim specialist. Given a pet insurance policy summary, an itemized vet invoice, and policy parameters the user provided, produce a precise claim analysis with pointed questions the user should ask their insurer.

You do NOT make legal claims. Estimate based ONLY on the text provided.

DEDUCTIBLE MODELS — use the one specified:
- ANNUAL deductible: applies once across the whole policy year. If the user has already met $X of their deductible, only the remaining amount ($deductible - $met) is subtracted from this claim.
  Formula: reimbursable = (invoice_total - remaining_deductible) × reimbursement_rate%
- PER-INCIDENT deductible: applies freshly to EACH separate claim/incident, regardless of what was paid earlier.
  Formula: reimbursable = (invoice_total - deductible) × reimbursement_rate%

CO-INSURANCE (reimbursement rate): If the policy pays 80%, the user pays 20% of the eligible amount after the deductible.

BENEFIT LIMIT: Annual cap on what the insurer will pay. If the user has already used $X of their limit, only ($limit - $used) is available for this claim.

When parameters are provided, show your arithmetic step-by-step in deductible_note and in each pointed question where relevant. Use exact dollar amounts from the invoice.

Return STRICT JSON only:
{
  "insurer": "string",
  "likely_reimbursable_categories": [
    {
      "label": "string",
      "estimated_amount_usd": number_or_null,
      "confidence": "high" | "medium" | "low",
      "rationale": "string"
    }
  ],
  "likely_excluded": [
    {"label": "string", "estimated_amount_usd": number_or_null, "rationale": "string"}
  ],
  "missing_documents": ["string"],
  "estimated_reimbursement_usd": number_or_null,
  "deductible_note": "string — step-by-step calculation showing exactly how the deductible and co-insurance affect this specific claim with dollar amounts",
  "pointed_questions": [
    {
      "question": "string — exact word-for-word question to ask the insurer",
      "why": "string — why this amount or clause matters for this specific claim",
      "urgency": "high" | "medium"
    }
  ],
  "appeal_draft": "string — professional appeal letter if reimbursement seems low or denial seems questionable. Leave empty string if not needed.",
  "next_steps": ["string"]
}

Pointed question rules:
- Quote specific dollar amounts from the invoice (e.g. "the $215 CBC panel")
- Reference the exact deductible model and percentage when calculating
- Ask about waiting periods for any diagnoses that could be considered pre-existing
- Ask about per-incident vs annual deductible application if ambiguous
- Ask about specific exclusion codes if any items were denied
- Maximum 6 questions, ordered high urgency first

No markdown fences. Return valid JSON only."""


POLICY_RECORD_SYSTEM_PROMPT = """You are PetBill Shield's pet insurance policy analyst.

Read a pet insurance policy, declaration page, or policy summary. Extract the practical claim rules a pet owner will need later when analyzing a vet bill.

Do not make legal claims. Do not invent details that are not in the policy. If something is unclear, say it is unclear.

Return STRICT JSON only:
{
  "insurer": "string",
  "policy_type": "string",
  "deductible_model": "annual" | "per_incident" | "unknown",
  "deductible_usd": number_or_null,
  "reimbursement_rate_pct": number_or_null,
  "benefit_limit_usd": number_or_null,
  "waiting_period_notes": "string",
  "coverage_summary": ["string"],
  "key_exclusions": ["string"],
  "claim_requirements": ["string"],
  "appeal_notes": ["string"],
  "questions_to_confirm": ["string"],
  "policy_text_for_claims": "string — compact policy summary with exact clauses, limits, exclusions, and requirements useful for future claim analysis"
}

No markdown fences. Return valid JSON only."""


CLAIM_DECISION_SYSTEM_PROMPT = """
You are PetBill Shield's insurance decision reader.

Read an insurer decision or reimbursement explanation.

Return strict JSON only:
{
  "decision_status": "approved" | "partially_approved" | "denied" | "unclear",
  "actual_reimbursement_usd": number_or_null,
  "deductible_applied_usd": number_or_null,
  "copay_or_coinsurance_usd": number_or_null,
  "denied_amount_usd": number_or_null,
  "reason_summary": "string",
  "appeal_recommended": true_or_false,
  "appeal_reason": "string",
  "next_steps": ["string"]
}

Rules:
- Do not invent values.
- If amount is unclear, return null.
- Be practical and concise.
"""


async def read_claim_upload(file: UploadFile):
    contents = await file.read()
    validate_upload_size(contents)

    filename = file.filename or ""
    ctype = (file.content_type or "").lower()

    if "pdf" in ctype or filename.lower().endswith(".pdf"):
        return ("text", extract_pdf_text(contents), contents)

    if ctype.startswith("image/") or filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        return ("image", base64.b64encode(contents).decode("utf-8"), contents)

    if ctype.startswith("text/") or filename.lower().endswith((".txt", ".md", ".csv")):
        return ("text", contents.decode("utf-8", errors="ignore"), contents)

    raise HTTPException(status_code=400, detail="Unsupported file type")


def _coerce_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value):
    number = _coerce_float(value)
    return int(number) if number is not None else None


def _policy_metadata(record: dict) -> dict:
    metadata = record.get("metadata") or {}
    if isinstance(metadata, dict):
        return metadata
    if isinstance(metadata, str):
        try:
            parsed = json.loads(metadata)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _format_saved_policy_for_claim(record: dict) -> str:
    metadata = _policy_metadata(record)
    def as_list(value):
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value.strip():
            return [value]
        return []

    lines = [
        f"Saved policy record title: {record.get('title') or 'Pet insurance policy'}",
        f"Insurer: {metadata.get('insurer') or ''}",
        f"Policy type: {metadata.get('policy_type') or ''}",
        f"Deductible model: {metadata.get('deductible_model') or ''}",
        f"Deductible: {metadata.get('deductible_usd') or ''}",
        f"Reimbursement rate: {metadata.get('reimbursement_rate_pct') or ''}",
        f"Annual benefit limit: {metadata.get('benefit_limit_usd') or ''}",
        f"Waiting period notes: {metadata.get('waiting_period_notes') or ''}",
        "",
        "Coverage summary:",
        *[f"- {item}" for item in as_list(metadata.get("coverage_summary"))],
        "",
        "Key exclusions:",
        *[f"- {item}" for item in as_list(metadata.get("key_exclusions"))],
        "",
        "Claim requirements:",
        *[f"- {item}" for item in as_list(metadata.get("claim_requirements"))],
        "",
        "Policy text for claims:",
        metadata.get("policy_text_for_claims") or record.get("details") or "",
    ]
    return "\n".join([line for line in lines if line is not None]).strip()


def _format_policy_details(result: dict) -> str:
    sections = []

    def add_list(label: str, items: list):
        if isinstance(items, str):
            items = [items]
        cleaned = [str(item).strip() for item in (items or []) if str(item).strip()]
        if cleaned:
            sections.append(f"{label}:\n" + "\n".join(f"- {item}" for item in cleaned))

    basics = []
    if result.get("policy_type"):
        basics.append(f"Policy type: {result.get('policy_type')}")
    if result.get("deductible_model"):
        basics.append(f"Deductible model: {result.get('deductible_model')}")
    if result.get("deductible_usd") is not None:
        basics.append(f"Deductible: ${float(result.get('deductible_usd')):,.0f}")
    if result.get("reimbursement_rate_pct") is not None:
        basics.append(f"Reimbursement rate: {int(float(result.get('reimbursement_rate_pct')))}%")
    if result.get("benefit_limit_usd") is not None:
        basics.append(f"Benefit limit: ${float(result.get('benefit_limit_usd')):,.0f}")
    if result.get("waiting_period_notes"):
        basics.append(f"Waiting periods: {result.get('waiting_period_notes')}")
    if basics:
        sections.append("\n".join(basics))

    add_list("Coverage summary", result.get("coverage_summary") or [])
    add_list("Key exclusions", result.get("key_exclusions") or [])
    add_list("Claim requirements", result.get("claim_requirements") or [])
    add_list("Questions to confirm", result.get("questions_to_confirm") or [])

    return "\n\n".join(sections).strip()


@router.post("/pets/{pet_id}/policy/analyze", response_model=PetRecord)
async def analyze_pet_policy_record(
    pet_id: str,
    insurer: Optional[str] = Form(""),
    title: Optional[str] = Form(""),
    policy_text: Optional[str] = Form(""),
    policy_file: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "claim")

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    pol_text = policy_text or ""
    saved_policy_file = None

    if policy_file is not None:
        kind, data, contents = await read_claim_upload(policy_file)
        saved_policy_file = await save_uploaded_file(
            contents=contents,
            original_filename=policy_file.filename or "",
            content_type=policy_file.content_type or "",
            folder=CLAIM_UPLOAD_DIR,
            user_id=user.user_id,
            purpose="pet_policy",
        )
        if kind == "text":
            pol_text = (pol_text + "\n" + data).strip()
        elif not pol_text.strip():
            raise HTTPException(
                status_code=400,
                detail="Policy image uploads need pasted text or a PDF so the policy can be analyzed.",
            )

    if not pol_text.strip():
        raise HTTPException(status_code=400, detail="Provide policy text or upload a PDF policy document")

    user_prompt = f"""
Pet: {pet.get('name') or 'Unknown pet'}
Insurer hint: {insurer or pet.get('insurance_provider') or 'unspecified'}

POLICY TEXT:
{pol_text[:12000]}

Return JSON only.
"""

    try:
        result = await call_claude_json(POLICY_RECORD_SYSTEM_PROMPT, user_prompt, max_tokens=2200)
    except Exception:
        logger.exception("Policy record analysis failed")
        raise HTTPException(status_code=500, detail="Policy analysis failed. Please try again.")

    effective_insurer = result.get("insurer") or insurer or pet.get("insurance_provider") or ""
    details = _format_policy_details(result)
    if not details:
        details = result.get("policy_text_for_claims") or "Policy analyzed and saved for future claims."

    metadata = {
        "source": "policy_ai_analysis",
        "insurer": effective_insurer,
        "policy_type": result.get("policy_type") or "",
        "deductible_model": result.get("deductible_model") or "unknown",
        "deductible_usd": _coerce_float(result.get("deductible_usd")),
        "reimbursement_rate_pct": _coerce_int(result.get("reimbursement_rate_pct")),
        "benefit_limit_usd": _coerce_float(result.get("benefit_limit_usd")),
        "waiting_period_notes": result.get("waiting_period_notes") or "",
        "coverage_summary": result.get("coverage_summary") or [],
        "key_exclusions": result.get("key_exclusions") or [],
        "claim_requirements": result.get("claim_requirements") or [],
        "appeal_notes": result.get("appeal_notes") or [],
        "questions_to_confirm": result.get("questions_to_confirm") or [],
        "policy_text_for_claims": (result.get("policy_text_for_claims") or pol_text)[:12000],
        "original_text_excerpt": pol_text[:2000],
    }

    record = PetRecord(
        pet_id=pet_id,
        user_id=user.user_id,
        record_type="policy",
        title=(title or f"{effective_insurer or 'Insurance'} policy").strip()[:300],
        details=details[:4000],
        amount_usd=None,
        date=datetime.now(timezone.utc).date().isoformat(),
        category="insurance",
        metadata=metadata,
    )

    doc = record.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.pet_records.insert_one(doc)

    if effective_insurer and not pet.get("insurance_provider"):
        await db.pets.update_one(
            {"pet_id": pet_id, "user_id": user.user_id},
            {"$set": {"insurance_provider": effective_insurer}},
        )

    if saved_policy_file:
        await db.uploaded_files.update_one(
            {"file_id": saved_policy_file["file_id"]},
            {"$set": {"linked_id": record.record_id}},
        )

    await record_ai_usage(user, "claim", record.record_id)
    return record


def extract_money_amounts(text: str):
    if not text:
        return []

    matches = re.findall(r"\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$?\s?\d+(?:\.\d{2})?", text)

    amounts = []

    for m in matches:
        try:
            cleaned = m.replace("$", "").replace(",", "").strip()
            value = float(cleaned)
            if value >= 0:
                amounts.append(value)
        except Exception:
            pass

    return amounts


async def extract_decision_text_from_upload(file: UploadFile):
    contents = await file.read()
    validate_upload_size(contents)

    filename = file.filename or ""
    ctype = (file.content_type or "").lower()

    saved_file = await save_uploaded_file(
        contents=contents,
        original_filename=filename,
        content_type=file.content_type or "",
        folder=CLAIM_UPLOAD_DIR,
        user_id="",
        purpose="claim_decision",
    )

    extracted_text = ""

    if "pdf" in ctype or filename.lower().endswith(".pdf"):
        extracted_text = extract_pdf_text(contents)

    return extracted_text, saved_file


async def enrich_claim_pet_names(rows: list[dict], user_id: str) -> list[dict]:
    pet_ids = sorted({r.get("pet_id") for r in rows if r.get("pet_id")})
    if not pet_ids:
        return rows

    pets = await db.pets.find(
        {"user_id": user_id, "pet_id": {"$in": pet_ids}},
        {"_id": 0, "pet_id": 1, "name": 1},
    ).to_list(len(pet_ids))
    pet_names = {p.get("pet_id"): p.get("name", "") for p in pets}

    for row in rows:
        if row.get("pet_id") and not row.get("pet_name"):
            row["pet_name"] = pet_names.get(row.get("pet_id"), "")
    return rows


@router.post("/claims/{claim_id}/mark-submitted")
async def mark_claim_submitted(
    claim_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    claim = await db.claims.find_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {"_id": 0},
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    submitted_at = datetime.now(timezone.utc).isoformat()

    await db.claims.update_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {
            "$set": {
                "submitted_to_insurer": True,
                "submitted_at": submitted_at,
                "claim_status": "submitted",
                "updated_at": submitted_at,
            }
        },
    )

    return {
        "ok": True,
        "claim_id": claim_id,
        "submitted_to_insurer": True,
        "submitted_at": submitted_at,
    }


@router.post("/claims/{claim_id}/decision")
async def save_claim_decision(
    claim_id: str,
    pet_id: Optional[str] = Form(None),
    decision_text: Optional[str] = Form(""),
    decision_file: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    claim = await db.claims.find_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {"_id": 0},
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    final_pet_id = pet_id or claim.get("pet_id")

    if final_pet_id:
        pet = await db.pets.find_one(
            {"pet_id": final_pet_id, "user_id": user.user_id},
            {"_id": 0},
        )

        if not pet:
            raise HTTPException(status_code=404, detail="Pet not found")

    combined_text = decision_text or ""
    saved_decision_file = None

    if decision_file is not None:
        contents = await decision_file.read()
        validate_upload_size(contents)

        saved_decision_file = await save_uploaded_file(
            contents=contents,
            original_filename=decision_file.filename or "",
            content_type=decision_file.content_type or "",
            folder=CLAIM_UPLOAD_DIR,
            user_id=user.user_id,
            purpose="claim_decision",
            linked_id=claim_id,
        )

        ctype = (decision_file.content_type or "").lower()
        filename = decision_file.filename or ""

        if "pdf" in ctype or filename.lower().endswith(".pdf"):
            extracted_text = extract_pdf_text(contents)
            combined_text = f"{combined_text}\n\n{extracted_text}".strip()

    if not combined_text.strip() and not saved_decision_file:
        raise HTTPException(
            status_code=400,
            detail="Paste the insurer decision text or upload a decision file.",
        )

    fallback_amounts = extract_money_amounts(combined_text)

    fallback_reimbursement = fallback_amounts[0] if fallback_amounts else None

    ai_result = {}

    if combined_text.strip():
        user_prompt = f"""
Original saved claim:
{claim}

Insurer decision / reimbursement response:
{combined_text[:8000]}

Return JSON only.
"""

        try:
            ai_result = await call_claude_json(
                CLAIM_DECISION_SYSTEM_PROMPT,
                user_prompt,
                max_tokens=1200,
            )
        except Exception:
            ai_result = {}

    actual_reimbursement = ai_result.get("actual_reimbursement_usd")

    if actual_reimbursement is None:
        actual_reimbursement = fallback_reimbursement

    decision_status = ai_result.get("decision_status") or "unclear"

    now = datetime.now(timezone.utc).isoformat()

    decision_doc = {
        "decision_status": decision_status,
        "actual_reimbursement_usd": actual_reimbursement,
        "deductible_applied_usd": ai_result.get("deductible_applied_usd"),
        "copay_or_coinsurance_usd": ai_result.get("copay_or_coinsurance_usd"),
        "denied_amount_usd": ai_result.get("denied_amount_usd"),
        "reason_summary": ai_result.get("reason_summary", ""),
        "appeal_recommended": bool(ai_result.get("appeal_recommended", False)),
        "appeal_reason": ai_result.get("appeal_reason", ""),
        "next_steps": ai_result.get("next_steps", []) or [],
        "raw_decision_text_excerpt": combined_text[:1500],
        "decision_file_id": saved_decision_file.get("file_id") if saved_decision_file else None,
        "decision_saved_at": now,
    }

    await db.claims.update_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {
            "$set": {
                "claim_status": decision_status,
                "insurer_decision_saved": True,
                "decision": decision_doc,
                "actual_reimbursement_usd": actual_reimbursement,
                "case_closed": False,
                "closed_at": None,
                "updated_at": now,
            }
        },
    )

    record_id = None

    if final_pet_id and actual_reimbursement is not None:
        record_id = f"rec_{uuid.uuid4().hex[:12]}"

        record = {
            "record_id": record_id,
            "pet_id": final_pet_id,
            "user_id": user.user_id,
            "record_type": "insurance_reimbursement",
            "title": f"Insurance reimbursement - {claim.get('insurer') or 'Unknown insurer'}",
            "details": decision_doc.get("reason_summary") or "Saved insurer reimbursement decision.",
            "amount_usd": float(actual_reimbursement),
            "date": datetime.now(timezone.utc).date().isoformat(),
            "category": "insurance",
            "source": "claim_decision",
            "claim_id": claim_id,
            "created_at": now,
        }

        await db.pet_records.insert_one(record)

    return {
        "ok": True,
        "claim_id": claim_id,
        "claim_status": decision_status,
        "actual_reimbursement_usd": actual_reimbursement,
        "decision": decision_doc,
        "record_id": record_id,
    }


@router.post("/claims/{claim_id}/close")
async def close_claim_case(
    claim_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    claim = await db.claims.find_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {"_id": 0},
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    closed_at = datetime.now(timezone.utc).isoformat()

    await db.claims.update_one(
        {"claim_id": claim_id, "user_id": user.user_id},
        {
            "$set": {
                "claim_status": "closed",
                "case_closed": True,
                "closed_at": closed_at,
                "updated_at": closed_at,
            }
        },
    )

    return {
        "ok": True,
        "claim_id": claim_id,
        "claim_status": "closed",
        "case_closed": True,
        "closed_at": closed_at,
    }


@router.post("/claims/analyze", response_model=ClaimAnalysis)
async def analyze_claim(
    pet_id: Optional[str] = Form(None),
    insurer: Optional[str] = Form(""),
    policy_record_id: Optional[str] = Form(""),
    policy_text: Optional[str] = Form(""),
    invoice_text: Optional[str] = Form(""),
    policy_file: Optional[UploadFile] = File(None),
    invoice_file: Optional[UploadFile] = File(None),
    # Policy parameters for precise pointed questions
    deductible_usd: Optional[float]  = Form(None),
    deductible_model: Optional[str]  = Form("annual"),  # annual | per_incident
    deductible_met_usd: Optional[float] = Form(None),   # annual only: amount already applied
    deductible_status: Optional[str] = Form(""),         # met | partial | unmet
    reimbursement_rate_pct: Optional[int] = Form(None),  # e.g. 80
    benefit_limit_usd: Optional[float] = Form(None),
    benefit_used_usd: Optional[float]  = Form(None),     # annual limit already consumed
    policy_type: Optional[str] = Form(""),
    waiting_period_notes: Optional[str] = Form(""),
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "estimate")
    saved_policy_file = None
    saved_invoice_file = None
    pol_text = policy_text or ""
    inv_text = invoice_text or ""
    pol_image: Optional[str] = None
    inv_image: Optional[str] = None
    saved_policy_record = None
    manual_deductible_usd = deductible_usd

    if policy_record_id:
        policy_query = {
            "record_id": policy_record_id,
            "user_id": user.user_id,
            "record_type": "policy",
        }
        if pet_id:
            policy_query["pet_id"] = pet_id

        saved_policy_record = await db.pet_records.find_one(policy_query, {"_id": 0})
        if not saved_policy_record:
            raise HTTPException(status_code=404, detail="Saved policy record not found for this pet")

        saved_policy_text = _format_saved_policy_for_claim(saved_policy_record)
        if saved_policy_text:
            pol_text = (pol_text + "\n\nSAVED PET POLICY RECORD:\n" + saved_policy_text).strip()

        saved_policy_metadata = _policy_metadata(saved_policy_record)
        insurer = insurer or saved_policy_metadata.get("insurer") or ""
        deductible_usd = deductible_usd if deductible_usd is not None else _coerce_float(saved_policy_metadata.get("deductible_usd"))
        reimbursement_rate_pct = reimbursement_rate_pct if reimbursement_rate_pct is not None else _coerce_int(saved_policy_metadata.get("reimbursement_rate_pct"))
        benefit_limit_usd = benefit_limit_usd if benefit_limit_usd is not None else _coerce_float(saved_policy_metadata.get("benefit_limit_usd"))
        policy_type = policy_type or saved_policy_metadata.get("policy_type") or ""
        waiting_period_notes = waiting_period_notes or saved_policy_metadata.get("waiting_period_notes") or ""
        saved_deductible_model = saved_policy_metadata.get("deductible_model")
        if saved_deductible_model in {"annual", "per_incident"} and manual_deductible_usd is None:
            deductible_model = saved_deductible_model

    if policy_file is not None:
        kind, data, contents = await read_claim_upload(policy_file)

        saved_policy_file = await save_uploaded_file(
            contents=contents,
            original_filename=policy_file.filename or "",
            content_type=policy_file.content_type or "",
            folder=CLAIM_UPLOAD_DIR,
            user_id=user.user_id,
            purpose="policy",
        )

        if kind == "text":
            pol_text = (pol_text + "\n" + data).strip()
        else:
            pol_image = data
    if invoice_file is not None:
        kind, data, contents = await read_claim_upload(invoice_file)

        saved_invoice_file = await save_uploaded_file(
            contents=contents,
            original_filename=invoice_file.filename or "",
            content_type=invoice_file.content_type or "",
            folder=CLAIM_UPLOAD_DIR,
            user_id=user.user_id,
            purpose="claim_invoice",
        )

        if kind == "text":
            inv_text = (inv_text + "\n" + data).strip()
        else:
            inv_image = data

    if not (pol_text or pol_image or inv_text or inv_image):
        raise HTTPException(status_code=400, detail="Provide policy and/or invoice content")

    # Build policy parameters block for precise AI analysis
    policy_params_lines = []
    if deductible_usd is not None:
        model_label  = "Per-incident deductible" if deductible_model == "per_incident" else "Annual deductible"
        status_label = {"met": "fully met this year", "partial": "partially met", "unmet": "not yet met"}.get(deductible_status or "", "status unknown")
        line = f"{model_label}: ${deductible_usd:,.0f} ({status_label})"
        if deductible_model != "per_incident" and deductible_met_usd is not None:
            remaining = max(0.0, deductible_usd - deductible_met_usd)
            line += f" — ${deductible_met_usd:,.0f} already applied this year, ${remaining:,.0f} remaining"
        policy_params_lines.append(line)
    if reimbursement_rate_pct is not None:
        policy_params_lines.append(
            f"Co-insurance: insurer pays {reimbursement_rate_pct}% of eligible amount after deductible (user pays {100 - reimbursement_rate_pct}%)"
        )
    if benefit_limit_usd is not None:
        line = f"Annual benefit limit: ${benefit_limit_usd:,.0f}"
        if benefit_used_usd is not None:
            remaining_limit = max(0.0, benefit_limit_usd - benefit_used_usd)
            line += f" — ${benefit_used_usd:,.0f} already used, ${remaining_limit:,.0f} available"
        policy_params_lines.append(line)
    if policy_type:
        policy_params_lines.append(f"Policy type / coverage model: {policy_type}")
    if waiting_period_notes:
        policy_params_lines.append(f"Waiting period / pre-existing notes: {waiting_period_notes}")

    policy_params_block = (
        "POLICY PARAMETERS (use these for precise step-by-step calculations):\n" +
        "\n".join(policy_params_lines)
        if policy_params_lines else ""
    )

    text_blob = (
        f"Insurer: {insurer or 'unspecified'}\n\n"
        + (f"{policy_params_block}\n\n" if policy_params_block else "")
        + f"POLICY SUMMARY:\n{(pol_text or '(image uploaded — text not extracted)')[:6000]}\n\n"
        f"VET INVOICE:\n{(inv_text or '(image uploaded — text not extracted)')[:6000]}\n\n"
        "Return JSON only."
    )

    try:
        result = await call_claude_json(CLAIM_SYSTEM_PROMPT, text_blob, max_tokens=2500)
    except Exception as e:
        logger.exception("Claim analysis failed")
        raise HTTPException(status_code=500, detail="AI analysis failed. Please try again.")


    pet_name = ""
    if pet_id:
        pet_doc = await db.pets.find_one(
            {"pet_id": pet_id, "user_id": user.user_id},
            {"_id": 0, "name": 1},
        )
        pet_name = pet_doc.get("name", "") if pet_doc else ""

    claim = ClaimAnalysis(
        user_id=user.user_id,
        pet_id=pet_id,
        pet_name=pet_name,
        insurer=result.get("insurer") or insurer or "",
        policy_record_id=saved_policy_record.get("record_id", "") if saved_policy_record else "",
        policy_text_excerpt=(pol_text or "")[:1500],
        invoice_text_excerpt=(inv_text or "")[:1500],
        likely_reimbursable_categories=result.get("likely_reimbursable_categories", []) or [],
        likely_excluded=result.get("likely_excluded", []) or [],
        missing_documents=result.get("missing_documents", []) or [],
        estimated_reimbursement_usd=result.get("estimated_reimbursement_usd"),
        deductible_note=result.get("deductible_note", ""),
        pointed_questions=result.get("pointed_questions", []) or [],
        appeal_draft=result.get("appeal_draft", ""),
        next_steps=result.get("next_steps", []) or [],
        disclaimer=SAFETY_DISCLAIMER,
        # Store policy parameters for display and re-analysis
        deductible_usd=deductible_usd,
        deductible_model=deductible_model or "annual",
        deductible_met_usd=deductible_met_usd,
        deductible_status=deductible_status or "",
        reimbursement_rate_pct=reimbursement_rate_pct,
        benefit_limit_usd=benefit_limit_usd,
        benefit_used_usd=benefit_used_usd,
        policy_type=policy_type or "",
        waiting_period_notes=waiting_period_notes or "",
    )
    doc = claim.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.claims.insert_one(doc)

    for saved in [saved_policy_file, saved_invoice_file]:
        if saved:
            await db.uploaded_files.update_one(
                {"file_id": saved["file_id"]},
                {"$set": {"linked_id": claim.claim_id}}
            )

    await record_ai_usage(user, "estimate", claim.claim_id)

    return claim


@router.get("/claims", response_model=List[ClaimAnalysis])
async def list_claims(user: User = Depends(get_current_user)):
    await require_paid_plan(user)
    rows = await db.claims.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    rows = await enrich_claim_pet_names(rows, user.user_id)
    for r in rows:
        if isinstance(r.get("created_at"), str):
            r["created_at"] = datetime.fromisoformat(r["created_at"])
    return [ClaimAnalysis(**r) for r in rows]


@router.get("/claims/{claim_id}", response_model=ClaimAnalysis)
async def get_claim(claim_id: str, user: User = Depends(get_current_user)):
    await require_paid_plan(user)
    row = await db.claims.find_one({"claim_id": claim_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    rows = await enrich_claim_pet_names([row], user.user_id)
    row = rows[0]
    if isinstance(row.get("created_at"), str):
        row["created_at"] = datetime.fromisoformat(row["created_at"])
    return ClaimAnalysis(**row)


class AppealGenerateRequest(BaseModel):
    claim_id: str
    tone: Optional[Literal["polite", "firm", "urgent"]] = "polite"


APPEAL_SYSTEM_PROMPT = """
You are PetBill Shield's appeal letter writer.
Write a respectful pet insurance appeal letter using only the saved claim analysis.
Do not make legal claims. Do not guarantee reimbursement.
Keep it clear, professional, and easy to send.

Return JSON only:
{
  "appeal_letter": "string"
}
"""


@router.post("/claims/generate-appeal")
async def generate_appeal_letter(
    payload: AppealGenerateRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    claim = await db.claims.find_one(
        {"claim_id": payload.claim_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    user_prompt = f"""
Tone: {payload.tone}

Claim analysis:
{json.dumps(claim, default=str)}

Write a complete appeal letter.
Return JSON only.
"""

    try:
        result = await call_claude_json(
            APPEAL_SYSTEM_PROMPT,
            user_prompt,
            max_tokens=1800
        )
    except Exception as e:
        logger.exception("Appeal generation failed")
        raise HTTPException(
            status_code=500,
            detail="Appeal generation failed. Please try again."
        )

    appeal_letter = result.get("appeal_letter", "")

    await db.claims.update_one(
        {"claim_id": payload.claim_id, "user_id": user.user_id},
        {"$set": {"appeal_draft": appeal_letter}}
    )

    return {"appeal_letter": appeal_letter}


# @router.post("/claims/save-to-vault")
# async def save_claim_to_vault(
#     payload: SaveClaimToVaultRequest,
#     user: User = Depends(get_current_user),
# ):
#     claim = await db.claims.find_one(
#         {"claim_id": payload.claim_id, "user_id": user.user_id},
#         {"_id": 0}
#     )
#
#     if not claim:
#         raise HTTPException(status_code=404, detail="Claim not found")
#
#     title = f"Insurance claim review — {claim.get('insurer') or 'Unknown insurer'}"
#
#     details = f"""
# Estimated reimbursement: ${claim.get('estimated_reimbursement_usd') or 0}
#
# Deductible note:
# {claim.get('deductible_note') or 'None'}
#
# Missing documents:
# {json.dumps(claim.get('missing_documents') or [], indent=2)}
#
# Next steps:
# {json.dumps(claim.get('next_steps') or [], indent=2)}
# """.strip()
#
#     record = {
#         "record_id": f"rec_{uuid.uuid4().hex[:12]}",
#         "pet_id": claim.get("pet_id") or "",
#         "user_id": user.user_id,
#         "record_type": "note",
#         "title": title,
#         "details": details,
#         "amount_usd": claim.get("estimated_reimbursement_usd"),
#         "date": datetime.now(timezone.utc).date().isoformat(),
#         "category": "other",
#         "created_at": datetime.now(timezone.utc).isoformat(),
#         "source": "insurance_claim",
#         "claim_id": payload.claim_id,
#     }
#
#     await db.pet_records.insert_one(record)
#
#     return {
#         "ok": True,
#         "record_id": record["record_id"],
#         "message": "Claim saved to Pet Vault",
#     }
