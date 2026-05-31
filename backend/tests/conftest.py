"""Shared fixtures for PetBill Shield backend tests."""
import os
import time
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pawcost-guard.preview.emergentagent.com").rstrip("/")


def _seed_session():
    """Seed a user + session into mongo via mongosh. Returns (token, user_id, email)."""
    ts = int(time.time() * 1000)
    user_id = f"test-user-{ts}"
    token = f"test_session_{ts}"
    email = f"test.user.{ts}@example.com"
    script = f"""
use('test_database');
db.users.insertOne({{
  user_id: '{user_id}',
  email: '{email}',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date().toISOString()
}});
db.user_sessions.insertOne({{
  user_id: '{user_id}',
  session_token: '{token}',
  expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  created_at: new Date().toISOString()
}});
"""
    subprocess.run(["mongosh", "--quiet", "--eval", script], check=True, capture_output=True)
    return token, user_id, email


@pytest.fixture(scope="session")
def seeded_user():
    token, user_id, email = _seed_session()
    yield {"token": token, "user_id": user_id, "email": email}
    # cleanup
    cleanup = f"""
use('test_database');
db.user_sessions.deleteMany({{user_id: '{user_id}'}});
db.users.deleteMany({{user_id: '{user_id}'}});
db.pets.deleteMany({{user_id: '{user_id}'}});
db.pet_records.deleteMany({{user_id: '{user_id}'}});
db.estimates.deleteMany({{user_id: '{user_id}'}});
db.claims.deleteMany({{user_id: '{user_id}'}});
db.reminders.deleteMany({{user_id: '{user_id}'}});
db.payment_transactions.deleteMany({{user_id: '{user_id}'}});
db.feedback.deleteMany({{user_id: '{user_id}'}});
"""
    subprocess.run(["mongosh", "--quiet", "--eval", cleanup], capture_output=True)


@pytest.fixture(scope="session")
def auth_client(seeded_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {seeded_user['token']}"})
    return s


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL
