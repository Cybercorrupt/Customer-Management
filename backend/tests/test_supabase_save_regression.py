"""Regression: failed Supabase Save must NOT corrupt existing config.

Covers the review-request bug: previously a failed PUT /api/admin/supabase would
overwrite project_url with the bogus URL being tested, breaking Sync Now. The
fix persists project_url/service_role_key/configured ONLY when the connection
test succeeds. A failed save just records last_test_ok=false + updated_at.

This file verifies the fix regardless of the baseline (configured or not):

  1) Baseline shape sanity — no secret leak.
  2) PUT with bogus (unreachable) https URL + dummy key → {ok:false}, and the
     stored project_url / configured / (ciphertext presence) are UNCHANGED.
     (Only last_test_ok=false + updated_at may change.)
  3) PUT with http:// → 422 validator.
  4) POST /api/admin/supabase/test with bogus https → 200 {ok:false,
     message includes 'tidak dapat dijangkau'}.
  5) POST /api/admin/supabase/sync when unconfigured → clean HTTP 400 JSON with
     the Indonesian detail. When configured+enabled we assert JSON (200 or 400,
     never 5xx/HTML).
  6) Auto-push resilience: POST/PUT/DELETE /api/customers still 201/200/200
     (create TESTFIX_<rand>, soft-delete to clean up).
  7) All /api/admin/supabase* endpoints reject user token (403) & missing (401).
  8) Regression: /api/login, /api/customers, /api/dashboard/statistics work.
"""
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


BOGUS_URL = "https://this-does-not-exist-abc123.supabase.co"
DUMMY_KEY = "TEST_dummy_service_role_key_never_persisted_abcdefghijk"  # >=20 chars


