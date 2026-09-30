"""New feature tests: admin contact fields on About + Supabase sync-without-config (HTTP 400)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or None
if not BASE_URL:
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break
assert BASE_URL, "BASE_URL not set"
API = f"{BASE_URL}/api"

CONTACT_KEYS = {"admin_email", "admin_phone", "admin_whatsapp"}


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_h(s):
    r = s.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def user_h(s):
    r = s.post(f"{API}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestAppConfigContactFields:
    """GET /api/app-config now includes admin_email/admin_phone/admin_whatsapp."""

    def test_public_config_has_contact_keys(self, s):
        r = s.get(f"{API}/app-config")
        assert r.status_code == 200
        data = r.json()
        assert CONTACT_KEYS.issubset(data.keys()), f"Missing: {CONTACT_KEYS - set(data.keys())}"
        for k in CONTACT_KEYS:
            assert isinstance(data[k], str)


class TestAdminAboutContacts:
    def test_non_admin_forbidden(self, s, user_h):
        # Fetch current about first as user (via /about)
        cur = s.get(f"{API}/about", headers=user_h)
        assert cur.status_code == 200
        payload = {**cur.json(),
                   "admin_email": "hack@evil.test",
                   "admin_phone": "000",
                   "admin_whatsapp": "000"}
        r = s.put(f"{API}/admin/about", headers=user_h, json=payload)
        assert r.status_code == 403

    def test_admin_saves_contacts_and_public_reflects(self, s, admin_h):
        # Snapshot current & restore afterwards
        orig = s.get(f"{API}/app-config").json()
        try:
            payload = {**orig,
                       "admin_email": "TEST_admin@example.com",
                       "admin_phone": "+62 812 1111 2222",
                       "admin_whatsapp": "+62 812 3333 4444"}
            r = s.put(f"{API}/admin/about", headers=admin_h, json=payload)
            assert r.status_code == 200, r.text
            saved = r.json()
            assert saved["admin_email"] == "TEST_admin@example.com"
            assert saved["admin_phone"] == "+62 812 1111 2222"
            assert saved["admin_whatsapp"] == "+62 812 3333 4444"

            # Public config reflects
            pub = s.get(f"{API}/app-config").json()
            assert pub["admin_email"] == "TEST_admin@example.com"
            assert pub["admin_phone"] == "+62 812 1111 2222"
            assert pub["admin_whatsapp"] == "+62 812 3333 4444"
        finally:
            # Restore original contact values (empty by default)
            restore = {**orig,
                       "admin_email": orig.get("admin_email", ""),
                       "admin_phone": orig.get("admin_phone", ""),
                       "admin_whatsapp": orig.get("admin_whatsapp", "")}
            s.put(f"{API}/admin/about", headers=admin_h, json=restore)


class TestSupabaseSyncWithoutConfig:
    """POST /api/admin/supabase/sync when not configured must return HTTP 400 (not 500)."""

    def test_sync_returns_400_when_unconfigured(self, s, admin_h):
        # Ensure not configured: GET reports configured status
        cur = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        if cur.get("configured"):
            pytest.skip("Supabase is currently configured; skipping sync-no-config test")
        r = s.post(f"{API}/admin/supabase/sync", headers=admin_h)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        detail = body.get("detail", "")
        assert isinstance(detail, str) and detail, "Missing/invalid detail"
        # Friendly Indonesian message expected
        assert any(w in detail.lower() for w in ("supabase", "sinkron", "belum")), detail

    def test_sync_forbidden_for_user(self, s, user_h):
        r = s.post(f"{API}/admin/supabase/sync", headers=user_h)
        assert r.status_code == 403


class TestRegressionCore:
    def test_customers_list_ok(self, s, user_h):
        r = s.get(f"{API}/customers", headers=user_h)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        # Ensure _id not leaked
        assert "_id" not in data[0]

    def test_dashboard_stats_ok(self, s, user_h):
        r = s.get(f"{API}/dashboard/statistics", headers=user_h)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_customer", "active_customer", "inactive_customer", "bad_debt_customer",
                  "by_status", "by_segment", "by_area"):
            assert k in d

    def test_admin_statistics_ok(self, s, admin_h):
        r = s.get(f"{API}/admin/statistics", headers=admin_h)
        assert r.status_code == 200
        d = r.json()
        assert d["total_customer"] >= 1

    def test_admin_customer_crud_soft_delete(self, s, admin_h):
        code = "TEST_CT99001"
        payload = {
            "customer_code": code, "customer_name": "TEST_ Contact CRUD",
            "segment": "Retail", "purchasing_size": "Small", "area": "Jakarta",
            "status": "Active", "payment_terms": "Cash", "credit_limit": 100000,
        }
        # Create
        r = s.post(f"{API}/customers", headers=admin_h, json=payload)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        try:
            # Update
            updated = {**payload, "customer_name": "TEST_ Contact CRUD Updated"}
            r2 = s.put(f"{API}/customers/{cid}", headers=admin_h, json=updated)
            assert r2.status_code == 200
            assert r2.json()["customer_name"] == "TEST_ Contact CRUD Updated"
            # GET verify
            r3 = s.get(f"{API}/customers/{cid}", headers=admin_h)
            assert r3.status_code == 200
            assert r3.json()["customer_name"] == "TEST_ Contact CRUD Updated"
        finally:
            # Soft delete
            r4 = s.delete(f"{API}/customers/{cid}", headers=admin_h)
            assert r4.status_code == 200
            r5 = s.get(f"{API}/customers/{cid}", headers=admin_h)
            assert r5.status_code == 404
