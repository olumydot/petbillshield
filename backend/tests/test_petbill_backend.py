"""End-to-end backend tests for PetBill Shield."""
import io
import json
import struct
import zlib
import requests
import pytest


# ---------------- helpers ----------------
def _no_underscore_id(payload):
    """Recursively assert no `_id` key leaks into JSON responses."""
    blob = json.dumps(payload)
    assert '"_id"' not in blob, f"_id leaked in response: {blob[:300]}"


def _make_png_bytes():
    """Generate a minimal valid 2x2 PNG image."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    raw = b"\x00" + b"\xff\x00\x00" * 2 + b"\x00" + b"\x00\xff\x00" * 2
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _make_pdf_bytes(text="Vet Exam Fee $85. Bloodwork CBC $120. Total $205."):
    """Minimal text-extractable PDF."""
    try:
        from pypdf import PdfWriter
    except ImportError:
        pytest.skip("pypdf not installed")
    # Easier: use reportlab if available
    try:
        from reportlab.pdfgen import canvas
        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        c.drawString(100, 750, text)
        c.save()
        return buf.getvalue()
    except ImportError:
        # fallback: raw minimal pdf
        return (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
                b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
                b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj\n"
                b"4 0 obj<</Length 80>>stream\nBT /F1 12 Tf 100 700 Td (" + text.encode() + b") Tj ET\nendstream\nendobj\n"
                b"xref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000111 00000 n\n0000000230 00000 n\n"
                b"trailer<</Size 5/Root 1 0 R>>\nstartxref\n360\n%%EOF")


# ---------------- root ----------------
class TestRoot:
    def test_root(self, base_url):
        r = requests.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


# ---------------- auth gating ----------------
class TestAuthGating:
    @pytest.mark.parametrize("path", [
        "/api/auth/me", "/api/pets", "/api/estimates", "/api/claims", "/api/stats/overview",
    ])
    def test_no_token_returns_401(self, base_url, path):
        r = requests.get(f"{base_url}{path}")
        assert r.status_code == 401, f"{path} returned {r.status_code}"

    def test_invalid_token_returns_401(self, base_url):
        r = requests.get(f"{base_url}/api/auth/me", headers={"Authorization": "Bearer bogus_xyz"})
        assert r.status_code == 401

    def test_post_session_bad(self, base_url):
        r = requests.post(f"{base_url}/api/auth/session", json={"session_id": "invalid_xyz_123"})
        # Should fail validating with Emergent
        assert r.status_code in (401, 400, 500)


# ---------------- auth me / logout ----------------
class TestAuthMe:
    def test_me_with_seeded_session(self, base_url, auth_client, seeded_user):
        r = auth_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert data["user_id"] == seeded_user["user_id"]
        assert data["email"] == seeded_user["email"]


# ---------------- pets CRUD ----------------
class TestPetsCRUD:
    pet_id = None

    def test_create_pet(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/pets", json={
            "name": "TEST_Mochi", "species": "cat", "breed": "Tabby", "age_years": 3.0,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["name"] == "TEST_Mochi"
        assert data["species"] == "cat"
        assert "pet_id" in data and data["pet_id"].startswith("pet_")
        TestPetsCRUD.pet_id = data["pet_id"]

    def test_list_pets(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/pets")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert any(p["pet_id"] == TestPetsCRUD.pet_id for p in data)

    def test_get_pet(self, base_url, auth_client):
        assert TestPetsCRUD.pet_id
        r = auth_client.get(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert data["pet_id"] == TestPetsCRUD.pet_id

    def test_update_pet(self, base_url, auth_client):
        r = auth_client.put(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}", json={
            "name": "TEST_Mochi", "species": "cat", "breed": "Persian", "age_years": 4.0,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["breed"] == "Persian"
        # verify persistence
        r2 = auth_client.get(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}")
        assert r2.json()["breed"] == "Persian"

    def test_user_isolation_get_404_other_id(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/pets/pet_nonexistent_xyz")
        assert r.status_code == 404


# ---------------- pet records ----------------
class TestPetRecords:
    record_id = None

    def test_add_record(self, base_url, auth_client):
        r = auth_client.post(
            f"{base_url}/api/pets/{TestPetsCRUD.pet_id}/records",
            json={"record_type": "invoice", "title": "Annual checkup", "amount_usd": 150.0, "date": "2025-06-01"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["title"] == "Annual checkup"
        assert data["amount_usd"] == 150.0
        TestPetRecords.record_id = data["record_id"]

    def test_list_records(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}/records")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert any(rec["record_id"] == TestPetRecords.record_id for rec in data)

    def test_delete_record(self, base_url, auth_client):
        r = auth_client.delete(
            f"{base_url}/api/pets/{TestPetsCRUD.pet_id}/records/{TestPetRecords.record_id}"
        )
        assert r.status_code == 200


# ---------------- stats ----------------
class TestStats:
    def test_overview(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/stats/overview")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        for k in ("total_pets", "total_estimates", "total_claims", "annual_spent_usd"):
            assert k in data
        assert data["total_pets"] >= 1


# ---------------- estimate analysis (AI) ----------------
class TestEstimateAnalysis:
    text_analysis_id = None

    def test_analyze_typed_text(self, base_url, auth_client):
        text = (
            "Wellness Exam $85. Bloodwork CBC/Chem $145. Dental cleaning $450. "
            "Rabies vaccine $35. Total estimate $715."
        )
        r = auth_client.post(
            f"{base_url}/api/estimates/analyze",
            data={"typed_text": text, "pet_name": "TEST_Mochi", "pet_species": "cat"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        _no_underscore_id(data)
        assert data["source_type"] == "text"
        assert "summary" in data
        assert isinstance(data["line_items"], list)
        assert isinstance(data["red_flags"], list)
        assert isinstance(data["questions_to_ask_vet"], list)
        assert isinstance(data["cost_saving_options"], list)
        assert isinstance(data["second_opinion_checklist"], list)
        assert data["disclaimer"]
        TestEstimateAnalysis.text_analysis_id = data["analysis_id"]

    def test_list_estimates(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/estimates")
        assert r.status_code == 200
        data = r.json()
        _no_underscore_id(data)
        assert any(e["analysis_id"] == TestEstimateAnalysis.text_analysis_id for e in data)

    def test_get_estimate(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/estimates/{TestEstimateAnalysis.text_analysis_id}")
        assert r.status_code == 200
        _no_underscore_id(r.json())

    def test_analyze_image(self, base_url, auth_client):
        png = _make_png_bytes()
        files = {"file": ("estimate.png", png, "image/png")}
        data = {"pet_name": "TEST_Mochi", "pet_species": "cat"}
        r = auth_client.post(f"{base_url}/api/estimates/analyze", data=data, files=files)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        _no_underscore_id(body)
        assert body["source_type"] == "image"

    def test_analyze_pdf(self, base_url, auth_client):
        pdf = _make_pdf_bytes("Vet Exam Fee $85. Bloodwork CBC $120. Total $205.")
        files = {"file": ("estimate.pdf", pdf, "application/pdf")}
        data = {"pet_name": "TEST_Mochi", "pet_species": "cat"}
        r = auth_client.post(f"{base_url}/api/estimates/analyze", data=data, files=files)
        # PDF extraction may fail on raw minimal pdf — accept either success or 400 with helpful message
        if r.status_code == 400:
            assert "PDF" in r.text or "text" in r.text.lower()
        else:
            assert r.status_code == 200, r.text[:300]
            body = r.json()
            _no_underscore_id(body)
            assert body["source_type"] == "pdf"

    def test_analyze_no_content(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/estimates/analyze", data={})
        assert r.status_code == 400

    def test_delete_estimate(self, base_url, auth_client):
        r = auth_client.delete(f"{base_url}/api/estimates/{TestEstimateAnalysis.text_analysis_id}")
        assert r.status_code == 200
        r2 = auth_client.get(f"{base_url}/api/estimates/{TestEstimateAnalysis.text_analysis_id}")
        assert r2.status_code == 404


# ---------------- claim analysis (AI) ----------------
class TestClaimAnalysis:
    claim_id = None

    def test_analyze_claim(self, base_url, auth_client):
        policy = ("Healthy Paws Pet Insurance. 80% reimbursement after $250 annual deductible. "
                  "Covers illness and injury. Excludes pre-existing conditions and routine wellness.")
        invoice = "Emergency exam $150. X-ray $200. Pain medication $40. Total $390."
        r = auth_client.post(
            f"{base_url}/api/claims/analyze",
            data={"insurer": "Healthy Paws", "policy_text": policy, "invoice_text": invoice},
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        _no_underscore_id(data)
        assert "likely_reimbursable_categories" in data
        assert "missing_documents" in data
        assert "appeal_draft" in data
        assert data["disclaimer"]
        TestClaimAnalysis.claim_id = data["claim_id"]

    def test_list_claims(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/claims")
        assert r.status_code == 200
        _no_underscore_id(r.json())

    def test_get_claim(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/claims/{TestClaimAnalysis.claim_id}")
        assert r.status_code == 200
        _no_underscore_id(r.json())


# ---------------- scripts ----------------
class TestScripts:
    def test_generate_script(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/scripts/generate", json={
            "situation": "Estimate is $2000 for dental, want to ask for cost-saving options",
            "tone": "polite",
            "pet_name": "TEST_Mochi",
            "pet_species": "cat",
            "estimated_cost_usd": 2000,
        })
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        _no_underscore_id(data)
        assert "script" in data and isinstance(data["script"], str)
        assert "follow_up_questions" in data and isinstance(data["follow_up_questions"], list)
        assert len(data["script"]) > 20


# ---------------- pet delete (last, after records) ----------------
class TestPetDelete:
    def test_delete_pet(self, base_url, auth_client):
        r = auth_client.delete(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}")
        assert r.status_code == 200
        r2 = auth_client.get(f"{base_url}/api/pets/{TestPetsCRUD.pet_id}")
        assert r2.status_code == 404


# ---------------- logout ----------------
class TestLogout:
    def test_logout(self, base_url, seeded_user):
        # Use a brand new session for this test so we don't kill the shared fixture session.
        # Create new session via mongosh
        import subprocess, time as _t
        ts = int(_t.time() * 1000)
        token = f"test_session_logout_{ts}"
        subprocess.run(["mongosh", "--quiet", "--eval",
                        f"use('test_database'); db.user_sessions.insertOne({{user_id:'{seeded_user['user_id']}', "
                        f"session_token:'{token}', expires_at: new Date(Date.now()+86400000).toISOString(), "
                        f"created_at: new Date().toISOString()}});"], capture_output=True)
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {token}"})
        r = s.post(f"{base_url}/api/auth/logout")
        assert r.status_code == 200
        # Verify session is dead
        r2 = s.get(f"{base_url}/api/auth/me")
        assert r2.status_code == 401
