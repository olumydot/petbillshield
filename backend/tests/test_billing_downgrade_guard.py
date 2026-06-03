import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ROUTE_FILE = BACKEND_ROOT / "app" / "routes" / "billing_routes.py"


def _load_function(name: str, extra_namespace: dict | None = None):
    source = ROUTE_FILE.read_text()
    module = ast.parse(source, filename=str(ROUTE_FILE))
    target = None
    for node in module.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            target = node
            break

    assert target is not None, f"Missing {name} helper"

    isolated = ast.Module(body=[target], type_ignores=[])
    ast.fix_missing_locations(isolated)
    namespace = {
        "datetime": datetime,
        "timezone": timezone,
        "Optional": Optional,
    }
    if extra_namespace:
        namespace.update(extra_namespace)
    exec(compile(isolated, str(ROUTE_FILE), "exec"), namespace)
    return namespace[name]


def test_pending_downgrade_is_due_only_after_scheduled_time():
    guard = _load_function("_pending_downgrade_is_due")
    now = datetime(2026, 5, 31, 18, 0, tzinfo=timezone.utc)

    future_doc = {
        "pending_downgrade_at": (now + timedelta(minutes=5)).isoformat(),
    }
    past_doc = {
        "pending_downgrade_at": (now - timedelta(minutes=5)).isoformat(),
    }

    assert guard(future_doc, now=now) is False
    assert guard(past_doc, now=now) is True


def test_pending_downgrade_is_due_is_false_without_valid_timestamp():
    guard = _load_function("_pending_downgrade_is_due")
    now = datetime(2026, 5, 31, 18, 0, tzinfo=timezone.utc)

    assert guard({}, now=now) is False
    assert guard({"pending_downgrade_at": ""}, now=now) is False
    assert guard({"pending_downgrade_at": "not-a-date"}, now=now) is False


def test_subscription_updated_webhook_uses_due_guard():
    source = ROUTE_FILE.read_text()
    assert "and _pending_downgrade_is_due(user_doc)" in source


def test_subscription_creation_conflict_detail_blocks_in_progress_states():
    guard = _load_function(
        "_subscription_creation_conflict_detail",
        extra_namespace={
            "_BLOCKING_SUBSCRIPTION_STATUSES": {
                "active",
                "trialing",
                "past_due",
                "unpaid",
                "incomplete",
            }
        },
    )

    assert guard({}) is None
    assert "active subscription" in guard({
        "stripe_subscription_id": "sub_123",
        "subscription_status": "active",
    })
    assert "checkout in progress" in guard({
        "stripe_subscription_id": "sub_123",
        "subscription_status": "incomplete",
    })
    assert "payment attention" in guard({
        "stripe_subscription_id": "sub_123",
        "subscription_status": "past_due",
    })


def test_should_send_renewal_success_email_only_for_true_renewals():
    guard = _load_function("_should_send_renewal_success_email")

    assert guard({"billing_reason": "subscription_cycle"}, "2026-06-01T00:00:00+00:00") is True
    assert guard({"billing_reason": "subscription_update"}, "2026-06-01T00:00:00+00:00") is False
    assert guard({"billing_reason": "subscription_create"}, "2026-06-01T00:00:00+00:00") is False
    assert guard({"billing_reason": "subscription_cycle"}, None) is False


def test_source_contains_new_billing_safety_guards():
    source = ROUTE_FILE.read_text()
    assert 'pi_status != "succeeded"' in source
    assert "Reactivate it before changing plans" in source
    assert '"pending_downgrade_plan_id": ""' in source


def test_checkout_success_paths_share_once_only_welcome_email_guard():
    source = ROUTE_FILE.read_text()
    assert "async def _queue_welcome_email_once(" in source
    assert source.count("await _queue_welcome_email_once(") >= 2


def test_missing_stripe_subscription_is_self_healed():
    source = ROUTE_FILE.read_text()
    assert "async def _clear_stale_missing_subscription(" in source
    assert "if _is_missing_subscription_error(e):" in source
    assert source.count("await _clear_stale_missing_subscription(") >= 3


def test_missing_stripe_customer_is_self_healed():
    source = ROUTE_FILE.read_text()
    assert "async def _clear_stale_missing_customer(" in source
    assert "async def _get_or_create_stripe_customer(" in source
    assert "if stripe_value(existing, \"deleted\", False):" in source
    assert "sess_kwargs[\"customer\"] = stripe_customer_id" in source
    assert source.count("await _get_or_create_stripe_customer(") >= 3
