import asyncio
import io
import json
import uuid
import base64
import hashlib
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse
from pypdf import PdfReader
from pydantic import BaseModel
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle

from app.shared import (
    db,
    logger,
    ROOT_DIR,
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_MB,
    ESTIMATE_UPLOAD_DIR,
    SAFETY_DISCLAIMER,
    anthropic_client,
    CLAUDE_MODEL,
    check_magic_bytes,

    User,
    EstimateAnalysis,
    EstimateComparison,
    CompareRequest,
    CompareQuestionRequest,
    PetQuestionRequest,
    ClaimQuestionRequest,
    PetRecord,
    PetRecordCreate,

    get_current_user,
    require_paid_plan,
    enforce_ai_usage_limit,
    record_ai_usage,
    call_claude_json,
    COMPARE_RECOMMENDATION_SYSTEM_PROMPT,
)

router = APIRouter()


# -------------------- Request models --------------------

class BillQuestionRequest(BaseModel):
    question: str

class BillFeedbackRequest(BaseModel):
    rating: str          # "helpful" | "not_helpful"
    comment: str = ""


class SaveLineItemRecordRequest(BaseModel):
    line_key: str
    record: PetRecordCreate


# -------------------- PDF helper --------------------

def _build_pdf_bytes(estimate: dict, disclaimer_fallback: str = "") -> bytes:
    """Generate a styled PDF packet for a single bill analysis."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    brand   = colors.HexColor("#2D2C28")
    accent  = colors.HexColor("#556045")
    flag_c  = colors.HexColor("#D26D53")
    subtle  = colors.HexColor("#65635C")
    border  = colors.HexColor("#E5E2D9")
    light   = colors.HexColor("#FAF9F6")

    base = getSampleStyleSheet()
    title_s = ParagraphStyle("pbt",  parent=base["Heading1"], fontSize=22, leading=26,
                              textColor=brand, spaceAfter=4, fontName="Helvetica-Bold")
    h2_s    = ParagraphStyle("pbh2", parent=base["Heading2"], fontSize=13, leading=16,
                              textColor=accent, spaceBefore=14, spaceAfter=6, fontName="Helvetica-Bold")
    body_s  = ParagraphStyle("pbb",  parent=base["Normal"],   fontSize=10, leading=14,
                              textColor=brand, fontName="Helvetica")
    small_s = ParagraphStyle("pbs",  parent=base["Normal"],   fontSize=8,  leading=11,
                              textColor=subtle, fontName="Helvetica")
    flag_s  = ParagraphStyle("pbf",  parent=base["Normal"],   fontSize=10, leading=14,
                              textColor=flag_c, fontName="Helvetica-Bold")

    pet_name    = estimate.get("pet_name")    or "Pet"
    pet_species = estimate.get("pet_species") or ""
    summary     = estimate.get("summary")     or "Vet bill analysis"
    total       = estimate.get("estimated_total_usd") or 0
    created_at  = (estimate.get("created_at") or "")[:10]
    line_items  = estimate.get("line_items")            or []
    red_flags   = estimate.get("red_flags")             or []
    questions   = estimate.get("questions_to_ask_vet")  or []
    cost_opts   = estimate.get("cost_saving_options")   or []
    disclaimer  = estimate.get("disclaimer") or disclaimer_fallback

    pet_label = f"{pet_name} · {pet_species}" if pet_species else pet_name
    story = []

    # ── Header ──────────────────────────────────────────────────────────────
    story.append(Paragraph("PetBill Shield", title_s))
    story.append(Paragraph(
        f"<font color='#65635C'>Bill Analysis Packet &nbsp;—&nbsp; {pet_label} &nbsp;|&nbsp; {created_at}</font>",
        body_s,
    ))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=1, color=brand))
    story.append(Spacer(1, 10))

    # ── Summary & total ─────────────────────────────────────────────────────
    story.append(Paragraph("Summary", h2_s))
    story.append(Paragraph(summary, body_s))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"<b>Estimated total:</b> <font color='#D26D53'>${float(total):.2f}</font>",
        body_s,
    ))

    # ── Line items ──────────────────────────────────────────────────────────
    if line_items:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border))
        story.append(Paragraph("Line Items", h2_s))

        rows = [["Item", "Category", "Cost", "Urgency"]]
        for item in line_items:
            label    = str(item.get("label")    or "")[:60]
            category = str(item.get("category") or "").replace("_", " ").title()
            cost     = item.get("cost_usd")
            cost_str = f"${float(cost):.2f}" if cost is not None else "—"
            urgency  = str(item.get("urgency")  or "").capitalize()
            rows.append([label, category, cost_str, urgency])

        col_w = [3.0 * inch, 1.35 * inch, 0.9 * inch, 0.95 * inch]
        tbl = Table(rows, colWidths=col_w, repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0),  brand),
            ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.white),
            ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, 0),  9),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, light]),
            ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE",      (0, 1), (-1, -1), 9),
            ("GRID",          (0, 0), (-1, -1), 0.25, border),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(tbl)

    # ── Concerns / red flags ─────────────────────────────────────────────────
    if red_flags:
        story.append(Spacer(1, 10))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border))
        story.append(Paragraph("Items to Clarify", h2_s))
        for flag in red_flags:
            label    = flag.get("label") or flag.get("item") or "Item"
            why      = flag.get("why")   or flag.get("note") or ""
            severity = (flag.get("severity") or "").lower()
            suf      = " — HIGH" if severity == "high" else (" — Note" if severity == "warning" else "")
            fs       = flag_s if severity in ("high", "warning") else body_s
            story.append(Paragraph(f"<b>{label}{suf}</b>", fs))
            if why:
                story.append(Paragraph(why, small_s))
            story.append(Spacer(1, 4))

    # ── Questions to ask your vet ────────────────────────────────────────────
    if questions:
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border))
        story.append(Paragraph("Questions to Ask Your Vet", h2_s))
        for i, q in enumerate(questions, 1):
            story.append(Paragraph(f"{i}.&nbsp;&nbsp;{q}", body_s))
            story.append(Spacer(1, 4))

    # ── Cost-saving options ──────────────────────────────────────────────────
    if cost_opts:
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=0.5, color=border))
        story.append(Paragraph("Cost-Saving Opportunities", h2_s))
        for opt in cost_opts:
            story.append(Paragraph(f"•&nbsp;&nbsp;{opt}", body_s))
            story.append(Spacer(1, 3))

    # ── Disclaimer ───────────────────────────────────────────────────────────
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", thickness=1, color=brand))
    story.append(Spacer(1, 8))
    story.append(Paragraph(disclaimer, small_s))

    doc.build(story)
    return buffer.getvalue()


# -------------------- Helpers: text extraction --------------------
def extract_pdf_text(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = []
        for p in reader.pages[:10]:
            pages.append(p.extract_text() or "")
        return "\n".join(pages).strip()
    except Exception as e:
        logger.warning(f"PDF text extraction failed: {e}")
        return ""

def validate_upload_size(contents: bytes):
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File is too large. Maximum allowed size is {MAX_UPLOAD_MB}MB.",
        )


def safe_file_ext(filename: str, content_type: str = "") -> str:
    name = (filename or "").lower()

    if name.endswith(".pdf") or "pdf" in content_type:
        return "pdf"
    if name.endswith(".jpg") or name.endswith(".jpeg") or content_type == "image/jpeg":
        return "jpg"
    if name.endswith(".png") or content_type == "image/png":
        return "png"
    if name.endswith(".webp") or content_type == "image/webp":
        return "webp"

    return "bin"


async def save_uploaded_file(
    contents: bytes,
    original_filename: str,
    content_type: str,
    folder: Path,
    user_id: str,
    purpose: str,
    linked_id: Optional[str] = None,
) -> dict:
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    ext = safe_file_ext(original_filename, content_type)
    stored_name = f"{file_id}.{ext}"
    path = folder / stored_name

    with open(path, "wb") as f:
        f.write(contents)

    public_path = f"/uploads/{folder.name}/{stored_name}"

    doc = {
        "file_id": file_id,
        "user_id": user_id,
        "purpose": purpose,
        "linked_id": linked_id,
        "original_filename": original_filename or "",
        "stored_filename": stored_name,
        "path": str(path),
        "url": public_path,
        "content_type": content_type or "",
        "size_bytes": len(contents),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.uploaded_files.insert_one(doc)
    return doc

@router.post("/pets/{pet_id}/picture")
async def upload_pet_picture(
    pet_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    pet = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    allowed = ["image/jpeg", "image/png", "image/webp"]
    if file.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Use JPG, PNG, or WEBP")

    contents = await file.read()

    if len(contents) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 3MB")

    if not check_magic_bytes(contents, file.content_type):
        raise HTTPException(status_code=400, detail="File content does not match the declared image type")

    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }[file.content_type]

    upload_dir = ROOT_DIR / "uploads" / "pet_pictures"
    upload_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{pet_id}.{ext}"
    path = upload_dir / filename

    with open(path, "wb") as f:
        f.write(contents)

    picture_url = f"/uploads/pet_pictures/{filename}"

    await db.pets.update_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"$set": {"picture": picture_url}}
    )

    return {"picture": picture_url}

# -------------------- Claude Estimate Analyzer --------------------
ESTIMATE_SYSTEM_PROMPT = """You are PetBill Shield, a calm and protective AI assistant that helps pet owners understand expensive vet bills BEFORE they pay.

