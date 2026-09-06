"""Verify DELETE /api/customers/{id} results in HARD delete from Supabase.

Bug: previously a customer delete was pushed as an upsert with `deleted_at`
set (a tombstone) so the row stayed in Supabase. Now delete must physically
remove the row from Supabase via HTTP DELETE.

Cleanup policy: any test row created here MUST be hard-deleted at the end.
We only ever touch rows whose customer_code starts with 'ZZTEST'.
"""
from __future__ import annotations

import os
import random
import string
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

SUPABASE_URL = "https://fmjctovfdkndqchbgsfq.supabase.co"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs"
    "InJlZiI6ImZtamN0b3ZmZGtuZHFjaGJnc2ZxIiwicm9sZSI6InNlcnZpY2Vf"
    "cm9sZSIsImlhdCI6MTc4ODYwMDU2MSwiZXhwIjoyMTA0MTc2NTYxfQ."
    "VlhhgMyo2Y1G-M7mInI0DO0IM4LAAnUjdMp3h0vGY3c"
)
SB_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

TIMEOUT = 30


def _rand(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))


def _sb_get_by_code(code: str) -> list:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/customers",
        params={"customer_code": f"eq.{code}", "select": "id,customer_code,customer_name,deleted_at"},
        headers=SB_HEADERS, timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Supabase GET failed: {r.status_code} {r.text}"
    return r.json()


def _sb_get_by_id(cid: str) -> list:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/customers",
        params={"id": f"eq.{cid}", "select": "id,customer_code,deleted_at"},
        headers=SB_HEADERS, timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"Supabase GET failed: {r.status_code} {r.text}"
    return r.json()


def _sb_cleanup_prefix():
    """Emergency cleanup: hard-delete any leftover ZZTEST rows in Supabase."""
    requests.delete(
        f"{SUPABASE_URL}/rest/v1/customers",
        params={"customer_code": "like.ZZTEST*"},
        headers=SB_HEADERS, timeout=TIMEOUT,
    )


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"username": "admin", "password": "admin123"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in admin login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/login",
                      json={"username": "user", "password": "user123"}, timeout=TIMEOUT)
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _create_customer(headers, code, name):
    payload = {
        "customer_code": code,
        "customer_name": name,
        "segment": "Retail",
        "purchasing_size": "Kecil",
        "area": "Test Area",
        "status": "Active",
        "bad_debt": False,
        "bad_debt_nominal": 0,
        "address": "TEST addr",
        "phone": "0800000000",
        "whatsapp": "0800000000",
        "pic_name": "TEST PIC",
        "payment_terms": "COD",
        "credit_limit": 0,
    }
    r = requests.post(f"{BASE_URL}/api/customers", headers=headers, json=payload, timeout=TIMEOUT)
    return r


def _force_sync(headers):
    """Trigger the manual drain so we don't have to wait for the 5s worker loop."""
    try:
        requests.post(f"{BASE_URL}/api/admin/supabase/sync", headers=headers, timeout=TIMEOUT)
    except Exception:
        pass


def _wait_sb(predicate, timeout=25, interval=2, headers=None):
    """Poll Supabase until `predicate(rows)` becomes True; return final rows."""
    end = time.time() + timeout
    rows = None
    while time.time() < end:
        rows = predicate()
        if rows is not None:
            return rows
        if headers is not None:
            _force_sync(headers)
        time.sleep(interval)
    return rows


# ---------- Regression: auth + dashboard ----------

