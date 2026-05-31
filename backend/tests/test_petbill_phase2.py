"""Phase 2 backend tests for PetBill Shield: Billing, Reminders, PDF Export, Feedback."""
import json
import time
import requests
from datetime import datetime, timezone, timedelta

import pytest


# ---- helpers ----
def _no_underscore_id(payload):
    blob = json.dumps(payload)
    assert '"_id"' not in blob, f"_id leaked: {blob[:300]}"


# ====================================================================
# Billing — plans (public)
# ====================================================================
class TestBillingPlansPublic:
    def test_plans_public(self, base_url):
        r = requests.get(f"{base_url}/api/billing/plans")
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert "plans" in data
        plans = data["plans"]
        for plan_id in ("defender_one_time", "vault_monthly", "family_monthly", "rescue_monthly"):
            assert plan_id in plans, f"Missing plan: {plan_id}"
            p = plans[plan_id]
            assert "label" in p and "amount" in p and "currency" in p and "kind" in p


# ====================================================================
# Billing — checkout (requires auth)
# ====================================================================
class TestBillingCheckout:
    sessions = {}  # plan_id -> session_id

    def test_checkout_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/billing/checkout",
                          json={"plan_id": "defender_one_time", "origin_url": "https://example.com"})
        assert r.status_code == 401

    def test_unknown_plan_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/billing/checkout",
                             json={"plan_id": "not_a_real_plan", "origin_url": "https://example.com"})
        assert r.status_code == 400, r.text

    @pytest.mark.parametrize("plan_id", [
        "defender_one_time", "vault_monthly", "family_monthly", "rescue_monthly",
    ])
    def test_create_checkout_for_each_plan(self, base_url, auth_client, plan_id, seeded_user):
        r = auth_client.post(
            f"{base_url}/api/billing/checkout",
            json={"plan_id": plan_id, "origin_url": "https://app.example.com"},
        )
        assert r.status_code == 200, f"[{plan_id}] {r.status_code} {r.text[:300]}"
        data = r.json()
        _no_underscore_id(data)
        assert "url" in data and isinstance(data["url"], str) and data["url"].startswith("http")
        assert "session_id" in data and isinstance(data["session_id"], str) and len(data["session_id"]) > 4
        TestBillingCheckout.sessions[plan_id] = data["session_id"]

    def test_payment_transactions_recorded(self, seeded_user):
        """Verify each created session has a payment_transactions row."""
        # Re-use mongosh via subprocess to keep dependencies thin
        import subprocess
        for plan_id, sid in TestBillingCheckout.sessions.items():
            script = (
                f"use('test_database');"
                f"printjson(db.payment_transactions.findOne({{session_id:'{sid}'}}, "
                f"{{_id:0}}));"
            )
            out = subprocess.run(["mongosh", "--quiet", "--eval", script],
                                 capture_output=True, text=True)
            assert out.returncode == 0
            blob = out.stdout
            assert "null" not in blob.lower().split("\n")[0], f"missing tx for {plan_id}: {blob}"
            for token in (plan_id, seeded_user["user_id"], "initiated", "pending"):
                assert token in blob, f"tx for {plan_id} missing '{token}': {blob[:400]}"


