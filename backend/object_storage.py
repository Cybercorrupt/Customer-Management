"""Emergent Managed Object Storage client helpers.

The app never talks to storage directly — only this backend does, using the
EMERGENT_LLM_KEY. All reads/writes go through our own API endpoints.
"""
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

# Ensure .env is loaded even if this module is imported before server.py runs
# its own load_dotenv (module import order would otherwise leave the key unset).
load_dotenv(Path(__file__).parent / ".env")

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"

# Separates this app's objects from other apps sharing the same bucket.
APP_NAME = "customer-management"

_storage_key = None  # module-level; init once, reuse globally


def init_storage():
    """Call once at startup. Idempotent — returns a reusable storage_key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": emergent_key}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload (overwrites silently if path exists). Returns {"path","size","etag"}."""
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        # stale storage_key — reset and re-init once
        _reset()
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    """Download. Returns (content_bytes, content_type)."""
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 503:
        _reset()
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def _reset():
    global _storage_key
    _storage_key = None
