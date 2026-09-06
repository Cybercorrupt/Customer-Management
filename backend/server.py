import os
import logging
import random
import asyncio
import csv
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal
from urllib.parse import urlparse
from uuid import uuid4

import bcrypt
import jwt
import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, UploadFile, File, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

from object_storage import init_storage, put_object, get_object, APP_NAME
import sync_engine

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config / DB
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "720"))

# Encrypts sensitive third-party credentials (e.g. Supabase key) before storing.
fernet = Fernet(os.environ["CREDENTIAL_MASTER_KEY"].encode())

# Optional built-in Supabase credentials. When present, they are seeded on
# startup so the app ships "connected by default"; admin can still change them.
SUPABASE_DEFAULT_URL = os.environ.get("SUPABASE_DEFAULT_URL", "").strip().rstrip("/")
SUPABASE_DEFAULT_KEY = os.environ.get("SUPABASE_DEFAULT_KEY", "").strip()
# Optional Supabase Personal Access Token (sbp_...) for auto-creating tables
# (DDL) via the Management API. Seeded once so fresh installs auto-connect.
SUPABASE_DEFAULT_ACCESS_TOKEN = os.environ.get("SUPABASE_DEFAULT_ACCESS_TOKEN", "").strip()

app = FastAPI(title="Customer Management API")
api_router = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("customer_mgmt")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class Customer(BaseModel):
    id: str
    customer_code: str
    customer_name: str
    segment: str
    purchasing_size: str
    area: str
    status: str  # Active | Inactive | Bad Debt
    bad_debt: bool
    bad_debt_nominal: float
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: str
    whatsapp: str
    pic_name: str = ""
    payment_terms: str
    credit_limit: float


class CustomerInput(BaseModel):
    customer_code: str = Field(min_length=1)
    customer_name: str = Field(min_length=1)
    segment: str = Field(min_length=1)
    purchasing_size: str = Field(min_length=1)
    area: str = Field(min_length=1)
    status: Literal["Active", "Inactive", "Bad Debt"]
    payment_terms: str = Field(min_length=1)
    credit_limit: float = 0
    phone: str = ""
    whatsapp: str = ""
    pic_name: str = ""
    address: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    bad_debt_nominal: float = 0


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["username"],
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
):
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = jwt.decode(
            credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM]
        )
        username = payload.get("sub")
    except jwt.PyJWTError:
        raise unauthorized
    if not username:
        raise unauthorized
    user = await db.users.find_one({"username": username})
    if not user:
        raise unauthorized
    return user


def public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "role": user["role"],
        "name": user.get("name", user["username"]),
    }


