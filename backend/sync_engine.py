"""Persistent, one-way sync engine: Local DB (MongoDB) -> Supabase.

Architecture:
    CRUD -> MongoDB (source of truth) -> sync_queue (PENDING) -> worker -> Supabase

Design goals (all enforced here):
  * Local DB is the single source of truth. We NEVER pull from Supabase, so a
    deleted row can never "come back to life".
  * The queue is a real MongoDB collection -> it survives process restarts and
    lost connectivity. Nothing is fire-and-forget.
  * Idempotent: every push is an upsert on the primary key (on_conflict), so a
    retry can never create a duplicate.
  * Deletes are HARD deletes: a delete operation issues a PostgREST DELETE so
    the row is physically removed from Supabase (not kept as a tombstone).
  * Coalescing: multiple pending changes for the same entity collapse to the
    final state. CREATE -> DELETE before the row was ever synced is cancelled
    entirely (nothing is sent).
  * Retry with exponential backoff via `attempts` + `next_attempt_at`.
  * Entity-agnostic: customers, categories, segments, payment terms, users and
    app config all flow through the same engine.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

import httpx

logger = logging.getLogger("customer_mgmt.sync")

# PostgREST error when the remote table is missing a column the app sends.
_MISSING_COL_RE = re.compile(r"Could not find the '([^']+)' column")

MAX_ATTEMPTS = 20
BASE_BACKOFF_SECONDS = 5
MAX_BACKOFF_SECONDS = 300
BATCH_LIMIT = 500
IDLE_POLL_SECONDS = 5

_db = None
_fernet = None
_registry: Dict[str, Dict[str, str]] = {}
_wake = asyncio.Event()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value) -> datetime:
    if not value:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def init(database, fernet_obj) -> None:
    """Wire the engine to the shared Mongo handle + Fernet used by the app."""
    global _db, _fernet
    _db = database
    _fernet = fernet_obj


def register_entity(entity_type: str, table: str, conflict: str = "id") -> None:
    """Map an entity_type to its Supabase table + conflict target column."""
    _registry[entity_type] = {"table": table, "conflict": conflict}


async def ensure_indexes() -> None:
    await _db.sync_queue.create_index(
        [("entity_type", 1), ("entity_id", 1)], name="idx_queue_entity"
    )
    await _db.sync_queue.create_index([("status", 1), ("next_attempt_at", 1)], name="idx_queue_due")
    await _db.sync_state.create_index(
        [("entity_type", 1), ("entity_id", 1)], unique=True, name="uq_sync_state"
    )


async def _creds() -> Optional[Tuple[str, str]]:
    """Return (url, key) if Supabase is configured AND sync is enabled, else None."""
    doc = await _db.app_settings.find_one({"key": "supabase"})
    if not doc or not doc.get("service_role_key_ciphertext"):
        return None
    if not doc.get("sync_enabled", True):
        return None
    try:
        key = _fernet.decrypt(doc["service_role_key_ciphertext"].encode()).decode()
    except Exception:
        return None
    return doc["project_url"], key


async def _synced_ever(entity_type: str, entity_id: str) -> bool:
    state = await _db.sync_state.find_one(
        {"entity_type": entity_type, "entity_id": entity_id}, {"synced_ever": 1}
    )
    return bool(state and state.get("synced_ever"))


async def enqueue(entity_type: str, entity_id: str, payload: dict) -> None:
    """Enqueue the current state of one entity for a one-way push to Supabase.

    A payload whose `deleted_at` is set is treated as a tombstone (delete).
    Coalesces with any existing pending item for the same entity.
    """
    if entity_type not in _registry:
        return
    entity_id = str(entity_id)
    is_delete = payload.get("deleted_at") is not None
    now = _now()

    existing = await _db.sync_queue.find_one(
        {"entity_type": entity_type, "entity_id": entity_id, "status": {"$in": ["pending", "failed"]}}
    )
    synced_ever = await _synced_ever(entity_type, entity_id)

    # CREATE -> DELETE before the row was ever synced remotely: cancel everything.
    if is_delete and not synced_ever:
        if existing:
            await _db.sync_queue.delete_one({"_id": existing["_id"]})
        return

    if existing:
        # Coalesce: keep only the latest state, reset the retry clock.
        await _db.sync_queue.update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "payload": payload,
                    "operation": "delete" if is_delete else "upsert",
                    "change_id": uuid4().hex,
                    "status": "pending",
                    "attempts": 0,
                    "last_error": None,
                    "next_attempt_at": now,
                    "updated_at": now,
                }
            },
        )
    else:
        await _db.sync_queue.insert_one(
            {
                "id": uuid4().hex,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "operation": "delete" if is_delete else "upsert",
                "payload": payload,
                "change_id": uuid4().hex,
                "status": "pending",
                "attempts": 0,
                "last_error": None,
                "created_at": now,
                "updated_at": now,
                "next_attempt_at": now,
                "synced_at": None,
            }
        )
    _wake.set()


async def enqueue_many(entity_type: str, items: List[Tuple[str, dict]]) -> None:
    for entity_id, payload in items:
        await enqueue(entity_type, entity_id, payload)


async def _sb_upsert(url: str, key: str, table: str, conflict: str, rows: list) -> None:
    if not rows:
        return
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # Work on shallow copies so we can strip columns the remote schema lacks.
    payload = [dict(r) for r in rows]
    async with httpx.AsyncClient(timeout=30.0) as c:
        # Self-heal a lagging remote schema: if Supabase reports an unknown
        # column (PGRST204), drop that column from every row and retry. This
        # keeps the local DB as source of truth and prevents one row with a
        # newly-added field from blocking the whole queue forever.
        for _ in range(8):
            r = await c.post(
                f"{url}/rest/v1/{table}?on_conflict={conflict}", headers=headers, json=payload
            )
            if r.status_code < 400:
                return
            missing = None
            try:
                body = r.json()
                if body.get("code") == "PGRST204":
                    m = _MISSING_COL_RE.search(body.get("message") or "")
                    if m:
                        missing = m.group(1)
            except Exception:
                missing = None
            # Never strip the primary/conflict key — that is a real error.
            if missing and missing not in ("id", conflict) and any(missing in row for row in payload):
                logger.warning(
                    "Supabase table '%s' is missing column '%s' — dropping it from payload and retrying.",
                    table, missing,
                )
                for row in payload:
                    row.pop(missing, None)
                continue
            r.raise_for_status()
        r.raise_for_status()


async def _sb_delete(url: str, key: str, table: str, conflict: str, ids: list) -> None:
    """Hard-delete rows from Supabase by their conflict key (usually `id`).

    Used for delete operations so that removing a record in the app physically
    removes the row from the Supabase table (instead of leaving a tombstone).
    Idempotent: deleting an already-absent id is a no-op success.
    """
    ids = [str(i) for i in ids if i is not None]
    if not ids:
        return
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "return=minimal",
    }
    # PostgREST filter: {col}=in.("a","b",...). Double-quote each value so ids
    # containing commas/special chars are handled safely.
    quoted = ",".join('"' + i.replace('"', '""') + '"' for i in ids)
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.delete(
            f"{url}/rest/v1/{table}?{conflict}=in.({quoted})", headers=headers
        )
        if r.status_code >= 400:
            r.raise_for_status()


async def _mark_synced(items: List[dict]) -> None:
    now = _now()
    ids = [it["_id"] for it in items]
    await _db.sync_queue.delete_many({"_id": {"$in": ids}})
    for it in items:
        await _db.sync_state.update_one(
            {"entity_type": it["entity_type"], "entity_id": it["entity_id"]},
            {"$set": {"synced_ever": True, "synced_at": now}},
            upsert=True,
        )


async def _mark_failed(items: List[dict], error: str) -> None:
    now_dt = _now_dt()
    for it in items:
        attempts = it.get("attempts", 0) + 1
        backoff = min(BASE_BACKOFF_SECONDS * (2 ** attempts), MAX_BACKOFF_SECONDS)
        next_at = (now_dt + timedelta(seconds=backoff)).isoformat()
        status = "failed" if attempts >= MAX_ATTEMPTS else "pending"
        await _db.sync_queue.update_one(
            {"_id": it["_id"]},
            {
                "$set": {
                    "attempts": attempts,
                    "last_error": error[:500],
                    "next_attempt_at": next_at,
                    "updated_at": now_dt.isoformat(),
                    "status": status,
                }
            },
        )


async def drain(force: bool = False) -> dict:
    """Process every due PENDING item now. One batched upsert per table.

    `force=True` also retries items whose backoff window has not elapsed yet
    (used by the manual "Sync Now" button and by failed-item retries).
    """
    creds = await _creds()
    if not creds:
        pending = await _db.sync_queue.count_documents({"status": "pending"})
        failed = await _db.sync_queue.count_documents({"status": "failed"})
        return {"processed": 0, "pending": pending, "failed": failed, "skipped": "supabase_not_connected"}
    url, key = creds

    query: dict
    if force:
        query = {"status": {"$in": ["pending", "failed"]}}
    else:
        # Retry due PENDING items and also due terminal-FAILED items, so a
        # transient upstream problem (e.g. a table created later in Supabase)
        # self-heals on the normal schedule without any manual action.
        query = {"status": {"$in": ["pending", "failed"]}, "next_attempt_at": {"$lte": _now()}}

    items = await _db.sync_queue.find(query).sort("created_at", 1).limit(BATCH_LIMIT).to_list(BATCH_LIMIT)
    processed = 0
    # Group by table so each table is a single idempotent batch upsert.
    by_type: Dict[str, List[dict]] = {}
    for it in items:
        by_type.setdefault(it["entity_type"], []).append(it)

    for entity_type, group in by_type.items():
        reg = _registry.get(entity_type)
        if not reg:
            continue
        # Split by operation: upserts go to POST (merge-duplicates), deletes go
        # to a real DELETE so the row is physically removed from Supabase.
        upserts = [it for it in group if it.get("operation") != "delete"]
        deletes = [it for it in group if it.get("operation") == "delete"]
        if upserts:
            try:
                await _sb_upsert(
                    url, key, reg["table"], reg["conflict"], [it["payload"] for it in upserts]
                )
                await _mark_synced(upserts)
                processed += len(upserts)
            except Exception as e:  # noqa: BLE001
                msg = _error_message(e)
                logger.warning("Sync push (upsert) failed for %s: %s", entity_type, msg)
                await _mark_failed(upserts, msg)
        if deletes:
            try:
                await _sb_delete(
                    url, key, reg["table"], reg["conflict"], [it["entity_id"] for it in deletes]
                )
                await _mark_synced(deletes)
                processed += len(deletes)
            except Exception as e:  # noqa: BLE001
                msg = _error_message(e)
                logger.warning("Sync push (delete) failed for %s: %s", entity_type, msg)
                await _mark_failed(deletes, msg)

    pending = await _db.sync_queue.count_documents({"status": "pending"})
    failed = await _db.sync_queue.count_documents({"status": "failed"})
    return {"processed": processed, "pending": pending, "failed": failed}


def _error_message(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        try:
            return f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        except Exception:
            return f"HTTP {e.response.status_code}"
    return f"{type(e).__name__}: {e}"


async def queue_stats() -> dict:
    pending = await _db.sync_queue.count_documents({"status": "pending"})
    failed = await _db.sync_queue.count_documents({"status": "failed"})
    last = await _db.sync_queue.find({"status": "failed"}).sort("updated_at", -1).limit(1).to_list(1)
    last_error = last[0].get("last_error") if last else None
    return {"pending": pending, "failed": failed, "last_error": last_error}


async def worker_loop() -> None:
    """Background loop. Drains the queue, then sleeps until woken or timeout."""
    logger.info("Sync worker started")
    while True:
        try:
            await drain(force=False)
        except Exception as e:  # noqa: BLE001
            logger.warning("Sync worker iteration error: %s", type(e).__name__)
        try:
            await asyncio.wait_for(_wake.wait(), timeout=IDLE_POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
        _wake.clear()


def start_worker() -> None:
    try:
        asyncio.create_task(worker_loop())
    except RuntimeError:
        pass
