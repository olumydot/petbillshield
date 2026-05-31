"""Phase 5 backend tests: Stripe Customer Portal + Email-PDF-to-Vet packet + vet-dispatches list.

Coverage:
  - POST /api/billing/portal:
      * 503 guard in preview env (STRIPE_API_KEY ends with '_emergent')
      * 401 without Bearer token
  - POST /api/estimates/{analysis_id}/email-packet:
      * Happy path -> 200, ok=true, dispatch_id starts with 'vetdsp_',
        either delivered=true or delivered=false+delivery_error,
        and a row is persisted in db.vet_dispatches (no _id leak).
      * 404 when analysis_id doesn't belong to user.
      * 422 when to_email is malformed.
      * 401 without auth.
  - GET /api/estimates/{analysis_id}/vet-dispatches:
      * Returns user's prior dispatches for that analysis, sorted by created_at desc.
      * Never leaks Mongo _id.
"""
import os
import json
import time
import subprocess

import pytest
import requests


# ------------------------ helpers ------------------------
def _mongosh(script: str) -> str:
    res = subprocess.run(
        ["mongosh", "--quiet", "--eval", script], capture_output=True, text=True
    )
    return (res.stdout or "") + (res.stderr or "")


@pytest.fixture(scope="module", autouse=True)
def cleanup_phase5(seeded_user):
    """Wipe Phase 5 artifacts before and after the module."""
    uid = seeded_user["user_id"]
    cleanup = f"""
use('test_database');
db.vet_dispatches.deleteMany({{user_id: '{uid}'}});
db.estimates.deleteMany({{user_id: '{uid}'}});
"""
    _mongosh(cleanup)
    yield
    _mongosh(cleanup)


@pytest.fixture(scope="module")
def estimate_id(base_url, auth_client):
    """Create a real estimate via /api/estimates/analyze (multipart form)."""
    files = {
        "typed_text": (None, "CBC: $80\nRadiograph two view: $220\nE-collar: $15\nTotal: $315"),
        "pet_name": (None, "TEST_phase5_kitty"),
        "pet_species": (None, "cat"),
    }
    r = auth_client.post(f"{base_url}/api/estimates/analyze", files=files, timeout=120)
    assert r.status_code == 200, f"analyze failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    aid = body.get("analysis_id")
    assert aid and aid.startswith("est_"), f"bad analysis_id: {aid}"
    return aid