async def require_admin(user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Customer Management API"}


@api_router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    user = await db.users.find_one({"username": body.username.strip().lower()})
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    return LoginResponse(
        access_token=create_access_token(user),
        user=public_user(user),
    )


@api_router.post("/admin/login", response_model=LoginResponse)
async def admin_login(body: LoginRequest):
    user = await db.users.find_one({"username": body.username.strip().lower()})
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    return LoginResponse(
        access_token=create_access_token(user),
        user=public_user(user),
    )


@api_router.get("/auth/me")
async def me(user=Depends(current_user)):
    return public_user(user)


@api_router.get("/customers", response_model=List[Customer])
async def list_customers(search: Optional[str] = None, user=Depends(current_user)):
    query: dict = {"deleted_at": None}
    if search:
        s = search.strip()
        query["$or"] = [
            {"customer_name": {"$regex": s, "$options": "i"}},
            {"customer_code": {"$regex": s, "$options": "i"}},
            {"pic_name": {"$regex": s, "$options": "i"}},
            {"phone": {"$regex": s, "$options": "i"}},
            {"whatsapp": {"$regex": s, "$options": "i"}},
            {"address": {"$regex": s, "$options": "i"}},
        ]
    docs = await db.customers.find(query, {"_id": 0}).sort("customer_name", 1).to_list(2000)
    return [Customer(**d) for d in docs]


@api_router.get("/customers/{customer_id}", response_model=Customer)
async def get_customer(customer_id: str, user=Depends(current_user)):
    doc = await db.customers.find_one({"id": customer_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    return Customer(**doc)


@api_router.get("/filter-options")
async def filter_options(user=Depends(current_user)):
    """Filter dropdown values for the user Customers screen.

    Sourced from the live database: Master Data names + any distinct value that
    actually appears on active customers. This keeps the user's filters in sync
    with the database (adding/removing a master value or importing new data is
    reflected immediately, no hardcoded lists)."""
    out: dict = {}
    for et, field in (("segment", "segment"), ("purchasing_size", "purchasing_size"), ("area", "area")):
        names: set = set()
        docs = await db[MASTER_COLLECTION[et]].find(
            {"deleted_at": None}, {"_id": 0, "name": 1}
        ).to_list(2000)
        for d in docs:
            n = (d.get("name") or "").strip()
            if n:
                names.add(n)
        for v in await db.customers.distinct(field, {"deleted_at": None}):
            if v and str(v).strip():
                names.add(str(v).strip())
        out[et] = sorted(names, key=lambda s: s.lower())
    return out


@api_router.post("/customers", response_model=Customer, status_code=201)
async def create_customer(body: CustomerInput, admin=Depends(require_admin)):
    code = body.customer_code.strip()
    cid = code.lower()
    existing = await db.customers.find_one({"id": cid})
    if existing and existing.get("deleted_at") is None:
        raise HTTPException(status_code=409, detail="Customer code sudah digunakan")
    is_bad = body.status == "Bad Debt"
    prev_version = int(existing.get("version", 0)) if existing else 0
    doc = {
        "id": cid,
        "customer_code": code,
        "customer_name": body.customer_name.strip(),
        "segment": body.segment,
        "purchasing_size": body.purchasing_size,
        "area": body.area,
        "status": body.status,
        "bad_debt": is_bad,
        "bad_debt_nominal": float(body.bad_debt_nominal) if is_bad else 0.0,
        "address": body.address,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "phone": body.phone,
        "whatsapp": body.whatsapp,
        "pic_name": body.pic_name.strip(),
        "payment_terms": body.payment_terms,
        "credit_limit": float(body.credit_limit),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
        "version": prev_version + 1,
        "change_id": uuid4().hex,
    }
    # replace_one with upsert lets a previously soft-deleted code be reused
    await db.customers.replace_one({"id": cid}, doc, upsert=True)
    await enqueue_customers([cid])
    return Customer(**doc)


@api_router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, body: CustomerInput, admin=Depends(require_admin)):
    existing = await db.customers.find_one({"id": customer_id, "deleted_at": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    is_bad = body.status == "Bad Debt"
    update = {
        "customer_code": body.customer_code.strip(),
        "customer_name": body.customer_name.strip(),
        "segment": body.segment,
        "purchasing_size": body.purchasing_size,
        "area": body.area,
        "status": body.status,
        "bad_debt": is_bad,
        "bad_debt_nominal": float(body.bad_debt_nominal) if is_bad else 0.0,
        "address": body.address,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "phone": body.phone,
        "whatsapp": body.whatsapp,
        "pic_name": body.pic_name.strip(),
        "payment_terms": body.payment_terms,
        "credit_limit": float(body.credit_limit),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "change_id": uuid4().hex,
    }
    await db.customers.update_one({"id": customer_id}, {"$set": update, "$inc": {"version": 1}})
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    await enqueue_customers([customer_id])
    return Customer(**doc)


@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, admin=Depends(require_admin)):
    res = await db.customers.update_one(
        {"id": customer_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat(),
                  "updated_at": datetime.now(timezone.utc).isoformat(),
                  "change_id": uuid4().hex},
         "$inc": {"version": 1}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer tidak ditemukan")
    await enqueue_customers([customer_id])
    return {"success": True, "message": "Customer deleted successfully"}


class BulkIdsInput(BaseModel):
    ids: List[str]


class BulkStatusInput(BaseModel):
    ids: List[str]
    status: Literal["Active", "Inactive", "Bad Debt"]


@api_router.post("/admin/customers/bulk-delete")
async def bulk_delete_customers(body: BulkIdsInput, admin=Depends(require_admin)):
    if not body.ids:
        raise HTTPException(status_code=400, detail="No customers selected")
    res = await db.customers.update_many(
        {"id": {"$in": body.ids}, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat(),
                  "updated_at": datetime.now(timezone.utc).isoformat(),
                  "change_id": uuid4().hex},
         "$inc": {"version": 1}},
    )
    await enqueue_customers(body.ids)
    return {"success": True, "deleted": res.modified_count}


@api_router.post("/admin/customers/bulk-status")
async def bulk_status_customers(body: BulkStatusInput, admin=Depends(require_admin)):
    if not body.ids:
        raise HTTPException(status_code=400, detail="No customers selected")
    is_bad = body.status == "Bad Debt"
    update: dict = {"status": body.status, "bad_debt": is_bad,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "change_id": uuid4().hex}
    if not is_bad:
        update["bad_debt_nominal"] = 0.0
    res = await db.customers.update_many(
        {"id": {"$in": body.ids}, "deleted_at": None},
        {"$set": update, "$inc": {"version": 1}},
    )
    await enqueue_customers(body.ids)
    return {"success": True, "updated": res.modified_count}


@api_router.get("/admin/statistics")
async def admin_statistics(admin=Depends(require_admin)):
    docs = await db.customers.find({"deleted_at": None}, {"_id": 0}).to_list(5000)
    return {
        "total_customer": len(docs),
        "active_customer": sum(1 for d in docs if d["status"] == "Active"),
        "inactive_customer": sum(1 for d in docs if d["status"] == "Inactive"),
        "bad_debt_customer": sum(1 for d in docs if d["status"] == "Bad Debt"),
    }


# ---------------------------------------------------------------------------
# Import / Export (admin only)
# ---------------------------------------------------------------------------
IMPORT_HEADERS = [
    "Customer Code", "Customer Name", "Segment", "Purchasing Size", "Area",
    "Status", "Bad Debt", "Bad Debt Nominal", "Address", "Latitude",
    "Longitude", "Phone", "WhatsApp", "PIC Name", "Payment Terms", "Credit Limit",
]


class ImportPayload(BaseModel):
    rows: List[dict]


def _cell(row_lower: dict, header: str) -> str:
    val = row_lower.get(header.lower(), "")
    return str(val).strip() if val is not None else ""


def _num(value: str):
    """Return (number, ok). Empty string -> (None, True)."""
    if value == "":
        return None, True
    try:
        return float(value.replace(",", ".")), True
    except (ValueError, AttributeError):
        return None, False


def _classify_rows(rows: List[dict], existing_codes: set) -> List[dict]:
    normalized = [
        {(k.strip().lower() if isinstance(k, str) else k): v for k, v in r.items()}
        for r in rows
    ]
    code_counts: dict = {}
    for rl in normalized:
        c = _cell(rl, "Customer Code").lower()
        if c:
            code_counts[c] = code_counts.get(c, 0) + 1

    results = []
    for i, rl in enumerate(normalized):
        code = _cell(rl, "Customer Code")
        name = _cell(rl, "Customer Name")
        status = _cell(rl, "Status")
        area = _cell(rl, "Area")
        error = None

        if not code:
            error = "Customer Code wajib diisi"
        elif not name:
            error = "Customer Name wajib diisi"
        elif status not in ("Active", "Inactive", "Bad Debt"):
            error = "Status tidak valid"
        elif not _num(_cell(rl, "Latitude"))[1]:
            error = "Latitude harus numeric"
        elif not _num(_cell(rl, "Longitude"))[1]:
            error = "Longitude harus numeric"
        elif not _num(_cell(rl, "Bad Debt Nominal"))[1]:
            error = "Bad Debt Nominal harus numeric"
        elif not _num(_cell(rl, "Credit Limit"))[1]:
            error = "Credit Limit harus numeric"
        elif code_counts.get(code.lower(), 0) > 1:
            error = "Duplicate Customer Code di file"

        if error:
            result = "ERROR"
        else:
            result = "UPDATE" if code.lower() in existing_codes else "CREATE"

        results.append({
            "no": i + 1,
            "customer_code": code,
            "customer_name": name,
            "status": status,
            "area": area,
            "result": result,
            "error": error,
        })
    return results


def _build_doc(rl: dict) -> dict:
    code = _cell(rl, "Customer Code")
    status = _cell(rl, "Status")
    is_bad = status == "Bad Debt"
    lat, _ = _num(_cell(rl, "Latitude"))
    lng, _ = _num(_cell(rl, "Longitude"))
    bd, _ = _num(_cell(rl, "Bad Debt Nominal"))
    cl, _ = _num(_cell(rl, "Credit Limit"))
    return {
        "id": code.lower(),
        "customer_code": code,
        "customer_name": _cell(rl, "Customer Name"),
        "segment": _cell(rl, "Segment") or "-",
        "purchasing_size": _cell(rl, "Purchasing Size") or "-",
        "area": _cell(rl, "Area") or "-",
        "status": status,
        "bad_debt": is_bad,
        "bad_debt_nominal": (bd or 0.0) if is_bad else 0.0,
        "address": _cell(rl, "Address"),
        "latitude": lat,
        "longitude": lng,
        "phone": _cell(rl, "Phone"),
        "whatsapp": _cell(rl, "WhatsApp"),
        "pic_name": _cell(rl, "PIC Name"),
        "payment_terms": _cell(rl, "Payment Terms") or "Cash",
        "credit_limit": cl or 0.0,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
        "version": 1,
        "change_id": uuid4().hex,
    }


async def _existing_codes() -> set:
    docs = await db.customers.find({"deleted_at": None}, {"customer_code": 1}).to_list(5000)
    return {d["customer_code"].lower() for d in docs}


@api_router.post("/admin/import/preview")
async def import_preview(payload: ImportPayload, admin=Depends(require_admin)):
    if not payload.rows:
        raise HTTPException(status_code=400, detail="File kosong")
    results = _classify_rows(payload.rows, await _existing_codes())
    counts = {
        "total": len(results),
        "create": sum(1 for r in results if r["result"] == "CREATE"),
        "update": sum(1 for r in results if r["result"] == "UPDATE"),
        "error": sum(1 for r in results if r["result"] == "ERROR"),
    }
    return {"results": results, "counts": counts}


@api_router.post("/admin/import")
async def import_customers(payload: ImportPayload, admin=Depends(require_admin)):
    if not payload.rows:
        raise HTTPException(status_code=400, detail="File kosong")
    results = _classify_rows(payload.rows, await _existing_codes())
    created = updated = failed = 0
    errors = []
    imported_ids: list = []
    for res, raw in zip(results, payload.rows):
        if res["result"] == "ERROR":
            failed += 1
            errors.append({"no": res["no"], "customer_code": res["customer_code"], "error": res["error"]})
            continue
        rl = {(k.strip().lower() if isinstance(k, str) else k): v for k, v in raw.items()}
        doc = _build_doc(rl)
        await db.customers.replace_one({"id": doc["id"]}, doc, upsert=True)
        imported_ids.append(doc["id"])
        if res["result"] == "CREATE":
            created += 1
        else:
            updated += 1
    await enqueue_customers(imported_ids)
    return {"total": len(results), "created": created, "updated": updated, "failed": failed, "errors": errors}


@api_router.get("/admin/export")
async def export_customers(admin=Depends(require_admin)):
    docs = await db.customers.find({"deleted_at": None}, {"_id": 0}).sort("customer_code", 1).to_list(5000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(IMPORT_HEADERS)
    for d in docs:
        writer.writerow([
            d.get("customer_code", ""),
            d.get("customer_name", ""),
            d.get("segment", ""),
            d.get("purchasing_size", ""),
            d.get("area", ""),
            d.get("status", ""),
            "Yes" if d.get("bad_debt") else "No",
            d.get("bad_debt_nominal", 0),
            d.get("address", ""),
            "" if d.get("latitude") is None else d.get("latitude"),
            "" if d.get("longitude") is None else d.get("longitude"),
            d.get("phone", ""),
            d.get("whatsapp", ""),
            d.get("pic_name", ""),
            d.get("payment_terms", ""),
            d.get("credit_limit", 0),
        ])
    return {"count": len(docs), "csv": output.getvalue()}


# ---------------------------------------------------------------------------
# Excel (.xlsx) import/export — single workbook for Customer + Master Data.
# Import path: Excel -> validate/preview -> Local DB (bulk) -> sync_queue.
# Export path: always from Local DB (never Supabase). Round-trippable.
# ---------------------------------------------------------------------------
import excel_io  # noqa: E402

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetml.sheet"
XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_COMPARE_FIELDS = [
    "customer_code", "customer_name", "segment", "purchasing_size", "area", "status",
    "bad_debt", "bad_debt_nominal", "address", "latitude", "longitude", "phone",
    "whatsapp", "pic_name", "payment_terms", "credit_limit",
]


def _customer_unchanged(existing: dict, cand: dict) -> bool:
    for f in _COMPARE_FIELDS:
        a, b = existing.get(f), cand.get(f)
        if f in ("latitude", "longitude"):
            if (a is None) != (b is None):
                return False
            if a is not None and abs(float(a) - float(b)) > 1e-9:
                return False
        elif f in ("bad_debt_nominal", "credit_limit"):
            if abs(float(a or 0) - float(b or 0)) > 1e-6:
                return False
        elif f == "bad_debt":
            if bool(a) != bool(b):
                return False
        else:
            if (a or "") != (b or ""):
                return False
    return True


def _classify_customers(rows: List[dict], existing_map: dict) -> List[dict]:
    normalized = [
        {(k.strip().lower() if isinstance(k, str) else k): v for k, v in r.items()}
        for r in rows
    ]
    code_counts: dict = {}
    for rl in normalized:
        c = _cell(rl, "Customer Code").lower()
        if c:
            code_counts[c] = code_counts.get(c, 0) + 1

    results = []
    for i, rl in enumerate(normalized):
        code = _cell(rl, "Customer Code")
        name = _cell(rl, "Customer Name")
        status = _cell(rl, "Status")
        area = _cell(rl, "Area")
        error = None
        if not code:
            error = "Customer Code wajib diisi"
        elif not name:
            error = "Customer Name wajib diisi"
        elif status not in ("Active", "Inactive", "Bad Debt"):
            error = "Status tidak valid"
        elif not _num(_cell(rl, "Latitude"))[1]:
            error = "Latitude harus numeric"
        elif not _num(_cell(rl, "Longitude"))[1]:
            error = "Longitude harus numeric"
        elif not _num(_cell(rl, "Bad Debt Nominal"))[1]:
            error = "Bad Debt Nominal harus numeric"
        elif not _num(_cell(rl, "Credit Limit"))[1]:
            error = "Credit Limit harus numeric"
        elif code_counts.get(code.lower(), 0) > 1:
            error = "Duplicate Customer Code di file"

        if error:
            result = "ERROR"
        else:
            code_l = code.lower()
            if code_l not in existing_map:
                result = "CREATE"
            else:
                result = "SKIP" if _customer_unchanged(existing_map[code_l], _build_doc(rl)) else "UPDATE"

        results.append({
            "no": i + 1, "customer_code": code, "customer_name": name,
            "status": status, "area": area, "result": result, "error": error,
        })
    return results


def _classify_master(rows: List[dict], existing: dict) -> List[dict]:
    """existing: {name_lower: {"description": str}} for the entity."""
    results = []
    seen: set = set()
    for i, r in enumerate(rows):
        rl = {(k.strip().lower() if isinstance(k, str) else k): v for k, v in r.items()}
        name = str(rl.get("name", "") or "").strip()
        desc = str(rl.get("description", "") or "").strip()
        error = None
        if not name:
            error = "Nama wajib diisi"
        elif name.lower() in seen:
            error = "Duplicate nama di file"
        else:
            seen.add(name.lower())
        if error:
            result = "ERROR"
        elif name.lower() not in existing:
            result = "CREATE"
        elif (existing[name.lower()].get("description") or "") != desc:
            result = "UPDATE"
        else:
            result = "SKIP"
        results.append({"no": i + 1, "name": name, "description": desc, "result": result, "error": error})
    return results


def _counts(results: List[dict]) -> dict:
    return {
        "total": len(results),
        "create": sum(1 for r in results if r["result"] == "CREATE"),
        "update": sum(1 for r in results if r["result"] == "UPDATE"),
        "skip": sum(1 for r in results if r["result"] == "SKIP"),
        "error": sum(1 for r in results if r["result"] == "ERROR"),
    }


async def _load_customer_map() -> dict:
    docs = await db.customers.find({}, {"_id": 0}).to_list(50000)
    return {d["id"]: d for d in docs}


async def _load_master_existing(entity: str) -> dict:
    docs = await db[MASTER_COLLECTION[entity]].find({"deleted_at": None}, {"_id": 0}).to_list(20000)
    return {d["name"].strip().lower(): d for d in docs}


async def _parse_upload(file: UploadFile) -> dict:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File kosong")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran file maksimal 15MB")
    try:
        return excel_io.parse(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api_router.get("/admin/template.xlsx")
async def download_template(admin=Depends(require_admin)):
    data = await run_in_threadpool(excel_io.build_template)
    return Response(
        content=data, media_type=XLSX_CT,
        headers={"Content-Disposition": 'attachment; filename="customer_import_template.xlsx"'},
    )


@api_router.get("/admin/export.xlsx")
async def export_xlsx(
    status: Optional[str] = None,
    search: Optional[str] = None,
    ids: Optional[str] = None,
    admin=Depends(require_admin),
):
    query: dict = {"deleted_at": None}
    if status in ("Active", "Inactive", "Bad Debt"):
        query["status"] = status
    if ids:
        query["id"] = {"$in": [i.strip().lower() for i in ids.split(",") if i.strip()]}
    if search:
        rx = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [
            {"customer_name": rx}, {"customer_code": rx}, {"pic_name": rx},
            {"phone": rx}, {"whatsapp": rx}, {"address": rx},
        ]
    customers = await db.customers.find(query, {"_id": 0}).sort("customer_code", 1).to_list(50000)
    masters = {}
    for entity in ("purchasing_size", "segment", "top", "area"):
        masters[entity] = await db[MASTER_COLLECTION[entity]].find(
            {"deleted_at": None}, {"_id": 0}
        ).sort("name", 1).to_list(20000)
    data = await run_in_threadpool(excel_io.build_export, customers, masters)
    return Response(
        content=data, media_type=XLSX_CT,
        headers={"Content-Disposition": 'attachment; filename="customer_export.xlsx"'},
    )


@api_router.post("/admin/import/xlsx/preview")
async def import_xlsx_preview(file: UploadFile = File(...), admin=Depends(require_admin)):
    parsed = await _parse_upload(file)
    existing_map = await _load_customer_map()
    cust_results = _classify_customers(parsed.get("customers", []), existing_map)
    master_out = {}
    for entity in ("purchasing_size", "segment", "top", "area"):
        existing = await _load_master_existing(entity)
        res = _classify_master(parsed.get(entity, []), existing)
        master_out[entity] = {"counts": _counts(res), "results": res}
    return {
        "customers": {"counts": _counts(cust_results), "results": cust_results},
        "master": master_out,
    }


@api_router.post("/admin/import/xlsx/commit")
async def import_xlsx_commit(file: UploadFile = File(...), admin=Depends(require_admin)):
    from pymongo import ReplaceOne, UpdateOne

    parsed = await _parse_upload(file)
    existing_map = await _load_customer_map()

    # ----- Master data first (so customer relations can reference them) -----
    master_summary = {}
    referenced = {"purchasing_size": set(), "segment": set(), "top": set(), "area": set()}
    for entity in ("purchasing_size", "segment", "top", "area"):
        existing = await _load_master_existing(entity)
        res = _classify_master(parsed.get(entity, []), existing)
        ops = []
        changed_ids = []
        now = datetime.now(timezone.utc).isoformat()
        for r in res:
            if r["result"] == "CREATE":
                mid = uuid4().hex
                ops.append(ReplaceOne(
                    {"id": mid},
                    {"id": mid, "name": r["name"], "description": r["description"],
                     "deleted_at": None, "updated_at": now, "version": 1, "change_id": uuid4().hex},
                    upsert=True,
                ))
                changed_ids.append((entity, mid))
                existing[r["name"].lower()] = {"id": mid, "description": r["description"]}
            elif r["result"] == "UPDATE":
                doc = existing[r["name"].lower()]
                ops.append(UpdateOne(
                    {"id": doc["id"]},
                    {"$set": {"description": r["description"], "updated_at": now, "change_id": uuid4().hex},
                     "$inc": {"version": 1}},
                ))
                changed_ids.append((entity, doc["id"]))
        if ops:
            await db[MASTER_COLLECTION[entity]].bulk_write(ops, ordered=False)
        for et, mid in changed_ids:
            await enqueue_master(et, mid)
        master_summary[entity] = {k: v for k, v in _counts(res).items() if k in ("total", "create", "update", "skip", "error")}

    # ----- Customers (bulk upsert) -----
    cust_results = _classify_customers(parsed.get("customers", []), existing_map)
    normalized = [
        {(k.strip().lower() if isinstance(k, str) else k): v for k, v in r.items()}
        for r in parsed.get("customers", [])
    ]
    ops = []
    changed_ids: list = []
    created = updated = skipped = 0
    errors = []
    for res, rl in zip(cust_results, normalized):
        if res["result"] == "ERROR":
            errors.append({"no": res["no"], "customer_code": res["customer_code"], "error": res["error"]})
            continue
        if res["result"] == "SKIP":
            skipped += 1
            continue
        doc = _build_doc(rl)
        prev = existing_map.get(doc["id"])
        doc["version"] = int(prev.get("version", 0)) + 1 if prev else 1
        ops.append(ReplaceOne({"id": doc["id"]}, doc, upsert=True))
        changed_ids.append(doc["id"])
        # track referenced master values for auto-create
        referenced["segment"].add(doc.get("segment", "").strip())
        referenced["purchasing_size"].add(doc.get("purchasing_size", "").strip())
        referenced["top"].add(doc.get("payment_terms", "").strip())
        referenced["area"].add(doc.get("area", "").strip())
        if res["result"] == "CREATE":
            created += 1
        else:
            updated += 1
    if ops:
        await db.customers.bulk_write(ops, ordered=False)
    await enqueue_customers(changed_ids)

    # ----- Auto-create master values referenced by customers (keep relations valid) -----
    for entity in ("purchasing_size", "segment", "top", "area"):
        existing = await _load_master_existing(entity)
        now = datetime.now(timezone.utc).isoformat()
        add_ops = []
        add_ids = []
        for name in referenced[entity]:
            if name and name.lower() not in existing:
                mid = uuid4().hex
                add_ops.append(ReplaceOne(
                    {"id": mid},
                    {"id": mid, "name": name, "description": "", "deleted_at": None,
                     "updated_at": now, "version": 1, "change_id": uuid4().hex},
                    upsert=True,
                ))
                add_ids.append((entity, mid))
                existing[name.lower()] = {"id": mid}
        if add_ops:
            await db[MASTER_COLLECTION[entity]].bulk_write(add_ops, ordered=False)
            master_summary[entity]["auto_created"] = len(add_ids)
        for et, mid in add_ids:
            await enqueue_master(et, mid)

    stats = await sync_engine.queue_stats()
    return {
        "customers": {
            "total": len(cust_results), "created": created, "updated": updated,
            "skipped": skipped, "failed": len(errors), "errors": errors,
        },
        "master": master_summary,
        "queue_pending": stats["pending"],
    }


# ---------------------------------------------------------------------------
# About settings (editable by admin)
# ---------------------------------------------------------------------------
DEFAULT_ABOUT = {
    "app_name": "Customer Data Management",
    "tagline": "Customer Data & Analytics",
    "description": (
        "Customer Management adalah aplikasi untuk membantu perusahaan mengelola "
        "informasi customer secara terstruktur serta memantau kondisi customer "
        "berdasarkan status, purchasing size, area dan bad debt."
    ),
    "developer": "MeO-Labs",
    "author": "MeO-Labs",
    "version": "1.0.0",
    "copyright": "© 2026 MeO-Labs. All rights reserved.",
    "logo_url": "",
    "primary_color": "#1F5297",
    "secondary_color": "#EE8C28",
    "admin_email": "admin@meolabs.co.id",
    "admin_phone": "+62 21 5099 1234",
    "admin_whatsapp": "+62 812 3456 7890",
}


class AboutInfo(BaseModel):
    app_name: str = DEFAULT_ABOUT["app_name"]
    tagline: str = DEFAULT_ABOUT["tagline"]
    description: str = DEFAULT_ABOUT["description"]
    developer: str = DEFAULT_ABOUT["developer"]
    author: str = DEFAULT_ABOUT["author"]
    version: str = DEFAULT_ABOUT["version"]
    copyright: str = DEFAULT_ABOUT["copyright"]
    logo_url: str = DEFAULT_ABOUT["logo_url"]
    primary_color: str = DEFAULT_ABOUT["primary_color"]
    secondary_color: str = DEFAULT_ABOUT["secondary_color"]
    admin_email: str = DEFAULT_ABOUT["admin_email"]
    admin_phone: str = DEFAULT_ABOUT["admin_phone"]
    admin_whatsapp: str = DEFAULT_ABOUT["admin_whatsapp"]


async def _read_about() -> AboutInfo:
    doc = await db.app_settings.find_one({"key": "about"}, {"_id": 0}) or {}
    merged = {**DEFAULT_ABOUT, **{k: v for k, v in doc.items() if k in AboutInfo.model_fields}}
    return AboutInfo(**merged)


# Public branding/config — used by login screen & theme before auth.
@api_router.get("/app-config", response_model=AboutInfo)
async def app_config():
    return await _read_about()


@api_router.get("/about", response_model=AboutInfo)
async def get_about(user=Depends(current_user)):
    return await _read_about()


@api_router.put("/admin/about", response_model=AboutInfo)
async def update_about(body: AboutInfo, admin=Depends(require_admin)):
    now = datetime.now(timezone.utc).isoformat()
    await db.app_settings.update_one(
        {"key": "about"},
        {"$set": {"key": "about", **body.model_dump(), "updated_at": now}},
        upsert=True,
    )
    await enqueue_about()
    return body


# ---------------------------------------------------------------------------
# Branding: logo upload (admin) + public file serving
# ---------------------------------------------------------------------------
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "webp", "gif"}


@api_router.post("/admin/upload-logo")
async def upload_logo(file: UploadFile = File(...), admin=Depends(require_admin)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File kosong")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran gambar maksimal 5MB")
    ct = (file.content_type or "").lower()
    if not ct.startswith("image/"):
        raise HTTPException(status_code=400, detail="File harus berupa gambar")
    ext = ct.split("/")[-1].split(";")[0]
    if ext == "jpeg":
        ext = "jpg"
    if ext not in ALLOWED_IMAGE_EXT:
        ext = "png"
    path = f"{APP_NAME}/branding/logo-{uuid4().hex}.{ext}"
    try:
        await run_in_threadpool(put_object, path, content, ct)
    except Exception as e:
        logger.error("Logo upload failed: %s", type(e).__name__)
        raise HTTPException(status_code=400, detail="Gagal mengunggah gambar ke storage")
    logo_url = f"/api/files/{path}"
    now = datetime.now(timezone.utc).isoformat()
    await db.app_settings.update_one(
        {"key": "about"}, {"$set": {"key": "about", "logo_url": logo_url, "updated_at": now}}, upsert=True
    )
    await enqueue_about()
    return {"logo_url": logo_url}


@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        content, ct = await run_in_threadpool(get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="File tidak ditemukan")
    return Response(content=content, media_type=ct, headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# Supabase connection settings (admin only) — store + test connectivity only
# ---------------------------------------------------------------------------
class SupabaseInput(BaseModel):
    project_url: str = Field(min_length=8, max_length=300)
    service_role_key: str = Field(default="", max_length=4000)
    access_token: str = Field(default="", max_length=4000)

    @field_validator("project_url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        parsed = urlparse(v)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Project URL harus berupa URL https yang valid")
        return v


async def _test_supabase(project_url: str, key: str):
    """Connectivity/auth check only — does not read or write app data."""
    endpoint = f"{project_url}/rest/v1/"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/openapi+json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0)) as c:
            r = await c.get(endpoint, headers=headers)
    except httpx.TimeoutException:
        return False, "Koneksi ke Supabase timeout"
    except httpx.RequestError:
        return False, "Host Supabase tidak dapat dijangkau (cek Project URL)"
    if 200 <= r.status_code < 300:
        return True, "Koneksi berhasil — URL & service_role key valid"
    if r.status_code in (401, 403):
        return False, "Key ditolak Supabase (cek service_role key)"
    if r.status_code == 404:
        return False, "Endpoint REST tidak ditemukan (cek Project URL)"
    return False, f"Supabase mengembalikan HTTP {r.status_code}"


async def _resolve_supabase_key(provided: str) -> Optional[str]:
    if provided.strip():
        return provided.strip()
    doc = await db.app_settings.find_one({"key": "supabase"})
    if doc and doc.get("service_role_key_ciphertext"):
        try:
            return fernet.decrypt(doc["service_role_key_ciphertext"].encode()).decode()
        except Exception:
            return None
    return None


@api_router.get("/admin/supabase")
async def get_supabase(admin=Depends(require_admin)):
    doc = await db.app_settings.find_one({"key": "supabase"}, {"_id": 0}) or {}
    configured = bool(doc.get("service_role_key_ciphertext"))
    stats = await sync_engine.queue_stats()
    return {
        "configured": configured,
        "has_access_token": bool(doc.get("access_token_ciphertext")),
        "project_url": doc.get("project_url", ""),
        "last_test_ok": doc.get("last_test_ok"),
        "updated_at": doc.get("updated_at"),
        "sync_enabled": doc.get("sync_enabled", True) if configured else False,
        "last_sync_at": doc.get("last_sync_at"),
        "queue_pending": stats["pending"],
        "queue_failed": stats["failed"],
        "queue_last_error": stats["last_error"],
    }


@api_router.post("/admin/supabase/test")
async def test_supabase_conn(body: SupabaseInput, admin=Depends(require_admin)):
    key = await _resolve_supabase_key(body.service_role_key)
    if not key:
        raise HTTPException(status_code=400, detail="service_role key diperlukan")
    ok, msg = await _test_supabase(body.project_url, key)
    return {"ok": ok, "message": msg}


@api_router.put("/admin/supabase")
async def save_supabase(body: SupabaseInput, admin=Depends(require_admin)):
    key = await _resolve_supabase_key(body.service_role_key)
    if not key:
        raise HTTPException(status_code=400, detail="service_role key diperlukan")
    ok, msg = await _test_supabase(body.project_url, key)
    now = datetime.now(timezone.utc).isoformat()
    if ok:
        # Only persist a connection that actually works, so a failed save can
        # never corrupt a previously-good configuration.
        await db.app_settings.update_one(
            {"key": "supabase"},
            {"$set": {
                "key": "supabase",
                "project_url": body.project_url,
                "service_role_key_ciphertext": fernet.encrypt(key.encode()).decode(),
                "last_test_ok": True,
                "updated_at": now,
                "sync_enabled": True,
            }},
            upsert=True,
        )
        # One-way seed: enqueue every local record so the freshly-connected
        # Supabase catches up. The worker drains it in the background.
        await resync_all()
        if body.access_token.strip():
            await db.app_settings.update_one(
                {"key": "supabase"},
                {"$set": {"access_token_ciphertext": fernet.encrypt(body.access_token.strip().encode()).decode()}},
            )
    else:
        # Record the failed attempt but leave any existing good connection intact.
        await db.app_settings.update_one(
            {"key": "supabase"}, {"$set": {"key": "supabase", "last_test_ok": False, "updated_at": now}}, upsert=True
        )
    return {"ok": ok, "message": msg, "configured": ok}


# ---------------------------------------------------------------------------
# Auto-create Supabase schema (DDL) via the Management API + schema check
# ---------------------------------------------------------------------------
SCHEMA_TABLES = [
    "customers", "app_config", "purchasing_sizes", "segments",
    "payment_terms", "areas", "app_users",
]

SCHEMA_SQL = """
create table if not exists public.customers (
  id text primary key,
  customer_code text unique not null,
  customer_name text, segment text, purchasing_size text, area text, status text,
  bad_debt boolean default false, bad_debt_nominal double precision default 0,
  address text, latitude double precision, longitude double precision,
  phone text, whatsapp text, pic_name text, payment_terms text,
  credit_limit double precision default 0,
  deleted_at timestamptz, updated_at timestamptz not null default now(),
  version bigint default 1, change_id text
);
alter table public.customers add column if not exists version bigint default 1;
alter table public.customers add column if not exists change_id text;
grant select, insert, update on public.customers to service_role;

create table if not exists public.app_config (
  id text primary key,
  app_name text, tagline text, description text, developer text, author text,
  version text, copyright text, logo_url text,
  primary_color text, secondary_color text,
  admin_email text, admin_phone text, admin_whatsapp text,
  updated_at timestamptz not null default now(), change_id text
);
alter table public.app_config add column if not exists author text;
alter table public.app_config add column if not exists change_id text;
grant select, insert, update on public.app_config to service_role;

create table if not exists public.purchasing_sizes (
  id text primary key, name text, description text,
  deleted_at timestamptz, updated_at timestamptz default now(),
  version bigint default 1, change_id text
);
create table if not exists public.segments (
  id text primary key, name text, description text,
  deleted_at timestamptz, updated_at timestamptz default now(),
  version bigint default 1, change_id text
);
create table if not exists public.payment_terms (
  id text primary key, name text, description text,
  deleted_at timestamptz, updated_at timestamptz default now(),
  version bigint default 1, change_id text
);
create table if not exists public.areas (
  id text primary key, name text, description text,
  deleted_at timestamptz, updated_at timestamptz default now(),
  version bigint default 1, change_id text
);
create table if not exists public.app_users (
  id text primary key, username text, name text, role text,
  status text, deleted_at timestamptz, updated_at timestamptz default now(),
  version bigint default 1, change_id text
);
alter table public.purchasing_sizes add column if not exists version bigint default 1;
alter table public.purchasing_sizes add column if not exists change_id text;
alter table public.purchasing_sizes add column if not exists deleted_at timestamptz;
alter table public.segments add column if not exists version bigint default 1;
alter table public.segments add column if not exists change_id text;
alter table public.segments add column if not exists deleted_at timestamptz;
alter table public.payment_terms add column if not exists version bigint default 1;
alter table public.payment_terms add column if not exists change_id text;
alter table public.payment_terms add column if not exists deleted_at timestamptz;
alter table public.areas add column if not exists version bigint default 1;
alter table public.areas add column if not exists change_id text;
alter table public.areas add column if not exists deleted_at timestamptz;
alter table public.app_users add column if not exists version bigint default 1;
alter table public.app_users add column if not exists change_id text;
alter table public.app_users add column if not exists deleted_at timestamptz;
grant select, insert, update on public.purchasing_sizes to service_role;
grant select, insert, update on public.segments to service_role;
grant select, insert, update on public.payment_terms to service_role;
grant select, insert, update on public.areas to service_role;
grant select, insert, update on public.app_users to service_role;
"""


async def _resolve_access_token(provided: str) -> Optional[str]:
    if provided.strip():
        return provided.strip()
    doc = await db.app_settings.find_one({"key": "supabase"})
    if doc and doc.get("access_token_ciphertext"):
        try:
            return fernet.decrypt(doc["access_token_ciphertext"].encode()).decode()
        except Exception:
            return None
    return None


def _project_ref(url: str) -> Optional[str]:
    host = urlparse(url).netloc.lower()
    if host.endswith(".supabase.co"):
        ref = host.split(".")[0]
        return ref or None
    return None


@api_router.get("/admin/supabase/schema-status")
async def supabase_schema_status(admin=Depends(require_admin)):
    """Check which expected tables already exist in Supabase (via PostgREST)."""
    doc = await db.app_settings.find_one({"key": "supabase"})
    if not doc or not doc.get("service_role_key_ciphertext"):
        raise HTTPException(status_code=400, detail="Supabase belum terhubung")
    url = doc["project_url"]
    try:
        key = fernet.decrypt(doc["service_role_key_ciphertext"].encode()).decode()
    except Exception:
        raise HTTPException(status_code=400, detail="Kredensial Supabase tidak dapat dibaca")
    result = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=4.0)) as c:
        for t in SCHEMA_TABLES:
            try:
                r = await c.get(
                    f"{url}/rest/v1/{t}",
                    headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": "0-0"},
                    params={"select": "id"},
                )
                exists = r.status_code < 400
            except httpx.RequestError:
                exists = False
            result.append({"table": t, "exists": exists})
    missing = [x["table"] for x in result if not x["exists"]]
    return {"tables": result, "missing": missing, "all_present": len(missing) == 0}


