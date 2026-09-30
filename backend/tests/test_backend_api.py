"""Backend API tests for Customer Management app."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or None
# Fallback to the internal frontend .env value written by build system
if not BASE_URL:
    # Read from /app/frontend/.env
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
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(session):
    r = session.post(f"{API}/login", json={"username": "user", "password": "user123"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self, session):
        r = session.post(f"{API}/login", json={"username": "user", "password": "user123"})
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and isinstance(body["access_token"], str)
        assert body["token_type"] == "bearer"
        assert body["user"]["username"] == "user"
        assert body["user"]["role"] == "user"

    def test_login_admin(self, session):
        r = session.post(f"{API}/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "admin"

    def test_login_wrong_password(self, session):
        r = session.post(f"{API}/login", json={"username": "user", "password": "wrong"})
        assert r.status_code == 401

    def test_login_unknown_user(self, session):
        r = session.post(f"{API}/login", json={"username": "nobody", "password": "x"})
        assert r.status_code == 401

    def test_me_requires_auth(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_ok(self, session, auth_headers):
        r = session.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["username"] == "user"


# ---------- Protected endpoints without token ----------
class TestAuthGuards:
    def test_customers_no_token(self, session):
        r = session.get(f"{API}/customers")
        assert r.status_code == 401

    def test_customer_detail_no_token(self, session):
        r = session.get(f"{API}/customers/cust-1000")
        assert r.status_code == 401

    def test_dashboard_no_token(self, session):
        r = session.get(f"{API}/dashboard/statistics")
        assert r.status_code == 401

    def test_customers_invalid_token(self, session):
        r = session.get(f"{API}/customers", headers={"Authorization": "Bearer notavalidtoken"})
        assert r.status_code == 401


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_shape(self, session, auth_headers):
        r = session.get(f"{API}/dashboard/statistics", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        for k in (
            "total_customer", "active_customer", "inactive_customer",
            "bad_debt_customer", "total_bad_debt_nominal",
            "by_status", "by_purchasing_size", "by_area",
        ):
            assert k in d, f"missing {k}"
        assert d["total_customer"] == d["active_customer"] + d["inactive_customer"] + d["bad_debt_customer"]
        assert d["total_customer"] >= 40  # seeded ~48
        # by_status labels
        labels = {s["label"] for s in d["by_status"]}
        assert {"Active", "Inactive", "Bad Debt"}.issubset(labels)
        # Top5+Others: at most 6 entries
        assert len(d["by_purchasing_size"]) <= 6
        assert len(d["by_area"]) <= 6
        # bad_debt nominal >= 0
        assert d["total_bad_debt_nominal"] >= 0


# ---------- Customers ----------
class TestCustomers:
    def test_list_customers(self, session, auth_headers):
        r = session.get(f"{API}/customers", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 40
        # No mongo _id leakage
        assert "_id" not in data[0]
        # Required fields present
        for k in ("id", "customer_code", "customer_name", "segment", "status"):
            assert k in data[0]

    def test_search_by_name(self, session, auth_headers):
        # First get any customer name substring
        r = session.get(f"{API}/customers", headers=auth_headers)
        first_name = r.json()[0]["customer_name"]
        needle = first_name.split()[0]
        r2 = session.get(f"{API}/customers", headers=auth_headers, params={"search": needle})
        assert r2.status_code == 200
        results = r2.json()
        assert len(results) > 0
        assert any(needle.lower() in c["customer_name"].lower() for c in results)

    def test_search_by_code(self, session, auth_headers):
        r = session.get(f"{API}/customers", headers=auth_headers)
        first_code = r.json()[0]["customer_code"]
        r2 = session.get(f"{API}/customers", headers=auth_headers, params={"search": first_code})
        assert r2.status_code == 200
        results = r2.json()
        assert any(c["customer_code"] == first_code for c in results)

    def test_search_no_match(self, session, auth_headers):
        r = session.get(f"{API}/customers", headers=auth_headers, params={"search": "ZZZ_no_match_xyz"})
        assert r.status_code == 200
        assert r.json() == []

    def test_customer_detail(self, session, auth_headers):
        r = session.get(f"{API}/customers", headers=auth_headers)
        cid = r.json()[0]["id"]
        r2 = session.get(f"{API}/customers/{cid}", headers=auth_headers)
        assert r2.status_code == 200
        d = r2.json()
        for k in ("id", "customer_code", "customer_name", "segment", "purchasing_size",
                  "area", "status", "bad_debt", "bad_debt_nominal", "address",
                  "phone", "whatsapp", "payment_terms", "credit_limit"):
            assert k in d
        assert d["id"] == cid

    def test_customer_detail_not_found(self, session, auth_headers):
        r = session.get(f"{API}/customers/does-not-exist", headers=auth_headers)
        assert r.status_code == 404
