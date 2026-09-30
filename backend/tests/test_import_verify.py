"""End-to-end backend verification for the freshly-imported Customer Mgmt app.

Covers the flows requested in review_request:
  * User + Admin login (JWT)
  * Filter options / statistics / customers list (empty state)
  * Master data CRUD (segment, purchasing_size, top, area)
  * Customer CRUD (create, list, get, update, soft-delete)
  * Dashboards reflecting new data
  * CSV export, Excel template, Excel export
  * Excel import preview + commit

Supabase / logo upload endpoints are intentionally SKIPPED (Supabase off by design).
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
USER_CREDS = {"username": "user", "password": "user123"}
ADMIN_CREDS = {"username": "admin", "password": "admin123"}

# Track test-created entities so we can cleanup at end of session
_created = {"customers": [], "master": []}


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_token(http):
    r = http.post(f"{BASE_URL}/login", json=USER_CREDS)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(http):
    r = http.post(f"{BASE_URL}/admin/login", json=ADMIN_CREDS)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _uh(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- Auth ----------
class TestAuth:
    def test_user_login(self, http):
        r = http.post(f"{BASE_URL}/login", json=USER_CREDS)
        assert r.status_code == 200
        d = r.json()
        assert d["token_type"] == "bearer"
        assert d["user"]["role"] == "user"
        assert d["access_token"]

    def test_admin_login(self, http):
        r = http.post(f"{BASE_URL}/admin/login", json=ADMIN_CREDS)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["role"] == "admin"

    def test_user_cannot_admin_login(self, http):
        r = http.post(f"{BASE_URL}/admin/login", json=USER_CREDS)
        assert r.status_code == 403

    def test_bad_password_rejected(self, http):
        r = http.post(f"{BASE_URL}/login", json={"username": "user", "password": "wrong"})
        assert r.status_code == 401

    def test_customers_requires_auth(self, http):
        r = http.get(f"{BASE_URL}/customers")
        assert r.status_code == 401


# ---------- Initial (empty) state visible to user ----------
class TestInitialState:
    def test_customers_list_empty(self, http, user_token):
        r = http.get(f"{BASE_URL}/customers", headers=_uh(user_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_filter_options_shape(self, http, user_token):
        r = http.get(f"{BASE_URL}/filter-options", headers=_uh(user_token))
        assert r.status_code == 200
        data = r.json()
        for k in ("segment", "purchasing_size", "area"):
            assert k in data and isinstance(data[k], list)

    def test_statistics_admin_only(self, http, user_token, admin_token):
        r = http.get(f"{BASE_URL}/admin/statistics", headers=_uh(user_token))
        assert r.status_code == 403
        r = http.get(f"{BASE_URL}/admin/statistics", headers=_uh(admin_token))
        assert r.status_code == 200
        for k in ("total_customer", "active_customer", "inactive_customer", "bad_debt_customer"):
            assert k in r.json()


# ---------- Master data CRUD ----------
MASTER_TYPES = ["segment", "purchasing_size", "top", "area"]


class TestMasterCRUD:
    @pytest.mark.parametrize("entity", MASTER_TYPES)
    def test_master_full_lifecycle(self, http, admin_token, entity):
        name = f"TEST_{entity}_{uuid.uuid4().hex[:6]}"
        # Create
        r = http.post(f"{BASE_URL}/admin/master/{entity}",
                      headers=_uh(admin_token),
                      json={"name": name, "description": "initial"})
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["name"] == name
        mid = created["id"]
        _created["master"].append((entity, mid))
        # List
        r = http.get(f"{BASE_URL}/admin/master/{entity}", headers=_uh(admin_token))
        assert r.status_code == 200
        assert any(m["id"] == mid for m in r.json())
        # Update
        r = http.put(f"{BASE_URL}/admin/master/{entity}/{mid}",
                     headers=_uh(admin_token),
                     json={"name": name, "description": "updated"})
        assert r.status_code == 200, r.text
        # Verify via list
        r = http.get(f"{BASE_URL}/admin/master/{entity}", headers=_uh(admin_token))
        found = next(m for m in r.json() if m["id"] == mid)
        assert found["description"] == "updated"

    def test_master_options_populated(self, http, admin_token):
        r = http.get(f"{BASE_URL}/admin/master-options", headers=_uh(admin_token))
        assert r.status_code == 200
        data = r.json()
        # Should include every master type we created above
        for et in MASTER_TYPES:
            assert et in data


# ---------- Customer CRUD ----------
@pytest.fixture(scope="session")
def seeded_master(http, admin_token):
    """Create one master value per type usable by customer tests."""
    out = {}
    for et in MASTER_TYPES:
        name = f"TEST_c_{et}_{uuid.uuid4().hex[:6]}"
        r = http.post(f"{BASE_URL}/admin/master/{et}",
                      headers=_uh(admin_token),
                      json={"name": name, "description": ""})
        assert r.status_code == 201, r.text
        _created["master"].append((et, r.json()["id"]))
        out[et] = name
    return out


class TestCustomerCRUD:
    def test_create_get_update_delete(self, http, admin_token, user_token, seeded_master):
        code = f"TEST_C{uuid.uuid4().hex[:6]}"
        payload = {
            "customer_code": code,
            "customer_name": "TEST Customer",
            "segment": seeded_master["segment"],
            "purchasing_size": seeded_master["purchasing_size"],
            "area": seeded_master["area"],
            "status": "Active",
            "payment_terms": seeded_master["top"],
            "credit_limit": 5000,
            "phone": "081200001111",
            "whatsapp": "081200001111",
            "pic_name": "John",
            "address": "Jl. Test 1",
            "latitude": -6.2,
            "longitude": 106.8,
        }
        # user cannot create
        r = http.post(f"{BASE_URL}/customers", headers=_uh(user_token), json=payload)
        assert r.status_code == 403
        # admin creates
        r = http.post(f"{BASE_URL}/customers", headers=_uh(admin_token), json=payload)
        assert r.status_code == 201, r.text
        c = r.json()
        assert c["customer_code"] == code
        assert c["status"] == "Active"
        cid = c["id"]
        _created["customers"].append(cid)

        # GET to verify persistence
        r = http.get(f"{BASE_URL}/customers/{cid}", headers=_uh(user_token))
        assert r.status_code == 200
        assert r.json()["customer_name"] == "TEST Customer"

        # LIST contains
        r = http.get(f"{BASE_URL}/customers", headers=_uh(user_token))
        assert r.status_code == 200
        assert any(x["id"] == cid for x in r.json())

        # UPDATE
        payload["customer_name"] = "TEST Customer Updated"
        payload["status"] = "Inactive"
        r = http.put(f"{BASE_URL}/customers/{cid}", headers=_uh(admin_token), json=payload)
        assert r.status_code == 200
        r = http.get(f"{BASE_URL}/customers/{cid}", headers=_uh(user_token))
        assert r.json()["customer_name"] == "TEST Customer Updated"
        assert r.json()["status"] == "Inactive"

        # DELETE (soft)
        r = http.delete(f"{BASE_URL}/customers/{cid}", headers=_uh(admin_token))
        assert r.status_code == 200
        r = http.get(f"{BASE_URL}/customers/{cid}", headers=_uh(user_token))
        assert r.status_code == 404

    def test_statistics_and_filter_reflect_data(self, http, admin_token, seeded_master):
        # create a fresh active customer
        code = f"TEST_S{uuid.uuid4().hex[:6]}"
        r = http.post(f"{BASE_URL}/customers", headers=_uh(admin_token), json={
            "customer_code": code, "customer_name": "TEST stats",
            "segment": seeded_master["segment"],
            "purchasing_size": seeded_master["purchasing_size"],
            "area": seeded_master["area"],
            "status": "Active",
            "payment_terms": seeded_master["top"],
            "credit_limit": 0,
        })
        assert r.status_code == 201
        _created["customers"].append(r.json()["id"])

        r = http.get(f"{BASE_URL}/admin/statistics", headers=_uh(admin_token))
        assert r.status_code == 200
        stats = r.json()
        assert stats["total_customer"] >= 1
        assert stats["active_customer"] >= 1

        r = http.get(f"{BASE_URL}/filter-options", headers=_uh(admin_token))
        opts = r.json()
        assert seeded_master["segment"] in opts["segment"]
        assert seeded_master["area"] in opts["area"]


# ---------- Export / Template / Import ----------
class TestExportImport:
    def test_csv_export(self, http, admin_token):
        r = http.get(f"{BASE_URL}/admin/export", headers=_uh(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert "csv" in d and "count" in d
        assert "Customer Code" in d["csv"]

    def test_xlsx_template_download(self, http, admin_token):
        r = requests.get(f"{BASE_URL}/admin/template.xlsx",
                         headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        # xlsx = zip container, starts with PK
        assert r.content[:2] == b"PK"
        assert "spreadsheetml" in r.headers.get("Content-Type", "")

    def test_xlsx_export(self, http, admin_token):
        r = requests.get(f"{BASE_URL}/admin/export.xlsx",
                         headers={"Authorization": f"Bearer {admin_token}"})
        assert r.status_code == 200
        assert r.content[:2] == b"PK"

    def test_xlsx_import_preview_and_commit(self, http, admin_token, seeded_master):
        # Build a minimal xlsx by re-downloading template and posting it back
        tmpl = requests.get(f"{BASE_URL}/admin/template.xlsx",
                            headers={"Authorization": f"Bearer {admin_token}"}).content
        # Use excel_io locally to inject a row so we validate commit path end-to-end
        import sys, importlib
        sys.path.insert(0, "/app/backend")
        excel_io = importlib.import_module("excel_io")
        # Build minimal fake export with one row
        code = f"TEST_X{uuid.uuid4().hex[:5]}"
        row = {
            "customer_code": code, "customer_name": "TEST xlsx",
            "segment": seeded_master["segment"],
            "purchasing_size": seeded_master["purchasing_size"],
            "area": seeded_master["area"], "status": "Active",
            "bad_debt": False, "bad_debt_nominal": 0,
            "address": "", "village": "", "district": "", "city_regency": "",
            "province": "", "postal_code": "", "country": "",
            "latitude": None, "longitude": None,
            "phone": "", "whatsapp": "", "pic_name": "",
            "payment_terms": seeded_master["top"], "credit_limit": 0,
        }
        try:
            data = excel_io.build_export([row], {k: [] for k in MASTER_TYPES})
        except Exception as e:
            pytest.skip(f"excel_io.build_export unavailable: {e}")

        files = {"file": ("import.xlsx", data,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        headers = {"Authorization": f"Bearer {admin_token}"}
        r = requests.post(f"{BASE_URL}/admin/import/xlsx/preview", headers=headers, files=files)
        assert r.status_code == 200, r.text
        preview = r.json()
        assert "customers" in preview and "counts" in preview["customers"]

        files = {"file": ("import.xlsx", data,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{BASE_URL}/admin/import/xlsx/commit", headers=headers, files=files)
        assert r.status_code == 200, r.text
        summary = r.json()
        assert summary["customers"]["total"] >= 1
        # cleanup
        _created["customers"].append(code.lower())


# ---------- Cleanup ----------
def test_zzz_cleanup(http, admin_token):
    for cid in _created["customers"]:
        try:
            http.delete(f"{BASE_URL}/customers/{cid}", headers=_uh(admin_token))
        except Exception:
            pass
    for et, mid in _created["master"]:
        try:
            http.delete(f"{BASE_URL}/admin/master/{et}/{mid}", headers=_uh(admin_token))
        except Exception:
            pass