class EnsureSchemaInput(BaseModel):
    access_token: str = Field(default="", max_length=4000)


@api_router.post("/admin/supabase/ensure-schema")
async def supabase_ensure_schema(body: EnsureSchemaInput, admin=Depends(require_admin)):
    """Create any missing Supabase tables automatically using the Management API.

    Requires a Supabase Personal Access Token (sbp_...) with database write
    permission — the anon/service_role key cannot run DDL. The token is stored
    encrypted so future runs (and fresh installs seeded from env) work with one tap.
    """
    doc = await db.app_settings.find_one({"key": "supabase"})
    if not doc or not doc.get("project_url"):
        raise HTTPException(status_code=400, detail="Supabase belum terhubung")
    url = doc["project_url"]
    ref = _project_ref(url)
    if not ref:
        raise HTTPException(
            status_code=400,
            detail="Project URL bukan format Supabase (xxxx.supabase.co); buat tabel lewat SQL manual.",
        )
    token = await _resolve_access_token(body.access_token)
    if not token:
        raise HTTPException(
            status_code=400,
            detail="Personal Access Token Supabase diperlukan untuk membuat tabel otomatis.",
        )
    api = f"https://api.supabase.com/v1/projects/{ref}/database/query"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as c:
            r = await c.post(
                api,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"query": SCHEMA_SQL},
            )
    except httpx.RequestError:
        raise HTTPException(status_code=400, detail="Tidak dapat menghubungi Management API Supabase.")
    if r.status_code in (401, 403):
        raise HTTPException(status_code=400, detail="Personal Access Token ditolak (cek token / izin database).")
    if not (200 <= r.status_code < 300):
        detail = "Gagal membuat tabel di Supabase"
        try:
            j = r.json()
            detail = j.get("message") or j.get("error") or detail
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"{detail} (HTTP {r.status_code})")
    # Persist token when freshly provided so it auto-connects next time.
    if body.access_token.strip():
        await db.app_settings.update_one(
            {"key": "supabase"},
            {"$set": {"access_token_ciphertext": fernet.encrypt(body.access_token.strip().encode()).decode()}},
            upsert=True,
        )
    # Tables exist now — push local data so Supabase catches up immediately.
    try:
        await resync_all()
    except Exception:
        logger.exception("resync after ensure-schema failed (non-fatal)")
    return {"ok": True, "message": "Skema Supabase siap — semua tabel dibuat/diverifikasi."}