class TestRegression:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_user_login(self, user_token):
        assert user_token

    def test_dashboard_statistics(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/statistics", headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        # basic shape check — must have at least a count field
        assert any(k in data for k in ("total_customer", "total_customers", "customers", "totals"))


# ---------- Core bug fix: hard delete propagates to Supabase ----------

class TestSupabaseHardDelete:
    """Create customer -> verify in Supabase -> DELETE -> verify GONE from Supabase."""

    _created_ids: list = []
    _created_codes: list = []

    @classmethod
    def teardown_class(cls):
        _sb_cleanup_prefix()

    def test_create_and_hard_delete_flow(self, admin_headers):
        code = f"ZZTEST{_rand(6)}"
        name = f"ZZ_SyncTest_{_rand(4)}"

        # 1) Create
        r = _create_customer(admin_headers, code, name)
        assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
        created = r.json()
        cid = created["id"]
        assert created["customer_code"] == code
        self.__class__._created_ids.append(cid)
        self.__class__._created_codes.append(code)

        # 2) Verify Mongo persistence via GET
        g = requests.get(f"{BASE_URL}/api/customers/{cid}", headers=admin_headers, timeout=TIMEOUT)
        assert g.status_code == 200, g.text
        assert g.json()["customer_code"] == code

        # 3) Wait for Supabase to have the row
        _force_sync(admin_headers)

        def _has_row():
            rows = _sb_get_by_code(code)
            return rows if rows else None
        rows = _wait_sb(_has_row, timeout=30, headers=admin_headers)
        assert rows and len(rows) == 1, f"customer {code} not found in Supabase after sync"
        sb_row = rows[0]
        assert sb_row["id"] == cid, f"Supabase id mismatch: {sb_row}"
        assert sb_row.get("deleted_at") in (None, ""), f"row has unexpected deleted_at pre-delete: {sb_row}"

        # 4) DELETE via app API (admin only) — soft-delete locally, hard-delete remote
        d = requests.delete(f"{BASE_URL}/api/customers/{cid}", headers=admin_headers, timeout=TIMEOUT)
        assert d.status_code == 200, f"delete failed: {d.status_code} {d.text}"

        # 5) Force sync then wait for row to be GONE from Supabase
        _force_sync(admin_headers)

        def _row_gone():
            rows = _sb_get_by_code(code)
            return [] if not rows else None  # None => keep polling
        final = _wait_sb(_row_gone, timeout=30, headers=admin_headers)
        assert final == [], f"BUG: row still in Supabase after delete: {final}"

        # 6) Also verify by id (paranoia)
        assert _sb_get_by_id(cid) == [], "row still queryable by id in Supabase"

        # 7) Local Mongo record must be soft-deleted (not returned by list)
        g2 = requests.get(f"{BASE_URL}/api/customers/{cid}", headers=admin_headers, timeout=TIMEOUT)
        assert g2.status_code == 404, f"soft-deleted row should 404 on GET, got {g2.status_code}"

        # 8) Trash must contain it
        tr = requests.get(f"{BASE_URL}/api/admin/trash/customer", headers=admin_headers, timeout=TIMEOUT)
        assert tr.status_code == 200, tr.text
        ids_in_trash = [row["id"] for row in tr.json()]
        assert cid in ids_in_trash, "soft-deleted customer must appear in trash"


# ---------- Trash purge: no resurrection ----------

class TestTrashPurgeNoResurrect:
    _cid = None
    _code = None

    @classmethod
    def teardown_class(cls):
        _sb_cleanup_prefix()

    def test_purge_after_soft_delete_keeps_supabase_empty(self, admin_headers):
        code = f"ZZTEST{_rand(6)}"
        name = f"ZZ_PurgeTest_{_rand(4)}"

        r = _create_customer(admin_headers, code, name)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        self.__class__._cid = cid
        self.__class__._code = code

        # Ensure it lands in Supabase first (so there is something to delete)
        _force_sync(admin_headers)
        rows = _wait_sb(lambda: _sb_get_by_code(code) or None, timeout=30, headers=admin_headers)
        assert rows and rows[0]["id"] == cid

        # Soft delete
        d = requests.delete(f"{BASE_URL}/api/customers/{cid}", headers=admin_headers, timeout=TIMEOUT)
        assert d.status_code == 200, d.text

        # Wait for Supabase to be empty from the soft delete already
        _force_sync(admin_headers)
        gone = _wait_sb(lambda: [] if not _sb_get_by_code(code) else None,
                        timeout=30, headers=admin_headers)
        assert gone == [], "Supabase row not removed after soft delete"

        # Purge
        p = requests.post(f"{BASE_URL}/api/admin/trash/customer/purge",
                          headers=admin_headers, json={"ids": [cid]}, timeout=TIMEOUT)
        assert p.status_code == 200, f"purge failed: {p.status_code} {p.text}"
        assert p.json().get("purged", 0) >= 1

        # Give sync a moment then assert row still absent from Supabase
        _force_sync(admin_headers)
        time.sleep(6)
        _force_sync(admin_headers)
        time.sleep(4)
        assert _sb_get_by_code(code) == [], "BUG: row reappeared in Supabase after purge"

        # Trash should no longer contain the id
        tr = requests.get(f"{BASE_URL}/api/admin/trash/customer", headers=admin_headers, timeout=TIMEOUT)
        assert tr.status_code == 200
        ids_in_trash = [row["id"] for row in tr.json()]
        assert cid not in ids_in_trash, "purged customer must not be in trash"


# ---------- Final safety net ----------

def test_zzz_final_cleanup():
    """Belt-and-braces: ensure zero ZZTEST rows remain in Supabase."""
    _sb_cleanup_prefix()
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/customers",
        params={"customer_code": "like.ZZTEST*", "select": "id,customer_code"},
        headers=SB_HEADERS, timeout=TIMEOUT,
    )
    assert r.status_code == 200
    assert r.json() == [], f"leftover test rows: {r.json()}"
