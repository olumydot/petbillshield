import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ROUTE_FILE = BACKEND_ROOT / "app" / "routes" / "billing_routes.py"


def _load_pending_downgrade_guard():
    source = ROUTE_FILE.read_text()
    module = ast.parse(source, filename=str(ROUTE_FILE))
    target = None
    for node in module.body:
        if isinstance(node, ast.FunctionDef) and node.name == "_pending_downgrade_is_due":
            target = node
            break

    assert target is not None, "Missing _pending_downgrade_is_due helper"

    isolated = ast.Module(body=[target], type_ignores=[])
    ast.fix_missing_locations(isolated)
    namespace = {
        "datetime": datetime,
        "timezone": timezone,
        "Optional": __import__("typing").Optional,
    }
    exec(compile(isolated, str(ROUTE_FILE), "exec"), namespace)
    return namespace["_pending_downgrade_is_due"]


def test_pending_downgrade_is_due_only_after_scheduled_time():
    guard = _load_pending_downgrade_guard()
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
    guard = _load_pending_downgrade_guard()
    now = datetime(2026, 5, 31, 18, 0, tzinfo=timezone.utc)

    assert guard({}, now=now) is False
    assert guard({"pending_downgrade_at": ""}, now=now) is False
    assert guard({"pending_downgrade_at": "not-a-date"}, now=now) is False


def test_subscription_updated_webhook_uses_due_guard():
    source = ROUTE_FILE.read_text()
    assert "and _pending_downgrade_is_due(user_doc)" in source