# ---------------------------------------------------------------------------
# Supabase two-way sync (last-write-wins by updated_at)
# ---------------------------------------------------------------------------
CUSTOMER_SYNC_FIELDS = [
    "id", "customer_code", "customer_name", "segment", "purchasing_size", "area",
    "status", "bad_debt", "bad_debt_nominal", "address", "latitude", "longitude",
    "phone", "whatsapp", "pic_name", "payment_terms", "credit_limit",
    "deleted_at", "updated_at", "version", "change_id",
]
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


async def _supabase_creds():
    """Return (url, key) if sync is configured & enabled, else None."""
    doc = await db.app_settings.find_one({"key": "supabase"})
    if not doc or not doc.get("service_role_key_ciphertext"):
        return None
    if not doc.get("sync_enabled", True):
        return None
    try:
        key = fernet.decrypt(doc["service_role_key_ciphertext"].encode()).decode()
    except Exception:
        return None
    return doc["project_url"], key


def _parse_dt(value) -> datetime:
    if not value:
        return _EPOCH
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return _EPOCH


def _row_from_doc(doc: dict) -> dict:
    row = {k: doc.get(k) for k in CUSTOMER_SYNC_FIELDS}
    if not row.get("updated_at"):
        row["updated_at"] = _EPOCH.isoformat()
    return row


def _doc_from_row(r: dict) -> dict:
    d = {k: r.get(k) for k in CUSTOMER_SYNC_FIELDS}
    d["bad_debt"] = bool(d.get("bad_debt"))
    d["bad_debt_nominal"] = float(d.get("bad_debt_nominal") or 0)
    d["credit_limit"] = float(d.get("credit_limit") or 0)
    for f in ["customer_code", "customer_name", "segment", "purchasing_size", "area",
              "status", "address", "phone", "whatsapp", "pic_name", "payment_terms"]:
        d[f] = d.get(f) or ""
    return d


async def _sb_upsert(url: str, key: str, rows: list, table: str = "customers", conflict: str = "id"):
    if not rows:
        return
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{url}/rest/v1/{table}?on_conflict={conflict}", headers=headers, json=rows)
        r.raise_for_status()


async def _sb_select_all(url: str, key: str, table: str = "customers") -> list:
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.get(f"{url}/rest/v1/{table}?select=*", headers=headers)
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# Conflict-safe PULL (Online -> Local) helpers.
# Rules: Last Valid Version Wins (version, then updated_at tiebreak); an
# unsynced local admin change (item still in sync_queue) is NEVER overwritten
# silently — it is logged to `sync_conflicts` and skipped; a remote tombstone
# with a winning version deletes locally (delete beats older update); nothing
# is ever duplicated (upsert on id).
# ---------------------------------------------------------------------------
SYNC_CONFLICTS = "sync_conflicts"