# ====================================================================
# Billing — status
# ====================================================================
class TestBillingStatus:
    def test_status_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/billing/status/cs_test_dummy_123")
        assert r.status_code == 401

    def test_status_unknown_session_404(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/billing/status/cs_test_doesnotexist_999")
        assert r.status_code == 404

    def test_status_for_fresh_session_unpaid(self, base_url, auth_client):
        sid = TestBillingCheckout.sessions.get("defender_one_time")
        if not sid:
            pytest.skip("No checkout session available")
        r = auth_client.get(f"{base_url}/api/billing/status/{sid}")
        # Endpoint reads ONLY from db.payment_transactions; the Emergent test Stripe
        # proxy does not support checkout.Session.retrieve. The webhook updates state.
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        _no_underscore_id(data)
        # required fields
        for key in ("payment_status", "status", "plan_id", "amount", "currency",
                    "entitled", "granted_now"):
            assert key in data, f"missing key: {key}"
        assert data["plan_id"] == "defender_one_time"
        assert data["entitled"] is False
        assert data["granted_now"] is False
        # fresh, unpaid: DB initial state
        assert data["payment_status"] == "pending", data["payment_status"]
        assert data["status"] == "initiated", data["status"]


# ====================================================================
# Billing — me
# ====================================================================
class TestBillingMe:
    def test_billing_me_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/billing/me")
        assert r.status_code == 401

    def test_billing_me_fresh_user_inactive(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/billing/me")
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        for key in ("plan_id", "plan_label", "plan_kind", "entitlement_expires_at", "active", "plans"):
            assert key in data, f"missing key: {key}"
        assert data["active"] is False
        plans = data["plans"]
        for plan_id in ("defender_one_time", "vault_monthly", "family_monthly", "rescue_monthly"):
            assert plan_id in plans


# ====================================================================
# Billing — webhook
# ====================================================================
class TestBillingWebhook:
    def test_webhook_empty_body_graceful(self, base_url):
        r = requests.post(f"{base_url}/api/webhook/stripe", data=b"", headers={"Stripe-Signature": ""})
        # Endpoint must not crash. 200 or 400 accepted.
        assert r.status_code in (200, 400), f"unexpected: {r.status_code} {r.text[:200]}"


# ====================================================================
# Billing — webhook-driven entitlement flow (must run AFTER TestBillingMe
# so that test_billing_me_fresh_user_inactive sees an unentitled user).
# ====================================================================
class TestBillingWebhookFlow:
    def test_webhook_marks_session_paid_and_grants_entitlement(
        self, base_url, auth_client, seeded_user
    ):
        """POST /api/webhook/stripe with a synthesized checkout.session.completed
        event should mark the tx paid+entitled, grant the user the plan, and reflect
        in /api/billing/status/{sid} and /api/billing/me.
        """
        # vault_monthly = subscription -> verifies entitlement_expires_at is set.
        plan_id = "vault_monthly"
        sid = TestBillingCheckout.sessions.get(plan_id)
        if not sid:
            pytest.skip(f"No checkout session for {plan_id}")

        payload = {
            "id": "evt_test_webhook_" + sid[-8:],
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": sid,
                    "payment_status": "paid",
                    "metadata": {
                        "user_id": seeded_user["user_id"],
                        "plan_id": plan_id,
                    },
                }
            },
        }
        r = requests.post(
            f"{base_url}/api/webhook/stripe",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Stripe-Signature": "", "Content-Type": "application/json"},
        )
        assert r.status_code == 200, f"webhook returned {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("received") is True, body

        # GET /api/billing/status/{sid} should now reflect entitled=True / paid
        r2 = auth_client.get(f"{base_url}/api/billing/status/{sid}")
        assert r2.status_code == 200, r2.text[:300]
        st = r2.json()
        _no_underscore_id(st)
        assert st["payment_status"] == "paid", st
        assert st["status"] == "complete", st
        assert st["entitled"] is True, st
        assert st["plan_id"] == plan_id

        # GET /api/billing/me should reflect plan_id and active=true
        r3 = auth_client.get(f"{base_url}/api/billing/me")
        assert r3.status_code == 200, r3.text[:300]
        me = r3.json()
        _no_underscore_id(me)
        assert me["plan_id"] == plan_id, me
        assert me["active"] is True, me
        assert me["entitlement_expires_at"], me

    def test_webhook_persists_paid_state_in_db(self, base_url):
        sid = TestBillingCheckout.sessions.get("vault_monthly")
        if not sid:
            pytest.skip("No checkout session for vault_monthly")
        import subprocess
        script = (
            f"use('test_database');"
            f"printjson(db.payment_transactions.findOne({{session_id:'{sid}'}}, {{_id:0}}));"
        )
        out = subprocess.run(["mongosh", "--quiet", "--eval", script],
                             capture_output=True, text=True)
        assert out.returncode == 0, out.stderr
        blob = out.stdout
        assert '"paid"' in blob or "paid" in blob, f"payment_status=paid not persisted: {blob[:400]}"
        assert "complete" in blob, f"status=complete not persisted: {blob[:400]}"
        assert "true" in blob, f"entitled=true not persisted: {blob[:400]}"
        assert "updated_at" in blob, f"updated_at not set: {blob[:400]}"


