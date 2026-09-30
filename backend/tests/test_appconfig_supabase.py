"""Tahap: App Settings (public config, logo upload, colors) + Supabase admin config."""
import io
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
    return ss


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


ABOUT_KEYS = {
    "app_name", "tagline", "description", "developer", "platform",
    "version", "copyright", "logo_url", "primary_color", "secondary_color",
}


# ---------- Public app-config ----------
class TestPublicAppConfig:
    def test_no_auth_required(self, s):
        r = s.get(f"{API}/app-config")
        assert r.status_code == 200
        d = r.json()
        assert ABOUT_KEYS.issubset(d.keys()), f"Missing: {ABOUT_KEYS - d.keys()}"
        # No sensitive fields leak
        assert "service_role_key" not in d
        assert "service_role_key_ciphertext" not in d

    def test_colors_are_hex_strings(self, s):
        d = s.get(f"{API}/app-config").json()
        assert isinstance(d["primary_color"], str) and d["primary_color"].startswith("#")
        assert isinstance(d["secondary_color"], str) and d["secondary_color"].startswith("#")


# ---------- PUT /api/admin/about (colors + branding) ----------
class TestAdminAbout:
    def test_user_forbidden(self, s, user_h):
        r = s.put(f"{API}/admin/about", headers=user_h, json={
            "app_name": "x", "tagline": "x", "description": "x",
            "developer": "x", "platform": "Android", "version": "1.0.0",
            "copyright": "x", "logo_url": "", "primary_color": "#000000",
            "secondary_color": "#111111",
        })
        assert r.status_code == 403

    def test_no_auth_401(self, s):
        r = s.put(f"{API}/admin/about", json={})
        assert r.status_code == 401

    def test_admin_updates_and_persists(self, s, admin_h):
        # Snapshot original config so we restore it
        orig = s.get(f"{API}/app-config").json()
        payload = {**orig,
                   "primary_color": "#123456",
                   "secondary_color": "#abcdef",
                   "tagline": "TEST_ tagline"}
        r = s.put(f"{API}/admin/about", headers=admin_h, json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["primary_color"] == "#123456"
        assert d["secondary_color"] == "#abcdef"
        # Verify persisted publicly
        pub = s.get(f"{API}/app-config").json()
        assert pub["primary_color"] == "#123456"
        assert pub["secondary_color"] == "#abcdef"
        assert pub["tagline"] == "TEST_ tagline"
        # Restore
        r2 = s.put(f"{API}/admin/about", headers=admin_h, json=orig)
        assert r2.status_code == 200


# ---------- POST /api/admin/upload-logo + GET /api/files/{path} ----------
def _tiny_png_bytes() -> bytes:
    # 1x1 transparent PNG
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


class TestUploadLogo:
    def test_user_forbidden(self, s, user_h):
        files = {"file": ("logo.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
        r = s.post(f"{API}/admin/upload-logo", headers=user_h, files=files)
        assert r.status_code == 403

    def test_no_auth_401(self, s):
        files = {"file": ("logo.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
        r = s.post(f"{API}/admin/upload-logo", files=files)
        assert r.status_code == 401

    def test_reject_non_image(self, s, admin_h):
        files = {"file": ("readme.txt", io.BytesIO(b"hello"), "text/plain")}
        r = s.post(f"{API}/admin/upload-logo", headers=admin_h, files=files)
        assert r.status_code == 400

    def test_upload_ok_and_served(self, s, admin_h):
        files = {"file": ("logo.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
        r = s.post(f"{API}/admin/upload-logo", headers=admin_h, files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "logo_url" in body
        logo_url = body["logo_url"]
        assert logo_url.startswith("/api/files/")

        # Reflected in public app-config
        pub = s.get(f"{API}/app-config").json()
        assert pub["logo_url"] == logo_url

        # Served publicly with image content-type
        r2 = s.get(f"{BASE_URL}{logo_url}")
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
        assert len(r2.content) > 0

    def test_files_missing_404(self, s):
        r = s.get(f"{API}/files/does/not/exist.png")
        assert r.status_code == 404


# ---------- Supabase admin ----------
class TestSupabase:
    def test_user_forbidden_get(self, s, user_h):
        r = s.get(f"{API}/admin/supabase", headers=user_h)
        assert r.status_code == 403

    def test_user_forbidden_put(self, s, user_h):
        r = s.put(f"{API}/admin/supabase", headers=user_h,
                  json={"project_url": "https://xyz.supabase.co", "service_role_key": "k"})
        assert r.status_code == 403

    def test_user_forbidden_test(self, s, user_h):
        r = s.post(f"{API}/admin/supabase/test", headers=user_h,
                   json={"project_url": "https://xyz.supabase.co", "service_role_key": "k"})
        assert r.status_code == 403

    def test_no_auth_401(self, s):
        r = s.get(f"{API}/admin/supabase")
        assert r.status_code == 401

    def test_get_shape(self, s, admin_h):
        r = s.get(f"{API}/admin/supabase", headers=admin_h)
        assert r.status_code == 200
        d = r.json()
        for k in ("configured", "project_url", "last_test_ok", "updated_at"):
            assert k in d
        assert "service_role_key" not in d
        assert "service_role_key_ciphertext" not in d

    def test_put_rejects_non_https(self, s, admin_h):
        r = s.put(f"{API}/admin/supabase", headers=admin_h,
                  json={"project_url": "http://example.com", "service_role_key": "abc"})
        assert r.status_code == 422

    def test_test_rejects_non_https(self, s, admin_h):
        r = s.post(f"{API}/admin/supabase/test", headers=admin_h,
                   json={"project_url": "http://example.com", "service_role_key": "abc"})
        assert r.status_code == 422

    def test_test_bogus_https_graceful(self, s, admin_h):
        r = s.post(f"{API}/admin/supabase/test", headers=admin_h,
                   json={"project_url": "https://this-host-should-not-exist-abc123.supabase.co",
                         "service_role_key": "fake-key-for-testing"})
        # Must not be 500 — graceful ok:false
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert isinstance(d.get("message", ""), str) and d["message"]

    def test_put_bogus_https_does_not_store_key(self, s, admin_h):
        # Save state so we can restore afterward
        before = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        r = s.put(f"{API}/admin/supabase", headers=admin_h,
                  json={"project_url": "https://this-host-should-not-exist-xyz789.supabase.co",
                        "service_role_key": "TEST_fake_key_never_persisted"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is False
        assert d.get("configured") in (False, None)
        # After a failed test, configured must remain False (unless it was already True before)
        after = s.get(f"{API}/admin/supabase", headers=admin_h).json()
        assert "service_role_key" not in after
        assert "service_role_key_ciphertext" not in after
        if not before.get("configured"):
            assert after["configured"] is False
        # last_test_ok reflects the failed attempt
        assert after["last_test_ok"] is False