async def _sb_select_since(url: str, key: str, table: str, since_iso: str, limit: int = 1000) -> list:
    """Incremental read: only rows changed after `since_iso` (updated_at)."""
    from urllib.parse import quote
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    params = f"select=*&order=updated_at.asc&limit={limit}"
    if since_iso:
        params += f"&updated_at=gt.{quote(since_iso)}"
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.get(f"{url}/rest/v1/{table}?{params}", headers=headers)
        r.raise_for_status()
        return r.json()


async def _pending_entity_ids(entity_type: str) -> set:
    docs = await db.sync_queue.find(
        {"entity_type": entity_type, "status": {"$in": ["pending", "failed"]}},
        {"entity_id": 1},
    ).to_list(100000)
    return {d["entity_id"] for d in docs}


def _remote_wins(remote: dict, local: dict) -> bool:
    """Last Valid Version Wins: higher version wins; equal version -> newer updated_at."""
    rv = int(remote.get("version") or 0)
    lv = int(local.get("version") or 0)
    if rv != lv:
        return rv > lv
    return _parse_dt(remote.get("updated_at")) > _parse_dt(local.get("updated_at"))


async def _log_conflict(entity_type: str, entity_id: str, reason: str, local: Optional[dict], remote: Optional[dict]) -> None:
    """Record a real divergence with both snapshots for the resolution screen.
    Idempotent per (entity, id) while unresolved so the log never piles up."""
    coll = db.customers if entity_type == "customer" else db[MASTER_COLLECTION[entity_type]]
    full_local = await coll.find_one({"id": entity_id}, {"_id": 0})
    remote_snap = {k: v for k, v in (remote or {}).items()}
    name = (
        (full_local or {}).get("customer_name")
        or (full_local or {}).get("name")
        or remote_snap.get("customer_name")
        or remote_snap.get("name")
        or entity_id
    )
    now = datetime.now(timezone.utc).isoformat()
    await db[SYNC_CONFLICTS].update_one(
        {"entity_type": entity_type, "entity_id": entity_id, "resolved": False},
        {
            "$set": {
                "reason": reason,
                "name": name,
                "local_version": int((local or {}).get("version") or 0),
                "remote_version": int((remote or {}).get("version") or 0),
                "local_snapshot": full_local,
                "remote_snapshot": remote_snap,
                "updated_at": now,
            },
            "$setOnInsert": {"id": uuid4().hex, "entity_type": entity_type,
                             "entity_id": entity_id, "resolved": False, "created_at": now},
        },
        upsert=True,
    )


async def _apply_remote_rows(entity: str, rows: list) -> dict:
    """Apply a batch of remote rows to Local DB using the conflict rules above.
    Shared by the manual pull and the background incremental pull."""
    from pymongo import ReplaceOne, UpdateOne
    coll = db.customers if entity == "customer" else db[MASTER_COLLECTION[entity]]
    proj = {"id": 1, "deleted_at": 1, "version": 1, "updated_at": 1, "change_id": 1}
    if entity != "customer":
        proj["name"] = 1
    local = {d["id"]: d for d in await coll.find({}, proj).to_list(50000)}
    active_names: set = set()
    if entity != "customer":
        active_names = {d.get("name", "").strip().lower()
                        for d in await coll.find({"deleted_at": None}, {"name": 1}).to_list(50000)}
    pending = await _pending_entity_ids(entity)
    tomb_docs = await db.sync_state.find(
        {"entity_type": entity, "tombstone": True}, {"entity_id": 1, "tombstone_version": 1}
    ).to_list(100000)
    tombstones = {d["entity_id"]: int(d.get("tombstone_version") or 0) for d in tomb_docs}
    created = updated = deleted = skipped = conflicts = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    ops = []
    for r in rows:
        rid = r.get("id")
        if not rid:
            skipped += 1
            continue
        loc = local.get(rid)
        # An unsynced local admin change must never be overwritten. But the row
        # we read back is often just the echo of our own not-yet-drained push
        # (same change_id or an older/equal remote version) — that is NOT a real
        # conflict, so only log one when the online copy is genuinely newer.
        if rid in pending:
            lv = int((loc or {}).get("version") or 0)
            rv = int(r.get("version") or 0)
            echo = bool(loc) and (r.get("change_id") == loc.get("change_id") or rv <= lv)
            if not echo:
                await _log_conflict(entity, rid, "local_unsynced_change", loc, r)
                conflicts += 1
            continue
        # Durable purge guard: a locally-purged row must not be resurrected by a
        # stale (<= tombstone version) online copy. A strictly newer online
        # version supersedes the purge and clears the marker.
        tomb = tombstones.get(rid)
        if tomb is not None and not r.get("deleted_at"):
            if int(r.get("version") or 0) <= tomb:
                skipped += 1
                continue
            await db.sync_state.update_one(
                {"entity_type": entity, "entity_id": rid}, {"$set": {"tombstone": False}}
            )
        # Last Valid Version Wins: keep local when it is a newer/equal valid version.
        if loc and not _remote_wins(r, loc):
            skipped += 1
            continue
        if r.get("deleted_at"):
            # Remote tombstone with a winning version -> delete locally.
            if not loc or loc.get("deleted_at"):
                skipped += 1
                continue
            ops.append(UpdateOne({"id": rid}, {"$set": {
                "deleted_at": r.get("deleted_at"),
                "updated_at": r.get("updated_at") or now_iso,
                "version": int(r.get("version") or 1),
                "change_id": r.get("change_id") or uuid4().hex,
            }}))
            deleted += 1
        else:
            if entity == "customer":
                doc = _doc_from_row(r)
                doc["deleted_at"] = None
                doc["version"] = int(r.get("version") or 1)
                doc["change_id"] = r.get("change_id") or uuid4().hex
            else:
                name = (r.get("name") or "").strip()
                if not loc and name.lower() in active_names:
                    skipped += 1  # same name already active under a different id
                    continue
                doc = {"id": rid, "name": name, "description": (r.get("description") or ""),
                       "deleted_at": None, "updated_at": r.get("updated_at") or now_iso,
                       "version": int(r.get("version") or 1), "change_id": r.get("change_id") or uuid4().hex}
                if not loc:
                    active_names.add(name.lower())
            ops.append(ReplaceOne({"id": rid}, doc, upsert=True))
            if loc:
                updated += 1
            else:
                created += 1
        await db.sync_state.update_one(
            {"entity_type": entity, "entity_id": rid},
            {"$set": {"synced_ever": True}}, upsert=True)
    if ops:
        await coll.bulk_write(ops, ordered=False)
    # Self-heal: any earlier transient conflict for a row that has now converged
    # (no longer pending) is marked resolved so the status badge can recover.
    converged = [r.get("id") for r in rows if r.get("id") and r.get("id") not in pending]
    if converged:
        await db[SYNC_CONFLICTS].update_many(
            {"entity_type": entity, "entity_id": {"$in": converged}, "resolved": False},
            {"$set": {"resolved": True}})
    return {"created": created, "updated": updated, "deleted": deleted,
            "skipped": skipped, "conflicts": conflicts}


_PULL_ENTITIES = ["customer"] + ["purchasing_size", "segment", "top", "area"]


def _pull_table(entity: str) -> str:
    return "customers" if entity == "customer" else MASTER_TABLE[entity]


async def _incremental_pull() -> dict:
    """USER Online -> Offline cache: pull ONLY changed rows (updated_at watermark)
    from Supabase into Local DB. Runs in the background; never full-syncs."""
    creds = await _supabase_creds()
    if not creds:
        return {"skipped": "not_connected"}
    url, key = creds
    doc = await db.app_settings.find_one({"key": "supabase"}) or {}
    watermark = doc.get("last_pull_at") or "1970-01-01T00:00:00+00:00"
    max_seen = watermark
    applied = 0
    for entity in _PULL_ENTITIES:
        try:
            remote = await _sb_select_since(url, key, _pull_table(entity), watermark)
        except Exception:
            continue  # table missing / offline -> keep last cache, retry later
        if not remote:
            continue
        res = await _apply_remote_rows(entity, remote)
        applied += res["created"] + res["updated"] + res["deleted"]
        for r in remote:
            ua = r.get("updated_at")
            if ua and _parse_dt(ua) > _parse_dt(max_seen):
                max_seen = ua
    if max_seen != watermark:
        await db.app_settings.update_one({"key": "supabase"}, {"$set": {"last_pull_at": max_seen}})
    return {"applied": applied, "watermark": max_seen}


async def user_pull_loop() -> None:
    """Background loop: keep Local DB freshened from Supabase (incremental)."""
    await asyncio.sleep(10)
    while True:
        try:
            await _incremental_pull()
        except Exception as e:  # noqa: BLE001
            logger.warning("Incremental pull error: %s", type(e).__name__)
        await asyncio.sleep(20)


async def enqueue_customers(ids: list):
    """Persist a one-way sync task for each customer id into sync_queue.

    Durable: the queue write is part of the request, but the actual push to
    Supabase happens later in the background worker, so CRUD never blocks on
    (or fails because of) Supabase.
    """
    if not ids:
        return
    docs = await db.customers.find({"id": {"$in": list(ids)}}).to_list(2000)
    for d in docs:
        await sync_engine.enqueue("customer", d["id"], _row_from_doc(d))


def schedule_push(ids: list):
    """Back-compat shim: enqueue customer ids for background sync."""
    if not ids:
        return
    try:
        asyncio.create_task(enqueue_customers(ids))
    except RuntimeError:
        pass


# ---- App config (About + admin contact) two-way sync ----
APP_CONFIG_SYNC_FIELDS = [
    "id", "app_name", "tagline", "description", "developer", "author", "version",
    "copyright", "logo_url", "primary_color", "secondary_color",
    "admin_email", "admin_phone", "admin_whatsapp", "updated_at", "change_id",
]


def _config_row_from_doc(doc: dict) -> dict:
    merged = {**DEFAULT_ABOUT, **{k: v for k, v in (doc or {}).items() if k in AboutInfo.model_fields}}
    row = {k: merged.get(k, "") for k in APP_CONFIG_SYNC_FIELDS}
    row["id"] = "about"
    row["updated_at"] = (doc or {}).get("updated_at") or _EPOCH.isoformat()
    row["change_id"] = uuid4().hex
    return row


def _config_doc_from_row(r: dict) -> dict:
    d = {k: r.get(k) for k in APP_CONFIG_SYNC_FIELDS if k in AboutInfo.model_fields}
    for k, v in list(d.items()):
        if v is None:
            d[k] = DEFAULT_ABOUT.get(k, "")
    d["updated_at"] = r.get("updated_at") or _EPOCH.isoformat()
    return d


async def enqueue_about():
    doc = await db.app_settings.find_one({"key": "about"}) or {}
    await sync_engine.enqueue("about", "about", _config_row_from_doc(doc))


def schedule_push_about():
    """Back-compat shim: enqueue app config for background sync."""
    try:
        asyncio.create_task(enqueue_about())
    except RuntimeError:
        pass


async def resync_all() -> dict:
    """Enqueue every local record for a one-way push to Supabase.

    Used when a connection is (re)established or when the admin taps a full
    resync. This is NOT a reconcile: we never read from Supabase, we only push
    local state (the source of truth), so nothing can be resurrected.
    """
    docs = await db.customers.find({}).to_list(5000)
    for d in docs:
        await sync_engine.enqueue("customer", d["id"], _row_from_doc(d))
    for et in ("purchasing_size", "segment", "top", "area"):
        mdocs = await db[MASTER_COLLECTION[et]].find({}).to_list(2000)
        for m in mdocs:
            await sync_engine.enqueue(et, m["id"], _master_row(m))
    users = await db.users.find({}).to_list(1000)
    for u in users:
        await sync_engine.enqueue("user", u["username"], _user_sync_row(u))
    await enqueue_about()
    return await sync_engine.queue_stats()