# ====================================================================
# Reminders — CRUD + auto-create + dispatch-now
# ====================================================================
class TestReminders:
    pet_id = None
    rem_id = None
    rem_past_id = None

    def test_create_pet_for_reminders(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/pets", json={
            "name": "TEST_RemPet", "species": "dog", "breed": "Mix", "age_years": 2,
        })
        assert r.status_code == 200, r.text
        TestReminders.pet_id = r.json()["pet_id"]

    def test_create_reminder_requires_auth(self, base_url):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r = requests.post(f"{base_url}/api/reminders", json={
            "title": "Vaccination", "scheduled_for": future,
        })
        assert r.status_code == 401

    def test_create_reminder(self, base_url, auth_client, seeded_user):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = auth_client.post(f"{base_url}/api/reminders", json={
            "pet_id": TestReminders.pet_id,
            "title": "TEST Rabies booster",
            "message": "Annual rabies shot",
            "scheduled_for": future,
            "email": seeded_user["email"],
        })
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["status"] == "pending"
        assert data["reminder_id"].startswith("rem_")
        assert data["title"] == "TEST Rabies booster"
        TestReminders.rem_id = data["reminder_id"]

    def test_list_reminders_sorted(self, base_url, auth_client):
        # Create another reminder farther in future to verify sort ASC
        future2 = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
        auth_client.post(f"{base_url}/api/reminders", json={
            "title": "TEST Later checkup", "scheduled_for": future2,
        })
        r = auth_client.get(f"{base_url}/api/reminders")
        assert r.status_code == 200
        rows = r.json()
        _no_underscore_id(rows)
        assert isinstance(rows, list)
        scheduled = [row["scheduled_for"] for row in rows]
        assert scheduled == sorted(scheduled), f"reminders not sorted ASC: {scheduled}"
        assert any(rw["reminder_id"] == TestReminders.rem_id for rw in rows)

    def test_delete_reminder(self, base_url, auth_client):
        # Delete the later reminder, keep the rem_id one for context
        r_list = auth_client.get(f"{base_url}/api/reminders").json()
        later = [r for r in r_list if r["title"] == "TEST Later checkup"]
        assert later, "later reminder not found"
        rid = later[0]["reminder_id"]
        r = auth_client.delete(f"{base_url}/api/reminders/{rid}")
        assert r.status_code == 200
        # confirm gone
        after = auth_client.get(f"{base_url}/api/reminders").json()
        assert not any(x["reminder_id"] == rid for x in after)

    def test_auto_reminder_from_pet_record(self, base_url, auth_client):
        future_date = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d")
        r = auth_client.post(
            f"{base_url}/api/pets/{TestReminders.pet_id}/records",
            json={
                "record_type": "reminder",
                "title": "TEST Auto-reminder from record",
                "date": future_date,
                "details": "Annual checkup",
            },
        )
        assert r.status_code == 200, r.text
        # Now list reminders, should include this auto-created one
        rems = auth_client.get(f"{base_url}/api/reminders").json()
        matches = [x for x in rems if x["title"] == "TEST Auto-reminder from record"]
        assert matches, f"auto-reminder not created. existing: {[r['title'] for r in rems]}"
        assert matches[0]["status"] == "pending"

    def test_dispatch_now_transitions_pending(self, base_url, auth_client, seeded_user):
        # Insert a reminder scheduled in the past directly via API: not possible (only future check
        # is in pet-record auto path; reminders endpoint accepts any ISO). Send past time.
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        r = auth_client.post(f"{base_url}/api/reminders", json={
            "title": "TEST Past due reminder",
            "scheduled_for": past,
            "email": seeded_user["email"],
        })
        assert r.status_code == 200, r.text
        rid = r.json()["reminder_id"]
        TestReminders.rem_past_id = rid

        # Trigger dispatch
        r2 = auth_client.post(f"{base_url}/api/reminders/dispatch-now")
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert "processed" in body

        # Allow scheduler/async dispatch to complete
        time.sleep(2)

        # Verify the past-due reminder is no longer pending
        rems = auth_client.get(f"{base_url}/api/reminders").json()
        target = next((x for x in rems if x["reminder_id"] == rid), None)
        assert target is not None, "past-due reminder vanished"
        assert target["status"] in ("sent", "failed"), (
            f"reminder did not transition out of 'pending': status={target['status']} "
            f"err={target.get('last_error')}"
        )

    def test_dispatch_now_requires_auth(self, base_url):
        r = requests.post(f"{base_url}/api/reminders/dispatch-now")
        assert r.status_code == 401