Your role:
- Translate vet estimates and invoices into plain English
- Flag items that may need clarification
- Help the owner ask better questions
- Suggest safe, non-diagnostic cost-saving options

Critical safety rules:
- You DO NOT diagnose the pet
- You DO NOT replace a veterinarian
- You NEVER tell the user to refuse care
- For urgent symptoms, you remind them to seek immediate veterinary care
- Use careful wording: say "may need clarification" not "overbilling"

ALWAYS return STRICT, VALID JSON matching exactly this schema:
{
  "summary": "string — 2-3 sentence plain-English summary",
  "estimated_total_usd": number_or_null,
  "line_items": [
    {"label": "string", "amount_usd": number_or_null, "urgency": "urgent" | "soon" | "elective" | "unclear", "category": "diagnostic|treatment|medication|hospitalization|surgery|imaging|labwork|exam|other", "notes": "string"}
  ],
  "red_flags": [
    {"label": "string", "severity": "info" | "warning" | "high", "why": "string — why this may need clarification (no accusations)", "ask_the_vet": "string — exact polite question"}
  ],
  "urgent_now": ["string"],
  "can_wait": ["string"],
  "questions_to_ask_vet": ["string"],
  "cost_saving_options": ["string"],
  "second_opinion_checklist": ["string"]
}

Return ONLY the JSON object, no markdown fences, no extra prose."""


HEALTH_MARKERS_SYSTEM_PROMPT = """You are a veterinary document parser. Extract every measurable health marker from this vet bill, lab report, or medical record.

Look for numeric values in these categories:
VITALS: weight (lbs or kg), height (inches or cm), temperature (°F or °C), heart rate (bpm),
  respiratory rate (breaths/min), SpO2/oxygen saturation (%), systolic blood pressure (mmHg),
  body condition score (BCS 1-9), muscle condition score (MCS 1-3), pain score (0-10)
KIDNEY: BUN (blood urea nitrogen), creatinine, SDMA
LIVER: ALT/SGPT, AST/SGOT, ALP/SAP, GGT, total bilirubin (tbili)
METABOLIC: glucose, total protein, albumin, calcium, phosphorus, lipase, triglycerides
ELECTROLYTES: sodium, potassium, chloride, bicarbonate (tCO2/HCO3)
CBC: WBC (white blood cells), RBC (red blood cells), hematocrit/PCV, hemoglobin, platelets,
  neutrophils, lymphocytes, monocytes, eosinophils
