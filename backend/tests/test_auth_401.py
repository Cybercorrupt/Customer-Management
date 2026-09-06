"""Backend tests for JWT 401 handling and login flows (bug fix retest)."""
import os
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://crm-hub-564.preview.emergentagent.com").rstrip("/") + "/api"

EXPECTED_MISSING = "Invalid or missing authentication token"
EXPECTED_BAD_CREDS = "Username atau password salah"


# --- 401: missing / invalid token on protected routes ---
def test_customers_missing_token_returns_401():
    r = requests.get(f"{BASE_URL}/customers")
    assert r.status_code == 401
    assert r.json().get("detail") == EXPECTED_MISSING


def test_customers_invalid_bearer_returns_401():
    r = requests.get(f"{BASE_URL}/customers", headers={"Authorization": "Bearer garbage.jwt.token"})
    assert r.status_code == 401
    assert r.json().get("detail") == EXPECTED_MISSING


def test_auth_me_missing_token_returns_401():
    r = requests.get(f"{BASE_URL}/auth/me")
    assert r.status_code == 401
    assert r.json().get("detail") == EXPECTED_MISSING


# --- login: valid + invalid credentials ---
def test_user_login_success_and_me():
    r = requests.post(f"{BASE_URL}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and data["user"]["role"] == "user"
    token = data["access_token"]
    me = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "user"


def test_admin_login_success_and_me():
    r = requests.post(f"{BASE_URL}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "admin"
    token = data["access_token"]
    me = requests.get(f"{BASE_URL}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["role"] == "admin"


def test_user_login_bad_password_returns_credential_error_not_session_error():
    r = requests.post(f"{BASE_URL}/login", json={"username": "user", "password": "WRONG"})
    assert r.status_code == 401
    detail = r.json().get("detail")
    assert detail == EXPECTED_BAD_CREDS
    # Critical: bad login must NOT return the session-expiry message (else frontend interceptor issue)
    assert detail != EXPECTED_MISSING


def test_admin_login_bad_password_returns_credential_error():
    r = requests.post(f"{BASE_URL}/admin/login", json={"username": "admin", "password": "WRONG"})
    assert r.status_code == 401
    assert r.json().get("detail") == EXPECTED_BAD_CREDS


def test_customers_with_valid_token_returns_200():
    r = requests.post(f"{BASE_URL}/login", json={"username": "user", "password": "user123"})
    token = r.json()["access_token"]
    lst = requests.get(f"{BASE_URL}/customers", headers={"Authorization": f"Bearer {token}"})
    assert lst.status_code == 200
    assert isinstance(lst.json(), list)