# ---------- Baseline shape sanity ----------
class TestBaselineShape:
    def test_get_shape_no_secret_leak(self, s, admin_h):
        r = s.get(f"{API}/admin/supabase", headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("configured", "project_url", "last_test_ok", "updated_at",
                  "sync_enabled", "last_sync_at"):
            assert k in d, f"missing key: {k}"
        # No secret leak
        assert "service_role_key" not in d
        assert "service_role_key_ciphertext" not in d


# ---------- CORE FIX: failed Save must NOT corrupt existing config ----------
class TestFailedSaveDoesNotCorruptConfig:
    def test_bogus_https_put_preserves_existing_config(self, s, admin_h):
        """Whether currently configured or not, a failed PUT must leave
        project_url + configured untouched. This is the exact regression."""
        before = s.get(f"{API}/admin/supabase", headers=admin_h).json()

        r = s.put(
            f"{API}/admin/supabase",
            headers=admin_h,
            json={"project_url": BOGUS_URL, "service_role_key": DUMMY_KEY},
        )
        assert r.status_code == 200, f"PUT should be 200 with ok:false; got {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("ok") is False, f"expected ok:false for unreachable host; got {body}"
        assert body.get("configured") in (False, None), (
            f"response.configured must not be True on failed test; got {body}"
        )

        after = s.get(f"{API}/admin/supabase", headers=admin_h).json()

        # CORE ASSERTIONS: failed save must NOT overwrite project_url or configured
        assert after["project_url"] == before["project_url"], (
            f"BUG REGRESSION: bogus URL was persisted!\n"
            f"before.project_url={before['project_url']!r}\n"
            f"after.project_url ={after['project_url']!r}"
        )
        assert after["configured"] == before["configured"], (
            f"BUG REGRESSION: configured flag changed!\n"
            f"before.configured={before['configured']} after.configured={after['configured']}"
        )
        # bogus URL must not be persisted anywhere visible
        assert BOGUS_URL not in str(after), f"bogus URL leaked into config: {after}"
        # last_test_ok should reflect the failed attempt
        assert after["last_test_ok"] is False
        # Still no secret leak
        assert "service_role_key" not in after
        assert "service_role_key_ciphertext" not in after


# ---------- Validator: non-https rejected ----------
class TestValidator:
    def test_put_non_https_returns_422(self, s, admin_h):
        r = s.put(
            f"{API}/admin/supabase",
            headers=admin_h,
            json={"project_url": "http://example.com", "service_role_key": DUMMY_KEY},
        )
        assert r.status_code == 422, f"expected 422 for http://; got {r.status_code}: {r.text[:300]}"

    def test_test_non_https_returns_422(self, s, admin_h):
        r = s.post(
            f"{API}/admin/supabase/test",
            headers=admin_h,
            json={"project_url": "http://example.com", "service_role_key": DUMMY_KEY},
        )
        assert r.status_code == 422, f"expected 422 for http://; got {r.status_code}: {r.text[:300]}"


# ---------- /test with bogus https → 200 {ok:false} with tidak dapat dijangkau ----------
class TestConnectionTest:
    def test_bogus_https_graceful(self, s, admin_h):
        r = s.post(
            f"{API}/admin/supabase/test",
            headers=admin_h,
            json={"project_url": BOGUS_URL, "service_role_key": DUMMY_KEY},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is False, f"expected ok:false; got {d}"
        msg = d.get("message", "")
        assert isinstance(msg, str) and msg, "message should be non-empty"
        assert "tidak dapat dijangkau" in msg.lower(), (
            f"expected 'tidak dapat dijangkau' in message; got: {msg!r}"
        )


# ---------- Sync endpoint returns clean JSON (never 5xx / HTML) ----------
class TestSyncCleanJson:
    def test_sync_returns_json(self, s, admin_h):
        r = s.post(f"{API}/admin/supabase/sync", headers=admin_h)
        # 200 if remote table exists, 400 if not configured or table missing.
        assert r.status_code in (200, 400), f"unexpected {r.status_code}: {r.text[:300]}"
        ct = r.headers.get("content-type", "")
        assert "application/json" in ct, f"expected JSON, got {ct}: {r.text[:200]}"
        d = r.json()
        if r.status_code == 400:
            detail = d.get("detail", "")
            assert isinstance(detail, str) and detail
            # Must mention supabase / customers / sync context (Indonesian friendly)
            low = detail.lower()
            assert any(k in low for k in ("supabase", "customers", "sinkron")), (
                f"detail should reference supabase/customers/sinkron: {detail!r}"
            )

    def test_sync_clean_400_when_unconfigured(self, s, admin_h):
        """If currently unconfigured, sync must return exact Indonesian detail."""
        cur = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        if cur.get("configured"):
            pytest.skip("Supabase is currently configured — clean-400-when-unconfigured not applicable here")
        r = s.post(f"{API}/admin/supabase/sync", headers=admin_h)
        assert r.status_code == 400, r.text
        assert "application/json" in r.headers.get("content-type", "")
        assert r.json().get("detail") == "Supabase belum terhubung atau sinkronisasi dinonaktifkan"


# ---------- Auto-push resilience ----------
class TestCrudResilient:
    def test_customer_crud_still_works(self, s, admin_h):
        code = f"TESTFIX_{_rand()}"
        payload = {
            "customer_code": code,
            "customer_name": "TEST_ resilience save-fix",
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
        r = s.post(f"{API}/customers", headers=admin_h, json=payload)
        assert r.status_code == 201, f"CREATE failed: {r.status_code} {r.text[:300]}"
        cid = r.json()["id"]
        try:
            r2 = s.put(
                f"{API}/customers/{cid}",
                headers=admin_h,
                json={**payload, "customer_name": "TEST_ resilience save-fix v2"},
            )
            assert r2.status_code == 200, f"UPDATE failed: {r2.status_code} {r2.text[:300]}"
            assert r2.json()["customer_name"] == "TEST_ resilience save-fix v2"
        finally:
            r3 = s.delete(f"{API}/customers/{cid}", headers=admin_h)
            assert r3.status_code == 200, f"DELETE failed: {r3.status_code} {r3.text[:300]}"


# ---------- Auth on all /admin/supabase* ----------
class TestAdminSupabaseAuth:
    ENDPOINTS = [
        ("GET", "/admin/supabase", None),
        ("PUT", "/admin/supabase", {"project_url": "https://x.supabase.co", "service_role_key": DUMMY_KEY}),
        ("POST", "/admin/supabase/test", {"project_url": "https://x.supabase.co", "service_role_key": DUMMY_KEY}),
        ("POST", "/admin/supabase/sync", None),
        ("POST", "/admin/supabase/sync-toggle", {"enabled": True}),
    ]

    def test_missing_token_401(self, s):
        for method, path, body in self.ENDPOINTS:
            r = s.request(method, f"{API}{path}", json=body)
            assert r.status_code == 401, f"{method} {path} expected 401, got {r.status_code}: {r.text[:200]}"

    def test_user_token_403(self, s, user_h):
        for method, path, body in self.ENDPOINTS:
            r = s.request(method, f"{API}{path}", headers=user_h, json=body)
            assert r.status_code == 403, f"{method} {path} expected 403, got {r.status_code}: {r.text[:200]}"


# ---------- Regression ----------
class TestRegression:
    def test_login_ok(self, s):
        r = s.post(f"{API}/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_customers_list(self, s, admin_h):
        r = s.get(f"{API}/customers", headers=admin_h, params={"search": "a", "limit": 5})
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_dashboard_stats(self, s, admin_h):
        r = s.get(f"{API}/dashboard/statistics", headers=admin_h)
        assert r.status_code == 200