THYROID/ENDOCRINE: T4/thyroxine, cortisol, insulin
URINALYSIS: urine specific gravity, urine pH
OTHER: cholesterol

Return ONLY valid JSON in this exact schema:
{
  "date": "YYYY-MM-DD or null",
  "markers": {
    "weight_lbs": null,
    "weight_kg": null,
    "height_in": null,
    "height_cm": null,
    "temperature_f": null,
    "heart_rate_bpm": null,
    "respiratory_rate": null,
    "spo2": null,
    "systolic_bp": null,
    "body_condition_score": null,
    "muscle_condition_score": null,
    "pain_score": null,
    "bun": null,
    "creatinine": null,
    "sdma": null,
    "alt": null,
    "ast": null,
    "alp": null,
    "ggt": null,
    "tbili": null,
    "glucose": null,
    "total_protein": null,
    "albumin": null,
    "calcium": null,
    "phosphorus": null,
    "lipase": null,
    "triglycerides": null,
    "sodium": null,
    "potassium": null,
    "chloride": null,
    "bicarbonate": null,
    "wbc": null,
    "rbc": null,
    "hematocrit": null,
    "hemoglobin": null,
    "platelets": null,
    "neutrophils": null,
    "lymphocytes": null,
    "monocytes": null,
    "eosinophils": null,
    "t4": null,
    "cortisol": null,
    "insulin": null,
    "urine_specific_gravity": null,
    "cholesterol": null
  },
  "has_data": true
}

Rules:
- Only populate a field if the document explicitly states a numeric value for it.
- Leave everything else as null.
- If nothing is found, return {"date": null, "markers": {}, "has_data": false}.
- Return ONLY the JSON object, no extra text."""


async def extract_health_markers(
    text_content: str,
    image_b64: Optional[str],
    pet_name: str,
    image_media_type: str = "image/jpeg",
) -> dict:
    if not anthropic_client:
        return {"has_data": False}
    if not text_content and not image_b64:
        return {"has_data": False}

    if text_content:
        # Text / PDF path — send as plain text
        user_msg: dict = {
            "role": "user",
            "content": (
                f"Pet: {pet_name}.\n\nDocument:\n---\n{text_content[:4500]}\n---\n\n"
                "Extract all numeric health markers. Return JSON only."
            ),
        }
    else:
        # Image path — use Claude vision so the actual pixels are analysed
        safe_media = image_media_type if image_media_type in (
            "image/jpeg", "image/png", "image/gif", "image/webp"
        ) else "image/jpeg"
        user_msg = {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": safe_media,
                        "data": image_b64,
                    },
                },
                {
                    "type": "text",
                    "text": (
                        f"Pet: {pet_name}.\n\n"
                        "Extract every numeric health marker visible in this lab result or vet document image. "
                        "Return JSON only."
                    ),
                },
            ],
        }

    try:
        message = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=900,
            temperature=0,
            system=HEALTH_MARKERS_SYSTEM_PROMPT,
            messages=[user_msg],
        )
        return parse_json_safely(message.content[0].text)
    except Exception as e:
        logger.warning(f"Health marker extraction failed: {e}")
        return {"has_data": False}


async def _extract_and_save_health_markers(
    pet_id: str,
    user_id: str,
    analysis_id: str,
    text_content: str,
    image_b64: Optional[str],
    pet_name: str,
    created_at: str,
    image_media_type: str = "image/jpeg",
) -> None:
    try:
        existing = await db.pet_health_markers.find_one(
            {"source_id": analysis_id, "user_id": user_id},
            {"_id": 0},
        )
        if existing:
            return
        result = await extract_health_markers(text_content, image_b64, pet_name, image_media_type)
        if not result.get("has_data"):
            return
        markers = {k: v for k, v in result.get("markers", {}).items() if v is not None}
        if not markers:
            return
        date = result.get("date") or created_at[:10]
        doc = {
            "marker_id": f"hm_{uuid.uuid4().hex[:12]}",
            "pet_id": pet_id,
            "user_id": user_id,
            "source": "estimate",
            "source_id": analysis_id,
            "date": date,
            "markers": markers,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.pet_health_markers.insert_one(doc)
        await db.estimates.update_one(
            {"analysis_id": analysis_id, "user_id": user_id},
            {
                "$set": {
                    "health_markers_saved": True,
                    "health_markers_extracted": True,
                    "health_markers_count": len(markers),
                    "health_markers_date": date,
                    "health_markers_saved_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        logger.info(f"Saved health markers for pet {pet_id} from analysis {analysis_id}")
    except Exception as e:
        logger.warning(f"_extract_and_save_health_markers failed: {e}")


# async def analyze_estimate_with_claude(
#     text_content: str,
#     image_b64: Optional[str],
#     pet_name: str,
#     pet_species: str,
# ) -> dict:
#     if not EMERGENT_LLM_KEY:
#         raise HTTPException(status_code=500, detail="LLM key not configured")
#
#     chat = LlmChat(
#         api_key=EMERGENT_LLM_KEY,
#         session_id=f"estimate_{uuid.uuid4().hex[:8]}",
#         system_message=ESTIMATE_SYSTEM_PROMPT,
#     ).with_model("anthropic", CLAUDE_MODEL)
#
#     intro = f"Pet: {pet_name or 'unspecified'} ({pet_species or 'unspecified species'}).\n\n"
#     if text_content:
#         prompt = intro + f"Vet estimate/invoice content (extracted text):\n---\n{text_content[:5000]}\n---\n\nAnalyze and return JSON only."
#         msg = UserMessage(text=prompt)
#     elif image_b64:
#         prompt = intro + "Vet estimate/invoice was uploaded as an image (attached). Read it carefully and analyze. Return JSON only."
#         msg = UserMessage(text=prompt, file_contents=[ImageContent(image_b64)])
#     else:
#         raise HTTPException(status_code=400, detail="No content to analyze")
#
#     raw = await chat.send_message(msg)
#     return parse_json_safely(raw)


async def analyze_estimate_with_claude(
    text_content: str,
    image_b64: Optional[str],
    pet_name: str,
    pet_species: str,
    image_media_type: str = "image/jpeg",
    language: str = "en",
) -> dict:
    if not anthropic_client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    intro = f"Pet: {pet_name or 'unspecified'} ({pet_species or 'unspecified species'})."
    if language == "es":
        intro += " IMPORTANT: Write ALL text fields in Spanish (español). The summary, line item notes, red flag labels and explanations, questions, and cost-saving options must all be in Spanish."

    if text_content:
        user_content: object = (
            f"{intro}\n\nVet bill content:\n---\n{text_content[:5000]}\n---\n\n"
            "Analyze every charge. Return JSON only."
        )
    else:
        # Vision path — send the actual image so Claude can read the bill
        safe_media = image_media_type if image_media_type in (
            "image/jpeg", "image/png", "image/gif", "image/webp"
        ) else "image/jpeg"
        user_content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": safe_media, "data": image_b64},
            },
            {
                "type": "text",
                "text": (
                    f"{intro}\n\nThis is a vet bill image. "
                    "Read every visible charge and analyze. Return JSON only."
                ),
            },
        ]

    # Assistant prefill forces valid JSON output — eliminates preamble and markdown fences
    message = await anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,   # raised from 1800 — large bills need ~3000+ tokens
        temperature=0,
        system=ESTIMATE_SYSTEM_PROMPT,
        messages=[
            {"role": "user",      "content": user_content},
            {"role": "assistant", "content": "{"},
        ],
    )

    if message.stop_reason == "max_tokens":
        logger.warning("analyze_estimate_with_claude: response was truncated (hit max_tokens)")

    # Restore the prefilled opening brace (the API strips it from the response)
    raw = "{" + message.content[0].text
    return parse_json_safely(raw)


def parse_json_safely(text: str) -> dict:
    if not text:
        return {}
    s = text.strip()
    # strip code fences if present
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: s.rfind("```")]
        s = s.strip()
        if s.lower().startswith("json"):
            s = s[4:].strip()
    # try to find the outermost JSON object
    try:
        return json.loads(s)
    except Exception:
        try:
            start = s.find("{")
            end = s.rfind("}")
            if start != -1 and end != -1 and end > start:
                return json.loads(s[start : end + 1])
        except Exception as e:
            logger.warning(f"JSON parse failed: {e}")
    return {}


async def call_claude_json(system_prompt: str, user_prompt: str, max_tokens: int = 2500) -> dict:
    if not anthropic_client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    message = await anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        temperature=0.2,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
    )

    raw = message.content[0].text
    return parse_json_safely(raw)


SUGGEST_REMINDERS_SYSTEM_PROMPT = """
You are PetBill Shield.

