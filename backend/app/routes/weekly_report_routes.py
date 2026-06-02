"""AI-personalized weekly account report emails for paid subscribers."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional
from zoneinfo import ZoneInfo
import asyncio
import json
import os
import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import EmailStr

from app.shared import (
    db,
    logger,
    User,
    require_admin,
    send_resend_email,
    call_claude_json,
    datetime,
    timezone,
    timedelta,
    FRONTEND_URL,
    PLANS,
)

router = APIRouter()

WEEKLY_REPORT_TIMEZONE = "America/Chicago"
WEEKLY_REPORT_PREP_BATCH_SIZE = max(1, int(os.environ.get("WEEKLY_REPORT_PREP_BATCH_SIZE", "500")))
WEEKLY_REPORT_PREP_CONCURRENCY = max(1, int(os.environ.get("WEEKLY_REPORT_PREP_CONCURRENCY", "10")))
WEEKLY_REPORT_SEND_BATCH_SIZE = max(1, int(os.environ.get("WEEKLY_REPORT_SEND_BATCH_SIZE", "1000")))
WEEKLY_REPORT_SEND_CONCURRENCY = max(1, int(os.environ.get("WEEKLY_REPORT_SEND_CONCURRENCY", "20")))
WEEKLY_REPORT_AI_MIN_ACTIVITY_SCORE = max(0, int(os.environ.get("WEEKLY_REPORT_AI_MIN_ACTIVITY_SCORE", "3")))

WEEKLY_REPORT_SYSTEM_PROMPT = """
You are PetBill Shield.

Write a deeply personal weekly account report for a paid subscriber using only the supplied account data.

Rules:
- Never diagnose pets.
- Never replace a veterinarian.
- Never invent facts.
- Be warm, observant, and practical.
- Focus on what changed recently, what needs attention soon, what is going well, and one or two fresh suggestions.
- Avoid repeating the exact same phrasing or generic praise from the prior week's report unless the same issue is still unresolved.
- If the household has many pets, summarize the overall load and spotlight only the pets that most need attention.
- Return JSON only.

