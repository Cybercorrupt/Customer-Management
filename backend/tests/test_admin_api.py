"""Tahap 3 Admin & Customer CRUD tests."""
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


@pytest.fixture(scope="session")
def s():
    ss = requests.Session()
    ss.headers.update({"Content-Type": "application/json"})
    return ss


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_token(s):
    r = s.post(f"{API}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def user_h(user_token):
    return {"Authorization": f"Bearer {user_token}"}


# ---------- Admin login ----------
class TestAdminLogin:
    def test_admin_login_ok(self, s):
        r = s.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        b = r.json()
        assert b["user"]["role"] == "admin"
        assert isinstance(b["access_token"], str)

    def test_admin_login_denied_for_user(self, s):
        r = s.post(f"{API}/admin/login", json={"username": "user", "password": "user123"})
        assert r.status_code == 403
        assert "denied" in r.json().get("detail", "").lower()

    def test_admin_login_wrong_password(self, s):
        r = s.post(f"{API}/admin/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401


# ---------- Role enforcement ----------
class TestRoleEnforcement:
    payload = {
        "customer_code": "TEST_ROLE_1",
        "customer_name": "TEST role denied",
        "segment": "Retail",
        "purchasing_size": "Small",
        "area": "Jakarta",
        "status": "Active",
        "payment_terms": "Cash",
        "credit_limit": 0,
    }

    def test_user_cannot_create(self, s, user_h):
        r = s.post(f"{API}/customers", headers=user_h, json=self.payload)
        assert r.status_code == 403

    def test_user_cannot_update(self, s, user_h):
        r = s.put(f"{API}/customers/anything", headers=user_h, json=self.payload)
        assert r.status_code == 403

    def test_user_cannot_delete(self, s, user_h):
        r = s.delete(f"{API}/customers/anything", headers=user_h)
        assert r.status_code == 403

    def test_user_cannot_admin_stats(self, s, user_h):
        r = s.get(f"{API}/admin/statistics", headers=user_h)
        assert r.status_code == 403

    def test_no_token_admin_stats(self, s):
        r = s.get(f"{API}/admin/statistics")
        assert r.status_code == 401


# ---------- Admin statistics shape ----------
class TestAdminStatistics:
    def test_shape(self, s, admin_h):
        r = s.get(f"{API}/admin/statistics", headers=admin_h)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_customer", "active_customer", "inactive_customer", "bad_debt_customer"):
            assert k in d and isinstance(d[k], int)
        assert d["total_customer"] == d["active_customer"] + d["inactive_customer"] + d["bad_debt_customer"]


# ---------- CRUD (Create -> GET -> Update -> Delete -> GET 404) ----------
class TestCustomerCRUD:
    code = "TEST_C99001"
    cid = code.lower()

    def _payload(self, **over):
        p = {
            "customer_code": self.code,
            "customer_name": "TEST_ Playwright Sentosa",
            "segment": "Retail",
            "purchasing_size": "Small",
            "area": "Jakarta",
            "status": "Active",
            "payment_terms": "Cash",
            "credit_limit": 5000000,
            "phone": "(021) 1111-2222",
            "whatsapp": "0812-1111-2222",
            "address": "TEST Jl. Contoh No. 1, Jakarta",
            "latitude": -6.2,
            "longitude": 106.85,
            "bad_debt_nominal": 0,
        }
        p.update(over)
        return p

    def test_00_precleanup(self, s, admin_h):
        # Best-effort cleanup from any earlier run
        s.delete(f"{API}/customers/{self.cid}", headers=admin_h)

    def test_01_create(self, s, admin_h):
        r = s.post(f"{API}/customers", headers=admin_h, json=self._payload())
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["id"] == self.cid
        assert d["customer_code"] == self.code
        assert d["status"] == "Active"
        assert d["bad_debt"] is False
        assert d["bad_debt_nominal"] == 0.0

    def test_02_duplicate_code_409(self, s, admin_h):
        r = s.post(f"{API}/customers", headers=admin_h, json=self._payload())
        assert r.status_code == 409

    def test_03_get_persisted(self, s, admin_h):
        r = s.get(f"{API}/customers/{self.cid}", headers=admin_h)
        assert r.status_code == 200
        assert r.json()["customer_name"] == "TEST_ Playwright Sentosa"

    def test_04_search_by_address(self, s, admin_h):
        r = s.get(f"{API}/customers", headers=admin_h, params={"search": "TEST Jl. Contoh"})
        assert r.status_code == 200
        assert any(c["id"] == self.cid for c in r.json())

    def test_05_search_by_code(self, s, admin_h):
        r = s.get(f"{API}/customers", headers=admin_h, params={"search": self.code})
        assert r.status_code == 200
        assert any(c["id"] == self.cid for c in r.json())

    def test_06_update_to_bad_debt(self, s, admin_h):
        r = s.put(
            f"{API}/customers/{self.cid}",
            headers=admin_h,
            json=self._payload(status="Bad Debt", bad_debt_nominal=25000000),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "Bad Debt"
        assert d["bad_debt"] is True
        assert d["bad_debt_nominal"] == 25000000.0
        # GET verifies persistence
        g = s.get(f"{API}/customers/{self.cid}", headers=admin_h).json()
        assert g["status"] == "Bad Debt" and g["bad_debt_nominal"] == 25000000.0

    def test_07_stats_reflect_created(self, s, admin_h):
        r = s.get(f"{API}/admin/statistics", headers=admin_h)
        d = r.json()
        # It should show at least 1 bad_debt (our test one)
        assert d["bad_debt_customer"] >= 1

    def test_08_dashboard_reflects_for_user(self, s, user_h):
        r = s.get(f"{API}/dashboard/statistics", headers=user_h)
        assert r.status_code == 200
        d = r.json()
        # Confirm TEST customer counted
        r2 = s.get(f"{API}/customers", headers=user_h, params={"search": "TEST_C99001"})
        assert any(c["id"] == self.cid for c in r2.json())
        assert d["total_customer"] >= 1

    def test_09_delete(self, s, admin_h):
        r = s.delete(f"{API}/customers/{self.cid}", headers=admin_h)
        assert r.status_code == 200
        assert r.json().get("success") is True

    def test_10_get_after_delete_404(self, s, admin_h):
        r = s.get(f"{API}/customers/{self.cid}", headers=admin_h)
        assert r.status_code == 404

    def test_11_excluded_from_list(self, s, admin_h):
        r = s.get(f"{API}/customers", headers=admin_h, params={"search": "TEST_C99001"})
        assert all(c["id"] != self.cid for c in r.json())

    def test_12_delete_missing_404(self, s, admin_h):
        r = s.delete(f"{API}/customers/does-not-exist-xyz", headers=admin_h)
        assert r.status_code == 404


# ---------- Search across name/code/address ----------
class TestSearchScopes:
    def test_search_matches_address(self, s, admin_h):
        # Seeded customers have addresses containing area names
        r = s.get(f"{API}/customers", headers=admin_h, params={"search": "Sudirman"})
        assert r.status_code == 200
        # It's possible zero, but seeded data uses random street picks; still assert type ok
        for c in r.json():
            assert "sudirman" in c["address"].lower() or "sudirman" in c["customer_name"].lower() or "sudirman" in c["customer_code"].lower()