Suggest helpful pet-care reminders using only the saved pet records provided.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not say something is definitely due unless the record date clearly supports it.
- Use cautious wording like "may be due" or "consider checking with your vet".
- Suggest practical reminders for vaccines, medication refills, follow-ups, claim next steps, annual wellness visits, labs, and dental care.
- Return only JSON.

Return this exact JSON shape:
{
  "suggested_reminders": [
    {
      "title": "string",
      "message": "string",
      "suggested_for": "YYYY-MM-DD",
      "repeat": "none" | "weekly" | "monthly" | "yearly",
      "reason": "string"
    }
  ]
}
"""

# ─────────────────────────────────────────────────────────────────────────────
# Vet-bill transparency dataset helpers
# Every analysis that includes a city/state contributes anonymised line-item
# prices to db.procedure_costs.  No user_id, pet_id, or analysis_id is stored.
# ─────────────────────────────────────────────────────────────────────────────

async def _save_procedure_costs(
    line_items: list,
    pet_species: str,
    city: str,
    state: str,
) -> None:
    """Persist anonymised price points. Non-blocking — always fire-and-forget."""
    month_year   = datetime.now(timezone.utc).strftime("%Y-%m")
    species_norm = (pet_species or "unknown").strip().lower()
    city_norm    = city.strip().lower()
    state_norm   = state.strip().upper()[:2]

    docs = []
    for item in (line_items or []):
        label     = (item.get("label") or "").strip()
        amount    = item.get("amount_usd")
        category  = item.get("category") or "other"
        if not label or amount is None or float(amount) <= 0:
            continue
        docs.append({
            "procedure_id": f"proc_{uuid.uuid4().hex[:10]}",
            "label":        label,
            "label_lower":  label.lower(),
            "category":     category,
            "amount_usd":   round(float(amount), 2),
            "city":         city_norm,
            "state":        state_norm,
            "pet_species":  species_norm,
            "month_year":   month_year,
            "created_at":   datetime.now(timezone.utc).isoformat(),
        })

    if docs:
        try:
            await db.procedure_costs.insert_many(docs, ordered=False)
        except Exception as exc:
            logger.warning(f"procedure_costs insert failed: {exc}")


# -------------------- Estimate Endpoints --------------------
@router.post("/estimates/analyze", response_model=EstimateAnalysis)
async def analyze_estimate(
    pet_id: Optional[str] = Form(None),
    pet_name: Optional[str] = Form(""),
    pet_species: Optional[str] = Form(""),
    typed_text: Optional[str] = Form(""),
    city: Optional[str] = Form(None),
    state: Optional[str] = Form(None),
    lang: Optional[str] = Form(None),   # "es" → respond in Spanish
    file: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
):
    await enforce_ai_usage_limit(user, "estimate")
    source_type: str = "text"
    text_content: str = ""
    image_b64: Optional[str] = None
    original_filename = ""
    saved_file = None
    content_hash: Optional[str] = None
    image_media_type: str = "image/jpeg"

    if file is not None:
        contents = await file.read()
        validate_upload_size(contents)
        content_hash = hashlib.sha256(contents).hexdigest()

        original_filename = file.filename or ""
        ctype = (file.content_type or "").lower()

        # Determine normalised MIME for magic-byte check
        _declared_mime: str
        if "pdf" in ctype or original_filename.lower().endswith(".pdf"):
            _declared_mime = "application/pdf"
        elif ctype in ("image/jpeg", "image/png", "image/webp"):
            _declared_mime = ctype
        elif original_filename.lower().endswith((".jpg", ".jpeg")):
            _declared_mime = "image/jpeg"
        elif original_filename.lower().endswith(".png"):
            _declared_mime = "image/png"
        elif original_filename.lower().endswith(".webp"):
            _declared_mime = "image/webp"
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use PDF, JPG, PNG or WEBP.")

        if not check_magic_bytes(contents, _declared_mime):
            raise HTTPException(
                status_code=400,
                detail="File content does not match the declared type. Please upload a genuine PDF or image.",
            )

        if _declared_mime == "application/pdf":
            source_type = "pdf"
            text_content = extract_pdf_text(contents)
            if not text_content:
                raise HTTPException(
                    status_code=400,
                    detail="Could not extract text from this PDF. Please upload an image (JPG/PNG) of the estimate instead.",
                )
        else:
            source_type = "image"
            image_b64 = base64.b64encode(contents).decode("utf-8")
            image_media_type = _declared_mime

        saved_file = await save_uploaded_file(
            contents=contents,
            original_filename=file.filename or "",
            content_type=file.content_type or "",
            folder=ESTIMATE_UPLOAD_DIR,
            user_id=user.user_id,
            purpose="estimate",
        )
        original_filename = file.filename or ""
        ctype = (file.content_type or "").lower()

    elif typed_text and typed_text.strip():
        text_content = typed_text.strip()
        source_type = "text"
        content_hash = hashlib.sha256(text_content.encode()).hexdigest()
    else:
        raise HTTPException(status_code=400, detail="Provide a file or typed text")

    is_paid = await require_paid_plan(user, raise_error=False)

    if not pet_id and is_paid:
        raise HTTPException(
            status_code=400,
            detail="Please select a pet from your vault before analyzing a bill.",
        )

    if pet_id:
        pet_doc = await db.pets.find_one(
            {"pet_id": pet_id, "user_id": user.user_id},
            {"_id": 0}
        )

        if not pet_doc:
            raise HTTPException(status_code=404, detail="Pet not found")

        pet_name = pet_doc.get("name", "")
        pet_species = pet_doc.get("species", "")
    else:
        pet_name = pet_name or "Unspecified pet"
        pet_species = pet_species or "unspecified species"

    # ── Cache check — same file/text returns instantly, no AI cost ──────────────
    result: dict = {}
    cache_hit = False
    if content_hash:
        cache_cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        cached = await db.estimate_cache.find_one({
            "content_hash": content_hash,
            "created_at": {"$gte": cache_cutoff},
        })
        if cached:
            result = cached["result"]
            cache_hit = True
            await db.estimate_cache.update_one(
                {"_id": cached["_id"]}, {"$inc": {"hit_count": 1}}
            )
            logger.info(f"estimate cache hit: {content_hash[:12]}")

    if not cache_hit:
        try:
            result = await analyze_estimate_with_claude(
                text_content,
                image_b64,
                pet_name or "",
                pet_species or "",
                image_media_type=image_media_type,
                language=lang or "en",
            )
        except Exception as e:
            logger.exception("Analysis failed")
            raise HTTPException(
                status_code=500,
                detail="Analysis failed. Please try again."
            )
        # Store result for future identical uploads (non-fatal if write fails)
        if content_hash:
            try:
                await db.estimate_cache.insert_one({
                    "content_hash": content_hash,
                    "result":       result,
                    "created_at":   datetime.now(timezone.utc).isoformat(),
                    "hit_count":    0,
                })
            except Exception:
                pass

    # If pet_id provided, look up name/species
    # if pet_id:
    #     pet_doc = await db.pets.find_one({"pet_id": pet_id, "user_id": user.user_id}, {"_id": 0})
    #     if pet_doc:
    #         pet_name = pet_name or pet_doc.get("name", "")
    #         pet_species = pet_species or pet_doc.get("species", "")

    analysis = EstimateAnalysis(
        user_id=user.user_id,
        pet_id=pet_id or None,
        pet_name=pet_name or "",
        pet_species=pet_species or "",
        source_type=source_type,  # type: ignore
        original_filename=original_filename,
        raw_text_excerpt=(text_content or "")[:800],
        summary=result.get("summary", ""),
        estimated_total_usd=result.get("estimated_total_usd"),
        line_items=result.get("line_items", []) or [],
        red_flags=result.get("red_flags", []) or [],
        urgent_now=result.get("urgent_now", []) or [],
        can_wait=result.get("can_wait", []) or [],
        questions_to_ask_vet=result.get("questions_to_ask_vet", []) or [],
        cost_saving_options=result.get("cost_saving_options", []) or [],
        second_opinion_checklist=result.get("second_opinion_checklist", []) or [],
        disclaimer=SAFETY_DISCLAIMER,
    )
    doc = analysis.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    # Store location for transparency comparisons (shown back to the user)
    city_clean  = city.strip()  if city  and city.strip()  else None
    state_clean = state.strip().upper()[:2] if state and state.strip() else None
    if city_clean:  doc["city"]  = city_clean
    if state_clean: doc["state"] = state_clean
    await db.estimates.insert_one(doc)
    if saved_file:
        await db.uploaded_files.update_one(
            {"file_id": saved_file["file_id"]},
            {"$set": {"linked_id": analysis.analysis_id}}
        )

    await record_ai_usage(user, "estimate", analysis.analysis_id)

    # Fire-and-forget: save anonymized procedure costs for transparency dataset
    if city_clean and state_clean:
        asyncio.create_task(
            _save_procedure_costs(
                line_items=analysis.line_items,
                pet_species=pet_species or "",
                city=city_clean,
                state=state_clean,
            )
        )

    # Fire-and-forget: extract health markers from the bill (non-blocking)
    if pet_id and (text_content or image_b64):
        asyncio.create_task(
            _extract_and_save_health_markers(
                pet_id=pet_id,
                user_id=user.user_id,
                analysis_id=analysis.analysis_id,
                text_content=text_content,
                image_b64=image_b64 or "",
                pet_name=pet_name or "",
                created_at=doc["created_at"],
                image_media_type=image_media_type,
            )
        )

    return analysis


@router.get("/estimates", response_model=List[EstimateAnalysis])
async def list_estimates(user: User = Depends(get_current_user)):
    rows = await db.estimates.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for r in rows:
        if isinstance(r.get("created_at"), str):
            r["created_at"] = datetime.fromisoformat(r["created_at"])
    return [EstimateAnalysis(**r) for r in rows]


@router.get("/estimates/{analysis_id}")
async def get_estimate(
    analysis_id: str,
    user: User = Depends(get_current_user),
):
    row = await db.estimates.find_one(
        {
            "analysis_id": analysis_id,
            "user_id": user.user_id,
        },
        {"_id": 0},
    )

    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    if isinstance(row.get("created_at"), str):
        row["created_at"] = datetime.fromisoformat(row["created_at"])

    row["saved_to_pet_vault"] = bool(row.get("saved_to_pet_vault", False))
    row["saved_pet_id"] = row.get("saved_pet_id")
    row["saved_line_item_keys"] = row.get("saved_line_item_keys") or []

    marker_doc = await db.pet_health_markers.find_one(
        {"source_id": analysis_id, "user_id": user.user_id},
        {"_id": 0, "markers": 1, "date": 1},
    )
    if marker_doc:
        row["health_markers_extracted"] = True
        row["health_markers_saved"] = True
        row["health_markers_count"] = len(marker_doc.get("markers") or {})
        row["health_markers_date"] = marker_doc.get("date")
    else:
        row["health_markers_extracted"] = bool(
            row.get("health_markers_extracted") or row.get("health_markers_saved")
        )
        row["health_markers_saved"] = bool(row.get("health_markers_saved", False))
        row["health_markers_count"] = int(row.get("health_markers_count") or 0)
        row["health_markers_date"] = row.get("health_markers_date")

    return row

@router.post("/estimates/{analysis_id}/save-to-vault")
async def save_estimate_to_vault(
    analysis_id: str,
    pet_id: str = Form(...),
    user: User = Depends(get_current_user),
):
    estimate = await db.estimates.find_one(
        {
            "analysis_id": analysis_id,
            "user_id": user.user_id,
        },
        {"_id": 0},
    )

    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    pet = await db.pets.find_one(
        {
            "pet_id": pet_id,
            "user_id": user.user_id,
        },
        {"_id": 0},
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    if estimate.get("saved_to_pet_vault"):
        return {
            "ok": True,
            "already_saved": True,
            "saved_to_pet_vault": True,
            "saved_pet_id": estimate.get("saved_pet_id") or pet_id,
            "record_id": estimate.get("saved_record_id"),
        }

    record = {
        "record_id": f"rec_{uuid.uuid4().hex[:12]}",
        "pet_id": pet_id,
        "user_id": user.user_id,
        "record_type": "invoice",
        "title": f"{estimate.get('pet_name') or pet.get('name') or 'Pet'} bill analysis",
        "details": estimate.get("summary", ""),
        "amount_usd": estimate.get("estimated_total_usd"),
        "date": datetime.now(timezone.utc).date().isoformat(),
        "category": "other",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.pet_records.insert_one(record)

    await db.estimates.update_one(
        {
            "analysis_id": analysis_id,
            "user_id": user.user_id,
        },
        {
            "$set": {
                "saved_to_pet_vault": True,
                "saved_pet_id": pet_id,
                "saved_record_id": record["record_id"],
                "saved_to_pet_vault_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    return {
        "ok": True,
        "saved_to_pet_vault": True,
        "saved_pet_id": pet_id,
        "record_id": record["record_id"],
    }


@router.post("/estimates/{analysis_id}/save-line-item")
async def save_estimate_line_item_to_vault(
    analysis_id: str,
    payload: SaveLineItemRecordRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)

    line_key = (payload.line_key or "").strip()
    if not line_key:
        raise HTTPException(status_code=400, detail="Line item key is required")

    estimate = await db.estimates.find_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")

    pet_id = estimate.get("pet_id")
    if not pet_id:
        raise HTTPException(status_code=400, detail="This analysis is not linked to a pet")

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    if line_key in (estimate.get("saved_line_item_keys") or []):
        return {"ok": True, "already_saved": True, "line_key": line_key}

    record = PetRecord(
        pet_id=pet_id,
        user_id=user.user_id,
        **payload.record.model_dump(),
    )
    doc = record.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.pet_records.insert_one(doc)

    await db.estimates.update_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {"$addToSet": {"saved_line_item_keys": line_key}},
    )

    return {
        "ok": True,
        "line_key": line_key,
        "record_id": record.record_id,
    }


@router.delete("/estimates/{analysis_id}")
async def delete_estimate(analysis_id: str, user: User = Depends(get_current_user)):
    await db.estimates.delete_one({"analysis_id": analysis_id, "user_id": user.user_id})
    return {"ok": True}


@router.post("/estimates/{analysis_id}/extract-markers")
async def reextract_health_markers(
    analysis_id: str,
    pet_id: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
):
    """
    Re-run health-marker extraction for an existing analysis.
    Useful when the original upload lacked a pet_id or the image path had a bug.
    Any previously extracted markers for this analysis are replaced.
    """
    await require_paid_plan(user)

    estimate = await db.estimates.find_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not estimate:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    # Resolve pet_id — prefer caller's arg, fall back to what was on the estimate
    resolved_pet_id = pet_id or estimate.get("pet_id")
    if not resolved_pet_id:
        raise HTTPException(
            status_code=400,
            detail="No pet linked to this analysis. Pass ?pet_id= to associate one.",
        )

    pet = await db.pets.find_one(
        {"pet_id": resolved_pet_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found.")

    pet_name = pet.get("name") or estimate.get("pet_name") or "Pet"

    if estimate.get("health_markers_extracted"):
        return {
            "ok": True,
            "already_saved": True,
            "markers_found": int(estimate.get("health_markers_count") or 0),
            "date": estimate.get("health_markers_date"),
            "message": "Lab marker extraction already ran for this analysis.",
        }

    existing_markers = await db.pet_health_markers.find_one(
        {"source_id": analysis_id, "user_id": user.user_id},
        {"_id": 0, "markers": 1, "date": 1},
    )
    if existing_markers:
        await db.estimates.update_one(
            {"analysis_id": analysis_id, "user_id": user.user_id},
            {
                "$set": {
                    "health_markers_extracted": True,
                    "health_markers_saved": True,
                    "health_markers_count": len(existing_markers.get("markers") or {}),
                    "health_markers_date": existing_markers.get("date"),
                }
            },
        )
        return {
            "ok": True,
            "already_saved": True,
            "markers_found": len(existing_markers.get("markers") or {}),
            "date": existing_markers.get("date"),
            "message": "Health markers were already saved for this analysis.",
        }

    # Try to recover the original file bytes
    text_content = ""
    image_b64: Optional[str] = None
    image_media_type = "image/jpeg"

    file_doc = await db.uploaded_files.find_one(
        {"linked_id": analysis_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if file_doc:
        file_path = file_doc.get("path", "")
        content_type = (file_doc.get("content_type") or "").lower()
        try:
            with open(file_path, "rb") as fh:
                raw = fh.read()
            if "pdf" in content_type or file_path.endswith(".pdf"):
                text_content = extract_pdf_text(raw)
            else:
                image_b64 = base64.b64encode(raw).decode("utf-8")
                image_media_type = content_type if content_type in (
                    "image/jpeg", "image/png", "image/gif", "image/webp"
                ) else "image/jpeg"
        except Exception as e:
            logger.warning(f"Could not re-read uploaded file for {analysis_id}: {e}")

    # Fall back to the truncated text excerpt stored on the estimate
    if not text_content and not image_b64:
        text_content = estimate.get("raw_text_excerpt", "")

    if not text_content and not image_b64:
        raise HTTPException(
            status_code=422,
            detail="Could not recover document content for re-extraction. "
                   "The original file may have been removed from the server.",
        )

    result = await extract_health_markers(text_content, image_b64, pet_name, image_media_type)

    if not result.get("has_data"):
        await db.estimates.update_one(
            {"analysis_id": analysis_id, "user_id": user.user_id},
            {
                "$set": {
                    "health_markers_extracted": True,
                    "health_markers_saved": False,
                    "health_markers_count": 0,
                    "health_markers_date": None,
                    "health_markers_saved_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        return {"ok": True, "markers_found": 0, "message": "No numeric health markers detected in this document."}

    markers = {k: v for k, v in result.get("markers", {}).items() if v is not None}
    if not markers:
        await db.estimates.update_one(
            {"analysis_id": analysis_id, "user_id": user.user_id},
            {
                "$set": {
                    "health_markers_extracted": True,
                    "health_markers_saved": False,
                    "health_markers_count": 0,
                    "health_markers_date": None,
                    "health_markers_saved_at": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
        return {"ok": True, "markers_found": 0, "message": "No numeric health markers detected in this document."}

    date = result.get("date") or estimate.get("created_at", "")[:10]

    doc = {
        "marker_id": f"hm_{uuid.uuid4().hex[:12]}",
        "pet_id": resolved_pet_id,
        "user_id": user.user_id,
        "source": "estimate",
        "source_id": analysis_id,
        "date": date,
        "markers": markers,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.pet_health_markers.insert_one(doc)
    await db.estimates.update_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {
            "$set": {
                "health_markers_saved": True,
                "health_markers_extracted": True,
                "health_markers_count": len(markers),
                "health_markers_date": date,
                "health_markers_saved_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )

    # Also link the estimate to this pet if it wasn't before
    if not estimate.get("pet_id"):
        await db.estimates.update_one(
            {"analysis_id": analysis_id, "user_id": user.user_id},
            {"$set": {"pet_id": resolved_pet_id}},
        )

    logger.info(f"Re-extracted {len(markers)} markers for pet {resolved_pet_id} from analysis {analysis_id}")
    return {
        "ok": True,
        "markers_found": len(markers),
        "date": date,
        "markers": markers,
    }


@router.post("/pets/ask")
async def ask_about_pet_history(
    payload: PetQuestionRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    pet = await db.pets.find_one(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    estimates = await db.estimates.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)

    claims = await db.claims.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)

    records = await db.pet_records.find(
        {"pet_id": payload.pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)

    system_prompt = """
