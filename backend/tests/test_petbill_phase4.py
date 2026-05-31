"""Phase 4 backend tests for PetBill Shield:
- Category field on PetRecord + category breakdown in /api/stats/trends
- CSV import (POST /api/pets/{pet_id}/records/import-csv)
- Per-IP rate-limiting on /api/contact (5/min) and /api/feedback (10/min)
- Honeypot 'website' field on /api/contact and /api/feedback
- Stripe one-time fallback (sk_test_emergent path) — mode='payment'
- Subscription-mode safety net code structure (the try/except fallback)
"""
import io
import json
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone

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


def _insert_pet(user_id: str, name: str = "TEST_Phase4Dog") -> str:
    pet_id = f"pet_TEST_{uuid.uuid4().hex[:10]}"
    doc = {
        "pet_id": pet_id,
        "user_id": user_id,
        "name": name,
        "species": "dog",
        "breed": "Mix",
        "age_years": 3,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _mongosh(f"db.pets.insertOne({json.dumps(doc)});")
    return pet_id


# --------------------- module cleanup ---------------------
@pytest.fixture(scope="module", autouse=True)
def _cleanup_phase4(seeded_user):
    yield
    uid = seeded_user["user_id"]
    _mongosh(
        f"db.pets.deleteMany({{user_id:'{uid}'}});"
        f"db.pet_records.deleteMany({{user_id:'{uid}'}});"
        f"db.payment_transactions.deleteMany({{user_id:'{uid}'}});"
        f"db.feedback.deleteMany({{user_id:'{uid}'}});"
        f"db.contact_messages.deleteMany({{email:/TEST_phase4/}});"
    )


# =====================================================================
# 1. Category field on PetRecord
# =====================================================================
class TestCategoryField:
    def test_create_record_with_category_persists(self, base_url, auth_client, seeded_user):
        pet_id = _insert_pet(seeded_user["user_id"])
        payload = {
            "record_type": "medication",
            "title": "TEST Antibiotic",
            "amount_usd": 42.50,
            "date": datetime.now(timezone.utc).isoformat(),
            "category": "medication",
        }
        r = auth_client.post(f"{base_url}/api/pets/{pet_id}/records", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        _no_leaks(body)
        assert body["category"] == "medication"

        # GET back
        r2 = auth_client.get(f"{base_url}/api/pets/{pet_id}/records")
        assert r2.status_code == 200
        rows = r2.json()
        _no_leaks(rows)
        assert any(rec.get("title") == "TEST Antibiotic" and rec.get("category") == "medication"
                   for rec in rows)

    def test_create_record_without_category_defaults_to_other(self, base_url, auth_client, seeded_user):
        pet_id = _insert_pet(seeded_user["user_id"])
        payload = {
            "record_type": "note",
            "title": "TEST No-Category Note",
        }
        r = auth_client.post(f"{base_url}/api/pets/{pet_id}/records", json=payload)
        assert r.status_code == 200, r.text
        assert r.json().get("category") == "other"


# =====================================================================
# 2. Spend trends with category breakdown
# =====================================================================
class TestTrendsCategories:
    def test_trends_by_category(self, base_url, auth_client, seeded_user):
        uid = seeded_user["user_id"]
        # Clean records first for deterministic math
        _mongosh(f"db.pet_records.deleteMany({{user_id:'{uid}'}});")
        pet_id = _insert_pet(uid, "TEST_CatPet")
        now_iso = datetime.now(timezone.utc).isoformat()

        # Two invoice records this month with distinct categories
        for cat, amt in [("medication", 120.0), ("surgery", 800.0)]:
            doc = {
                "record_id": f"rec_TEST_{uuid.uuid4().hex[:10]}",
                "pet_id": pet_id,
                "user_id": uid,
                "record_type": "invoice",
                "title": f"TEST {cat} bill",
                "amount_usd": amt,
                "date": now_iso,
                "category": cat,
                "created_at": now_iso,
            }
            _mongosh(f"db.pet_records.insertOne({json.dumps(doc)});")

        r = auth_client.get(f"{base_url}/api/stats/trends?months=6")
        assert r.status_code == 200, r.text
        data = r.json()
        _no_leaks(data)

        # Top-level
        assert "by_category_totals" in data and isinstance(data["by_category_totals"], dict)
        assert "categories" in data and isinstance(data["categories"], list)
        assert "medication" in data["categories"] and "surgery" in data["categories"]
        assert data["by_category_totals"].get("medication") == 120.0
        assert data["by_category_totals"].get("surgery") == 800.0

        # Bucket-level
        current = data["buckets"][-1]
        assert "by_category" in current and isinstance(current["by_category"], dict)
        assert current["by_category"].get("medication") == 120.0
        assert current["by_category"].get("surgery") == 800.0


# =====================================================================
# 3. CSV import
# =====================================================================
class TestCSVImport:
    def test_csv_import_requires_auth(self, base_url):
        files = {"file": ("a.csv", io.BytesIO(b"title,amount_usd\nfoo,10"), "text/csv")}
        r = requests.post(f"{base_url}/api/pets/somepet/records/import-csv", files=files)
        assert r.status_code == 401

    def test_csv_import_404_for_other_user_pet(self, base_url, auth_client):
        files = {"file": ("a.csv", io.BytesIO(b"title,amount_usd\nfoo,10"), "text/csv")}
        r = auth_client.post(f"{base_url}/api/pets/pet_not_mine/records/import-csv", files=files)
        assert r.status_code == 404

    def test_csv_import_happy_path_with_aliases_and_currency(self, base_url, auth_client, seeded_user):
        pet_id = _insert_pet(seeded_user["user_id"], "TEST_CSVPet")
        # Case-insensitive headers, 'amount' alias, currency-formatted amount
        csv_bytes = (
            "Title,Date,Amount,Category,Details\n"
            "TEST Annual Exam,2025-03-15,\"$1,234.50\",exam,Annual checkup\n"
            "TEST Dental Cleaning,2025-04-02,$320,dental,Tartar removal\n"
            "TEST Mystery Item,2025-05-01,75.00,unknown_cat_xyz,Falls back to other\n"
        ).encode("utf-8")
        files = {"file": ("history.csv", io.BytesIO(csv_bytes), "text/csv")}
        r = auth_client.post(f"{base_url}/api/pets/{pet_id}/records/import-csv", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        _no_leaks(body)
        assert body["imported"] == 3
        assert body["skipped"] == 0
        assert body["errors"] == []
        assert isinstance(body["categories"], list)
        assert "exam" in body["categories"] and "dental" in body["categories"] and "other" in body["categories"]

        # Confirm via GET
        r2 = auth_client.get(f"{base_url}/api/pets/{pet_id}/records")
        assert r2.status_code == 200
        rows = r2.json()
        by_title = {row["title"]: row for row in rows}
        assert "TEST Annual Exam" in by_title
        assert by_title["TEST Annual Exam"]["amount_usd"] == 1234.50
        assert by_title["TEST Annual Exam"]["category"] == "exam"
        assert by_title["TEST Dental Cleaning"]["amount_usd"] == 320.0
        assert by_title["TEST Dental Cleaning"]["category"] == "dental"
        # Unknown category falls back to "other"
        assert by_title["TEST Mystery Item"]["category"] == "other"

    def test_csv_import_skips_bad_rows(self, base_url, auth_client, seeded_user):
        pet_id = _insert_pet(seeded_user["user_id"], "TEST_BadRowPet")
        csv_bytes = (
            "title,amount_usd,category\n"
            "Good One,50,medication\n"
            ",100,surgery\n"           # missing title
            "  ,25,exam\n"             # whitespace-only title
            "Another Good,75,labwork\n"
        ).encode("utf-8")
        files = {"file": ("mixed.csv", io.BytesIO(csv_bytes), "text/csv")}
        r = auth_client.post(f"{base_url}/api/pets/{pet_id}/records/import-csv", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["imported"] == 2
        assert body["skipped"] == 2
        assert len(body["errors"]) == 2
        for err in body["errors"]:
            assert "row" in err and "reason" in err

    def test_csv_import_empty_file_400(self, base_url, auth_client, seeded_user):
        pet_id = _insert_pet(seeded_user["user_id"], "TEST_EmptyPet")
        files = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
        r = auth_client.post(f"{base_url}/api/pets/{pet_id}/records/import-csv", files=files)
        assert r.status_code == 400


# =====================================================================
# 4. Honeypot — must come BEFORE rate-limit tests (rate-limit will burn the quota)
# =====================================================================
class TestHoneypot:
    def test_contact_honeypot_silently_drops(self, base_url):
        # Snapshot DB count
        before = _mongosh(
            "print(db.contact_messages.countDocuments({email:'TEST_phase4_honeypot@example.com'}));"
        ).strip().splitlines()[-1]

        r = requests.post(f"{base_url}/api/contact", json={
            "name": "TEST_Spammer",
            "email": "TEST_phase4_honeypot@example.com",
            "subject": "spam",
            "message": "spam content",
            "website": "spammy.com",   # honeypot triggered
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"ok": True, "contact_id": "", "delivered": False}

        after = _mongosh(
            "print(db.contact_messages.countDocuments({email:'TEST_phase4_honeypot@example.com'}));"
        ).strip().splitlines()[-1]
        assert before == after, f"contact_messages row was created despite honeypot (before={before}, after={after})"

    def test_feedback_honeypot_silently_drops(self, base_url):
        marker = f"TEST_HONEYPOT_FB_{uuid.uuid4().hex[:8]}"
        # We tag the comment with a unique marker — honeypot should NOT write it.
        before = _mongosh(
            f"print(db.feedback.countDocuments({{comment:/{marker}/}}));"
        ).strip().splitlines()[-1]

        r = requests.post(f"{base_url}/api/feedback", json={
            "rating": 1,
            "category": "bug",
            "comment": marker,
            "page": "/landing",
            "website": "evil.com",   # honeypot triggered
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"ok": True, "feedback_id": ""}

        after = _mongosh(
            f"print(db.feedback.countDocuments({{comment:/{marker}/}}));"
        ).strip().splitlines()[-1]
        assert before == after, f"feedback row was created despite honeypot (before={before}, after={after})"


# =====================================================================
# 5. Stripe one-time fallback (current preview env)
# =====================================================================
class TestStripeOneTimeFallback:
    def test_subscription_plan_falls_back_to_payment(self, base_url, auth_client, seeded_user):
        # In preview env STRIPE_API_KEY=sk_test_emergent → must fall back to one-time
        r = auth_client.post(f"{base_url}/api/billing/checkout",
                             json={"plan_id": "vault_monthly",
                                   "origin_url": base_url})
        assert r.status_code == 200, r.text
        body = r.json()
        _no_leaks(body)
        assert "url" in body and "session_id" in body and "mode" in body
        assert body["mode"] == "payment", f"expected 'payment' mode, got {body['mode']}"
        assert body["url"].startswith("http")
        sid = body["session_id"]

        # DB row reflects mode='payment'
        out = _mongosh(
            f"printjson(db.payment_transactions.findOne({{session_id:'{sid}'}},{{_id:0}}));"
        )
        assert re.search(r"mode:\s*['\"]payment['\"]", out), f"DB row missing mode=payment: {out[:400]}"
        assert "vault_monthly" in out

    def test_one_time_plan_is_payment(self, base_url, auth_client, seeded_user):
        r = auth_client.post(f"{base_url}/api/billing/checkout",
                             json={"plan_id": "defender_one_time",
                                   "origin_url": base_url})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["mode"] == "payment"


# =====================================================================
# 6. Subscription path safety net — code structure verification
# (The runtime path requires a real Stripe key + STRIPE_PRICE_* env var, which
#  cannot be safely toggled inside this preview env. The safety net is the
#  try/except that falls back to one-time on any Stripe SDK failure.)
# =====================================================================
class TestSubscriptionFallbackSafetyNet:
    def test_use_subscription_guard_endswith_emergent(self):
        src = open("/app/backend/server.py").read()
        # The guard: STRIPE_API_KEY and not STRIPE_API_KEY.endswith("_emergent")
        assert 'endswith("_emergent")' in src, \
            "Subscription guard missing — STRIPE_API_KEY.endswith('_emergent') check absent"

    def test_subscription_block_wrapped_in_try_except_fallback(self):
        src = open("/app/backend/server.py").read()
        # Find the use_subscription block and ensure try/except with use_subscription=False fallback
        m = re.search(
            r"if use_subscription:\s*\n\s*try:.*?except Exception.*?use_subscription\s*=\s*False",
            src, re.DOTALL,
        )
        assert m is not None, "Subscription path missing try/except fallback to use_subscription=False"

    def test_fallback_path_creates_one_time_session_when_use_subscription_false(self):
        src = open("/app/backend/server.py").read()
        # Ensure the fallback path (if not use_subscription) constructs a one-time session
        assert re.search(r"if not use_subscription:.*?create_checkout_session", src, re.DOTALL), \
            "One-time fallback path missing"


# =====================================================================
# 7. Rate-limiting — MUST run last (burns the per-IP quota)
# pytest collects test classes in file order; this class is intentionally last.
# =====================================================================
class TestZRateLimiting:
    def test_contact_rate_limit_429(self, base_url):
        # Hit /api/contact ~8 times quickly; with 5/min limit, at least one 429 should appear
        seen_429 = False
        for i in range(8):
            r = requests.post(f"{base_url}/api/contact", json={
                "name": f"TEST_RL_{i}",
                "email": f"TEST_phase4_rl_{i}@example.com",
                "subject": "rl",
                "message": "rate-limit probe",
            })
            if r.status_code == 429:
                seen_429 = True
                break
        assert seen_429, "Expected at least one 429 from /api/contact after rapid posts (5/min limit)"

    def test_feedback_rate_limit_429(self, base_url):
        # Hit /api/feedback ~14 times quickly; with 10/min limit, at least one 429 should appear
        seen_429 = False
        for i in range(14):
            r = requests.post(f"{base_url}/api/feedback", json={
                "rating": 5,
                "category": "praise",
                "comment": f"TEST RL probe {i}",
            })
            if r.status_code == 429:
                seen_429 = True
                break
        assert seen_429, "Expected at least one 429 from /api/feedback after rapid posts (10/min limit)"
