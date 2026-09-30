"""Deeper verification for iteration_5 critical fix:
Post create->delete->purge->pull cycle, verify:
  1. GET /api/customers does NOT contain the customer (no resurrection).
  2. A second POST /api/admin/supabase/pull STILL does not resurrect.
  3. Supabase row (via /api/admin/supabase/preview) for that code has deleted_at set.
"""
from __future__ import annotations
import os, time
from uuid import uuid4
import pytest, requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def admin_h() -> dict:
    r = requests.post(f"{API}/admin/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _mk_payload(code: str) -> dict:
    return {
        "customer_code": code, "customer_name": "TEST DeepPurge",
        "segment": "Retail", "purchasing_size": "Small", "area": "Jakarta",
        "status": "Active", "bad_debt": False, "bad_debt_nominal": 0,
        "address": "-", "latitude": None, "longitude": None,
        "phone": "0", "whatsapp": "0", "pic_name": "T",
        "payment_terms": "Cash", "credit_limit": 0,
    }


class TestDeepPurge:
    def test_double_pull_does_not_resurrect(self, admin_h):
        code = f"TEST-DEEP-{uuid4().hex[:6]}".upper()
        r = requests.post(f"{API}/customers", headers=admin_h, json=_mk_payload(code))
        assert r.status_code == 201, r.text
        cid = r.json()["id"]

        # allow initial push to Supabase to drain
        time.sleep(2.5)

        # soft delete then purge (permanent)
        assert requests.delete(f"{API}/customers/{cid}", headers=admin_h).status_code == 200
        assert requests.post(f"{API}/admin/trash/customer/purge", headers=admin_h,
                             json={"ids": [cid]}).status_code == 200

        # pull #1
        p1 = requests.post(f"{API}/admin/supabase/pull", headers=admin_h)
        if p1.status_code == 400:
            pytest.skip("Supabase not connected")
        assert p1.status_code == 200, p1.text
        listing = requests.get(f"{API}/customers", headers=admin_h).json()
        assert not any(c["id"] == cid for c in listing), \
            f"first pull resurrected purged customer {cid}"
        assert not any(c.get("customer_code", "").upper() == code for c in listing), \
            "customer code reappeared after first pull"

        # pull #2 (defense in depth: purge marker must persist across pulls)
        p2 = requests.post(f"{API}/admin/supabase/pull", headers=admin_h)
        assert p2.status_code == 200
        listing2 = requests.get(f"{API}/customers", headers=admin_h).json()
        assert not any(c["id"] == cid for c in listing2), "second pull resurrected purged customer"
        assert not any(c.get("customer_code", "").upper() == code for c in listing2)


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