You are PetBill Shield. Answer questions using only the saved pet history provided.
Do not diagnose. Do not replace a veterinarian.
If the history does not contain enough information, say what is missing.
Be clear, calm, and practical.
"""

    estimate_summary = [
        {
            "summary": e.get("summary"),
            "estimated_total_usd": e.get("estimated_total_usd"),
            "urgent_now": e.get("urgent_now"),
            "questions_to_ask_vet": e.get("questions_to_ask_vet"),
        }
        for e in estimates
    ]

    claim_summary = [
        {
            "insurer": c.get("insurer"),
            "estimated_reimbursement_usd": c.get("estimated_reimbursement_usd"),
            "likely_excluded": c.get("likely_excluded"),
        }
        for c in claims
    ]

    record_summary = [
        {
            "type": r.get("record_type"),
            "title": r.get("title"),
            "date": r.get("date"),
            "details": r.get("details"),
            "amount_usd": r.get("amount_usd"),
        }
        for r in records
    ]

    user_prompt = f"""
    Pet:
    {json.dumps(pet, default=str)}

    Previous estimates:
    {json.dumps(estimate_summary, default=str)}

    Previous claims:
    {json.dumps(claim_summary, default=str)}

    Pet records:
    {json.dumps(record_summary, default=str)}

    User question:
    {payload.question}
    """

    if not anthropic_client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    try:
        message = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=800,
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
        logger.exception("Pet history question failed")
        raise HTTPException(
            status_code=500,
            detail="AI question failed. Please try again."
        )

    doc = {
        "question_id": f"qst_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "pet_id": payload.pet_id,
        "question": payload.question,
        "answer": answer,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.pet_questions.insert_one(dict(doc))

    return {
        "ok": True,
        "question_id": doc["question_id"],
        "pet_id": doc["pet_id"],
        "question": doc["question"],
        "answer": doc["answer"],
        "created_at": doc["created_at"],
    }

@router.post("/claims/ask")
async def ask_about_claim(
    payload: ClaimQuestionRequest,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    claim = await db.claims.find_one(
        {
            "claim_id": payload.claim_id,
            "user_id": user.user_id
        },
        {"_id": 0}
    )

    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")

    system_prompt = """
