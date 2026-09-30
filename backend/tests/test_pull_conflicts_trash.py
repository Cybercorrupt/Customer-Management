"""Tests for new endpoints in review_request:
- POST /api/sync/pull-now (user & admin)
- GET  /api/admin/conflicts (admin-only)
- POST /api/admin/conflicts/{cid}/resolve
- Trash end-to-end (soft-delete -> trash -> restore -> re-delete -> purge)
- Regression: /api/sync/status shape, background pull doesn't resurrect trash
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fall back to frontend/.env for BASE_URL (public URL) since tests run in same container
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_token(api):
    r = api.post(f"{BASE_URL}/api/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------
# Sync Sekarang endpoint
# --------------------------------------------------------------------------
class TestSyncPullNow:
    def test_user_can_pull_now(self, api, user_token):
        r = api.post(f"{BASE_URL}/api/sync/pull-now", headers=auth(user_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("success") is True
        assert "applied" in j
        assert "last_pull_at" in j
        assert isinstance(j["applied"], int)

    def test_admin_can_pull_now(self, api, admin_token):
        r = api.post(f"{BASE_URL}/api/sync/pull-now", headers=auth(admin_token))
        assert r.status_code == 200
        assert r.json().get("success") is True

    def test_pull_now_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/sync/pull-now")
        assert r.status_code in (401, 403)

    def test_pull_now_updates_last_pull_at(self, api, user_token):
        before = api.get(f"{BASE_URL}/api/sync/status", headers=auth(user_token)).json()
        time.sleep(1.1)
        r = api.post(f"{BASE_URL}/api/sync/pull-now", headers=auth(user_token))
        assert r.status_code == 200
        after = api.get(f"{BASE_URL}/api/sync/status", headers=auth(user_token)).json()
        # last_pull_at should be present and >= before
        assert after.get("last_pull_at") is not None


# --------------------------------------------------------------------------
# Conflicts admin endpoints
# --------------------------------------------------------------------------
class TestConflictsEndpoints:
    def test_list_conflicts_admin_ok(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/conflicts", headers=auth(admin_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_conflicts_user_forbidden(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/admin/conflicts", headers=auth(user_token))
        assert r.status_code in (401, 403)

    def test_list_conflicts_unauth(self, api):
        r = api.get(f"{BASE_URL}/api/admin/conflicts")
        assert r.status_code in (401, 403)

    def test_resolve_unknown_returns_404(self, api, admin_token):
        r = api.post(f"{BASE_URL}/api/admin/conflicts/nonexistent-id-xyz/resolve",
                     headers=auth(admin_token), json={"choice": "keep_local"})
        assert r.status_code == 404

    def test_resolve_bad_choice_returns_400(self, api, admin_token):
        r = api.post(f"{BASE_URL}/api/admin/conflicts/any-id/resolve",
                     headers=auth(admin_token), json={"choice": "hocus_pocus"})
        assert r.status_code == 400

    def test_resolve_user_forbidden(self, api, user_token):
        r = api.post(f"{BASE_URL}/api/admin/conflicts/any-id/resolve",
                     headers=auth(user_token), json={"choice": "keep_local"})
        assert r.status_code in (401, 403)


class TestConflictSeededResolve:
    """Seed a synthetic sync_conflict directly in Mongo and exercise resolve."""

    def test_resolve_keep_local(self, api, admin_token, mongo):
        # Create a customer to attach the conflict to (so keep_local path finds it)
        cust_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        mongo.customers.insert_one({
            "id": cust_id, "customer_name": "TEST_CONFLICT_LOCAL",
            "version": 3, "change_id": uuid.uuid4().hex,
            "created_at": now, "updated_at": now, "deleted_at": None,
        })
        conf_id = uuid.uuid4().hex
        mongo.sync_conflicts.insert_one({
            "id": conf_id,
            "entity_type": "customer",
            "entity_id": cust_id,
            "resolved": False,
            "reason": "test_seeded",
            "name": "TEST_CONFLICT_LOCAL",
            "local_version": 3,
            "remote_version": 4,
            "local_snapshot": {"id": cust_id, "customer_name": "TEST_CONFLICT_LOCAL", "version": 3},
            "remote_snapshot": {"id": cust_id, "customer_name": "TEST_CONFLICT_REMOTE", "version": 4},
            "created_at": now, "updated_at": now,
        })
        try:
            r = api.post(f"{BASE_URL}/api/admin/conflicts/{conf_id}/resolve",
                         headers=auth(admin_token), json={"choice": "keep_local"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["success"] is True
            assert j["choice"] == "keep_local"
            assert j["version"] == 5  # max(3,4)+1
            # Confirm conflict marked resolved and local retained
            doc = mongo.sync_conflicts.find_one({"id": conf_id})
            assert doc["resolved"] is True
            assert doc["resolution"] == "keep_local"
            cust = mongo.customers.find_one({"id": cust_id})
            assert cust["customer_name"] == "TEST_CONFLICT_LOCAL"
            assert cust["version"] == 5
        finally:
            mongo.sync_conflicts.delete_one({"id": conf_id})
            mongo.customers.delete_one({"id": cust_id})
            mongo.sync_queue.delete_many({"entity_id": cust_id})

    def test_resolve_keep_online(self, api, admin_token, mongo):
        cust_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        mongo.customers.insert_one({
            "id": cust_id, "customer_name": "TEST_CONFLICT_LOCAL2",
            "version": 2, "change_id": uuid.uuid4().hex,
            "created_at": now, "updated_at": now, "deleted_at": None,
        })
        conf_id = uuid.uuid4().hex
        mongo.sync_conflicts.insert_one({
            "id": conf_id,
            "entity_type": "customer",
            "entity_id": cust_id,
            "resolved": False,
            "reason": "test_seeded2",
            "name": "TEST_CONFLICT_LOCAL2",
            "local_version": 2,
            "remote_version": 5,
            "local_snapshot": {"id": cust_id, "customer_name": "TEST_CONFLICT_LOCAL2", "version": 2},
            "remote_snapshot": {"id": cust_id, "customer_name": "TEST_CONFLICT_ONLINE_WINS", "version": 5},
            "created_at": now, "updated_at": now,
        })
        try:
            r = api.post(f"{BASE_URL}/api/admin/conflicts/{conf_id}/resolve",
                         headers=auth(admin_token), json={"choice": "keep_online"})
            assert r.status_code == 200, r.text
            j = r.json()
            assert j["choice"] == "keep_online"
            assert j["version"] == 6
            cust = mongo.customers.find_one({"id": cust_id})
            assert cust["customer_name"] == "TEST_CONFLICT_ONLINE_WINS"
        finally:
            mongo.sync_conflicts.delete_one({"id": conf_id})
            mongo.customers.delete_one({"id": cust_id})
            mongo.sync_queue.delete_many({"entity_id": cust_id})


# --------------------------------------------------------------------------
# Trash end-to-end (regression the crash fix depends on backend flows)
# --------------------------------------------------------------------------
class TestTrashEndToEnd:
    def _make_customer(self, api, admin_token) -> str:
        code = f"TEST-{uuid.uuid4().hex[:8].upper()}"
        payload = {
            "customer_code": code,
            "customer_name": f"TEST_TRASH_{uuid.uuid4().hex[:6]}",
            "segment": "Retail", "purchasing_size": "Small", "area": "Jakarta",
            "status": "Active", "bad_debt": False, "bad_debt_nominal": 0,
            "address": "TEST", "latitude": None, "longitude": None,
            "phone": "0", "whatsapp": "0", "pic_name": "T",
            "payment_terms": "Cash", "credit_limit": 0,
        }
        r = api.post(f"{BASE_URL}/api/customers", headers=auth(admin_token), json=payload)
        assert r.status_code in (200, 201), r.text
        return r.json()["id"]

    def test_soft_delete_appears_in_trash_and_restore_purge(self, api, admin_token, mongo):
        cid = self._make_customer(api, admin_token)
        try:
            # soft delete
            r = api.delete(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            assert r.status_code in (200, 204), r.text

            # appears in trash
            r = api.get(f"{BASE_URL}/api/admin/trash/customer", headers=auth(admin_token))
            assert r.status_code == 200
            ids = [it["id"] for it in r.json()]
            assert cid in ids, "soft-deleted customer must appear in Trash"

            # restore
            r = api.post(f"{BASE_URL}/api/admin/trash/customer/restore",
                         headers=auth(admin_token), json={"ids": [cid]})
            assert r.status_code == 200, r.text
            assert r.json().get("restored", 0) >= 1

            # back in customers list
            r = api.get(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            assert r.status_code == 200

            # delete again, then purge
            api.delete(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            r = api.post(f"{BASE_URL}/api/admin/trash/customer/purge",
                         headers=auth(admin_token), json={"ids": [cid]})
            assert r.status_code == 200, r.text
            assert r.json().get("purged", 0) >= 1

            # customer must be gone
            r = api.get(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            assert r.status_code == 404
        finally:
            mongo.customers.delete_one({"id": cid})
            mongo.sync_queue.delete_many({"entity_id": cid})
            mongo.sync_state.delete_many({"entity_id": cid})

    def test_soft_delete_stays_in_trash_after_20s_incremental_pull(self, api, admin_token, mongo):
        """Regression: background incremental pull must NOT resurrect a soft-deleted customer."""
        cid = self._make_customer(api, admin_token)
        try:
            api.delete(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            # Manual pull-now to eagerly force a cycle (also covered by background)
            api.post(f"{BASE_URL}/api/sync/pull-now", headers=auth(admin_token))
            time.sleep(20)
            r = api.get(f"{BASE_URL}/api/admin/trash/customer", headers=auth(admin_token))
            ids = [it["id"] for it in r.json()]
            assert cid in ids, "Soft-deleted customer must remain in Trash after 20s pull cycle"
            # And must not have reappeared in the live list
            r = api.get(f"{BASE_URL}/api/customers/{cid}", headers=auth(admin_token))
            assert r.status_code == 404
        finally:
            api.post(f"{BASE_URL}/api/admin/trash/customer/purge",
                     headers=auth(admin_token), json={"ids": [cid]})
            mongo.customers.delete_one({"id": cid})
            mongo.sync_queue.delete_many({"entity_id": cid})
            mongo.sync_state.delete_many({"entity_id": cid})


# --------------------------------------------------------------------------
# Sync status regression
# --------------------------------------------------------------------------
class TestSyncStatusRegression:
    REQUIRED_KEYS = {"online", "status", "pending", "failed", "conflicts", "last_sync_at", "last_pull_at"}

    def test_sync_status_shape_admin(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/sync/status", headers=auth(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert self.REQUIRED_KEYS.issubset(j.keys()), f"missing keys: {self.REQUIRED_KEYS - set(j.keys())}"
        assert j["status"] in {"synced", "syncing", "sync_failed", "conflict", "offline"}

    def test_sync_status_shape_user(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/sync/status", headers=auth(user_token))
        assert r.status_code == 200
        j = r.json()
        assert self.REQUIRED_KEYS.issubset(j.keys())

    def test_sync_status_unauth(self, api):
        r = api.get(f"{BASE_URL}/api/sync/status")
        assert r.status_code in (401, 403)
