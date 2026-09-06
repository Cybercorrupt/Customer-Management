"""Backend tests for iteration-8 features:
- /api/about (MeO-Labs + no 'platform')
- /api/admin/supabase (has_access_token field)
- /api/admin/supabase/schema-status (all_present, 7 tables)
- /api/admin/conflicts/count (count field)
- /api/admin/supabase/ensure-schema (400 when no PAT)
- Auth (user, admin, 403 for user on admin routes)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://customer-hub-523.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EXPECTED_TABLES = {
    "customers",
    "purchasing_sizes",
    "segments",
    "payment_terms",
    "areas",
    "app_users",
    "app_config",
}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_token(session):
    r = session.post(f"{API}/login", json={"username": "user", "password": "user123"}, timeout=15)
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ---- Auth tests ----
class TestAuth:
    def test_user_login(self, session):
        r = session.post(f"{API}/login", json={"username": "user", "password": "user123"}, timeout=15)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_admin_login(self, session):
        r = session.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"}, timeout=15)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_user_403_on_admin_route(self, session, user_token):
        r = session.get(f"{API}/admin/supabase", headers={"Authorization": f"Bearer {user_token}"}, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_admin_login_rejects_non_admin(self, session):
        r = session.post(f"{API}/admin/login", json={"username": "user", "password": "user123"}, timeout=15)
        assert r.status_code in (401, 403)


# ---- About ----
class TestAbout:
    def test_about_meO_labs(self, session, user_token):
        r = session.get(f"{API}/about", headers={"Authorization": f"Bearer {user_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("app_name") == "Customer Data Management", j
        assert j.get("developer") == "MeO-Labs", j
        assert j.get("author") == "MeO-Labs", j
        assert "platform" not in j, f"'platform' should not be present: keys={list(j.keys())}"
        assert "MeO-Labs" in j.get("copyright", ""), j


# ---- Supabase admin ----
class TestSupabaseAdmin:
    def test_supabase_has_access_token_field(self, session, admin_token):
        r = session.get(f"{API}/admin/supabase", headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "has_access_token" in j, f"missing 'has_access_token': {list(j.keys())}"
        assert isinstance(j["has_access_token"], bool)

    def test_schema_status_all_present(self, session, admin_token):
        r = session.get(f"{API}/admin/supabase/schema-status", headers={"Authorization": f"Bearer {admin_token}"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "tables" in j and "missing" in j and "all_present" in j
        table_names = {t["table"] for t in j["tables"]}
        assert table_names == EXPECTED_TABLES, f"tables mismatch: got {table_names}"
        for t in j["tables"]:
            assert "exists" in t and isinstance(t["exists"], bool)
        assert j["all_present"] is True, f"expected all_present=True, missing={j['missing']}"
        assert j["missing"] == []

    def test_ensure_schema_400_without_pat(self, session, admin_token):
        # No token stored (verified by has_access_token=false) and empty body → must 400
        r = session.post(
            f"{API}/admin/supabase/ensure-schema",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        detail = ""
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        assert "Personal Access Token" in detail or "personal access token" in detail.lower(), detail


# ---- Conflicts count ----
class TestConflictsCount:
    def test_conflicts_count(self, session, admin_token):
        r = session.get(f"{API}/admin/conflicts/count", headers={"Authorization": f"Bearer {admin_token}"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "count" in j
        assert isinstance(j["count"], int)
        assert j["count"] >= 0

    def test_conflicts_count_user_403(self, session, user_token):
        r = session.get(f"{API}/admin/conflicts/count", headers={"Authorization": f"Bearer {user_token}"}, timeout=15)
        assert r.status_code == 403