You are PetBill Shield.

You help pet owners understand insurance claims and reimbursement decisions.

Rules:
- Do not diagnose pets
- Do not invent insurance coverage
- Only use information provided
- Be calm, practical, and helpful
- Explain insurance concepts in plain English
- Help users understand:
  - deductibles
  - reimbursement percentages
  - exclusions
  - appeals
  - missing documents
  - next steps

If information is missing, clearly say so.
"""

    user_prompt = f"""
Claim information:
{json.dumps(claim, default=str)}

User question:
{payload.question}
"""

    if not anthropic_client:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY not configured"
        )

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
        logger.exception("Claim question failed")

        raise HTTPException(
            status_code=500,
            detail="AI question failed. Please try again."
        )

    doc = {
        "question_id": f"clmq_{uuid.uuid4().hex[:12]}",
        "claim_id": payload.claim_id,
        "user_id": user.user_id,
        "question": payload.question,
        "answer": answer,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.claim_questions.insert_one(dict(doc))

    return {
        "ok": True,
        "question_id": doc["question_id"],
        "question": doc["question"],
        "answer": doc["answer"],
        "created_at": doc["created_at"],
    }


# ── Enhancement #8: follow-up question about a specific bill ──────────────────

@router.post("/estimates/{analysis_id}/ask")
async def ask_about_estimate(
    analysis_id: str,
    payload: BillQuestionRequest,
    user: User = Depends(get_current_user),
):
    await enforce_ai_usage_limit(user, "ask")

    estimate = await db.estimates.find_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not estimate:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if not anthropic_client:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured")

    pet_name    = estimate.get("pet_name")    or "unspecified"
    pet_species = estimate.get("pet_species") or "unspecified"
    summary     = estimate.get("summary")     or ""
    line_items  = estimate.get("line_items")           or []
    red_flags   = estimate.get("red_flags")            or []
    questions   = estimate.get("questions_to_ask_vet") or []
    cost_opts   = estimate.get("cost_saving_options")  or []

    context = (
        f"Pet: {pet_name} ({pet_species})\n\n"
        f"Bill summary: {summary}\n\n"
        f"Line items:\n{json.dumps(line_items, default=str)}\n\n"
        f"Concerns flagged:\n{json.dumps(red_flags, default=str)}\n\n"
        f"Questions to ask vet:\n{json.dumps(questions, default=str)}\n\n"
        f"Cost-saving options:\n{json.dumps(cost_opts, default=str)}"
    )

    system_prompt = (
        "You are PetBill Shield, an AI assistant helping pet owners understand their veterinary bills. "
        "Answer the question using only the bill analysis provided — do not invent or assume information. "
        "Be clear, concise, and reassuring. Do not diagnose, prescribe, or replace veterinary advice. "
        "If the question cannot be answered from the bill data, say so politely."
    )

    try:
        message = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=600,
            temperature=0.2,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Bill analysis:\n{context}\n\nQuestion: {payload.question}",
            }],
        )
        answer = message.content[0].text
    except Exception:
        logger.exception("Bill follow-up question failed")
        raise HTTPException(status_code=500, detail="Could not process your question right now.")

    await record_ai_usage(user, "ask", linked_id=analysis_id)
    return {"ok": True, "question": payload.question, "answer": answer}


# ── Enhancement #9: PDF packet download ──────────────────────────────────────

@router.get("/estimates/{analysis_id}/packet.pdf")
async def download_estimate_packet(
    analysis_id: str,
    user: User = Depends(get_current_user),
):
    estimate = await db.estimates.find_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not estimate:
        raise HTTPException(status_code=404, detail="Analysis not found")

    try:
        pdf_bytes = _build_pdf_bytes(estimate, disclaimer_fallback=SAFETY_DISCLAIMER)
    except Exception:
        logger.exception("PDF generation failed")
        raise HTTPException(status_code=500, detail="Could not generate PDF right now.")

    safe_id = analysis_id[:12]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="petbill_shield_{safe_id}.pdf"',
            "Cache-Control": "no-store",
        },
    )


# ── Enhancement #10: inline analysis feedback ─────────────────────────────────

@router.post("/estimates/{analysis_id}/feedback")
async def submit_estimate_feedback(
    analysis_id: str,
    payload: BillFeedbackRequest,
    user: User = Depends(get_current_user),
):
    if payload.rating not in ("helpful", "not_helpful"):
        raise HTTPException(status_code=422, detail="rating must be 'helpful' or 'not_helpful'")

    now = datetime.now(timezone.utc).isoformat()
    await db.feedback.update_one(
        {"analysis_id": analysis_id, "user_id": user.user_id},
        {
            "$set": {
                "rating":      payload.rating,
                "comment":     payload.comment,
                "updated_at":  now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"ok": True}
