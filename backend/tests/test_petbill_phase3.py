"""Phase 3 backend tests for PetBill Shield: Shares, Trends, Compare, Contact, Admin."""
import json
import time
import re
import subprocess
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests


# --------------------- helpers ---------------------
def _no_leaks(payload, keys=("_id",)):
    blob = json.dumps(payload, default=str)
    for k in keys:
        assert f'"{k}"' not in blob, f"{k} leaked: {blob[:400]}"


def _mongosh(script: str) -> str:
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", f"use('test_database');{script}"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout


def _now_iso(dt: datetime = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _insert_estimate(user_id: str, line_items: list, total: float, pet_id: str = None) -> str:
    analysis_id = f"est_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "analysis_id": analysis_id,
        "user_id": user_id,
        "pet_id": pet_id,
        "pet_name": "TEST_Pet",
        "pet_species": "dog",
        "source_type": "text",
        "original_filename": "",
        "raw_text_excerpt": "TEST_estimate",
        "summary": "TEST summary",
        "estimated_total_usd": total,
        "line_items": line_items,
        "red_flags": [],
        "urgent_now": [],
        "can_wait": [],
        "questions_to_ask_vet": [],
        "cost_saving_options": [],
        "second_opinion_checklist": [],
        "disclaimer": "TEST",
        "created_at": _now_iso(),
    }
    _mongosh(f"db.estimates.insertOne({json.dumps(doc)});")
    return analysis_id


def _insert_pet_record(user_id: str, pet_id: str, amount: float, when: datetime):
    rec_id = f"rec_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "record_id": rec_id,
        "user_id": user_id,
        "pet_id": pet_id,
        "record_type": "invoice",
        "title": "TEST invoice",
        "notes": "",
        "amount_usd": amount,
        "date": _now_iso(when),
        "created_at": _now_iso(),
    }
    _mongosh(f"db.pet_records.insertOne({json.dumps(doc)});")
    return rec_id


def _insert_pet(user_id: str, name: str) -> str:
    pet_id = f"pet_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "pet_id": pet_id,
        "user_id": user_id,
        "name": name,
        "species": "dog",
        "breed": "Mix",
        "age_years": 3,
        "created_at": _now_iso(),
    }
    _mongosh(f"db.pets.insertOne({json.dumps(doc)});")
    return pet_id


# --------------------- admin fixture ---------------------
@pytest.fixture(scope="module")
def admin_user():
    ts = int(time.time() * 1000)
    user_id = f"test-admin-{ts}"
    token = f"test_admin_session_{ts}"
    email = "olutaiwo.oni@gmail.com"  # matches ADMIN_EMAILS env
    script = (
        f"db.users.insertOne({{user_id:'{user_id}',email:'{email}',name:'TEST Admin',"
        f"picture:'',created_at:new Date().toISOString()}});"
        f"db.user_sessions.insertOne({{user_id:'{user_id}',session_token:'{token}',"
        f"expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString(),"
        f"created_at:new Date().toISOString()}});"
    )
    _mongosh(script)
    yield {"user_id": user_id, "token": token, "email": email}
    # cleanup
    cleanup = (
        f"db.user_sessions.deleteMany({{user_id:'{user_id}'}});"
        f"db.users.deleteMany({{user_id:'{user_id}'}});"
        f"db.pets.deleteMany({{user_id:'{user_id}'}});"
        f"db.pet_records.deleteMany({{user_id:'{user_id}'}});"
        f"db.estimates.deleteMany({{user_id:'{user_id}'}});"
        f"db.shares.deleteMany({{user_id:'{user_id}'}});"
    )
    _mongosh(cleanup)


@pytest.fixture(scope="module")
def admin_client(admin_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_user['token']}"})
    return s


# --------------------- module-scoped cleanup ---------------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup_phase3(seeded_user):
    yield
    uid = seeded_user["user_id"]
    _mongosh(
        f"db.shares.deleteMany({{user_id:'{uid}'}});"
        f"db.estimates.deleteMany({{user_id:'{uid}'}});"
        f"db.pet_records.deleteMany({{user_id:'{uid}'}});"
        f"db.pets.deleteMany({{user_id:'{uid}'}});"
        f"db.contact_messages.deleteMany({{email:/TEST_/}});"
    )


