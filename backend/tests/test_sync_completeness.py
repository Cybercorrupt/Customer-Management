"""Sync completeness audit (Jan 2026).

Verifies that after the 'areas' table was provisioned in Supabase, ALL sync
entities push to Supabase without PGRST205/PGRST204 errors and queue_failed
stays at 0.

Coverage (per review_request):
  1. Baseline: queue_failed == 0 and queue_last_error is None.
  2. Customer CRUD -> drain -> queue clean.
  3. Every master (purchasing_size, segment, top, area) CRUD -> drain -> clean.
  4. Admin user (app_users) CRUD -> drain -> clean.
  5. About/app-settings update (app_config) -> drain -> clean.
  6. Soft-delete (tombstone) pushes deleted_at without error.
  7. POST /api/admin/supabase/pull returns summary for all 5 entities
     without 'tabel tidak ditemukan' errors.
  8. Regression: /api/sync/pull-now (user), /api/admin/trash/customer,
     /api/admin/conflicts still work.
"""
import os
import random
import string
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or None
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
assert BASE_URL, "BASE_URL not set"
API = f"{BASE_URL}/api"


def _rand():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


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


def _drain_and_stats(s, admin_h, wait_after=1.5):
    """Force a sync drain and return queue stats after it settles."""
    r = s.post(f"{API}/admin/supabase/sync", headers=admin_h)
    # 200 when configured; 400 when not. We accept both, but the point is to
    # trigger a drain. Body has `result` counters when 200.
    assert r.status_code in (200, 400), f"drain {r.status_code}: {r.text[:200]}"
    time.sleep(wait_after)
    q = s.get(f"{API}/admin/supabase", headers=admin_h).json()
    return q


def _assert_queue_clean(q, ctx=""):
    assert q.get("queue_failed", 0) == 0, (
        f"[{ctx}] queue_failed={q.get('queue_failed')} last_error={q.get('queue_last_error')!r}"
    )
    assert q.get("queue_last_error") in (None, ""), (
        f"[{ctx}] queue_last_error not clear: {q.get('queue_last_error')!r}"
    )


# ---------------- 0) BASELINE ----------------
class TestBaseline:
    def test_baseline_queue_clean(self, s, admin_h):
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "baseline")
        assert q.get("configured") is True
        assert q.get("sync_enabled") is True

    def test_sync_status_not_failed(self, s, admin_h):
        r = s.get(f"{API}/sync/status", headers=admin_h)
        assert r.status_code == 200, r.text
        st = r.json()
        assert st["status"] != "sync_failed", f"status={st}"


# ---------------- 1) CUSTOMER CRUD ----------------
class TestCustomerSync:
    def test_customer_crud_no_errors(self, s, admin_h):
        code = f"TEST_C_{_rand()}"
        payload = {
            "customer_code": code,
            "customer_name": "TEST_ sync-completeness",
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
        # CREATE
        r = s.post(f"{API}/customers", headers=admin_h, json=payload)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "customer.create")

        # UPDATE
        r2 = s.put(f"{API}/customers/{cid}", headers=admin_h,
                   json={**payload, "customer_name": "TEST_ sync-completeness v2"})
        assert r2.status_code == 200, r2.text
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "customer.update")

        # DELETE (soft-delete -> tombstone push)
        r3 = s.delete(f"{API}/customers/{cid}", headers=admin_h)
        assert r3.status_code == 200, r3.text
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "customer.delete/tombstone")

        # Purge (hard delete) to keep DB tidy
        try:
            s.delete(f"{API}/admin/trash/customer/{cid}/purge", headers=admin_h)
        except Exception:
            pass


# ---------------- 2) MASTER CRUD (all 4 types incl area) ----------------
MASTER_TYPES = ["purchasing_size", "segment", "top", "area"]


