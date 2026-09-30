"""Regression tests for BUG A (Supabase Storage upload/serve) and BUG B
(Customer list + filter-options freshness after admin mutations).

Uses the public preview URL from EXPO_PUBLIC_BACKEND_URL so the tests exercise
the same ingress path the mobile client uses.
"""
import io
import os
import struct
import uuid
import zlib

import pytest
import requests
from dotenv import load_dotenv

# Load frontend .env because that's where the public URL lives
load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"


def _png_bytes() -> bytes:
    """Minimal 1x1 red PNG (no external deps)."""
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"  # filter=0 + RGB(255,0,0)
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/admin/login",
                      json={"username": "admin", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return tok


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/login",
                      json={"username": "user", "password": "user123"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# -------------------- BUG A: Supabase upload/serve --------------------
class TestBugASupabaseStorage:
    def test_upload_logo_and_fetch_roundtrip(self, admin_token):
        img = _png_bytes()
        files = {"file": ("logo.png", io.BytesIO(img), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/upload-logo",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "logo_url" in body
        logo_url = body["logo_url"]
        assert logo_url.startswith("/api/files/customer-management/branding/logo-")
        assert logo_url.endswith(".png")

        # Fetch via the same public /api/files/{path} endpoint that mobile uses
        full = f"{BASE_URL}{logo_url}"
        r2 = requests.get(full, timeout=60)
        assert r2.status_code == 200, r2.text
        assert (r2.headers.get("Content-Type") or "").startswith("image/"), r2.headers
        assert len(r2.content) > 0
        # Content should match what we uploaded (Supabase serves the exact bytes)
        assert r2.content == img, "served bytes differ from uploaded bytes"

    def test_upload_rejects_non_image(self, admin_token):
        files = {"file": ("hack.txt", io.BytesIO(b"not-an-image"), "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/admin/upload-logo",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
            timeout=30,
        )
        assert r.status_code == 400

    def test_upload_requires_admin(self, user_token):
        img = _png_bytes()
        files = {"file": ("x.png", io.BytesIO(img), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/admin/upload-logo",
            headers={"Authorization": f"Bearer {user_token}"},
            files=files,
            timeout=30,
        )
        assert r.status_code in (401, 403)

    def test_files_missing_path_404(self):
        r = requests.get(
            f"{BASE_URL}/api/files/customer-management/branding/does-not-exist-{uuid.uuid4().hex}.png",
            timeout=30,
        )
        assert r.status_code == 404


# -------------------- BUG B: customers + filter-options freshness --------------------
class TestBugBFreshness:
    def test_customers_list_and_search(self, user_token):
        h = {"Authorization": f"Bearer {user_token}"}
        r = requests.get(f"{BASE_URL}/api/customers", headers=h, timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert len(items) > 0
        first = items[0]
        assert "customer_name" in first and "id" in first
        # search by an existing name substring
        name = first["customer_name"]
        needle = name.split()[0][:4]
        r2 = requests.get(f"{BASE_URL}/api/customers", headers=h,
                          params={"search": needle}, timeout=30)
        assert r2.status_code == 200
        found = [c for c in r2.json() if c["id"] == first["id"]]
        assert found, f"search for '{needle}' did not return the customer it should"

    def test_filter_options_shape(self, user_token):
        h = {"Authorization": f"Bearer {user_token}"}
        r = requests.get(f"{BASE_URL}/api/filter-options", headers=h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        for k in ("segment", "purchasing_size", "area"):
            assert k in body and isinstance(body[k], list)

    def test_create_then_visible_and_delete_then_hidden(self, admin_token, user_token):
        code = f"TESTBB{uuid.uuid4().hex[:6].upper()}"
        payload = {
            "customer_code": code,
            "customer_name": f"TEST_BugB_{code}",
            "segment": "General Trade",
            "purchasing_size": "Small",
            "area": "Surabaya",
            "status": "Active",
            "bad_debt_nominal": 0,
            "address": "TEST addr",
            "latitude": None,
            "longitude": None,
            "phone": "",
            "whatsapp": "",
            "pic_name": "Tester",
            "payment_terms": "Cash",
            "credit_limit": 0,
        }
        ah = {"Authorization": f"Bearer {admin_token}"}
        uh = {"Authorization": f"Bearer {user_token}"}
        # Create
        r = requests.post(f"{BASE_URL}/api/customers", json=payload, headers=ah, timeout=30)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        try:
            # User-side search should find it (freshness w/o cache since curl has none)
            r2 = requests.get(f"{BASE_URL}/api/customers", headers=uh,
                              params={"search": "TEST_BugB"}, timeout=30)
            assert r2.status_code == 200
            got = [c for c in r2.json() if c["id"] == cid]
            assert got, "newly created customer not returned by user search"
            # Delete
            rd = requests.delete(f"{BASE_URL}/api/customers/{cid}", headers=ah, timeout=30)
            assert rd.status_code == 200, rd.text
            # After delete: should not appear
            r3 = requests.get(f"{BASE_URL}/api/customers", headers=uh,
                              params={"search": "TEST_BugB"}, timeout=30)
            got2 = [c for c in r3.json() if c["id"] == cid]
            assert not got2, "deleted customer still visible to user"
            # single GET should 404
            r4 = requests.get(f"{BASE_URL}/api/customers/{cid}", headers=uh, timeout=30)
            assert r4.status_code == 404
        finally:
            # best-effort cleanup if create succeeded but assertions failed before delete
            requests.delete(f"{BASE_URL}/api/customers/{cid}", headers=ah, timeout=30)

    def test_sync_pull_now_endpoint_reachable(self, user_token):
        # Endpoint must be reachable (auth OK). 400 is expected in this preview
        # env because no Supabase-backed online DB is configured for two-way sync;
        # frontend still relies on useFocusEffect invalidations (Bug B core fix).
        h = {"Authorization": f"Bearer {user_token}"}
        r = requests.post(f"{BASE_URL}/api/sync/pull-now", headers=h, timeout=30)
        assert r.status_code in (200, 202, 400), r.text
        assert r.status_code != 401 and r.status_code != 403