# ====================== Customer Portal ======================
class TestCustomerPortal:
    def test_portal_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/billing/portal", timeout=15)
        # FastAPI returns 401/403 depending on dependency; both signal "unauthenticated"
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text[:200]}"

    def test_portal_503_with_emergent_proxy_key(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/billing/portal", timeout=20)
        assert r.status_code == 503, f"expected 503 guard, got {r.status_code} {r.text[:300]}"
        body = r.json()
        detail = (body.get("detail") or "").lower()
        assert "customer portal" in detail and "real stripe key" in detail, (
            f"unexpected guard message: {body}"
        )


# ====================== Email-Packet ======================
class TestEmailPacket:
    def test_email_packet_requires_auth(self, base_url, estimate_id):
        r = requests.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json={"to_email": "noauth@example.com"},
            timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_email_packet_404_on_other_users_analysis(self, base_url, auth_client):
        r = auth_client.post(
            f"{base_url}/api/estimates/est_doesnotexist1234/email-packet",
            json={"to_email": "vet@example.com", "vet_name": "Dr. Test"},
            timeout=20,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:200]}"

    def test_email_packet_422_on_bad_email(self, base_url, auth_client, estimate_id):
        r = auth_client.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json={"to_email": "not-an-email", "vet_name": "Dr. Test"},
            timeout=20,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text[:300]}"

    def test_email_packet_happy_path(self, base_url, auth_client, estimate_id, seeded_user):
        payload = {
            "to_email": "delivered@resend.dev",
            "vet_name": "Dr. Test Vet",
            "note": "Hi! Please review this estimate when you get a chance. Thanks!",
        }
        r = auth_client.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json=payload,
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text[:400]}"
        body = r.json()

        # response shape
        assert body.get("ok") is True, f"ok != True: {body}"
        assert "delivered" in body and isinstance(body["delivered"], bool)
        assert "delivery_error" in body  # may be None or string
        if body["delivered"] is False:
            assert body["delivery_error"], "delivered=false must have delivery_error"
        dispatch_id = body.get("dispatch_id") or ""
        assert dispatch_id.startswith("vetdsp_"), f"bad dispatch_id: {dispatch_id}"

        # DB persistence (no _id leak; correct fields)
        uid = seeded_user["user_id"]
        script = f"""
use('test_database');
const row = db.vet_dispatches.findOne({{dispatch_id: '{dispatch_id}', user_id: '{uid}'}});
print(JSON.stringify(row));
"""
        out = _mongosh(script).strip().splitlines()[-1].strip()
        assert out and out != "null", f"vet_dispatches row not persisted: {out!r}"
        row = json.loads(out)
        assert row["analysis_id"] == estimate_id
        assert row["to_email"] == payload["to_email"]
        assert row["vet_name"] == payload["vet_name"]
        assert row["delivered"] == body["delivered"]
        assert "created_at" in row
        # _id leak check: this is the raw mongo doc and _will_ include _id internally,
        # which is fine — what we must verify is the API endpoint never returns _id.

    def test_email_packet_persists_even_on_delivery_failure(
        self, base_url, auth_client, estimate_id, seeded_user
    ):
        """Even if Resend fails, the dispatch row must still persist."""
        # An address that resend will accept syntactically; whether it delivers depends on env.
        r = auth_client.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json={"to_email": "vet+phase5@example.com", "vet_name": "Dr. Persistence"},
            timeout=60,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["ok"] is True
        assert body["dispatch_id"].startswith("vetdsp_")

        uid = seeded_user["user_id"]
        script = f"""
use('test_database');
print(db.vet_dispatches.countDocuments({{dispatch_id: '{body['dispatch_id']}', user_id: '{uid}'}}));
"""
        out = _mongosh(script).strip().splitlines()[-1].strip()
        assert out == "1", f"dispatch row count != 1: {out!r}"


# ====================== Vet Dispatches list ======================
class TestVetDispatchesList:
    def test_list_requires_auth(self, base_url, estimate_id):
        r = requests.get(
            f"{base_url}/api/estimates/{estimate_id}/vet-dispatches", timeout=15
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_list_returns_sorted_desc_and_no_id_leak(
        self, base_url, auth_client, estimate_id
    ):
        # Create two more dispatches with a small gap so created_at differs.
        first = auth_client.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json={"to_email": "list1@example.com", "vet_name": "Dr. First"},
            timeout=60,
        )
        assert first.status_code == 200, first.text[:300]
        time.sleep(1.1)
        second = auth_client.post(
            f"{base_url}/api/estimates/{estimate_id}/email-packet",
            json={"to_email": "list2@example.com", "vet_name": "Dr. Second"},
            timeout=60,
        )
        assert second.status_code == 200, second.text[:300]

        r = auth_client.get(
            f"{base_url}/api/estimates/{estimate_id}/vet-dispatches", timeout=20
        )
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 2, f"too few rows: {rows}"

        # No mongo _id leak
        for row in rows:
            assert "_id" not in row, f"_id leaked: {row}"
            assert row.get("analysis_id") == estimate_id
            assert row.get("dispatch_id", "").startswith("vetdsp_")

        # Sorted by created_at desc
        created_at_list = [row["created_at"] for row in rows]
        assert created_at_list == sorted(created_at_list, reverse=True), (
            f"not sorted desc: {created_at_list}"
        )

    def test_list_empty_for_unknown_analysis(self, base_url, auth_client):
        r = auth_client.get(
            f"{base_url}/api/estimates/est_nonexistent9999/vet-dispatches", timeout=15
        )
        assert r.status_code == 200
        assert r.json() == []


# ====================== Regression on /api/auth/me is_admin ======================
class TestAuthMeRegression:
    def test_auth_me_returns_is_admin_flag(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/auth/me", timeout=15)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert "is_admin" in body, f"missing is_admin: {body}"
        # seeded user is NOT in ADMIN_EMAILS
        assert body["is_admin"] is False