class TestMasterSync:
    @pytest.mark.parametrize("etype", MASTER_TYPES)
    def test_master_crud_no_errors(self, s, admin_h, etype):
        name = f"TEST_M_{etype}_{_rand()}"
        # CREATE
        r = s.post(f"{API}/admin/master/{etype}", headers=admin_h,
                   json={"name": name, "description": "TEST desc"})
        assert r.status_code == 201, f"[{etype}] create {r.status_code}: {r.text[:200]}"
        mid = r.json()["id"]
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, f"master.{etype}.create")

        # UPDATE
        r2 = s.put(f"{API}/admin/master/{etype}/{mid}", headers=admin_h,
                   json={"name": name + "_v2", "description": "TEST desc v2"})
        assert r2.status_code == 200, f"[{etype}] update {r2.status_code}: {r2.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, f"master.{etype}.update")

        # DELETE (soft) -> pushes deleted_at
        r3 = s.delete(f"{API}/admin/master/{etype}/{mid}", headers=admin_h)
        assert r3.status_code == 200, f"[{etype}] delete {r3.status_code}: {r3.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, f"master.{etype}.delete/tombstone")

        # Purge to keep DB tidy
        try:
            s.delete(f"{API}/admin/trash/{etype}/{mid}/purge", headers=admin_h)
        except Exception:
            pass


# ---------------- 3) ADMIN USER (app_users) CRUD ----------------
class TestUserSync:
    def test_admin_user_crud_no_errors(self, s, admin_h):
        uname = f"testu{_rand().lower()}"
        # CREATE
        r = s.post(f"{API}/admin/users", headers=admin_h, json={
            "username": uname, "name": f"TEST_ {uname}", "password": "temp1234", "role": "user",
        })
        assert r.status_code == 201, f"user.create {r.status_code}: {r.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "user.create")

        # UPDATE (PATCH name)
        r2 = s.patch(f"{API}/admin/users/{uname}", headers=admin_h, json={"name": f"TEST_ {uname} v2"})
        assert r2.status_code == 200, f"user.update {r2.status_code}: {r2.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "user.update")

        # DELETE
        r3 = s.delete(f"{API}/admin/users/{uname}", headers=admin_h)
        assert r3.status_code in (200, 204), f"user.delete {r3.status_code}: {r3.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "user.delete")


# ---------------- 4) ABOUT / app_config ----------------
class TestAboutSync:
    def test_about_update_no_errors(self, s, admin_h):
        orig = s.get(f"{API}/app-config").json()
        payload = {**orig, "tagline": f"TEST_ tag_{_rand()}"}
        r = s.put(f"{API}/admin/about", headers=admin_h, json=payload)
        assert r.status_code == 200, f"about.update {r.status_code}: {r.text[:200]}"
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "about.update")

        # Restore
        r2 = s.put(f"{API}/admin/about", headers=admin_h, json=orig)
        assert r2.status_code == 200
        q = _drain_and_stats(s, admin_h)
        _assert_queue_clean(q, "about.restore")


# ---------------- 5) CONFLICT-SAFE PULL (all 5 entities) ----------------
class TestPull:
    def test_pull_returns_summary_no_errors(self, s, admin_h):
        r = s.post(f"{API}/admin/supabase/pull", headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("success") is True
        summary = d.get("summary") or {}
        expected = {"customer", "purchasing_size", "segment", "top", "area"}
        missing = expected - set(summary.keys())
        assert not missing, f"pull summary missing entities: {missing}. got: {summary}"
        for et in expected:
            s_e = summary[et]
            # No table-missing / column-missing errors expected now
            err = s_e.get("error")
            assert err in (None, ""), f"pull[{et}] error: {err!r}"
            for k in ("created", "updated", "skipped"):
                assert k in s_e, f"pull[{et}] missing key {k}: {s_e}"


# ---------------- 6) REGRESSION ----------------
class TestRegression:
    def test_sync_pull_now_user(self, s, user_h):
        r = s.post(f"{API}/sync/pull-now", headers=user_h)
        assert r.status_code == 200, f"pull-now(user) {r.status_code}: {r.text[:200]}"
        d = r.json()
        assert d.get("success") is True
        assert "applied" in d
        assert "last_pull_at" in d

    def test_admin_trash_customer(self, s, admin_h):
        r = s.get(f"{API}/admin/trash/customer", headers=admin_h)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_conflicts_list(self, s, admin_h):
        r = s.get(f"{API}/admin/conflicts", headers=admin_h)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_final_queue_clean(self, s, admin_h):
        """After ALL operations above, the queue MUST still be clean."""
        q = _drain_and_stats(s, admin_h, wait_after=2.0)
        _assert_queue_clean(q, "final")
        r = s.get(f"{API}/sync/status", headers=admin_h)
        assert r.status_code == 200
        assert r.json()["status"] != "sync_failed"