class SyncToggle(BaseModel):
    enabled: bool


@api_router.post("/admin/supabase/sync-toggle")
async def toggle_sync(body: SyncToggle, admin=Depends(require_admin)):
    doc = await db.app_settings.find_one({"key": "supabase"})
    if not doc or not doc.get("service_role_key_ciphertext"):
        raise HTTPException(status_code=400, detail="Supabase belum terhubung")
    await db.app_settings.update_one({"key": "supabase"}, {"$set": {"sync_enabled": body.enabled}})
    return {"sync_enabled": body.enabled}


@api_router.post("/admin/supabase/sync")
async def run_sync(admin=Depends(require_admin)):
    creds = await _supabase_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Supabase belum terhubung atau sinkronisasi dinonaktifkan")
    result = await sync_engine.drain(force=True)
    now = datetime.now(timezone.utc).isoformat()
    await db.app_settings.update_one({"key": "supabase"}, {"$set": {"last_sync_at": now}})
    return {
        "pushed": result.get("processed", 0),
        "pulled": 0,
        "total": result.get("processed", 0),
        "pending": result.get("pending", 0),
        "failed": result.get("failed", 0),
        "last_sync_at": now,
    }


@api_router.post("/admin/supabase/resync-all")
async def resync_all_endpoint(admin=Depends(require_admin)):
    creds = await _supabase_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Supabase belum terhubung atau sinkronisasi dinonaktifkan")
    stats = await resync_all()
    result = await sync_engine.drain(force=True)
    now = datetime.now(timezone.utc).isoformat()
    await db.app_settings.update_one({"key": "supabase"}, {"$set": {"last_sync_at": now}})
    return {
        "enqueued_pending_after": stats.get("pending", 0),
        "pushed": result.get("processed", 0),
        "pending": result.get("pending", 0),
        "failed": result.get("failed", 0),
        "last_sync_at": now,
    }


# ---------------------------------------------------------------------------
# Master data (admin only): Category, Segment, TOP (Terms of Payment)
# All flow through the same one-way sync engine (Local DB -> queue -> Supabase).
# ---------------------------------------------------------------------------
MASTER_COLLECTION = {
    "purchasing_size": "purchasing_sizes",
    "segment": "segments",
    "top": "payment_terms_master",
    "area": "areas",
}
MASTER_TABLE = {
    "purchasing_size": "purchasing_sizes",
    "segment": "segments",
    "top": "payment_terms",
    "area": "areas",
}
MASTER_LABEL = {"purchasing_size": "Purchasing Size", "segment": "Segment", "top": "TOP", "area": "Area"}
MASTER_SYNC_FIELDS = ["id", "name", "description", "deleted_at", "updated_at", "version", "change_id"]


def _master_row(doc: dict) -> dict:
    row = {k: doc.get(k) for k in MASTER_SYNC_FIELDS}
    row["name"] = row.get("name") or ""
    row["description"] = row.get("description") or ""
    return row


class MasterInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


def _require_master_type(entity_type: str) -> str:
    if entity_type not in MASTER_COLLECTION:
        raise HTTPException(status_code=404, detail="Master data tidak dikenal")
    return entity_type


async def enqueue_master(entity_type: str, mid: str):
    doc = await db[MASTER_COLLECTION[entity_type]].find_one({"id": mid})
    if doc:
        await sync_engine.enqueue(entity_type, mid, _master_row(doc))


@api_router.get("/admin/master/{entity_type}")
async def list_master(entity_type: str, admin=Depends(require_admin)):
    _require_master_type(entity_type)
    docs = await db[MASTER_COLLECTION[entity_type]].find(
        {"deleted_at": None}, {"_id": 0}
    ).sort("name", 1).to_list(2000)
    return [{"id": d["id"], "name": d.get("name", ""), "description": d.get("description", "")} for d in docs]


@api_router.get("/admin/master-options")
async def master_options(admin=Depends(require_admin)):
    """Master values (names) for the customer form dropdowns — keeps customer
    fields relationally in sync with Master Data."""
    out: dict = {}
    for et in ("segment", "purchasing_size", "area", "top"):
        docs = await db[MASTER_COLLECTION[et]].find(
            {"deleted_at": None}, {"_id": 0, "name": 1}
        ).sort("name", 1).to_list(2000)
        out[et] = [d["name"] for d in docs if d.get("name")]
    return out


@api_router.post("/admin/master/{entity_type}", status_code=201)
async def create_master(entity_type: str, body: MasterInput, admin=Depends(require_admin)):
    _require_master_type(entity_type)
    coll = db[MASTER_COLLECTION[entity_type]]
    name = body.name.strip()
    dup = await coll.find_one({"name": name, "deleted_at": None})
    if dup:
        raise HTTPException(status_code=409, detail=f"{MASTER_LABEL[entity_type]} '{name}' sudah ada")
    mid = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": mid, "name": name, "description": body.description.strip(),
        "deleted_at": None, "updated_at": now, "version": 1, "change_id": uuid4().hex,
    }
    await coll.insert_one(doc)
    await enqueue_master(entity_type, mid)
    return {"id": mid, "name": name, "description": doc["description"]}


@api_router.put("/admin/master/{entity_type}/{mid}")
async def update_master(entity_type: str, mid: str, body: MasterInput, admin=Depends(require_admin)):
    _require_master_type(entity_type)
    coll = db[MASTER_COLLECTION[entity_type]]
    existing = await coll.find_one({"id": mid, "deleted_at": None})
    if not existing:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")
    name = body.name.strip()
    dup = await coll.find_one({"name": name, "deleted_at": None, "id": {"$ne": mid}})
    if dup:
        raise HTTPException(status_code=409, detail=f"{MASTER_LABEL[entity_type]} '{name}' sudah ada")
    now = datetime.now(timezone.utc).isoformat()
    await coll.update_one(
        {"id": mid},
        {"$set": {"name": name, "description": body.description.strip(),
                  "updated_at": now, "change_id": uuid4().hex},
         "$inc": {"version": 1}},
    )
    await enqueue_master(entity_type, mid)
    return {"id": mid, "name": name, "description": body.description.strip()}