Return:
{
  "subject_line": "string",
  "preview_text": "string",
  "headline": "string",
  "overall_summary": "string",
  "account_snapshot": ["string"],
  "pet_spotlights": [
    {
      "pet_name": "string",
      "summary": "string",
      "wins": ["string"],
      "watch_items": ["string"],
      "next_steps": ["string"]
    }
  ],
  "suggested_actions": ["string"]
}
"""


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value)
        except Exception:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _fmt_short_date(value: Any, tz: ZoneInfo | None = None) -> str:
    dt = _parse_dt(value)
    if not dt:
        return "No date"
    if tz:
        dt = dt.astimezone(tz)
    return dt.strftime("%b %d")


def _safe_amount(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except Exception:
        return 0.0


def _user_is_paid(doc: dict, now_utc: datetime) -> bool:
    plan_id = doc.get("plan_id")
    if not plan_id or plan_id in ("free", "free_tier"):
        return False
    expires_at = _parse_dt(doc.get("entitlement_expires_at"))
    if expires_at and expires_at <= now_utc:
        return False
    return True


def _weekly_reports_enabled(doc: dict) -> bool:
    prefs = doc.get("prefs") or {}
    return prefs.get("weekly_reports", True)


def _week_key(local_now: datetime) -> str:
    return local_now.date().isoformat()


def _plan_label(plan_id: str | None) -> str:
    if not plan_id:
        return "Paid subscriber"
    return (PLANS.get(plan_id) or {}).get("label") or plan_id.replace("_", " ").title()


def _score_pet_snapshot(snapshot: dict) -> int:
    return (
        snapshot.get("overdue_reminders_count", 0) * 5
        + snapshot.get("due_next_7_days_count", 0) * 3
        + snapshot.get("recent_record_count", 0)
        + snapshot.get("recent_estimate_count", 0) * 2
        + snapshot.get("recent_claim_count", 0) * 2
    )


def _account_activity_score(context: dict) -> int:
    stats = context["account_stats"]
    return (
        min(stats.get("total_pets", 0), 5)
        + stats.get("recent_activity_count", 0)
        + (stats.get("overdue_reminders", 0) * 3)
        + (stats.get("upcoming_next_7_days", 0) * 2)
    )


def _should_generate_with_ai(context: dict) -> bool:
    return _account_activity_score(context) >= WEEKLY_REPORT_AI_MIN_ACTIVITY_SCORE


def _current_local_now() -> datetime:
    return datetime.now(ZoneInfo(WEEKLY_REPORT_TIMEZONE))


def _scheduled_send_local(local_now: datetime) -> datetime:
    return local_now.replace(hour=20, minute=0, second=0, microsecond=0)


def _scheduled_send_utc_iso(local_now: datetime) -> str:
    return _scheduled_send_local(local_now).astimezone(timezone.utc).isoformat()


def _normalize_report_payload(payload: dict, context: dict) -> dict:
    fallback = _fallback_report_payload(context)
    if not isinstance(payload, dict):
        return fallback

    result = {
        "subject_line": str(payload.get("subject_line") or fallback["subject_line"])[:140],
        "preview_text": str(payload.get("preview_text") or fallback["preview_text"])[:220],
        "headline": str(payload.get("headline") or fallback["headline"])[:220],
        "overall_summary": str(payload.get("overall_summary") or fallback["overall_summary"])[:2000],
        "account_snapshot": [str(x)[:240] for x in (payload.get("account_snapshot") or fallback["account_snapshot"])[:5]],
        "pet_spotlights": [],
        "suggested_actions": [str(x)[:260] for x in (payload.get("suggested_actions") or fallback["suggested_actions"])[:6]],
    }

    raw_spotlights = payload.get("pet_spotlights") or fallback["pet_spotlights"]
    for item in raw_spotlights[:4]:
        if not isinstance(item, dict):
            continue
        result["pet_spotlights"].append(
            {
                "pet_name": str(item.get("pet_name") or "Pet")[:80],
                "summary": str(item.get("summary") or "")[:900],
                "wins": [str(x)[:220] for x in (item.get("wins") or [])[:3]],
                "watch_items": [str(x)[:220] for x in (item.get("watch_items") or [])[:3]],
                "next_steps": [str(x)[:220] for x in (item.get("next_steps") or [])[:3]],
            }
        )

    if not result["pet_spotlights"]:
        result["pet_spotlights"] = fallback["pet_spotlights"]

    return result


def _fallback_report_payload(context: dict) -> dict:
    stats = context["account_stats"]
    pet_spotlights = []
    for pet in context["detailed_pets"][:3]:
        watch_items = []
        next_steps = []
        wins = []
        if pet["overdue_reminders_count"]:
            watch_items.append(f"{pet['overdue_reminders_count']} reminder(s) are overdue.")
            next_steps.append("Clear the overdue reminders first so care tasks do not slip.")
        if pet["due_next_7_days_count"]:
            watch_items.append(f"{pet['due_next_7_days_count']} reminder(s) are due in the next 7 days.")
        if pet["recent_record_titles"]:
            wins.append(f"Recent activity logged: {', '.join(pet['recent_record_titles'][:2])}.")
        if pet["upcoming_reminders"]:
            next_steps.append(f"Upcoming: {pet['upcoming_reminders'][0]['title']} on {pet['upcoming_reminders'][0]['scheduled_for']}.")
        if not next_steps:
            next_steps.append("Keep records current so next week’s report can be more specific.")
        pet_spotlights.append(
            {
                "pet_name": pet["pet_name"],
                "summary": pet["summary_line"],
                "wins": wins[:3],
                "watch_items": watch_items[:3],
                "next_steps": next_steps[:3],
            }
        )

    subject = "Your weekly PetBill Shield report"
    if stats["total_pets"] == 1 and context["detailed_pets"]:
        subject = f"Your weekly PetBill Shield report for {context['detailed_pets'][0]['pet_name']}"

    overall_summary = (
        f"You’re tracking {stats['total_pets']} pet(s), with {stats['pending_reminders']} pending reminder(s), "
        f"{stats['overdue_reminders']} overdue, and {stats['recent_activity_count']} recent account activity item(s) this week."
    )

    snapshot = [
        f"{stats['upcoming_next_7_days']} reminder(s) are due in the next 7 days.",
        f"{stats['recent_estimates_count']} bill analysis activity item(s) were logged this week.",
        f"{stats['recent_claims_count']} insurance claim activity item(s) were logged this week.",
        f"${stats['invoice_spend_30d']:.2f} in tracked invoice spend over the last 30 days.",
    ]

    actions = []
    if stats["overdue_reminders"]:
        actions.append("Review overdue reminders first and reschedule or complete what is still relevant.")
    if stats["upcoming_next_7_days"]:
        actions.append("Look ahead at the next 7 days so appointments, refills, or follow-ups are already covered.")
    if not actions:
        actions.append("Use this quieter week to tighten records, update notes, and keep your pet history current.")
    actions.append("Open the dashboard to review reminders, health timeline, and recent analyses in one place.")

    return {
        "subject_line": subject,
        "preview_text": f"{stats['upcoming_next_7_days']} upcoming reminders and {stats['recent_activity_count']} recent activity items.",
        "headline": "Your weekly pet care picture, in one place.",
        "overall_summary": overall_summary,
        "account_snapshot": snapshot,
        "pet_spotlights": pet_spotlights,
        "suggested_actions": actions,
    }


def _build_weekly_report_email_html(report: dict, context: dict) -> str:
    snapshot_items = "".join(
        f"<li style='margin:0 0 10px 0;'>{item}</li>" for item in report.get("account_snapshot", [])
    )
    action_items = "".join(
        f"<li style='margin:0 0 10px 0;'>{item}</li>" for item in report.get("suggested_actions", [])
    )

    spotlight_blocks = []
    for item in report.get("pet_spotlights", [])[:4]:
        wins = "".join(f"<li style='margin:0 0 8px 0;'>{x}</li>" for x in item.get("wins", []))
        watch = "".join(f"<li style='margin:0 0 8px 0;'>{x}</li>" for x in item.get("watch_items", []))
        next_steps = "".join(f"<li style='margin:0 0 8px 0;'>{x}</li>" for x in item.get("next_steps", []))
        spotlight_blocks.append(
            f"""
            <div style="background:#26221b;border:1px solid #3d3528;border-radius:18px;padding:20px;margin:0 0 16px 0;">
              <div style="font:400 26px Georgia,serif;color:#f4efe6;margin:0 0 10px 0;">{item.get('pet_name', 'Pet')}</div>
              <p style="margin:0 0 14px 0;color:#d9d0c3;font-size:15px;line-height:1.7;">{item.get('summary', '')}</p>
              {f"<div style='color:#89b67d;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 0;'>Going well</div><ul style='padding-left:18px;margin:0 0 14px 0;color:#d9d0c3;font-size:14px;line-height:1.6;'>{wins}</ul>" if wins else ""}
              {f"<div style='color:#f2c17a;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 0;'>Watch this week</div><ul style='padding-left:18px;margin:0 0 14px 0;color:#d9d0c3;font-size:14px;line-height:1.6;'>{watch}</ul>" if watch else ""}
              {f"<div style='color:#d47a5c;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 0;'>Suggested next steps</div><ul style='padding-left:18px;margin:0;color:#d9d0c3;font-size:14px;line-height:1.6;'>{next_steps}</ul>" if next_steps else ""}
            </div>
            """
        )

    spotlights_html = "".join(spotlight_blocks)

    return f"""
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f2e9;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f7f2e9;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#1f1b14;border:1px solid #3d3528;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:32px;border-bottom:1px solid #3d3528;">
                <div style="color:#d47a5c;font-size:12px;letter-spacing:.12em;text-transform:uppercase;">Sunday account report</div>
                <h1 style="margin:14px 0 10px;font:400 40px Georgia,serif;color:#f4efe6;">{report.get('headline', 'Your weekly pet care picture, in one place.')}</h1>
                <p style="margin:0;color:#d9d0c3;font-size:17px;line-height:1.7;">{report.get('overall_summary', '')}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 12px;">
                <div style="background:#26221b;border:1px solid #3d3528;border-radius:18px;padding:20px;">
                  <div style="color:#b9ae9b;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px 0;">This week at a glance</div>
                  <ul style="padding-left:18px;margin:0;color:#d9d0c3;font-size:15px;line-height:1.7;">
                    {snapshot_items}
                  </ul>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;">
                <div style="color:#f4efe6;font:400 30px Georgia,serif;margin:0 0 14px 0;">Pet spotlights</div>
                {spotlights_html or "<p style='color:#d9d0c3;font-size:15px;line-height:1.7;'>No standout pet updates this week yet — keep logging records and reminders to make future reports more detailed.</p>"}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 18px;">
                <div style="background:#26221b;border:1px solid #3d3528;border-radius:18px;padding:20px;">
                  <div style="color:#89b67d;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 10px 0;">Suggested next moves</div>
                  <ul style="padding-left:18px;margin:0;color:#d9d0c3;font-size:15px;line-height:1.7;">
                    {action_items}
                  </ul>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 18px;">
                <a href="{FRONTEND_URL}/dashboard" style="display:inline-block;background:#b55335;color:#fff7f0;text-decoration:none;padding:14px 22px;border-radius:14px;font-weight:600;">Open your dashboard</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <p style="margin:0;color:#8e8475;font-size:13px;line-height:1.7;">
                  PetBill Shield does not diagnose pets, does not replace your veterinarian, and never tells you to refuse care.
                  This report is here to help you stay organized, spot patterns, and prepare better questions.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


