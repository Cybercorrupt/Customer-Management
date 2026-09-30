"""Iteration 3 backend regression tests.

Coverage:
- POST /api/customers ignores/omits location_accuracy
- GET /api/customers/{id} response has NO location_accuracy key
- CSV /api/admin/export header has NO 'Location Accuracy' column
- GET /api/dashboard/statistics returns by_province + by_city (empty & populated)

Test data (customers + master rows) is cleaned up in class teardown so the
offline DB stays empty of dummy data.
"""

import os
import csv
import io
import uuid

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


# ---------- shared fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE}/api/admin/login",
                      json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE}/api/login",
                      json={"username": "user", "password": "user123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def user_h(user_token):
    return {"Authorization": f"Bearer {user_token}"}


# ---------- auth smoke ----------
class TestAuth:
    def test_admin_login(self, admin_token):
        assert admin_token

    def test_user_login(self, user_token):
        assert user_token


# ---------- location_accuracy removal ----------
class TestLocationAccuracyGone:
    created_ids = []
    master_ids = []  # list of (entity, id)

    @classmethod
    def teardown_class(cls):
        r = requests.post(f"{BASE}/api/admin/login",
                          json={"username": "admin", "password": "admin123"}, timeout=15)
        if r.status_code != 200:
            return
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        for cid in cls.created_ids:
            requests.delete(f"{BASE}/api/customers/{cid}", headers=h, timeout=15)
        for entity, mid in cls.master_ids:
            requests.delete(f"{BASE}/api/admin/master/{entity}/{mid}",
                            headers=h, timeout=15)

    def _seed_masters(self, admin_h):
        """Create one master row per entity so form dropdowns have options."""
        specs = [("segment", "TEST_seg"), ("purchasing_size", "TEST_ps"),
                 ("area", "TEST_area"), ("top", "TEST_top")]
        out = {}
        for entity, name in specs:
            r = requests.post(f"{BASE}/api/admin/master/{entity}",
                              json={"name": name, "description": ""},
                              headers=admin_h, timeout=15)
            assert r.status_code in (200, 201), f"{entity}: {r.status_code} {r.text}"
            body = r.json()
            self.__class__.master_ids.append((entity, body["id"]))
            out[entity] = name
        return out

    def test_post_ignores_location_accuracy(self, admin_h):
        masters = self._seed_masters(admin_h)
        code = f"TEST_LA_{uuid.uuid4().hex[:6]}"
        payload = {
            "customer_code": code,
            "customer_name": "TEST location_accuracy ignored",
            "segment": masters["segment"],
            "purchasing_size": masters["purchasing_size"],
            "area": masters["area"],
            "status": "Active",
            "payment_terms": masters["top"],
            "credit_limit": 0,
            "phone": "", "whatsapp": "", "pic_name": "",
            "address": "Jl. Test", "village": "V", "district": "D",
            "city_regency": "Jakarta Selatan", "province": "DKI Jakarta",
            "postal_code": "12345", "country": "Indonesia",
            "latitude": -6.2, "longitude": 106.8,
            "bad_debt_nominal": 0,
            # Extra unknown key — must be ignored & not echoed back
            "location_accuracy": 12.34,
        }
        r = requests.post(f"{BASE}/api/customers", json=payload,
                          headers=admin_h, timeout=15)
        assert r.status_code == 201, r.text
        body = r.json()
        assert "location_accuracy" not in body
        self.__class__.created_ids.append(body["id"])

    def test_get_customer_has_no_location_accuracy(self, admin_h):
        assert self.__class__.created_ids, "prior create must have run"
        cid = self.__class__.created_ids[0]
        r = requests.get(f"{BASE}/api/customers/{cid}", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "location_accuracy" not in body
        # sanity: the new Alamat & Lokasi fields are present
        for f in ("village", "district", "city_regency", "province",
                  "postal_code", "country", "latitude", "longitude",
                  "location_updated_at", "location_updated_by"):
            assert f in body, f"missing field {f}"

    def test_csv_export_has_no_location_accuracy_column(self, admin_h):
        r = requests.get(f"{BASE}/api/admin/export", headers=admin_h, timeout=15)
        assert r.status_code == 200, r.text
        csv_text = r.json()["csv"]
        reader = csv.reader(io.StringIO(csv_text))
        header = next(reader)
        assert "Location Accuracy" not in header
        # sanity checks: new region columns present, old accuracy column absent
        for col in ("Province", "City/Regency", "Village", "District",
                    "Latitude", "Longitude"):
            assert col in header, f"missing column {col}"


# ---------- dashboard by_province / by_city ----------
class TestDashboardRegions:
    def test_returns_arrays(self, user_h):
        r = requests.get(f"{BASE}/api/dashboard/statistics",
                         headers=user_h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("by_province"), list)
        assert isinstance(body.get("by_city"), list)
        for slice_ in body["by_province"] + body["by_city"]:
            assert "label" in slice_ and "count" in slice_
            assert isinstance(slice_["count"], int)

    def test_populated_when_customers_exist(self, admin_h, user_h):
        # Reuse master data seeded above if present; otherwise seed fresh.
        def _ensure(entity, name):
            r = requests.post(f"{BASE}/api/admin/master/{entity}",
                              json={"name": name, "description": ""},
                              headers=admin_h, timeout=15)
            if r.status_code in (200, 201):
                TestLocationAccuracyGone.master_ids.append((entity, r.json()["id"]))
                return name
            return name  # already exists — fine

        seg = _ensure("segment", "TEST_seg2")
        ps = _ensure("purchasing_size", "TEST_ps2")
        area = _ensure("area", "TEST_area2")
        top = _ensure("top", "TEST_top2")

        created = []
        for prov, city in [("DKI Jakarta", "Jakarta Selatan"),
                           ("DKI Jakarta", "Jakarta Selatan"),
                           ("Jawa Barat", "Bandung")]:
            code = f"TEST_R_{uuid.uuid4().hex[:6]}"
            payload = {
                "customer_code": code, "customer_name": f"TEST {prov}",
                "segment": seg, "purchasing_size": ps, "area": area,
                "status": "Active", "payment_terms": top, "credit_limit": 0,
                "phone": "", "whatsapp": "", "pic_name": "",
                "address": "x", "village": "", "district": "",
                "city_regency": city, "province": prov,
                "postal_code": "", "country": "Indonesia",
                "latitude": None, "longitude": None, "bad_debt_nominal": 0,
            }
            r = requests.post(f"{BASE}/api/customers", json=payload,
                              headers=admin_h, timeout=15)
            assert r.status_code == 201, r.text
            created.append(r.json()["id"])
            TestLocationAccuracyGone.created_ids.append(r.json()["id"])

        r = requests.get(f"{BASE}/api/dashboard/statistics",
                         headers=user_h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        prov_map = {s["label"]: s["count"] for s in body["by_province"]}
        city_map = {s["label"]: s["count"] for s in body["by_city"]}
        # Includes at least the two provinces we just added
        assert prov_map.get("DKI Jakarta", 0) >= 2
        assert prov_map.get("Jawa Barat", 0) >= 1
        assert city_map.get("Jakarta Selatan", 0) >= 2
        assert city_map.get("Bandung", 0) >= 1