@api_router.delete("/admin/master/{entity_type}/{mid}")
async def delete_master(entity_type: str, mid: str, admin=Depends(require_admin)):
    _require_master_type(entity_type)
    coll = db[MASTER_COLLECTION[entity_type]]
    now = datetime.now(timezone.utc).isoformat()
    res = await coll.update_one(
        {"id": mid, "deleted_at": None},
        {"$set": {"deleted_at": now, "updated_at": now, "change_id": uuid4().hex},
         "$inc": {"version": 1}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")
    await enqueue_master(entity_type, mid)
    return {"success": True}


@api_router.post("/admin/master/{entity_type}/bulk-delete")
async def bulk_delete_master(entity_type: str, body: BulkIdsInput, admin=Depends(require_admin)):
    _require_master_type(entity_type)
    coll = db[MASTER_COLLECTION[entity_type]]
    now = datetime.now(timezone.utc).isoformat()
    res = await coll.update_many(
        {"id": {"$in": body.ids}, "deleted_at": None},
        {"$set": {"deleted_at": now, "updated_at": now, "change_id": uuid4().hex},
         "$inc": {"version": 1}},
    )
    for mid in body.ids:
        await enqueue_master(entity_type, mid)
    return {"success": True, "deleted": res.modified_count}


# ---------------------------------------------------------------------------
# Trash (soft-deleted items) + manual pull from Supabase.
# Entities: customer + master (purchasing_size, segment, top).
# ---------------------------------------------------------------------------
TRASH_ENTITIES = {"customer", "purchasing_size", "segment", "top", "area"}


def _entity_collection(entity: str):
    if entity == "customer":
        return db.customers
    if entity in MASTER_COLLECTION:
        return db[MASTER_COLLECTION[entity]]
    raise HTTPException(status_code=404, detail="Entity tidak dikenal")


def _entity_row(entity: str, doc: dict) -> dict:
    return _row_from_doc(doc) if entity == "customer" else _master_row(doc)


async def _entity_enqueue(entity: str, doc: dict):
    await sync_engine.enqueue(entity, doc["id"], _entity_row(entity, doc))


def _trash_item(entity: str, d: dict) -> dict:
    if entity == "customer":
        return {"id": d["id"], "title": d.get("customer_name", ""),
                "subtitle": d.get("customer_code", ""), "deleted_at": d.get("deleted_at")}
    return {"id": d["id"], "title": d.get("name", ""),
            "subtitle": d.get("description", ""), "deleted_at": d.get("deleted_at")}


def _require_trash_entity(entity: str) -> str:
    if entity not in TRASH_ENTITIES:
        raise HTTPException(status_code=404, detail="Entity tidak dikenal")
    return entity


@api_router.get("/admin/trash/{entity}")
async def list_trash(entity: str, admin=Depends(require_admin)):
    _require_trash_entity(entity)
    coll = _entity_collection(entity)
    docs = await coll.find({"deleted_at": {"$ne": None}}, {"_id": 0}).sort("deleted_at", -1).to_list(5000)
    return [_trash_item(entity, d) for d in docs]


@api_router.get("/admin/trash-counts")
async def trash_counts(admin=Depends(require_admin)):
    out = {}
    for entity in TRASH_ENTITIES:
        out[entity] = await _entity_collection(entity).count_documents({"deleted_at": {"$ne": None}})
    out["total"] = sum(out.values())
    return out


@api_router.post("/admin/trash/{entity}/restore")
async def restore_trash(entity: str, body: BulkIdsInput, admin=Depends(require_admin)):
    _require_trash_entity(entity)
    coll = _entity_collection(entity)
    now = datetime.now(timezone.utc).isoformat()
    restored = 0
    for rid in body.ids:
        doc = await coll.find_one({"id": rid, "deleted_at": {"$ne": None}})
        if not doc:
            continue
        # For master, block restoring a name that is now taken by an active row.
        if entity != "customer":
            clash = await coll.find_one({"name": doc.get("name"), "deleted_at": None})
            if clash:
                continue
        await coll.update_one(
            {"id": rid},
            {"$set": {"deleted_at": None, "updated_at": now, "change_id": uuid4().hex},
             "$inc": {"version": 1}},
        )
        fresh = await coll.find_one({"id": rid})
        await _entity_enqueue(entity, fresh)  # push active state back to Supabase
        restored += 1
    return {"success": True, "restored": restored}


async def _purge_ids(entity: str, ids: list) -> int:
    """Permanently remove ids: push a tombstone first (so a later pull can't
    resurrect them from Supabase), then hard-delete locally. A durable purge
    marker in sync_state guarantees no pull can resurrect the row before the
    tombstone has propagated to Supabase (fixes the pull-resurrect race)."""
    coll = _entity_collection(entity)
    purged = 0
    for rid in ids:
        doc = await coll.find_one({"id": rid})
        if not doc:
            continue
        now = datetime.now(timezone.utc).isoformat()
        new_version = int(doc.get("version") or 1) + 1  # delete must beat the active version
        tombstone = _entity_row(entity, {**doc, "deleted_at": now, "updated_at": now,
                                         "version": new_version, "change_id": uuid4().hex})
        await sync_engine.enqueue(entity, rid, tombstone)
        await coll.delete_one({"id": rid})
        await db.sync_state.update_one(
            {"entity_type": entity, "entity_id": rid},
            {"$set": {"synced_ever": True, "tombstone": True, "tombstone_version": new_version}},
            upsert=True,
        )
        purged += 1
    return purged


@api_router.post("/admin/trash/{entity}/purge")
async def purge_trash(entity: str, body: BulkIdsInput, admin=Depends(require_admin)):
    _require_trash_entity(entity)
    purged = await _purge_ids(entity, body.ids)
    return {"success": True, "purged": purged}


@api_router.post("/admin/trash/{entity}/empty")
async def empty_trash(entity: str, admin=Depends(require_admin)):
    _require_trash_entity(entity)
    coll = _entity_collection(entity)
    docs = await coll.find({"deleted_at": {"$ne": None}}, {"id": 1}).to_list(20000)
    purged = await _purge_ids(entity, [d["id"] for d in docs])
    return {"success": True, "purged": purged}


@api_router.post("/admin/supabase/pull")
async def pull_from_supabase(admin=Depends(require_admin)):
    """Manual one-way PULL: bring rows that exist in Supabase into the local DB.

    Safe by design — NEVER resurrects data that was deleted locally:
      * remote rows whose deleted_at is set (tombstones) are skipped;
      * local rows that are tombstoned (in Trash) are left untouched.
    New remote rows are inserted; edited remote rows update the local copy.
    """
    creds = await _supabase_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Supabase belum terhubung atau sinkronisasi dinonaktifkan")
    url, key = creds
    # Push any pending local changes (incl. purge tombstones) first, so reading
    # Supabase back can never resurrect a row we just deleted/purged.
    await sync_engine.drain(force=True)
    summary = {}

    # ----- Customers -----
    try:
        remote = await _sb_select_all(url, key, table="customers")
    except Exception:
        raise HTTPException(status_code=400, detail="Gagal membaca data dari Supabase (cek koneksi/tabel)")
    summary["customer"] = await _apply_remote_rows("customer", remote)

    # ----- Master data -----
    for entity in ("purchasing_size", "segment", "top", "area"):
        try:
            remote = await _sb_select_all(url, key, table=MASTER_TABLE[entity])
        except Exception:
            summary[entity] = {"created": 0, "updated": 0, "skipped": 0, "error": "tabel tidak ditemukan"}
            continue
        summary[entity] = await _apply_remote_rows(entity, remote)

    return {"success": True, "summary": summary}


@api_router.get("/sync/status")
async def sync_status(user=Depends(current_user)):
    """Live sync state for the UI badge (any authenticated user).
    status: offline | syncing | synced | sync_failed | conflict."""
    doc = await db.app_settings.find_one({"key": "supabase"}) or {}
    configured = bool(doc.get("service_role_key_ciphertext")) and doc.get("sync_enabled", True)
    stats = await sync_engine.queue_stats()
    conflicts = await db[SYNC_CONFLICTS].count_documents({"resolved": False})
    if not configured:
        status_v = "offline"
    elif stats["failed"] > 0:
        status_v = "sync_failed"
    elif conflicts > 0:
        status_v = "conflict"
    elif stats["pending"] > 0:
        status_v = "syncing"
    else:
        status_v = "synced"
    return {
        "online": configured,
        "status": status_v,
        "pending": stats["pending"],
        "failed": stats["failed"],
        "conflicts": conflicts,
        "last_sync_at": doc.get("last_sync_at"),
        "last_pull_at": doc.get("last_pull_at"),
    }


@api_router.post("/sync/pull-now")
async def sync_pull_now(user=Depends(current_user)):
    """Manual 'Sync Sekarang' for USER (read-only): pull latest changed rows
    from the online DB into the local cache, then return the fresh status."""
    creds = await _supabase_creds()
    if not creds:
        raise HTTPException(status_code=400, detail="Belum terhubung ke server online.")
    result = await _incremental_pull()
    doc = await db.app_settings.find_one({"key": "supabase"}) or {}
    return {"success": True, "applied": result.get("applied", 0), "last_pull_at": doc.get("last_pull_at")}


@api_router.get("/admin/conflicts")
async def list_conflicts(resolved: bool = False, admin=Depends(require_admin)):
    """Conflict records for the resolution screen (unresolved by default)."""
    docs = await db[SYNC_CONFLICTS].find(
        {"resolved": resolved}, {"_id": 0}
    ).sort("updated_at", -1).limit(200).to_list(200)
    return docs


@api_router.get("/admin/conflicts/count")
async def count_conflicts(admin=Depends(require_admin)):
    """Lightweight unresolved-conflict count for the drawer badge."""
    n = await db[SYNC_CONFLICTS].count_documents({"resolved": False})
    return {"count": n}


@api_router.post("/admin/conflicts/{cid}/resolve")
async def resolve_conflict(cid: str, body: dict, admin=Depends(require_admin)):
    """Resolve a conflict. choice='keep_local' re-pushes the local version to the
    online DB (local wins); choice='keep_online' overwrites local with the online
    version and drops the queued local change. Both converge to one version."""
    choice = (body or {}).get("choice")
    if choice not in ("keep_local", "keep_online"):
        raise HTTPException(status_code=400, detail="choice harus keep_local atau keep_online")
    conf = await db[SYNC_CONFLICTS].find_one({"id": cid}, {"_id": 0})
    if not conf:
        raise HTTPException(status_code=404, detail="Konflik tidak ditemukan")
    entity = conf["entity_type"]
    rid = conf["entity_id"]
    coll = db.customers if entity == "customer" else db[MASTER_COLLECTION[entity]]
    winning = max(int(conf.get("local_version") or 0), int(conf.get("remote_version") or 0)) + 1

    if choice == "keep_local":
        local = await coll.find_one({"id": rid}, {"_id": 0}) or conf.get("local_snapshot") or {}
        local = {**local, "version": winning, "change_id": uuid4().hex,
                 "updated_at": datetime.now(timezone.utc).isoformat()}
        await coll.update_one({"id": rid}, {"$set": local}, upsert=True)
        await db.sync_queue.delete_many({"entity_type": entity, "entity_id": rid})
        await sync_engine.enqueue(entity, rid, _entity_row(entity, local))
    else:  # keep_online
        remote = conf.get("remote_snapshot") or {}
        merged = {**remote, "version": winning, "change_id": uuid4().hex,
                  "updated_at": datetime.now(timezone.utc).isoformat()}
        merged.pop("_id", None)
        await coll.update_one({"id": rid}, {"$set": merged}, upsert=True)
        await db.sync_queue.delete_many({"entity_type": entity, "entity_id": rid})
        await db.sync_state.update_one({"entity_type": entity, "entity_id": rid},
                                       {"$set": {"tombstone": False}})
        await sync_engine.enqueue(entity, rid, _entity_row(entity, merged))

    await db[SYNC_CONFLICTS].update_one(
        {"id": cid},
        {"$set": {"resolved": True, "resolution": choice,
                  "resolved_at": datetime.now(timezone.utc).isoformat()}})
    return {"success": True, "choice": choice, "version": winning}
# ---------------------------------------------------------------------------
MIN_PASSWORD_LENGTH = 6


def normalize_username(value: str) -> str:
    v = value.strip().lower()
    if not v or len(v) > 64:
        raise HTTPException(status_code=422, detail="Username tidak valid")
    return v


def validate_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=422, detail=f"Password minimal {MIN_PASSWORD_LENGTH} karakter")
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password terlalu panjang (maks 72 byte)")
    return password


class UserOut(BaseModel):
    username: str
    name: str
    role: str
    created_at: Optional[str] = None


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    role: Literal["user", "admin"] = "user"
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["user", "admin"]] = None


class PasswordReset(BaseModel):
    new_password: str


class OwnPasswordChange(BaseModel):
    current_password: str
    new_password: str


def user_out(doc: dict) -> dict:
    return {
        "username": doc["username"],
        "name": doc.get("name", ""),
        "role": doc.get("role", "user"),
        "created_at": doc.get("created_at"),
    }


async def admin_count() -> int:
    return await db.users.count_documents({"role": "admin"})


def _user_sync_row(doc: dict) -> dict:
    """Profile/role/status only — NEVER the password. Auth stays local."""
    return {
        "id": doc["username"],
        "username": doc["username"],
        "name": doc.get("name", ""),
        "role": doc.get("role", "user"),
        "status": doc.get("status", "active"),
        "deleted_at": doc.get("deleted_at"),
        "updated_at": doc.get("updated_at") or doc.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "version": int(doc.get("version", 1)),
        "change_id": doc.get("change_id") or uuid4().hex,
    }


async def enqueue_user(username: str):
    doc = await db.users.find_one({"username": username})
    if doc:
        await sync_engine.enqueue("user", username, _user_sync_row(doc))


async def enqueue_user_tombstone(username: str):
    now = datetime.now(timezone.utc).isoformat()
    await sync_engine.enqueue("user", username, {
        "id": username, "username": username, "name": "", "role": "user",
        "status": "deleted", "deleted_at": now, "updated_at": now,
        "version": 9999, "change_id": uuid4().hex,
    })


@api_router.get("/admin/users", response_model=List[UserOut])
async def list_users(admin=Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "hashed_password": 0}).sort("username", 1).to_list(1000)
    return [UserOut(**user_out(d)) for d in docs]