async def _build_account_context(user_doc: dict, now_utc: datetime) -> dict:
    user_id = user_doc["user_id"]
    local_tz = ZoneInfo(WEEKLY_REPORT_TIMEZONE)
    week_start_utc = (now_utc - timedelta(days=7)).isoformat()
    spend_window_utc = (now_utc - timedelta(days=30)).isoformat()
    due_window_utc = (now_utc + timedelta(days=7)).isoformat()

    pets = await db.pets.find({"user_id": user_id}, {"_id": 0}).to_list(100)
    records = await db.pet_records.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(1200)
    reminders = await db.reminders.find({"user_id": user_id}, {"_id": 0}).sort("scheduled_for", 1).to_list(400)
    estimates = await db.estimates.find(
        {"user_id": user_id, "created_at": {"$gte": week_start_utc}},
        {"_id": 0, "pet_id": 1, "pet_name": 1, "summary": 1, "created_at": 1, "estimated_total_usd": 1},
    ).sort("created_at", -1).to_list(80)
    claims = await db.claims.find(
        {"user_id": user_id, "created_at": {"$gte": week_start_utc}},
        {"_id": 0, "pet_id": 1, "pet_name": 1, "insurer": 1, "claim_status": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(80)
    comparisons = await db.estimate_comparisons.find(
        {"user_id": user_id, "created_at": {"$gte": week_start_utc}},
        {"_id": 0, "pet_id": 1, "pet_name": 1, "title": 1, "created_at": 1, "total_diff_usd": 1},
    ).sort("created_at", -1).to_list(80)

    reminders_by_pet: dict[str, list[dict]] = defaultdict(list)
    records_by_pet: dict[str, list[dict]] = defaultdict(list)
    estimates_by_pet: dict[str, list[dict]] = defaultdict(list)
    claims_by_pet: dict[str, list[dict]] = defaultdict(list)
    comparisons_by_pet: dict[str, list[dict]] = defaultdict(list)

    for row in reminders:
        if row.get("pet_id"):
            reminders_by_pet[row["pet_id"]].append(row)
    for row in records:
        if row.get("pet_id"):
            records_by_pet[row["pet_id"]].append(row)
    for row in estimates:
        if row.get("pet_id"):
            estimates_by_pet[row["pet_id"]].append(row)
    for row in claims:
        if row.get("pet_id"):
            claims_by_pet[row["pet_id"]].append(row)
    for row in comparisons:
        if row.get("pet_id"):
            comparisons_by_pet[row["pet_id"]].append(row)

    pet_snapshots = []
    invoice_spend_30d = 0.0

    for pet in pets:
        pet_id = pet["pet_id"]
        pet_records = records_by_pet.get(pet_id, [])
        pet_reminders = reminders_by_pet.get(pet_id, [])
        pet_estimates = estimates_by_pet.get(pet_id, [])
        pet_claims = claims_by_pet.get(pet_id, [])
        pet_comparisons = comparisons_by_pet.get(pet_id, [])

        overdue = []
        due_next_7 = []
        upcoming = []
        for rem in pet_reminders:
            if rem.get("status") != "pending":
                continue
            scheduled_dt = _parse_dt(rem.get("scheduled_for"))
            if not scheduled_dt:
                continue
            if scheduled_dt < now_utc:
                overdue.append(rem)
            if now_utc <= scheduled_dt <= _parse_dt(due_window_utc):
                due_next_7.append(rem)
            if scheduled_dt >= now_utc:
                upcoming.append(rem)

        recent_records = []
        recent_record_titles = []
        recent_record_count = 0
        lifetime_invoice_total = 0.0
        spend_30d = 0.0
        for rec in pet_records:
            created_dt = _parse_dt(rec.get("created_at")) or _parse_dt(rec.get("date"))
            if rec.get("record_type") == "invoice":
                amount = _safe_amount(rec.get("amount_usd"))
                lifetime_invoice_total += amount
                if created_dt and created_dt >= _parse_dt(spend_window_utc):
                    spend_30d += amount
                    invoice_spend_30d += amount
            if created_dt and created_dt >= _parse_dt(week_start_utc):
                recent_record_count += 1
                if len(recent_records) < 4:
                    recent_records.append(
                        {
                            "title": rec.get("title") or (rec.get("record_type") or "record").title(),
                            "record_type": rec.get("record_type") or "note",
                            "date": _fmt_short_date(created_dt, local_tz),
                            "amount_usd": _safe_amount(rec.get("amount_usd")),
                        }
                    )
                    recent_record_titles.append(rec.get("title") or (rec.get("record_type") or "record").title())

        pet_snapshots.append(
            {
                "pet_id": pet_id,
                "pet_name": pet.get("name") or "Pet",
                "species": pet.get("species") or "",
                "breed": pet.get("breed") or "",
                "chronic_conditions": pet.get("chronic_conditions") or [],
                "overdue_reminders_count": len(overdue),
                "due_next_7_days_count": len(due_next_7),
                "upcoming_reminders": [
                    {
                        "title": r.get("title") or "Reminder",
                        "scheduled_for": _fmt_short_date(r.get("scheduled_for"), local_tz),
                    }
                    for r in upcoming[:3]
                ],
                "recent_records": recent_records,
                "recent_record_titles": recent_record_titles,
                "recent_record_count": recent_record_count,
                "recent_estimate_count": len(pet_estimates),
                "recent_claim_count": len(pet_claims),
                "recent_comparison_count": len(pet_comparisons),
                "recent_estimates": [
                    {
                        "summary": row.get("summary") or "Estimate review",
                        "date": _fmt_short_date(row.get("created_at"), local_tz),
                    }
                    for row in pet_estimates[:2]
                ],
                "recent_claims": [
                    {
                        "status": row.get("claim_status") or "analyzed",
                        "insurer": row.get("insurer") or "Insurer",
                        "date": _fmt_short_date(row.get("created_at"), local_tz),
                    }
                    for row in pet_claims[:2]
                ],
                "recent_comparisons": [
                    {
                        "title": row.get("title") or "Comparison",
                        "date": _fmt_short_date(row.get("created_at"), local_tz),
                    }
                    for row in pet_comparisons[:2]
                ],
                "spend_30d_usd": round(spend_30d, 2),
                "lifetime_invoice_total_usd": round(lifetime_invoice_total, 2),
                "summary_line": (
                    f"{pet.get('name') or 'This pet'} has {len(upcoming)} upcoming reminder(s), "
                    f"{len(overdue)} overdue, and {recent_record_count} recent record activity item(s) this week."
                ),
            }
        )

    pet_snapshots.sort(key=lambda row: (-_score_pet_snapshot(row), row["pet_name"].lower()))
    detailed_pets = pet_snapshots[:8]

    recent_activity_count = (
        len(estimates)
        + len(claims)
        + len(comparisons)
        + sum(1 for row in records if (_parse_dt(row.get("created_at")) or _parse_dt(row.get("date"))) and (_parse_dt(row.get("created_at")) or _parse_dt(row.get("date"))) >= _parse_dt(week_start_utc))
    )

    account_stats = {
        "total_pets": len(pets),
        "pending_reminders": sum(1 for r in reminders if r.get("status") == "pending"),
        "overdue_reminders": sum(
            1 for r in reminders
            if r.get("status") == "pending"
            and (_parse_dt(r.get("scheduled_for")) and _parse_dt(r.get("scheduled_for")) < now_utc)
        ),
        "upcoming_next_7_days": sum(
            1 for r in reminders
            if r.get("status") == "pending"
            and (_parse_dt(r.get("scheduled_for")) and now_utc <= _parse_dt(r.get("scheduled_for")) <= _parse_dt(due_window_utc))
        ),
        "recent_activity_count": recent_activity_count,
        "recent_estimates_count": len(estimates),
        "recent_claims_count": len(claims),
        "recent_comparisons_count": len(comparisons),
        "invoice_spend_30d": round(invoice_spend_30d, 2),
    }

    previous_report = await db.weekly_account_reports.find_one(
        {"user_id": user_id},
        {"_id": 0, "report": 1, "week_key": 1, "sent_at": 1},
        sort=[("sent_at", -1)],
    )

    return {
        "user_name": user_doc.get("name") or user_doc.get("first_name") or "there",
        "plan_label": _plan_label(user_doc.get("plan_id")),
        "account_stats": account_stats,
        "detailed_pets": detailed_pets,
        "other_pets_count": max(0, len(pet_snapshots) - len(detailed_pets)),
        "previous_report": previous_report or {},
        "window_start": _fmt_short_date(week_start_utc, local_tz),
        "window_end": _fmt_short_date(now_utc, local_tz),
        "dashboard_url": f"{FRONTEND_URL}/dashboard",
    }


async def _generate_weekly_report_payload(context: dict) -> dict:
    if not _should_generate_with_ai(context):
        return _fallback_report_payload(context)

    prompt = f"""
Account owner: {context['user_name']}
Plan: {context['plan_label']}
Reporting window: {context['window_start']} to {context['window_end']}

Account stats:
{json.dumps(context['account_stats'], default=str)}

Detailed pet snapshots:
{json.dumps(context['detailed_pets'], default=str)}

Other pets not expanded in detail:
{context['other_pets_count']}

Previous report summary:
{json.dumps(context.get('previous_report') or {}, default=str)}

Write this week's account report now.
"""
    try:
        result = await call_claude_json(
            WEEKLY_REPORT_SYSTEM_PROMPT,
            prompt,
            max_tokens=1800,
        )
        return _normalize_report_payload(result, context)
    except Exception as exc:
        logger.warning(f"weekly report AI generation failed: {exc}")
        return _fallback_report_payload(context)


async def enqueue_weekly_account_reports(
    *,
    target_email: Optional[str] = None,
    force: bool = False,
) -> dict:
    local_now = _current_local_now()
    now_utc = datetime.now(timezone.utc)
    week_key = _week_key(local_now)
    scheduled_send_at = _scheduled_send_utc_iso(local_now)
    query: dict[str, Any] = {"plan_id": {"$nin": ["free", "free_tier", None, ""]}}
    if target_email:
        query["email"] = target_email.strip().lower()

    projection = {
        "_id": 0,
        "user_id": 1,
        "email": 1,
        "name": 1,
        "first_name": 1,
        "plan_id": 1,
        "entitlement_expires_at": 1,
        "prefs": 1,
    }

    processed = created = updated = skipped = 0
    cursor = db.users.find(query, projection)
    async for user_doc in cursor:
        processed += 1
        user_id = user_doc["user_id"]
        existing = await db.weekly_report_jobs.find_one(
            {"user_id": user_id, "week_key": week_key},
            {"_id": 0, "status": 1},
        )
        if existing and existing.get("status") in {"queued", "prepared", "sent"} and not force:
            skipped += 1
            continue

        job_doc = {
            "job_id": f"wrj_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "email": (user_doc.get("email") or "").strip().lower(),
            "plan_id": user_doc.get("plan_id"),
            "week_key": week_key,
            "timezone": WEEKLY_REPORT_TIMEZONE,
            "scheduled_send_at": scheduled_send_at,
            "status": "queued",
            "created_at": now_utc.isoformat(),
            "updated_at": now_utc.isoformat(),
            "generation_attempts": 0,
            "send_attempts": 0,
            "last_error": None,
            "report": None,
            "context_stats": None,
            "generation_mode": None,
        }
        await db.weekly_report_jobs.update_one(
            {"user_id": user_id, "week_key": week_key},
            {"$set": job_doc},
            upsert=True,
        )
        if existing:
            updated += 1
        else:
            created += 1

    summary = {
        "ok": True,
        "week_key": week_key,
        "timezone": WEEKLY_REPORT_TIMEZONE,
        "processed": processed,
        "queued_created": created,
        "queued_updated": updated,
        "skipped": skipped,
        "forced": force,
        "target_email": target_email,
    }
    logger.info(f"weekly account report enqueue complete: {summary}")
    return summary


async def _prepare_weekly_report_job(job: dict, local_now: datetime, force: bool = False) -> dict:
    now_utc = datetime.now(timezone.utc)
    user_id = job["user_id"]
    user_doc = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "first_name": 1, "plan_id": 1, "entitlement_expires_at": 1, "prefs": 1},
    ) or {}

    if not user_doc:
        await db.weekly_report_jobs.update_one(
            {"job_id": job["job_id"]},
            {"$set": {"status": "skipped", "last_error": "user_not_found", "updated_at": now_utc.isoformat()}},
        )
        return {"status": "skipped", "reason": "user_not_found"}

    if not _user_is_paid(user_doc, now_utc):
        await db.weekly_report_jobs.update_one(
            {"job_id": job["job_id"]},
            {"$set": {"status": "skipped", "last_error": "not_paid", "updated_at": now_utc.isoformat()}},
        )
        return {"status": "skipped", "reason": "not_paid"}

    if not _weekly_reports_enabled(user_doc):
        await db.weekly_report_jobs.update_one(
            {"job_id": job["job_id"]},
            {"$set": {"status": "skipped", "last_error": "pref_disabled", "updated_at": now_utc.isoformat()}},
        )
        return {"status": "skipped", "reason": "pref_disabled"}

    if not force:
        existing_sent = await db.weekly_account_reports.find_one(
            {"user_id": user_id, "week_key": job["week_key"]},
            {"_id": 0, "report_id": 1},
        )
        if existing_sent:
            await db.weekly_report_jobs.update_one(
                {"job_id": job["job_id"]},
                {"$set": {"status": "sent", "updated_at": now_utc.isoformat(), "last_error": None}},
            )
            return {"status": "skipped", "reason": "already_sent"}

    context = await _build_account_context(user_doc, now_utc)
    report = await _generate_weekly_report_payload(context)
    generation_mode = "ai" if _should_generate_with_ai(context) else "fallback"

    await db.weekly_report_jobs.update_one(
        {"job_id": job["job_id"]},
        {
            "$set": {
                "status": "prepared",
                "email": (user_doc.get("email") or "").strip().lower(),
                "plan_id": user_doc.get("plan_id"),
                "report": report,
                "context_stats": context["account_stats"],
                "generation_mode": generation_mode,
                "prepared_at": now_utc.isoformat(),
                "updated_at": now_utc.isoformat(),
                "last_error": None,
            },
            "$inc": {"generation_attempts": 1},
        },
    )
    return {"status": "prepared", "reason": generation_mode}


