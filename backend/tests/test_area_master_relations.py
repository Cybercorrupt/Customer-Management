"""Tests for the new features:
- Area master data CRUD (admin only)
- /api/admin/master-options for customer-form dropdowns
- Customer create/update with 'area' persists correctly
- Supabase auto-connect from env (configured/sync_enabled)
"""
import os
import uuid
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


@pytest.fixture(scope="module")
def session():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_headers(session):
    r = session.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def user_headers(session):
    r = session.post(f"{API}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --------------------------- Area master ----------------------------
class TestAreaMaster:
    def test_list_area_seeded(self, session, admin_headers):
        r = session.get(f"{API}/admin/master/area", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1, "expected seeded areas"
        assert {"id", "name", "description"}.issubset(data[0].keys())

    def test_area_forbidden_for_user(self, session, user_headers):
        r = session.get(f"{API}/admin/master/area", headers=user_headers)
        assert r.status_code == 403

    def test_area_crud(self, session, admin_headers):
        name = f"TEST_Area_{uuid.uuid4().hex[:6]}"
        # Create
        r = session.post(f"{API}/admin/master/area", headers=admin_headers,
                         json={"name": name, "description": "auto test"})
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["name"] == name
        aid = created["id"]

        # Verify in list
        r = session.get(f"{API}/admin/master/area", headers=admin_headers)
        assert any(a["id"] == aid and a["name"] == name for a in r.json())

        # Update
        new_name = name + "_upd"
        r = session.put(f"{API}/admin/master/area/{aid}", headers=admin_headers,
                        json={"name": new_name, "description": "updated"})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == new_name

        # Verify update
        r = session.get(f"{API}/admin/master/area", headers=admin_headers)
        assert any(a["id"] == aid and a["name"] == new_name for a in r.json())

        # Duplicate name -> 409
        r = session.post(f"{API}/admin/master/area", headers=admin_headers,
                         json={"name": new_name, "description": "dup"})
        assert r.status_code == 409

        # Delete (soft)
        r = session.delete(f"{API}/admin/master/area/{aid}", headers=admin_headers)
        assert r.status_code == 200

        # Verify removed from list
        r = session.get(f"{API}/admin/master/area", headers=admin_headers)
        assert not any(a["id"] == aid for a in r.json())


# --------------------------- master-options -------------------------
class TestMasterOptions:
    def test_master_options_shape(self, session, admin_headers):
        r = session.get(f"{API}/admin/master-options", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) == {"segment", "purchasing_size", "area", "top"}
        for k, v in data.items():
            assert isinstance(v, list), f"{k} should be list"
            for name in v:
                assert isinstance(name, str) and name.strip()
        assert len(data["area"]) >= 1
        assert len(data["segment"]) >= 1
        assert len(data["purchasing_size"]) >= 1
        assert len(data["top"]) >= 1

    def test_master_options_forbidden_for_user(self, session, user_headers):
        r = session.get(f"{API}/admin/master-options", headers=user_headers)
        assert r.status_code == 403


# --------------------------- Customer w/ area -----------------------
class TestCustomerArea:
    def test_customer_create_update_with_area(self, session, admin_headers):
        # Fetch valid option names
        opts = session.get(f"{API}/admin/master-options", headers=admin_headers).json()
        area1 = opts["area"][0]
        area2 = opts["area"][1] if len(opts["area"]) > 1 else area1
        seg = opts["segment"][0]
        psize = opts["purchasing_size"][0]
        top = opts["top"][0]

        payload = {
            "customer_code": f"TEST-{uuid.uuid4().hex[:6]}",
            "customer_name": "TEST_Area Customer",
            "segment": seg,
            "purchasing_size": psize,
            "area": area1,
            "status": "Active",
            "bad_debt": False,
            "bad_debt_nominal": 0,
            "address": "Jl. Test",
            "phone": "021-000",
            "whatsapp": "0812000",
            "payment_terms": top,
            "credit_limit": 1000000,
        }
        r = session.post(f"{API}/api/customers", headers=admin_headers, json=payload) \
            if False else session.post(f"{API}/customers", headers=admin_headers, json=payload)
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["area"] == area1
        cid = created["id"]

        # GET verifies persistence
        r = session.get(f"{API}/customers/{cid}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["area"] == area1

        # Update area
        upd = dict(payload)
        upd["area"] = area2
        r = session.put(f"{API}/customers/{cid}", headers=admin_headers, json=upd)
        assert r.status_code == 200, r.text
        assert r.json()["area"] == area2

        # GET verifies update
        r = session.get(f"{API}/customers/{cid}", headers=admin_headers)
        assert r.json()["area"] == area2

        # Cleanup
        session.delete(f"{API}/customers/{cid}", headers=admin_headers)


# --------------------------- Supabase auto-connect ------------------
class TestSupabaseAutoConnect:
    def test_supabase_configured(self, session, admin_headers):
        r = session.get(f"{API}/admin/supabase", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("configured") is True, f"expected configured=True, got {data}"
        assert data.get("sync_enabled") is True, f"expected sync_enabled=True, got {data}"
        # project_url should be a valid supabase URL
        assert "supabase.co" in (data.get("project_url") or "")

    def test_supabase_forbidden_for_user(self, session, user_headers):
        r = session.get(f"{API}/admin/supabase", headers=user_headers)
        assert r.status_code == 403