@api_router.post("/admin/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, admin=Depends(require_admin)):
    username = normalize_username(body.username)
    validate_password(body.password)
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    doc = {
        "username": username,
        "name": body.name.strip(),
        "role": body.role,
        "status": "active",
        "hashed_password": hash_password(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "change_id": uuid4().hex,
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Username sudah digunakan")
    await enqueue_user(username)
    return user_out(doc)


@api_router.patch("/admin/users/{username}", response_model=UserOut)
async def update_user_account(username: str, body: UserUpdate, admin=Depends(require_admin)):
    username = normalize_username(username)
    existing = await db.users.find_one({"username": username})
    if not existing:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    changes: dict = {}
    if body.name is not None:
        changes["name"] = body.name.strip()
    if body.role is not None:
        if username == admin["username"] and body.role != "admin":
            raise HTTPException(status_code=400, detail="Tidak bisa menurunkan role akun sendiri")
        if existing.get("role") == "admin" and body.role != "admin" and await admin_count() <= 1:
            raise HTTPException(status_code=409, detail="Tidak bisa menghapus admin terakhir")
        changes["role"] = body.role
    if changes:
        changes["updated_at"] = datetime.now(timezone.utc).isoformat()
        changes["change_id"] = uuid4().hex
        await db.users.update_one({"username": username}, {"$set": changes, "$inc": {"version": 1}})
        await enqueue_user(username)
    doc = await db.users.find_one({"username": username})
    return user_out(doc)


@api_router.delete("/admin/users/{username}")
async def delete_user_account(username: str, admin=Depends(require_admin)):
    username = normalize_username(username)
    if username == admin["username"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")
    existing = await db.users.find_one({"username": username})
    if not existing:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    if existing.get("role") == "admin" and await admin_count() <= 1:
        raise HTTPException(status_code=409, detail="Tidak bisa menghapus admin terakhir")
    await db.users.delete_one({"username": username})
    await enqueue_user_tombstone(username)
    return {"success": True, "message": "User deleted successfully"}


@api_router.post("/admin/users/{username}/password")
async def reset_user_password(username: str, body: PasswordReset, admin=Depends(require_admin)):
    username = normalize_username(username)
    if not await db.users.find_one({"username": username}):
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    validate_password(body.new_password)
    await db.users.update_one(
        {"username": username}, {"$set": {"hashed_password": hash_password(body.new_password)}}
    )
    return {"success": True, "message": "Password updated successfully"}


@api_router.post("/admin/me/password")
async def change_own_password(body: OwnPasswordChange, admin=Depends(require_admin)):
    if not verify_password(body.current_password, admin["hashed_password"]):
        raise HTTPException(status_code=400, detail="Password saat ini salah")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=422, detail="Password baru harus berbeda")
    validate_password(body.new_password)
    await db.users.update_one(
        {"username": admin["username"]}, {"$set": {"hashed_password": hash_password(body.new_password)}}
    )
    return {"success": True, "message": "Password updated successfully"}


class MeUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@api_router.patch("/me")
async def update_me(body: MeUpdate, user=Depends(current_user)):
    await db.users.update_one({"username": user["username"]}, {"$set": {"name": body.name.strip()}})
    doc = await db.users.find_one({"username": user["username"]})
    return {"username": doc["username"], "name": doc.get("name", ""), "role": doc.get("role", "user")}


@api_router.post("/me/password")
async def change_my_password(body: OwnPasswordChange, user=Depends(current_user)):
    if not verify_password(body.current_password, user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Password saat ini salah")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=422, detail="Password baru harus berbeda")
    validate_password(body.new_password)
    await db.users.update_one(
        {"username": user["username"]}, {"$set": {"hashed_password": hash_password(body.new_password)}}
    )
    return {"success": True, "message": "Password updated successfully"}


@api_router.get("/dashboard/statistics")
async def dashboard_statistics(user=Depends(current_user)):
    docs = await db.customers.find({"deleted_at": None}, {"_id": 0}).to_list(2000)

    total = len(docs)
    active = sum(1 for d in docs if d["status"] == "Active")
    inactive = sum(1 for d in docs if d["status"] == "Inactive")
    bad_debt = sum(1 for d in docs if d["status"] == "Bad Debt")
    total_bad_debt_nominal = sum(d.get("bad_debt_nominal", 0) for d in docs)

    # Customer by status
    by_status = [
        {"label": "Active", "count": active},
        {"label": "Inactive", "count": inactive},
        {"label": "Bad Debt", "count": bad_debt},
    ]

    def top5_with_others(field: str):
        counts: dict = {}
        for d in docs:
            key = d.get(field) or "Unknown"
            counts[key] = counts.get(key, 0) + 1
        ordered = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        top = ordered[:5]
        others = sum(c for _, c in ordered[5:])
        result = [{"label": k, "count": v} for k, v in top]
        if others > 0:
            result.append({"label": "Others", "count": others})
        return result

    return {
        "total_customer": total,
        "active_customer": active,
        "inactive_customer": inactive,
        "bad_debt_customer": bad_debt,
        "total_bad_debt_nominal": total_bad_debt_nominal,
        "by_status": by_status,
        "by_segment": top5_with_others("segment"),
        "by_purchasing_size": top5_with_others("purchasing_size"),
        "by_area": top5_with_others("area"),
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
async def seed_users():
    existing = await db.users.find_one({"username": "user"})
    if not existing:
        await db.users.insert_one(
            {
                "username": "user",
                "name": "Demo User",
                "hashed_password": hash_password("user123"),
                "role": "user",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        logger.info("Seeded default user account: user / user123")
    # Admin role kept in system for future expansion (no UI in MVP)
    admin = await db.users.find_one({"username": "admin"})
    if not admin:
        await db.users.insert_one(
            {
                "username": "admin",
                "name": "Administrator",
                "hashed_password": hash_password("admin123"),
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        logger.info("Seeded admin account (role reserved for future use)")


AREAS = {
    "Jakarta": (-6.2088, 106.8456),
    "Bandung": (-6.9175, 107.6191),
    "Surabaya": (-7.2575, 112.7521),
    "Medan": (3.5952, 98.6722),
    "Semarang": (-6.9667, 110.4167),
    "Yogyakarta": (-7.7956, 110.3695),
    "Makassar": (-5.1477, 119.4327),
    "Denpasar": (-8.6705, 115.2126),
    "Palembang": (-2.9761, 104.7754),
}

SEED_VERSION = 3

SEGMENTS = ["Distributor", "Retail", "Wholesale", "Corporate", "Pharmacy"]
PURCHASING_SIZES = ["Enterprise", "Large", "Medium", "Small", "Micro"]
PAYMENT_TERMS = ["Cash", "14 Days", "30 Days", "45 Days", "60 Days"]

NAME_PREFIX = ["PT", "CV"]
NAME_WORDS = [
    "Globalindo", "Sumber", "Maju", "Berkah", "Sentosa", "Mulia", "Harapan",
    "Cahaya", "Prima", "Sejahtera", "Anugerah", "Nusantara", "Mitra",
    "Cendana", "Permata", "Makmur", "Rejeki", "Abadi", "Utama", "Karya",
    "Jaya", "Sukses", "Bahari", "Kencana",
]
STREETS = [
    "Sudirman", "Gatot Subroto", "Thamrin", "Ahmad Yani", "Diponegoro",
    "Merdeka", "Pemuda", "Gajah Mada", "Asia Afrika", "Veteran",
]

PIC_FIRST = [
    "Budi", "Siti", "Andi", "Rina", "Agus", "Dewi", "Rudi", "Lestari",
    "Hendra", "Maya", "Joko", "Wati", "Bayu", "Nur", "Eko", "Putri",
]
PIC_LAST = [
    "Santoso", "Wijaya", "Pratama", "Kusuma", "Halim", "Saputra",
    "Wahyuni", "Nugroho", "Permata", "Utami", "Setiawan", "Hartono",
]


async def seed_customers():
    meta = await db.app_meta.find_one({"key": "seed_version"})
    current = meta["value"] if meta else 0
    count = await db.customers.count_documents({})
    if count > 0 and current == SEED_VERSION:
        return

    # Regenerate sample data (development seed only — not user data)
    await db.customers.delete_many({})

    rng = random.Random(42)
    customers = []
    used_codes = set()
    n = 48
    for i in range(n):
        segment = rng.choice(SEGMENTS)
        prefix = rng.choice(NAME_PREFIX)
        word = rng.choice(NAME_WORDS)
        word2 = rng.choice(NAME_WORDS)
        name = f"{prefix}. {word} {word2}"
        area = rng.choice(list(AREAS.keys()))

        # Status distribution: mostly active, some inactive, few bad debt
        roll = rng.random()
        if roll < 0.62:
            status_v = "Active"
        elif roll < 0.85:
            status_v = "Inactive"
        else:
            status_v = "Bad Debt"

        is_bad = status_v == "Bad Debt"
        bad_nominal = float(rng.randint(15, 480) * 1_000_000) if is_bad else 0.0

        code = f"C0{rng.randint(10000, 99999)}"
        while code in used_codes:
            code = f"C0{rng.randint(10000, 99999)}"
        used_codes.add(code)

        base_lat, base_lng = AREAS[area]
        # A few customers with missing coordinates to exercise the fallback
        has_coords = rng.random() > 0.12
        lat = round(base_lat + rng.uniform(-0.08, 0.08), 6) if has_coords else None
        lng = round(base_lng + rng.uniform(-0.08, 0.08), 6) if has_coords else None

        phone = f"(021) {rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}"
        wa = f"0812-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}"

        customers.append(
            {
                "id": code.lower(),
                "customer_code": code,
                "customer_name": name,
                "segment": segment,
                "purchasing_size": rng.choice(PURCHASING_SIZES),
                "area": area,
                "status": status_v,
                "bad_debt": is_bad,
                "bad_debt_nominal": bad_nominal,
                "address": f"Jl. {rng.choice(STREETS)} No. {rng.randint(1, 200)}, {area}",
                "latitude": lat,
                "longitude": lng,
                "phone": phone,
                "whatsapp": wa,
                "pic_name": f"{rng.choice(PIC_FIRST)} {rng.choice(PIC_LAST)}",
                "payment_terms": rng.choice(PAYMENT_TERMS),
                "credit_limit": float(rng.randint(50, 1500) * 1_000_000),
                "deleted_at": None,
                "version": 1,
                "change_id": uuid4().hex,
            }
        )

    await db.customers.insert_many(customers)
    await db.app_meta.update_one(
        {"key": "seed_version"}, {"$set": {"value": SEED_VERSION}}, upsert=True
    )
    logger.info("Seeded %d sample customers (v%d)", len(customers), SEED_VERSION)


async def seed_supabase_defaults():
    """Seed built-in Supabase credentials (from env) once, so the app ships
    connected by default. Never overwrites an existing/admin-changed config."""
    existing = await db.app_settings.find_one({"key": "supabase"})
    now = datetime.now(timezone.utc).isoformat()
    if SUPABASE_DEFAULT_URL and SUPABASE_DEFAULT_KEY and not (
        existing and existing.get("service_role_key_ciphertext")
    ):
        await db.app_settings.update_one(
            {"key": "supabase"},
            {"$set": {
                "key": "supabase",
                "project_url": SUPABASE_DEFAULT_URL,
                "service_role_key_ciphertext": fernet.encrypt(SUPABASE_DEFAULT_KEY.encode()).decode(),
                "last_test_ok": None,
                "updated_at": now,
                "sync_enabled": True,
                "seeded_default": True,
            }},
            upsert=True,
        )
        existing = await db.app_settings.find_one({"key": "supabase"})
        logger.info("Seeded default Supabase credentials from env")
    # Seed the Personal Access Token (for auto-creating tables) if provided and
    # not already stored — lets a fresh install auto-connect AND auto-provision.
    if SUPABASE_DEFAULT_ACCESS_TOKEN and existing and not existing.get("access_token_ciphertext"):
        await db.app_settings.update_one(
            {"key": "supabase"},
            {"$set": {
                "access_token_ciphertext": fernet.encrypt(SUPABASE_DEFAULT_ACCESS_TOKEN.encode()).decode(),
                "updated_at": now,
            }},
        )
        logger.info("Seeded default Supabase access token from env")


async def seed_master():
    """Seed initial master data (idempotent — only when a collection is empty)."""
    defaults = {
        "purchasing_size": PURCHASING_SIZES,
        "segment": SEGMENTS,
        "top": PAYMENT_TERMS,
        "area": list(AREAS.keys()),
    }
    for et, names in defaults.items():
        coll = db[MASTER_COLLECTION[et]]
        if await coll.count_documents({}) > 0:
            continue
        now = datetime.now(timezone.utc).isoformat()
        docs = [
            {"id": uuid4().hex, "name": n, "description": "", "deleted_at": None,
             "updated_at": now, "version": 1, "change_id": uuid4().hex}
            for n in names
        ]
        if docs:
            await coll.insert_many(docs)
            logger.info("Seeded %d %s master records", len(docs), et)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("username", unique=True, name="uq_users_username")
    await seed_users()
    await seed_customers()
    await seed_supabase_defaults()
    await seed_master()
    # Wire + start the persistent one-way sync engine.
    sync_engine.init(db, fernet)
    sync_engine.register_entity("customer", table="customers", conflict="id")
    sync_engine.register_entity("purchasing_size", table="purchasing_sizes", conflict="id")
    sync_engine.register_entity("segment", table="segments", conflict="id")
    sync_engine.register_entity("top", table="payment_terms", conflict="id")
    sync_engine.register_entity("area", table="areas", conflict="id")
    sync_engine.register_entity("user", table="app_users", conflict="id")
    sync_engine.register_entity("about", table="app_config", conflict="id")
    await sync_engine.ensure_indexes()
    sync_engine.start_worker()
    # USER Online -> Offline: background incremental pull (changed rows only).
    asyncio.create_task(user_pull_loop())
    try:
        await run_in_threadpool(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.warning("Object storage init failed: %s", type(e).__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