async def prepare_weekly_account_report_batch(
    *,
    target_email: Optional[str] = None,
    force: bool = False,
    limit: int = WEEKLY_REPORT_PREP_BATCH_SIZE,
) -> dict:
    local_now = _current_local_now()
    week_key = _week_key(local_now)
    query: dict[str, Any] = {
        "week_key": week_key,
        "status": {"$in": ["queued", "failed_prepare"]},
    }
    if target_email:
        query["email"] = target_email.strip().lower()

    jobs = await db.weekly_report_jobs.find(query, {"_id": 0}).sort("created_at", 1).to_list(limit)
    if not jobs:
        return {"ok": True, "week_key": week_key, "processed": 0, "prepared": 0, "skipped": 0, "failed": 0}

    semaphore = asyncio.Semaphore(WEEKLY_REPORT_PREP_CONCURRENCY)

    async def _runner(job: dict):
        async with semaphore:
            try:
                return await _prepare_weekly_report_job(job, local_now, force=force)
            except Exception as exc:
                await db.weekly_report_jobs.update_one(
                    {"job_id": job["job_id"]},
                    {
                        "$set": {
                            "status": "failed_prepare",
                            "last_error": str(exc)[:500],
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                        "$inc": {"generation_attempts": 1},
                    },
                )
                return {"status": "failed", "reason": str(exc)}

    results = await asyncio.gather(*(_runner(job) for job in jobs))
    prepared = sum(1 for r in results if r.get("status") == "prepared")
    skipped = sum(1 for r in results if r.get("status") == "skipped")
    failed = sum(1 for r in results if r.get("status") == "failed")
    summary = {
        "ok": True,
        "week_key": week_key,
        "processed": len(jobs),
        "prepared": prepared,
        "skipped": skipped,
        "failed": failed,
        "target_email": target_email,
    }
    logger.info(f"weekly account report prepare batch complete: {summary}")
    return summary


async def _send_prepared_weekly_report_job(job: dict, local_now: datetime) -> dict:
    now_utc = datetime.now(timezone.utc)
    email = (job.get("email") or "").strip()
    if not email:
        await db.weekly_report_jobs.update_one(
            {"job_id": job["job_id"]},
            {"$set": {"status": "failed_send", "last_error": "missing_email", "updated_at": now_utc.isoformat()}},
        )
        return {"status": "failed", "reason": "missing_email"}

    report = job.get("report") or {}
    context = {"account_stats": job.get("context_stats") or {}, "detailed_pets": []}
    html = _build_weekly_report_email_html(report, context)
    await send_resend_email(
        to=email,
        subject=report.get("subject_line") or "Your weekly PetBill Shield report",
        html=html,
    )

    report_doc = {
        "report_id": f"wrp_{uuid.uuid4().hex[:12]}",
        "user_id": job["user_id"],
        "email": email,
        "plan_id": job.get("plan_id"),
        "week_key": job["week_key"],
        "timezone": WEEKLY_REPORT_TIMEZONE,
        "report": report,
        "context_stats": job.get("context_stats"),
        "created_at": job.get("prepared_at") or now_utc.isoformat(),
        "sent_at": now_utc.isoformat(),
        "generation_mode": job.get("generation_mode"),
    }
    await db.weekly_account_reports.update_one(
        {"user_id": job["user_id"], "week_key": job["week_key"]},
        {"$set": report_doc},
        upsert=True,
    )
    await db.weekly_report_jobs.update_one(
        {"job_id": job["job_id"]},
        {
            "$set": {
                "status": "sent",
                "sent_at": now_utc.isoformat(),
                "updated_at": now_utc.isoformat(),
                "last_error": None,
            },
            "$inc": {"send_attempts": 1},
        },
    )
    return {"status": "sent", "reason": "ok"}


async def send_due_weekly_account_reports(
    *,
    target_email: Optional[str] = None,
    force: bool = False,
    immediate: bool = False,
    limit: int = WEEKLY_REPORT_SEND_BATCH_SIZE,
) -> dict:
    local_now = _current_local_now()
    now_utc = datetime.now(timezone.utc)
    week_key = _week_key(local_now)
    query: dict[str, Any] = {
        "week_key": week_key,
        "status": {"$in": ["prepared", "failed_send"]},
    }
    if not immediate:
        query["scheduled_send_at"] = {"$lte": now_utc.isoformat()}
    if target_email:
        query["email"] = target_email.strip().lower()

    jobs = await db.weekly_report_jobs.find(query, {"_id": 0}).sort("prepared_at", 1).to_list(limit)
    if not jobs:
        return {"ok": True, "week_key": week_key, "processed": 0, "sent": 0, "failed": 0, "skipped": 0}

    semaphore = asyncio.Semaphore(WEEKLY_REPORT_SEND_CONCURRENCY)

    async def _runner(job: dict):
        async with semaphore:
            try:
                return await _send_prepared_weekly_report_job(job, local_now)
            except Exception as exc:
                await db.weekly_report_jobs.update_one(
                    {"job_id": job["job_id"]},
                    {
                        "$set": {
                            "status": "failed_send",
                            "last_error": str(exc)[:500],
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                        "$inc": {"send_attempts": 1},
                    },
                )
                return {"status": "failed", "reason": str(exc)}

    results = await asyncio.gather(*(_runner(job) for job in jobs))
    sent = sum(1 for r in results if r.get("status") == "sent")
    failed = sum(1 for r in results if r.get("status") == "failed")
    skipped = sum(1 for r in results if r.get("status") == "skipped")
    summary = {
        "ok": True,
        "week_key": week_key,
        "processed": len(jobs),
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "target_email": target_email,
        "immediate": immediate,
        "forced": force,
    }
    logger.info(f"weekly account report send batch complete: {summary}")
    return summary


async def dispatch_weekly_account_reports(
    *,
    target_email: Optional[str] = None,
    force: bool = False,
) -> dict:
    enqueue = await enqueue_weekly_account_reports(target_email=target_email, force=force)
    prepare = await prepare_weekly_account_report_batch(
        target_email=target_email,
        force=force,
        limit=1 if target_email else min(WEEKLY_REPORT_PREP_BATCH_SIZE, 50),
    )
    send = await send_due_weekly_account_reports(
        target_email=target_email,
        force=force,
        immediate=True,
        limit=1 if target_email else min(WEEKLY_REPORT_SEND_BATCH_SIZE, 50),
    )
    return {"ok": True, "enqueue": enqueue, "prepare": prepare, "send": send}


@router.post("/admin/weekly-reports/dispatch-now")
async def admin_dispatch_weekly_reports_now(
    target_email: Optional[EmailStr] = Query(default=None),
    force: bool = Query(default=False),
    immediate: bool = Query(default=False),
    user: User = Depends(require_admin),
):
    _ = user
    target = str(target_email) if target_email else None
    if immediate:
        return await dispatch_weekly_account_reports(
            target_email=target,
            force=force,
        )
    return await enqueue_weekly_account_reports(
        target_email=target,
        force=force,
    )
