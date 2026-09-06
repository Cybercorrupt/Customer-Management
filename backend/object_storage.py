"""Supabase Storage client helpers.

Customer/branding images are stored in a Supabase Storage bucket. Only this
backend talks to Supabase (using the SERVICE_ROLE key); the frontend keeps
using the existing /api/files/{path} + /api/admin/upload-logo endpoints, so
nothing changes on the client side.

Required backend environment variables:
  SUPABASE_URL             e.g. https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY  service_role key (backend only, never shipped)
  SUPABASE_STORAGE_BUCKET  bucket name, e.g. customer-photos
"""
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

# Ensure .env is loaded even if this module is imported before server.py runs
# its own load_dotenv (module import order would otherwise leave keys unset).
load_dotenv(Path(__file__).parent / ".env")

# Separates this app's objects from other content sharing the same bucket.
APP_NAME = "customer-management"


def _config():
    """Read Supabase config at call time (so .env reloads take effect)."""
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = (os.environ.get("SUPABASE_STORAGE_BUCKET") or "").strip()
    if not url or not key or not bucket:
        raise RuntimeError(
            "Supabase Storage is not configured. Set SUPABASE_URL, "
            "SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET."
        )
    return url, key, bucket


def _object_url(url: str, bucket: str, path: str) -> str:
    return f"{url}/storage/v1/object/{bucket}/{path.lstrip('/')}"


def _headers(key: str, content_type: str = None) -> dict:
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if content_type:
        h["Content-Type"] = content_type
    return h


def init_storage():
    """Called once at startup. Validates config; returns True when ready."""
    _config()  # raises if misconfigured
    return True


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload (overwrites silently if path exists via x-upsert)."""
    url, key, bucket = _config()
    resp = requests.post(
        _object_url(url, bucket, path),
        headers={**_headers(key, content_type), "x-upsert": "true"},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return {"path": path, "size": len(data)}


def get_object(path: str):
    """Download. Returns (content_bytes, content_type)."""
    url, key, bucket = _config()
    resp = requests.get(
        _object_url(url, bucket, path),
        headers=_headers(key),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
