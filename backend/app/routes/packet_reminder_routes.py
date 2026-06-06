from fastapi import APIRouter
from app.shared import *

router = APIRouter()

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

# -------------------- Email PDF packet to vet --------------------
class EmailPacketRequest(BaseModel):
    to_email: EmailStr
    vet_name: Optional[str] = ""
    note: Optional[str] = ""


@router.post("/estimates/{analysis_id}/email-packet")
async def email_packet(analysis_id: str, payload: EmailPacketRequest, user: User = Depends(get_current_user)):
    """Generates the PDF packet for an analysis and emails it (as attachment)
    to the supplied vet email via Resend. Stores a record of the dispatch."""
    await require_paid_plan(user)

    if not RESEND_API_KEY:
        raise HTTPException(status_code=503, detail="Email service not configured")

    row = await db.estimates.find_one({"analysis_id": analysis_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")

    pdf_bytes = _build_estimate_pdf(row).getvalue()
    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

    pet_label = (row.get("pet_name") or "your patient").strip()
    vet_label = (payload.vet_name or "").strip() or "there"
    sender_name = (user.name or user.email).strip()
    safe_note = (payload.note or "").strip().replace("\n", "<br/>")
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:Manrope,Arial,sans-serif;background:#FAF9F6;padding:24px;">
      <tr><td>
        <table width="640" cellpadding="0" cellspacing="0" align="center" style="background:#F2F0E9;border:1px solid #E5E2D9;border-radius:8px;">
          <tr><td style="padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#65635C;">PetBill Shield · Estimate review</div>
            <h1 style="font-family:Georgia,serif;font-weight:500;font-size:26px;color:#2D2C28;margin:8px 0 0 0;">Estimate review for {pet_label}</h1>
            <p style="color:#2D2C28;line-height:1.6;margin:14px 0 0 0;">Hi {vet_label},</p>
            <p style="color:#2D2C28;line-height:1.6;margin:10px 0 0 0;">
              {sender_name} put their estimate for {pet_label} through PetBill Shield — a calm "second set of eyes" service that helps pet owners understand vet bills.
              The attached packet summarizes the estimate in plain English, marks urgency, and lists questions {sender_name} would like to walk through with you.
            </p>
            {f'<div style="margin-top:14px;padding:12px 14px;background:#FAF9F6;border:1px solid #E5E2D9;border-radius:6px;color:#2D2C28;font-size:14px;line-height:1.5;">{safe_note}</div>' if safe_note else ''}
            <hr style="border:none;border-top:1px solid #E5E2D9;margin:18px 0;"/>
            <p style="color:#65635C;font-size:12px;line-height:1.6;margin:0;">
              PetBill Shield doesn't diagnose pets, doesn't replace a veterinarian, and never tells owners to refuse care.
              It helps owners understand costs and prepare questions. Thank you for the care you provide.
            </p>
            <p style="color:#65635C;font-size:12px;margin-top:14px;">— Sent on behalf of {sender_name} ({user.email})</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

    attachments = [
        {
            "filename": f"petbill_shield_packet_{analysis_id}.pdf",
            "content": pdf_b64,
        }
    ]

    delivered = False
    delivery_error = None
    try:
        resp = await send_resend_email(
            to=[payload.to_email],
            subject=f"PetBill Shield — estimate review for {pet_label}",
            html=html,
            template_key="packet_sent",
            template_variables={
                "to_email":     payload.to_email,
                "vet_name":     vet_label,
                "pet_name":     pet_label,
                "sender_name":  sender_name,
                "sender_email": user.email,
                "note":         (payload.note or "").strip(),
                "frontend_url": FRONTEND_URL,
            },
            reply_to=user.email,
            attachments=attachments,
        )
        delivered = True
        info = str(resp.get("id") if isinstance(resp, dict) else resp)[:160]
    except Exception as e:
        info = None
        delivery_error = str(e)[:200]
        logger.warning(f"email-packet send failed: {delivery_error}")

    doc = {
        "dispatch_id": f"vetdsp_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "analysis_id": analysis_id,
        "to_email": payload.to_email,
        "vet_name": payload.vet_name or "",
        "note": (payload.note or "")[:2000],
        "delivered": delivered,
        "delivery_id": info if delivered else None,
        "delivery_error": delivery_error,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.vet_dispatches.insert_one(dict(doc))

    return {
        "ok": True,
        "delivered": delivered,
        "delivery_error": delivery_error,
        "dispatch_id": doc["dispatch_id"],
    }


@router.get("/estimates/{analysis_id}/vet-dispatches")
async def list_vet_dispatches(analysis_id: str, user: User = Depends(get_current_user)):
    """List previous vet email dispatches for an analysis."""
    rows = await db.vet_dispatches.find(
        {"analysis_id": analysis_id, "user_id": user.user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return rows



# -------------------- Reminders --------------------
class Reminder(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reminder_id: str = Field(default_factory=lambda: f"rem_{uuid.uuid4().hex[:12]}")
    user_id: str
    pet_id: Optional[str] = None
    pet_name: Optional[str] = ""
    title: str
    message: Optional[str] = ""
    scheduled_for: str
    email: Optional[str] = ""
    status: Literal["pending", "sent", "failed", "cancelled"] = "pending"
    repeat: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"
    sent_at: Optional[str] = None
    last_error: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ReminderCreate(BaseModel):
    pet_id: Optional[str] = None
    title: str
    message: Optional[str] = ""
    scheduled_for: str
    email: Optional[str] = ""
    repeat: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"


class SuggestedReminderCreate(BaseModel):
    title: str
    message: str
    suggested_for: str
    repeat: Optional[Literal["none", "weekly", "monthly", "yearly"]] = "none"
    reason: Optional[str] = ""


@router.post("/pets/{pet_id}/suggest-reminders")
async def suggest_pet_reminders(
    pet_id: str,
    user: User = Depends(get_current_user),
):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "suggest_reminders")

    pet = await db.pets.find_one(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    records = await db.pet_records.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    estimates = await db.estimates.find(
        {"pet_id": pet_id, "user_id": user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)

    claims = await db.claims.find(
        {
            "$or": [
                {"pet_id": pet_id, "user_id": user.user_id},
                {"saved_pet_id": pet_id, "user_id": user.user_id},
            ]
        },
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)

    compact_records = [
        {
            "record_type": r.get("record_type"),
            "title": r.get("title"),
            "date": r.get("date"),
            "category": r.get("category"),
            "details": (r.get("details") or "")[:1000],
        }
        for r in records
    ]

    compact_estimates = [
        {
            "summary": e.get("summary"),
            "urgent_now": e.get("urgent_now"),
            "can_wait": e.get("can_wait"),
            "questions_to_ask_vet": e.get("questions_to_ask_vet"),
            "created_at": e.get("created_at"),
        }
        for e in estimates
    ]

    compact_claims = [
        {
            "insurer": c.get("insurer"),
            "missing_documents": c.get("missing_documents"),
            "next_steps": c.get("next_steps"),
            "created_at": c.get("created_at"),
        }
        for c in claims
    ]

    today = datetime.now(timezone.utc).date().isoformat()

    user_prompt = f"""
Today is {today}.

Pet:
{json.dumps(pet, default=str)}

Pet records:
{json.dumps(compact_records, default=str)}

Estimate analyses:
{json.dumps(compact_estimates, default=str)}

Insurance claim analyses:
{json.dumps(compact_claims, default=str)}

Suggest useful reminders only when the saved history supports them.
Return JSON only.
"""

    result = await call_claude_json(
        SUGGEST_REMINDERS_SYSTEM_PROMPT,
        user_prompt,
        max_tokens=1800,
    )

    try:
        await record_ai_usage(user, "suggest_reminders", linked_id=pet_id)
    except Exception:
        pass

    suggestions = result.get("suggested_reminders", []) or []

    cleaned = []
    for item in suggestions[:10]:
        title = (item.get("title") or "").strip()
        message = (item.get("message") or "").strip()
        suggested_for = (item.get("suggested_for") or "").strip()
        repeat = item.get("repeat") or "none"

        if not title or not message or not suggested_for:
            continue

        if repeat not in ["none", "weekly", "monthly", "yearly"]:
            repeat = "none"

        cleaned.append({
            "title": title[:160],
            "message": message[:1200],
            "suggested_for": suggested_for,
            "repeat": repeat,
            "reason": (item.get("reason") or "").strip()[:800],
        })

    return {
        "ok": True,
        "pet_id": pet_id,
        "suggested_reminders": cleaned,
    }

@router.put("/reminders/{reminder_id}", response_model=Reminder)
async def update_reminder(
    reminder_id: str,
    payload: ReminderCreate,
    user: User = Depends(get_current_user),
):
    existing = await db.reminders.find_one(
        {"reminder_id": reminder_id, "user_id": user.user_id},
        {"_id": 0}
    )

    if not existing:
        raise HTTPException(status_code=404, detail="Reminder not found")

    pet_name = ""
    if payload.pet_id:
        pet = await db.pets.find_one(
            {"pet_id": payload.pet_id, "user_id": user.user_id},
            {"_id": 0}
        )
        if pet:
            pet_name = pet.get("name", "")

    update = {
        "pet_id": payload.pet_id,
        "pet_name": pet_name,
        "title": payload.title,
        "message": payload.message or "",
        "scheduled_for": payload.scheduled_for,
        "email": payload.email or user.email,
        "repeat": payload.repeat or "none",
        "status": "pending",
        "sent_at": None,
        "last_error": None,
    }

    await db.reminders.update_one(
        {"reminder_id": reminder_id, "user_id": user.user_id},
        {"$set": update}
    )

    updated = await db.reminders.find_one(
        {"reminder_id": reminder_id, "user_id": user.user_id},
        {"_id": 0}
    )

    return Reminder(**updated)

@router.post("/reminders", response_model=Reminder)
async def create_reminder(payload: ReminderCreate, user: User = Depends(get_current_user)):
    pet_name = ""
    if payload.pet_id:
        pet = await db.pets.find_one({"pet_id": payload.pet_id, "user_id": user.user_id}, {"_id": 0})
        if not pet:
            raise HTTPException(status_code=404, detail="Pet not found")
        pet_name = pet.get("name", "")
    rem = Reminder(
        user_id=user.user_id,
        pet_id=payload.pet_id,
        pet_name=pet_name,
        title=payload.title,
        message=payload.message or "",
        scheduled_for=payload.scheduled_for,
        email=(payload.email or user.email),
        repeat=payload.repeat or "none",
    )
    await db.reminders.insert_one(rem.model_dump())
    return rem


@router.get("/reminders", response_model=List[Reminder])
async def list_reminders(user: User = Depends(get_current_user)):
    rows = await db.reminders.find({"user_id": user.user_id}, {"_id": 0}).sort("scheduled_for", 1).to_list(500)
    return [Reminder(**r) for r in rows]


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str, user: User = Depends(get_current_user)):
    await db.reminders.delete_one({"reminder_id": reminder_id, "user_id": user.user_id})
    return {"ok": True}


def _build_reminder_email_html(title: str, message: str, pet_name: str) -> str:
    pet_line = f"For <strong>{pet_name}</strong>" if pet_name else "From PetBill Shield"
    msg = (message or "").replace("\n", "<br/>")
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:Manrope,Arial,sans-serif;background:#FAF9F6;padding:24px;">
      <tr><td>
        <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#F2F0E9;border:1px solid #E5E2D9;border-radius:8px;">
          <tr><td style="padding:24px 28px;">
            <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#65635C;">Reminder · {pet_line}</div>
            <h1 style="font-family:Georgia,serif;font-weight:500;font-size:28px;color:#2D2C28;margin:8px 0 0 0;">{title}</h1>
            <p style="color:#2D2C28;line-height:1.6;margin:16px 0;">{msg}</p>
            <hr style="border:none;border-top:1px solid #E5E2D9;margin:20px 0;"/>
            <p style="color:#65635C;font-size:12px;line-height:1.6;margin:0;">PetBill Shield doesn't diagnose pets, doesn't replace your veterinarian, and never tells you to refuse care. For urgent symptoms, please seek immediate veterinary care.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """


async def _send_reminder_email(rem: dict) -> tuple[bool, str]:
    if not RESEND_API_KEY:
        return (False, "RESEND_API_KEY not configured")
    to_email = (rem.get("email") or "").strip()
    if not to_email:
        return (False, "no recipient email")
    params = {
        "from": SENDER_EMAIL,
        "to": [to_email],
        "subject": f"PetBill Shield reminder — {rem.get('title', '')}",
        "html": _build_reminder_email_html(rem.get("title", ""), rem.get("message", ""), rem.get("pet_name", "")),
    }
    try:
        resp = await asyncio.to_thread(resend.Emails.send, params)
        return (True, str(resp.get("id") if isinstance(resp, dict) else resp))
    except Exception as e:
        return (False, str(e)[:200])


async def dispatch_due_reminders():
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    try:
        cursor = db.reminders.find(
            {
                "status": "pending",
                "scheduled_for": {"$lte": now_iso},
            },
            {"_id": 0}
        ).sort("scheduled_for", 1).limit(50)

        due = await cursor.to_list(50)

        for rem in due:
            ok, info = await _send_reminder_email(rem)
            repeat = rem.get("repeat", "none")

            if ok and repeat in ["weekly", "monthly", "yearly"]:
                try:
                    old_dt = datetime.fromisoformat(rem.get("scheduled_for"))

                    if old_dt.tzinfo is None:
                        old_dt = old_dt.replace(tzinfo=timezone.utc)

                    if repeat == "weekly":
                        next_dt = old_dt + timedelta(days=7)
                    elif repeat == "monthly":
                        next_dt = old_dt + timedelta(days=30)
                    else:
                        next_dt = old_dt + timedelta(days=365)

                    while next_dt <= now:
                        if repeat == "weekly":
                            next_dt += timedelta(days=7)
                        elif repeat == "monthly":
                            next_dt += timedelta(days=30)
                        else:
                            next_dt += timedelta(days=365)

                    update = {
                        "scheduled_for": next_dt.isoformat(),
                        "status": "pending",
                        "sent_at": now_iso,
                        "last_error": None,
                    }

                except Exception:
                    update = {
                        "scheduled_for": (now + timedelta(days=7)).isoformat(),
                        "status": "pending",
                        "sent_at": now_iso,
                        "last_error": None,
                    }

                except Exception:
                    update = {
                        "scheduled_for": (now + timedelta(days=7)).isoformat(),
                        "status": "pending",
                        "sent_at": now_iso,
                        "last_error": None,
                    }

            else:
                update = {
                    "status": "sent" if ok else "failed",
                    "sent_at": now_iso if ok else None,
                    "last_error": None if ok else info,
                }

            await db.reminders.update_one(
                {"reminder_id": rem["reminder_id"]},
                {"$set": update}
            )

            if ok:
                logger.info(f"Reminder {rem['reminder_id']} processed for {rem.get('email')} ({info})")
            else:
                logger.warning(f"Reminder {rem['reminder_id']} failed: {info}")

    except Exception as e:
        logger.exception(f"dispatch_due_reminders failed: {e}")


@router.post("/reminders/dispatch-now")
async def reminders_dispatch_now(user: User = Depends(get_current_user)):
    """Manual trigger (useful for testing). Returns count of due/processed."""
    before = await db.reminders.count_documents({"status": "pending", "scheduled_for": {"$lte": datetime.now(timezone.utc).isoformat()}})
    await dispatch_due_reminders()
    after = await db.reminders.count_documents({"status": "pending", "scheduled_for": {"$lte": datetime.now(timezone.utc).isoformat()}})
    return {"processed": max(before - after, 0)}


# -------------------- PDF Export — "Print as packet" --------------------
def _build_estimate_pdf(analysis: dict) -> io.BytesIO:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, topMargin=0.6 * inch, bottomMargin=0.6 * inch, leftMargin=0.7 * inch, rightMargin=0.7 * inch)
    styles = getSampleStyleSheet()

    h1 = ParagraphStyle("h1", parent=styles["Title"], fontName="Times-Roman", fontSize=28, leading=32, textColor=colors.HexColor("#2D2C28"), spaceAfter=10)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Times-Roman", fontSize=16, leading=20, textColor=colors.HexColor("#D26D53"), spaceAfter=8, spaceBefore=18)
    body = ParagraphStyle("body", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5, leading=15, textColor=colors.HexColor("#2D2C28"))
    eyebrow = ParagraphStyle("eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=12, textColor=colors.HexColor("#65635C"))
    small = ParagraphStyle("small", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=9, leading=13, textColor=colors.HexColor("#65635C"))
    item = ParagraphStyle("item", parent=body, leftIndent=0)

    flow = []
    pet_line = f"{analysis.get('pet_name','')} · {analysis.get('pet_species','')}".strip(" ·") or "Pet not specified"
    flow.append(Paragraph("PETBILL SHIELD · ESTIMATE DEFENSE PACKET", eyebrow))
    flow.append(Paragraph("Understand your vet bill before you pay it.", h1))
    flow.append(Paragraph(pet_line, small))
    flow.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#E5E2D9"), spaceBefore=8, spaceAfter=4))

    if analysis.get("summary"):
        flow.append(Paragraph("Summary", h2))
        flow.append(Paragraph(analysis["summary"], body))

    if analysis.get("estimated_total_usd") is not None:
        flow.append(Paragraph(f"Estimated total: ${float(analysis['estimated_total_usd']):.2f}", small))

    if analysis.get("line_items"):
        flow.append(Paragraph("Line items", h2))
        rows = []
        for li in analysis["line_items"]:
            label = li.get("label", "")
            amt = li.get("amount_usd")
            amt_str = f"${float(amt):.2f}" if amt is not None else "—"
            urg = li.get("urgency", "")
            notes = li.get("notes", "")
            row = f"<b>{label}</b> &nbsp;·&nbsp; <font color='#65635C'>{amt_str}</font>"
            if urg:
                row += f" &nbsp;<font color='#8C2D14'>[{urg}]</font>"
            if notes:
                row += f"<br/><font color='#65635C' size='9'>{notes}</font>"
            rows.append(ListItem(Paragraph(row, item), leftIndent=10))
        flow.append(ListFlowable(rows, bulletType="bullet", start="–", bulletColor=colors.HexColor("#D26D53")))

    if analysis.get("urgent_now"):
        flow.append(Paragraph("Urgent today", h2))
        flow.append(ListFlowable([ListItem(Paragraph(x, body)) for x in analysis["urgent_now"]], bulletType="bullet"))

    if analysis.get("can_wait"):
        flow.append(Paragraph("May be able to wait", h2))
        flow.append(ListFlowable([ListItem(Paragraph(x, body)) for x in analysis["can_wait"]], bulletType="bullet"))

    if analysis.get("red_flags"):
        flow.append(Paragraph("Items that may need clarification", h2))
        for rf in analysis["red_flags"]:
            flow.append(Paragraph(f"<b>{rf.get('label','')}</b> &nbsp;<font color='#65635C' size='9'>[{rf.get('severity','info')}]</font>", body))
            if rf.get("why"):
                flow.append(Paragraph(rf["why"], small))
            if rf.get("ask_the_vet"):
                flow.append(Paragraph(f"<i>Ask: \"{rf['ask_the_vet']}\"</i>", body))
            flow.append(Spacer(1, 4))

    if analysis.get("questions_to_ask_vet"):
        flow.append(Paragraph("Questions to ask your vet", h2))
        ord_items = [ListItem(Paragraph(q, body)) for q in analysis["questions_to_ask_vet"]]
        flow.append(ListFlowable(ord_items, bulletType="1"))

    if analysis.get("cost_saving_options"):
        flow.append(Paragraph("Safe cost-saving options to discuss", h2))
        flow.append(ListFlowable([ListItem(Paragraph(x, body)) for x in analysis["cost_saving_options"]], bulletType="bullet"))

    if analysis.get("second_opinion_checklist"):
        flow.append(Paragraph("Second-opinion checklist", h2))
        flow.append(ListFlowable([ListItem(Paragraph(x, body)) for x in analysis["second_opinion_checklist"]], bulletType="bullet"))

    flow.append(Spacer(1, 18))
    flow.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#E5E2D9")))
    flow.append(Paragraph(analysis.get("disclaimer", SAFETY_DISCLAIMER), small))

    doc.build(flow)
    buf.seek(0)
    return buf


@router.get("/estimates/{analysis_id}/packet.pdf")
async def estimate_packet_pdf(analysis_id: str, user: User = Depends(get_current_user)):
    await require_paid_plan(user)
    row = await db.estimates.find_one({"analysis_id": analysis_id, "user_id": user.user_id}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    pdf = _build_estimate_pdf(row)
    fname = f"petbill_shield_packet_{analysis_id}.pdf"
    return StreamingResponse(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