# ====================================================================
# PDF Export — /api/estimates/{id}/packet.pdf
# ====================================================================
class TestPdfPacketExport:
    analysis_id = None

    def test_create_estimate_via_typed_text(self, base_url, auth_client):
        text = ("Wellness exam $90. Bloodwork CBC $135. Dental cleaning $420. "
                "Heartworm test $45. Total $690.")
        r = auth_client.post(
            f"{base_url}/api/estimates/analyze",
            data={"typed_text": text, "pet_name": "TEST_RemPet", "pet_species": "dog"},
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        _no_underscore_id(data)
        TestPdfPacketExport.analysis_id = data["analysis_id"]

    def test_packet_pdf_requires_auth(self, base_url):
        aid = TestPdfPacketExport.analysis_id or "nope"
        r = requests.get(f"{base_url}/api/estimates/{aid}/packet.pdf")
        assert r.status_code == 401

    def test_packet_pdf_unknown_404(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/estimates/notarealid/packet.pdf")
        assert r.status_code == 404

    def test_packet_pdf_success(self, base_url, auth_client):
        aid = TestPdfPacketExport.analysis_id
        assert aid, "analysis id missing"
        r = auth_client.get(f"{base_url}/api/estimates/{aid}/packet.pdf")
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower(), cd
        assert len(r.content) > 1000, f"pdf too small: {len(r.content)} bytes"
        assert r.content[:4] == b"%PDF", f"not PDF magic: {r.content[:8]}"


# ====================================================================
# Feedback — anonymous + authenticated
# ====================================================================
class TestFeedback:
    feedback_id_authed = None

    def test_feedback_anonymous(self, base_url):
        r = requests.post(f"{base_url}/api/feedback", json={
            "rating": 5, "category": "praise", "comment": "love it",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["ok"] is True
        assert "feedback_id" in data and data["feedback_id"].startswith("fb_")

    def test_feedback_with_auth_captures_user(self, base_url, auth_client, seeded_user):
        r = auth_client.post(f"{base_url}/api/feedback", json={
            "rating": 4, "category": "idea", "comment": "TEST add dark mode toggle",
            "page": "/dashboard",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["ok"] is True
        TestFeedback.feedback_id_authed = data["feedback_id"]

        # Verify GET /api/feedback/mine returns this
        r2 = auth_client.get(f"{base_url}/api/feedback/mine")
        assert r2.status_code == 200, r2.text
        rows = r2.json()
        _no_underscore_id(rows)
        assert isinstance(rows, list)
        assert any(x["feedback_id"] == TestFeedback.feedback_id_authed for x in rows)
        mine = next(x for x in rows if x["feedback_id"] == TestFeedback.feedback_id_authed)
        assert mine["user_id"] == seeded_user["user_id"]
        assert mine["rating"] == 4
        assert mine["category"] == "idea"

    def test_feedback_mine_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/feedback/mine")
        assert r.status_code == 401

    def test_feedback_rating_validation(self, base_url):
        # rating must be 1..5
        r = requests.post(f"{base_url}/api/feedback", json={"rating": 9})
        assert r.status_code in (400, 422), r.status_code
        r2 = requests.post(f"{base_url}/api/feedback", json={"rating": 0})
        assert r2.status_code in (400, 422)


# ====================================================================
# Mongo hygiene — ensure _id never leaks across phase-2 endpoints
# ====================================================================
class TestMongoHygienePhase2:
    def test_no_underscore_id_anywhere(self, base_url, auth_client):
        endpoints = [
            "/api/billing/plans",
            "/api/billing/me",
            "/api/reminders",
            "/api/feedback/mine",
        ]
        for ep in endpoints:
            r = auth_client.get(f"{base_url}{ep}")
            assert r.status_code == 200, f"{ep}: {r.status_code}"
            assert '"_id"' not in r.text, f"{ep} leaks _id"
