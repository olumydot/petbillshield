from fastapi import APIRouter
from app.shared import *

router = APIRouter()

# -------------------- Question Script Generator --------------------
SCRIPT_SYSTEM_PROMPT = """You are PetBill Shield's question-script writer. The user is preparing to call/visit a vet and may be stressed.
Write a kind, polite, professional script that the user can read aloud or paraphrase.
Always include:
- a respectful greeting and brief context
- a clear ask for clarification on the estimate
- a polite request for what's urgent today vs what can wait
- a request for any lower-cost alternatives (generic medication, staged treatment, payment plans)
- a thank-you closing

Return STRICT JSON only:
{
  "script": "string — the script (3-6 short paragraphs)",
  "follow_up_questions": ["string"]
}
No markdown fences."""


COMPARE_RECOMMENDATION_SYSTEM_PROMPT = """
You are PetBill Shield.

You compare two veterinary estimates and give a careful, plain-English suggestion.

Rules:
- Do not diagnose.
- Do not replace a veterinarian.
- Do not guarantee the cheaper option is better.
- Consider total cost, urgent items, repeated items, missing items, red flags, questions to ask, and whether one estimate seems more complete.
- Be cautious and practical.
- Always remind the user that the final decision rests with them and their veterinarian.

Return strict JSON only:
{
  "recommended_side": "a" | "b" | "neither" | "unclear",
  "title": "string",
  "summary": "string",
  "reasons": ["string"],
  "questions_to_ask": ["string"],
  "medical_caution": "string"
}
"""

@router.post("/scripts/generate", response_model=ScriptResponse)
async def generate_script(payload: ScriptRequest, user: User = Depends(get_current_user)):
    await require_paid_plan(user)
    await enforce_ai_usage_limit(user, "script")

    prompt = (
        f"Situation: {payload.situation}\n"
        f"Tone: {payload.tone}\n"
        f"Pet: {payload.pet_name or 'my pet'} ({payload.pet_species or 'unspecified'})\n"
        f"Estimated cost: {payload.estimated_cost_usd if payload.estimated_cost_usd is not None else 'unspecified'} USD\n"
        "Return JSON only."
    )

    try:
        result = await call_claude_json(SCRIPT_SYSTEM_PROMPT, prompt, max_tokens=1800)
    except Exception as e:
        logger.exception("Script generation failed")
        raise HTTPException(status_code=500, detail="AI generation failed. Please try again.")

    script_text = result.get("script", "")
    follow_ups  = result.get("follow_up_questions", []) or []

    # Track AI usage (for analytics; paid users are not capped but we still log)
    try:
        await record_ai_usage(user, "script")
    except Exception:
        pass

    # Persist to DB so user can review history
    try:
        await db.scripts.insert_one({
            "script_id":            str(uuid.uuid4()),
            "user_id":              user.user_id,
            "situation":            payload.situation,
            "tone":                 payload.tone,
            "pet_name":             payload.pet_name or "",
            "pet_species":          payload.pet_species or "",
            "estimated_cost_usd":   payload.estimated_cost_usd,
            "script":               script_text,
            "follow_up_questions":  follow_ups,
            "created_at":           datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        logger.warning("Could not persist generated script", exc_info=True)

    return ScriptResponse(script=script_text, follow_up_questions=follow_ups)


@router.get("/scripts")
async def list_scripts(user: User = Depends(get_current_user)):
    """Return the 50 most-recent scripts for the current user."""
    rows = await db.scripts.find(
        {"user_id": user.user_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return {"scripts": rows}


@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str, user: User = Depends(get_current_user)):
    res = await db.scripts.delete_one({"script_id": script_id, "user_id": user.user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Script not found.")
    return {"ok": True}