# =====================================================================
# Shares
# =====================================================================
class TestShares:
    def test_share_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/estimates/est_TEST_xxx/share")
        assert r.status_code == 401

    def test_share_404_for_unknown_estimate(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/estimates/est_does_not_exist/share")
        assert r.status_code == 404

    def test_create_share_and_idempotent(self, base_url, auth_client, seeded_user):
        aid = _insert_estimate(seeded_user["user_id"],
                               [{"label": "Exam", "amount_usd": 80.0}], 80.0)
        r = auth_client.post(f"{base_url}/api/estimates/{aid}/share")
        assert r.status_code == 200, r.text
        s1 = r.json()
        _no_leaks(s1)
        assert s1["share_id"].startswith("shr_")
        assert re.fullmatch(r"[0-9a-f]{18}", s1["slug"]), f"bad slug: {s1['slug']}"
        assert s1["revoked"] is False
        assert s1["view_count"] == 0
        assert s1["analysis_id"] == aid

        # idempotent
        r2 = auth_client.post(f"{base_url}/api/estimates/{aid}/share")
        assert r2.status_code == 200
        s2 = r2.json()
        assert s2["share_id"] == s1["share_id"], "create_share not idempotent"
        assert s2["slug"] == s1["slug"]

    def test_list_shares(self, base_url, auth_client, seeded_user):
        aid = _insert_estimate(seeded_user["user_id"], [{"label": "X", "amount_usd": 10}], 10)
        rc = auth_client.post(f"{base_url}/api/estimates/{aid}/share")
        sid = rc.json()["share_id"]
        r = auth_client.get(f"{base_url}/api/shares")
        assert r.status_code == 200
        rows = r.json()
        _no_leaks(rows)
        assert any(row["share_id"] == sid for row in rows)

    def test_public_share_no_auth_strips_user_id_and_increments_views(self, base_url, auth_client, seeded_user):
        aid = _insert_estimate(seeded_user["user_id"],
                               [{"label": "Bloodwork", "amount_usd": 145.0}], 145.0)
        rc = auth_client.post(f"{base_url}/api/estimates/{aid}/share")
        slug = rc.json()["slug"]

        # PUBLIC call without any auth header
        r1 = requests.get(f"{base_url}/api/public/analysis/{slug}")
        assert r1.status_code == 200, r1.text
        body = r1.json()
        _no_leaks(body, keys=("_id", "user_id"))
        assert "analysis" in body and "share" in body
        # extra explicit check on analysis sub-object
        assert "user_id" not in body["analysis"]
        assert body["analysis"]["analysis_id"] == aid
        v1 = body["share"]["view_count"]
        assert v1 == 1

        r2 = requests.get(f"{base_url}/api/public/analysis/{slug}")
        assert r2.status_code == 200
        assert r2.json()["share"]["view_count"] == v1 + 1

    def test_revoke_share_then_public_404(self, base_url, auth_client, seeded_user):
        aid = _insert_estimate(seeded_user["user_id"], [{"label": "Z", "amount_usd": 5}], 5)
        rc = auth_client.post(f"{base_url}/api/estimates/{aid}/share")
        share = rc.json()
        sid, slug = share["share_id"], share["slug"]
        rd = auth_client.delete(f"{base_url}/api/shares/{sid}")
        assert rd.status_code == 200
        # public call now 404
        r = requests.get(f"{base_url}/api/public/analysis/{slug}")
        assert r.status_code == 404


# =====================================================================
# Stats trends
# =====================================================================
class TestStatsTrends:
    def test_trends_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/stats/trends?months=6")
        assert r.status_code == 401

    def test_trends_buckets_structure_and_totals(self, base_url, auth_client, seeded_user):
        uid = seeded_user["user_id"]
        # clear previous records for clean math
        _mongosh(f"db.pet_records.deleteMany({{user_id:'{uid}'}});")
        pet_id = _insert_pet(uid, "TEST_TrendDog")

        now = datetime.now(timezone.utc)
        # current month: 100 + 50 = 150
        _insert_pet_record(uid, pet_id, 100.0, now)
        _insert_pet_record(uid, pet_id, 50.0, now - timedelta(days=1))
        # 1 month ago: 75
        prev = now.replace(day=15) - timedelta(days=30)
        _insert_pet_record(uid, pet_id, 75.0, prev)

        r = auth_client.get(f"{base_url}/api/stats/trends?months=6")
        assert r.status_code == 200, r.text
        data = r.json()
        _no_leaks(data)
        assert data["months"] == 6
        assert isinstance(data["buckets"], list) and len(data["buckets"]) == 6
        for b in data["buckets"]:
            for k in ("key", "year", "month", "label", "total_usd", "by_pet"):
                assert k in b, f"bucket missing {k}: {b}"

        # current month bucket is the last
        current_bucket = data["buckets"][-1]
        assert current_bucket["year"] == now.year and current_bucket["month"] == now.month
        assert current_bucket["total_usd"] == 150.0
        assert current_bucket["by_pet"].get("TEST_TrendDog") == 150.0

        assert data["total_usd"] == round(150.0 + 75.0, 2)
        assert data["by_pet_totals"].get("TEST_TrendDog") == 225.0


# =====================================================================
# Compare estimates
# =====================================================================
class TestCompareEstimates:
    def test_compare_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/estimates/compare", json={"a_id": "x", "b_id": "y"})
        assert r.status_code == 401

    def test_compare_404_if_not_owned(self, base_url, auth_client, seeded_user):
        aid = _insert_estimate(seeded_user["user_id"], [{"label": "X", "amount_usd": 1}], 1)
        r = auth_client.post(f"{base_url}/api/estimates/compare",
                             json={"a_id": aid, "b_id": "est_does_not_exist"})
        assert r.status_code == 404

    def test_compare_rows_and_diffs(self, base_url, auth_client, seeded_user):
        a_items = [
            {"label": "Exam", "amount_usd": 80.0, "urgency": "now"},
            {"label": "Bloodwork", "amount_usd": 145.0, "urgency": "now"},
            {"label": "OnlyA", "amount_usd": 25.0, "urgency": "later"},
        ]
        b_items = [
            {"label": "exam", "amount_usd": 100.0, "urgency": "now"},  # case-insensitive
            {"label": "Bloodwork", "amount_usd": 150.0, "urgency": "now"},
            {"label": "OnlyB", "amount_usd": 60.0, "urgency": "later"},
        ]
        a_id = _insert_estimate(seeded_user["user_id"], a_items, 250.0)
        b_id = _insert_estimate(seeded_user["user_id"], b_items, 310.0)

        r = auth_client.post(f"{base_url}/api/estimates/compare",
                             json={"a_id": a_id, "b_id": b_id})
        assert r.status_code == 200, r.text
        data = r.json()
        _no_leaks(data)
        for k in ("a", "b", "rows", "a_total", "b_total", "total_diff_usd"):
            assert k in data
        assert data["a_total"] == 250.0
        assert data["b_total"] == 310.0
        assert data["total_diff_usd"] == 60.0

        by_label = {row["label"].lower(): row for row in data["rows"]}
        assert "exam" in by_label
        exam = by_label["exam"]
        assert exam["in_both"] is True
        assert exam["only_in"] is None
        assert exam["a_amount_usd"] == 80.0
        assert exam["b_amount_usd"] == 100.0
        assert exam["diff_usd"] == 20.0

        bw = by_label["bloodwork"]
        assert bw["in_both"] is True
        assert bw["diff_usd"] == 5.0

        only_a = by_label["onlya"]
        assert only_a["in_both"] is False
        assert only_a["only_in"] == "a"
        assert only_a["a_amount_usd"] == 25.0 and only_a["b_amount_usd"] is None

        only_b = by_label["onlyb"]
        assert only_b["only_in"] == "b"


# =====================================================================
# Contact
# =====================================================================
class TestContact:
    def test_contact_public_and_persists(self, base_url):
        payload = {
            "name": "TEST_Sender",
            "email": "TEST_sender@example.com",
            "subject": "TEST subject",
            "message": "Hello from automated test.",
        }
        r = requests.post(f"{base_url}/api/contact", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_leaks(data)
        assert data["ok"] is True
        cid = data["contact_id"]
        assert cid.startswith("ctc_")
        # delivered may be true OR false (Resend test mode) — both acceptable
        assert "delivered" in data

        # Verify DB row exists
        out = _mongosh(
            f"printjson(db.contact_messages.findOne({{contact_id:'{cid}'}},{{_id:0}}));"
        )
        assert cid in out, f"contact row missing: {out[:400]}"
        assert "TEST_Sender" in out
        assert "TEST_sender@example.com" in out

    def test_contact_validates_email(self, base_url):
        r = requests.post(f"{base_url}/api/contact", json={
            "name": "bad",
            "email": "not-an-email",
            "subject": "x",
            "message": "y",
        })
        assert r.status_code == 422


# =====================================================================
# Admin
# =====================================================================
class TestAdmin:
    def test_auth_me_includes_is_admin_for_regular(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert "is_admin" in data
        assert data["is_admin"] is False

    def test_auth_me_includes_is_admin_for_admin(self, base_url, admin_client, admin_user):
        r = admin_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["is_admin"] is True
        assert data["email"] == admin_user["email"]

    def test_admin_check_regular_false(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/admin/check")
        assert r.status_code == 200
        assert r.json()["is_admin"] is False

    def test_admin_check_admin_true(self, base_url, admin_client):
        r = admin_client.get(f"{base_url}/api/admin/check")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_admin_metrics_requires_admin(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/admin/metrics")
        assert r.status_code == 403

    def test_admin_metrics_admin_ok(self, base_url, admin_client):
        r = admin_client.get(f"{base_url}/api/admin/metrics")
        assert r.status_code == 200, r.text
        data = r.json()
        _no_leaks(data)
        for k in ("users", "pets", "estimates", "claims", "feedback",
                  "reminders", "payments", "contact_messages", "shares", "dispatcher"):
            assert k in data, f"metrics missing {k}"
        # nested checks
        for k in ("total", "avg_rating", "count_rated"):
            assert k in data["feedback"]
        for k in ("pending", "sent", "failed"):
            assert k in data["reminders"]
        for k in ("paid", "total", "revenue_usd"):
            assert k in data["payments"]
        for k in ("total", "delivered"):
            assert k in data["contact_messages"]
        for k in ("total", "active"):
            assert k in data["shares"]
        for k in ("scheduled_every_minutes", "sender", "resend_configured"):
            assert k in data["dispatcher"]

    def test_admin_feedback_requires_admin(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/admin/feedback")
        assert r.status_code == 403

    def test_admin_feedback_admin_ok(self, base_url, admin_client):
        r = admin_client.get(f"{base_url}/api/admin/feedback")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        _no_leaks(rows)
        # sorted desc by created_at
        if len(rows) >= 2:
            for i in range(len(rows) - 1):
                if rows[i].get("created_at") and rows[i + 1].get("created_at"):
                    assert rows[i]["created_at"] >= rows[i + 1]["created_at"]

    def test_admin_contact_messages_requires_admin(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/admin/contact-messages")
        assert r.status_code == 403

    def test_admin_contact_messages_admin_ok(self, base_url, admin_client):
        # Ensure at least one contact exists
        requests.post(f"{base_url}/api/contact", json={
            "name": "TEST_Admin_Contact", "email": "TEST_admin_contact@example.com",
            "subject": "admin", "message": "for admin list test",
        })
        r = admin_client.get(f"{base_url}/api/admin/contact-messages")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        _no_leaks(rows)
        # sorted desc
        if len(rows) >= 2:
            for i in range(len(rows) - 1):
                if rows[i].get("created_at") and rows[i + 1].get("created_at"):
                    assert rows[i]["created_at"] >= rows[i + 1]["created_at"]
