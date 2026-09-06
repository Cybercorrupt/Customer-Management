"""Tahap: Two-way sync (sync-toggle, sync, CRUD auto-push resilience)."""
import os
import random
import string
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


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_h(s):
    r = s.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def user_h(s):
    r = s.post(f"{API}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _rand():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------- GET /api/admin/supabase now has sync fields ----------
class TestSupabaseShapeExtended:
    def test_shape_has_sync_fields(self, s, admin_h):
        r = s.get(f"{API}/admin/supabase", headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("configured", "project_url", "last_test_ok", "updated_at",
                  "sync_enabled", "last_sync_at"):
            assert k in d, f"missing key: {k}"
        assert isinstance(d["sync_enabled"], bool)
        # No secret leak
        assert "service_role_key" not in d
        assert "service_role_key_ciphertext" not in d


# ---------- POST /api/admin/supabase/sync-toggle ----------
class TestSyncToggle:
    def test_no_auth_401(self, s):
        r = s.post(f"{API}/admin/supabase/sync-toggle", json={"enabled": True})
        assert r.status_code == 401

    def test_user_forbidden_403(self, s, user_h):
        r = s.post(f"{API}/admin/supabase/sync-toggle", headers=user_h, json={"enabled": True})
        assert r.status_code == 403

    def test_admin_toggle_roundtrip(self, s, admin_h):
        # Ensure configured (per review context, real project is stored)
        cur = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        if not cur.get("configured"):
            pytest.skip("Supabase not configured — toggle expected to return 400 here")

        # OFF
        r = s.post(f"{API}/admin/supabase/sync-toggle", headers=admin_h, json={"enabled": False})
        assert r.status_code == 200, r.text
        assert r.json() == {"sync_enabled": False}
        after = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        assert after["sync_enabled"] is False

        # ON (restore)
        r = s.post(f"{API}/admin/supabase/sync-toggle", headers=admin_h, json={"enabled": True})
        assert r.status_code == 200, r.text
        assert r.json() == {"sync_enabled": True}
        after = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        assert after["sync_enabled"] is True


# ---------- POST /api/admin/supabase/sync ----------
class TestSyncRun:
    def test_no_auth_401(self, s):
        r = s.post(f"{API}/admin/supabase/sync")
        assert r.status_code == 401

    def test_user_forbidden_403(self, s, user_h):
        r = s.post(f"{API}/admin/supabase/sync", headers=user_h)
        assert r.status_code == 403

    def test_admin_sync_returns_clean_400_when_table_missing(self, s, admin_h):
        """Remote 'customers' table doesn't exist → must return clean 400 JSON, NOT 5xx/HTML."""
        r = s.post(f"{API}/admin/supabase/sync", headers=admin_h)
        # If configured but table missing → 400. If somehow succeeded (table exists) → 200.
        assert r.status_code in (200, 400), f"unexpected {r.status_code}: {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct, f"expected JSON, got {ct}: {r.text[:200]}"
        d = r.json()
        if r.status_code == 400:
            detail = d.get("detail", "")
            assert isinstance(detail, str) and detail, "detail should be non-empty string"
            assert ("customers" in detail.lower()
                    or "supabase" in detail.lower()), f"detail should mention table/supabase: {detail}"


# ---------- Customer CRUD must not break when auto-push fails silently ----------
class TestCrudResilientToSyncFailure:
    def test_crud_still_works_when_remote_table_missing(self, s, admin_h):
        code = f"TESTSYNC_{_rand()}"
        payload = {
            "customer_code": code,
            "customer_name": "TEST_ sync resilience",
            "segment": "Retail",
            "purchasing_size": "Kecil",
            "area": "Test Area",
            "status": "Active",
            "bad_debt": False,
            "bad_debt_nominal": 0,
            "address": "TEST",
            "phone": "0800000000",
            "whatsapp": "0800000000",
            "pic_name": "TEST PIC",
            "payment_terms": "COD",
            "credit_limit": 0,
        }
        # CREATE — must return 201 even though background push will fail
        r = s.post(f"{API}/customers", headers=admin_h, json=payload)
        assert r.status_code == 201, f"CREATE failed: {r.status_code} {r.text[:300]}"
        created = r.json()
        cid = created["id"]
        assert created["customer_code"] == code

        try:
            # UPDATE — must return 200
            r2 = s.put(f"{API}/customers/{cid}", headers=admin_h,
                       json={**payload, "customer_name": "TEST_ sync resilience v2"})
            assert r2.status_code == 200, f"UPDATE failed: {r2.status_code} {r2.text[:300]}"
            assert r2.json()["customer_name"] == "TEST_ sync resilience v2"
        finally:
            # DELETE (soft) — must return 200 (cleanup)
            r3 = s.delete(f"{API}/customers/{cid}", headers=admin_h)
            assert r3.status_code == 200, f"DELETE failed: {r3.status_code} {r3.text[:300]}"


# ---------- Bulk endpoints unaffected ----------
class TestBulkResilient:
    def test_bulk_status_still_ok(self, s, admin_h):
        # Create a temp customer to bulk-update
        code = f"TESTSYNC_{_rand()}"
        payload = {
            "customer_code": code, "customer_name": "TEST_ bulk",
            "segment": "Retail", "purchasing_size": "Kecil", "area": "T",
            "status": "Active", "bad_debt": False, "bad_debt_nominal": 0,
            "address": "T", "phone": "0", "whatsapp": "0",
            "pic_name": "T", "payment_terms": "COD", "credit_limit": 0,
        }
        c = s.post(f"{API}/customers", headers=admin_h, json=payload)
        assert c.status_code == 201, c.text
        cid = c.json()["id"]
        try:
            r = s.post(f"{API}/admin/customers/bulk-status", headers=admin_h,
                       json={"ids": [cid], "status": "Inactive"})
            assert r.status_code in (200, 201), f"bulk-status failed: {r.status_code} {r.text[:300]}"
            body = r.json()
            # Success-ish shape (updated/matched/modified count)
            assert isinstance(body, dict)
        finally:
            s.delete(f"{API}/customers/{cid}", headers=admin_h)


# ---------- Regression: existing surfaces still work ----------
class TestRegression:
    def test_login_ok(self, s):
        r = s.post(f"{API}/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_app_config_public(self, s):
        r = s.get(f"{API}/app-config")
        assert r.status_code == 200
        assert "app_name" in r.json()

    def test_customers_search(self, s, admin_h):
        for q in ("a", "TEST", "0"):
            r = s.get(f"{API}/customers", headers=admin_h, params={"search": q, "limit": 5})
            assert r.status_code == 200, r.text
            body = r.json()
            assert isinstance(body, (list, dict))

    def test_dashboard_statistics(self, s, admin_h):
        r = s.get(f"{API}/dashboard/statistics", headers=admin_h)
        assert r.status_code == 200

    def test_upload_logo_still_200(self, s, admin_h):
        import io
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
               b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("logo.png", io.BytesIO(png), "image/png")}
        r = s.post(f"{API}/admin/upload-logo", headers=admin_h, files=files)
        assert r.status_code == 200, r.text
        assert r.json()["logo_url"].startswith("/api/files/")
