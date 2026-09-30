"""
Smoke tests for imported Customer Management app.
Covers: auth (user + admin), dashboard stats, customer list/detail/filter,
admin dashboard/master/users/trash, and change-password endpoints.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://crm-system-62.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE_URL}/api/login", json={"username": "user", "password": "user123"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and data["user"]["role"] == "user"
    return data["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login", json={"username": "admin", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and data["user"]["role"] == "admin"
    return data["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Auth ---------------- #
class TestAuth:
    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/login", json={"username": "user", "password": "wrong"}, timeout=10)
        assert r.status_code in (400, 401), r.text

    def test_admin_login_wrong_role(self):
        # user credentials via admin endpoint should fail
        r = requests.post(f"{BASE_URL}/api/admin/login", json={"username": "user", "password": "user123"}, timeout=10)
        assert r.status_code in (400, 401, 403), r.text

    def test_auth_me_user(self, user_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(user_token), timeout=10)
        assert r.status_code == 200
        assert r.json()["username"] == "user"


# ---------------- User dashboard / customers ---------------- #
class TestUserFlow:
    def test_dashboard_statistics(self, user_token):
        r = requests.get(f"{BASE_URL}/api/dashboard/statistics", headers=_auth(user_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_customer", "active_customer", "inactive_customer", "bad_debt_customer",
                 "total_bad_debt_nominal", "by_status", "by_segment", "by_area"):
            assert k in d, f"missing {k}"
        assert d["total_customer"] >= 40, f"expected ~48 customers, got {d['total_customer']}"
        assert isinstance(d["by_status"], list) and len(d["by_status"]) == 3

    def test_customers_list(self, user_token):
        r = requests.get(f"{BASE_URL}/api/customers", headers=_auth(user_token), timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 40
        # no mongo _id leakage
        assert "_id" not in arr[0]
        assert "id" in arr[0] and "customer_name" in arr[0]

    def test_customers_filter_options(self, user_token):
        r = requests.get(f"{BASE_URL}/api/filter-options", headers=_auth(user_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict)

    def test_customers_search(self, user_token):
        # get list then fetch one by id
        r = requests.get(f"{BASE_URL}/api/customers", headers=_auth(user_token), timeout=15)
        first = r.json()[0]
        rid = first["id"]
        r2 = requests.get(f"{BASE_URL}/api/customers/{rid}", headers=_auth(user_token), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["id"] == rid


# ---------------- Admin flow ---------------- #
class TestAdminFlow:
    def test_admin_statistics(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/statistics", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_admin_users_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) >= 2
        assert any(u["username"] == "admin" for u in users)

    @pytest.mark.parametrize("entity", ["segment", "area", "purchasing_size"])
    def test_admin_master_data(self, admin_token, entity):
        r = requests.get(f"{BASE_URL}/api/admin/master/{entity}", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, f"{entity}: {r.text}"
        assert isinstance(r.json(), list)

    def test_admin_master_options(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/master-options", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_admin_trash_counts(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/trash-counts", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_admin_trash_customer(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/trash/customer", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_about_and_appconfig(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/about", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE_URL}/api/app-config", headers=_auth(admin_token), timeout=10)
        assert r2.status_code == 200


# ---------------- Change password ---------------- #
class TestChangePassword:
    def test_admin_can_view_password_endpoint_wrong_current(self, admin_token):
        # verify endpoint present & rejects wrong current pass
        r = requests.post(
            f"{BASE_URL}/api/admin/me/password",
            headers=_auth(admin_token),
            json={"current_password": "wrongPw!", "new_password": "some_new_pw_123"},
            timeout=10,
        )
        assert r.status_code in (400, 401, 403), r.text

    def test_user_password_endpoint_wrong_current(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/me/password",
            headers=_auth(user_token),
            json={"current_password": "wrongPw!", "new_password": "some_new_pw_123"},
            timeout=10,
        )
        assert r.status_code in (400, 401, 403), r.text


# ---------------- Supabase unconfigured (must NOT crash) ---------------- #
class TestSupabaseUnconfigured:
    def test_supabase_config(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/supabase", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200, r.text
        # inactive is acceptable

    def test_sync_status(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/sync/status", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
