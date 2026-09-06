import { File } from "expo-file-system";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export const TOKEN_KEY = "cm_access_token";

const API_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --- Global 401 handling ---------------------------------------------------
// The API client stays framework-agnostic: on an expired/invalid token it
// clears the stored token and notifies a handler registered by AuthContext,
// which flips the user to null so the route guards redirect to /login.
// No import of AuthContext/router here -> no circular dependency.
type UnauthorizedHandler = () => void | Promise<void>;
let onUnauthorized: UnauthorizedHandler | undefined;
let signingOut = false;

export function registerUnauthorizedHandler(handler: UnauthorizedHandler) {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = undefined;
  };
}

async function handleUnauthorized() {
  if (signingOut) return; // collapse a burst of concurrent 401s into one sign-out
  signingOut = true;
  try {
    await storage.secureRemove(TOKEN_KEY);
    await onUnauthorized?.();
  } finally {
    setTimeout(() => {
      signingOut = false;
    }, 0);
  }
}

// A 401 from the login endpoints means "wrong credentials", NOT session expiry.
function isLoginPath(path: string) {
  return path.endsWith("/login");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet<string>(TOKEN_KEY, null as any);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (e) {
    // Surface the real transport error instead of masking everything as
    // "Network Error" — makes offline vs CORS vs DNS issues diagnosable.
    const msg = e instanceof Error && e.message ? e.message : "Tidak dapat terhubung ke server";
    throw new ApiError(msg, 0);
  }

  if (!res.ok) {
    if (res.status === 401 && !isLoginPath(path)) {
      await handleUnauthorized();
    }
    let detail = "Terjadi kesalahan";
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

// ---- Types ----
export type PublicUser = { username: string; role: string; name: string };

export type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
  segment: string;
  purchasing_size: string;
  area: string;
  status: "Active" | "Inactive" | "Bad Debt";
  bad_debt: boolean;
  bad_debt_nominal: number;
  address: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  whatsapp: string;
  pic_name: string;
  payment_terms: string;
  credit_limit: number;
};

export type Slice = { label: string; count: number };

export type DashboardStats = {
  total_customer: number;
  active_customer: number;
  inactive_customer: number;
  bad_debt_customer: number;
  total_bad_debt_nominal: number;
  by_status: Slice[];
  by_segment: Slice[];
  by_purchasing_size: Slice[];
  by_area: Slice[];
};

// ---- API calls ----
export async function apiLogin(username: string, password: string) {
  return request<{ access_token: string; token_type: string; user: PublicUser }>(
    "/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
}

export const apiMe = () => request<PublicUser>("/auth/me");

export const apiCustomers = (search?: string) =>
  request<Customer[]>(
    `/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`,
  );

export const apiCustomer = (id: string) => request<Customer>(`/customers/${id}`);

export const apiDashboard = () => request<DashboardStats>("/dashboard/statistics");

// ---- Admin ----
export type CustomerInput = {
  customer_code: string;
  customer_name: string;
  segment: string;
  purchasing_size: string;
  area: string;
  status: "Active" | "Inactive" | "Bad Debt";
  payment_terms: string;
  credit_limit: number;
  phone: string;
  whatsapp: string;
  pic_name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  bad_debt_nominal: number;
};

export type AdminStats = {
  total_customer: number;
  active_customer: number;
  inactive_customer: number;
  bad_debt_customer: number;
};

export async function apiAdminLogin(username: string, password: string) {
  return request<{ access_token: string; token_type: string; user: PublicUser }>(
    "/admin/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
}

export const apiAdminStats = () => request<AdminStats>("/admin/statistics");

export const apiCreateCustomer = (body: CustomerInput) =>
  request<Customer>("/customers", { method: "POST", body: JSON.stringify(body) });

export const apiUpdateCustomer = (id: string, body: CustomerInput) =>
  request<Customer>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const apiDeleteCustomer = (id: string) =>
  request<{ success: boolean; message: string }>(`/customers/${id}`, { method: "DELETE" });

export const apiBulkDelete = (ids: string[]) =>
  request<{ success: boolean; deleted: number }>("/admin/customers/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });

export const apiBulkStatus = (ids: string[], status: "Active" | "Inactive" | "Bad Debt") =>
  request<{ success: boolean; updated: number }>("/admin/customers/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
  });

// ---- Import / Export (admin) ----
export type PreviewResult = {
  no: number;
  customer_code: string;
  customer_name: string;
  status: string;
  area: string;
  result: "CREATE" | "UPDATE" | "ERROR";
  error: string | null;
};

export type ImportPreview = {
  results: PreviewResult[];
  counts: { total: number; create: number; update: number; error: number };
};

export type ImportSummary = {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { no: number; customer_code: string; error: string }[];
};

export const apiImportPreview = (rows: Record<string, string>[]) =>
  request<ImportPreview>("/admin/import/preview", { method: "POST", body: JSON.stringify({ rows }) });

export const apiImportCommit = (rows: Record<string, string>[]) =>
  request<ImportSummary>("/admin/import", { method: "POST", body: JSON.stringify({ rows }) });

export const apiExport = () => request<{ count: number; csv: string }>("/admin/export");

// ---- Excel (.xlsx) import/export (admin) ----
export type XlsxResult = "CREATE" | "UPDATE" | "SKIP" | "ERROR";
export type XlsxCounts = { total: number; create: number; update: number; skip: number; error: number };
export type XlsxCustomerRow = {
  no: number;
  customer_code: string;
  customer_name: string;
  status: string;
  area: string;
  result: XlsxResult;
  error: string | null;
};
export type XlsxMasterRow = { no: number; name: string; description: string; result: XlsxResult; error: string | null };
export type XlsxSection<T> = { counts: XlsxCounts; results: T[] };
export type XlsxPreview = {
  customers: XlsxSection<XlsxCustomerRow>;
  master: Record<MasterType, XlsxSection<XlsxMasterRow>>;
};
export type XlsxSummary = {
  customers: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: { no: number; customer_code: string; error: string }[];
  };
  master: Record<string, { total: number; create: number; update: number; skip: number; error: number; auto_created?: number }>;
  queue_pending: number;
};

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function getAuthToken(): Promise<string | null> {
  return storage.secureGet<string>(TOKEN_KEY, null as any);
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

async function uploadXlsx<T>(path: string, uri: string, name: string): Promise<T> {
  const token = await getAuthToken();
  const form = new FormData();
  if (Platform.OS === "web") {
    let blob: Blob;
    try {
      blob = await (await fetch(uri)).blob();
    } catch (e) {
      throw new ApiError(e instanceof Error && e.message ? e.message : "Gagal membaca file", 0);
    }
    form.append("file", blob, name);
  } else {
    // Expo SDK 57 uses the WinterCG `fetch`, which rejects the legacy
    // { uri, name, type } FormData part ("Unsupported FormDataPart
    // implementation"). Append an expo-file-system File (Blob-compliant).
    form.append("file", new File(uri) as any, name);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (e) {
    throw new ApiError(e instanceof Error && e.message ? e.message : "Tidak dapat terhubung ke server", 0);
  }
  if (!res.ok) {
    if (res.status === 401) await handleUnauthorized();
    let detail = `Gagal memproses file (HTTP ${res.status})`;
    try {
      const b = await res.json();
      if (b?.detail) detail = b.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export const apiImportXlsxPreview = (uri: string, name: string) =>
  uploadXlsx<XlsxPreview>("/admin/import/xlsx/preview", uri, name);

export const apiImportXlsxCommit = (uri: string, name: string) =>
  uploadXlsx<XlsxSummary>("/admin/import/xlsx/commit", uri, name);

// ---- About (editable settings) ----
export type AboutInfo = {
  app_name: string;
  tagline: string;
  description: string;
  developer: string;
  author: string;
  version: string;
  copyright: string;
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  admin_email: string;
  admin_phone: string;
  admin_whatsapp: string;
};

export const apiAbout = () => request<AboutInfo>("/app-config");

export const apiUpdateAbout = (body: AboutInfo) =>
  request<AboutInfo>("/admin/about", { method: "PUT", body: JSON.stringify(body) });

// Build an absolute URL for a stored logo path ("/api/files/...").
export function logoUri(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${process.env.EXPO_PUBLIC_BACKEND_URL}${path}`;
}

export async function apiUploadLogo(uri: string, name: string, type: string) {
  const token = await storage.secureGet<string>(TOKEN_KEY, null as any);
  const form = new FormData();
  if (Platform.OS === "web") {
    // On web the picker gives a blob:/data: uri — materialise it into a Blob.
    let blob: Blob;
    try {
      blob = await (await fetch(uri)).blob();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Gagal membaca file gambar";
      throw new ApiError(msg, 0);
    }
    form.append("file", blob, name);
  } else {
    // WinterCG fetch (Expo SDK 57): append a Blob-compliant File, not the
    // legacy { uri, name, type } object.
    form.append("file", new File(uri) as any, name);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/upload-logo`, {
      method: "POST",
      // NOTE: never set Content-Type manually for multipart — the runtime must
      // add the multipart boundary itself, otherwise the upload silently fails.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : "Tidak dapat terhubung ke server";
    throw new ApiError(msg, 0);
  }
  if (!res.ok) {
    if (res.status === 401) await handleUnauthorized();
    let detail = `Gagal mengunggah gambar (HTTP ${res.status})`;
    try {
      const b = await res.json();
      if (b?.detail) detail = b.detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<{ logo_url: string }>;
}

// ---- Supabase connection (admin) ----
export type SupabaseConfig = {
  configured: boolean;
  has_access_token: boolean;
  project_url: string;
  last_test_ok: boolean | null;
  updated_at: string | null;
  sync_enabled: boolean;
  last_sync_at: string | null;
  queue_pending: number;
  queue_failed: number;
  queue_last_error: string | null;
};

export const apiSupabaseGet = () => request<SupabaseConfig>("/admin/supabase");

export const apiSupabaseTest = (project_url: string, service_role_key: string) =>
  request<{ ok: boolean; message: string }>("/admin/supabase/test", {
    method: "POST",
    body: JSON.stringify({ project_url, service_role_key }),
  });

export const apiSupabaseSave = (project_url: string, service_role_key: string) =>
  request<{ ok: boolean; message: string; configured: boolean }>("/admin/supabase", {
    method: "PUT",
    body: JSON.stringify({ project_url, service_role_key }),
  });

export const apiSupabaseSyncToggle = (enabled: boolean) =>
  request<{ sync_enabled: boolean }>("/admin/supabase/sync-toggle", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });

export const apiSupabaseSync = () =>
  request<{ pushed: number; pulled: number; total: number; pending: number; failed: number; last_sync_at: string }>(
    "/admin/supabase/sync",
    { method: "POST" },
  );

export const apiSupabaseResyncAll = () =>
  request<{ enqueued_pending_after: number; pushed: number; pending: number; failed: number; last_sync_at: string }>(
    "/admin/supabase/resync-all",
    { method: "POST" },
  );

export type SchemaStatus = {
  tables: { table: string; exists: boolean }[];
  missing: string[];
  all_present: boolean;
};

export const apiSupabaseSchemaStatus = () =>
  request<SchemaStatus>("/admin/supabase/schema-status");

export const apiSupabaseEnsureSchema = (access_token: string) =>
  request<{ ok: boolean; message: string }>("/admin/supabase/ensure-schema", {
    method: "POST",
    body: JSON.stringify({ access_token }),
  });

export const apiConflictsCount = () =>
  request<{ count: number }>("/admin/conflicts/count");

// ---- Master data (admin): Purchasing Size / Segment / TOP ----
export type MasterType = "purchasing_size" | "segment" | "top" | "area";
export type MasterItem = { id: string; name: string; description: string };

// Master values (names) for customer-form dropdowns — keeps customer fields
// relationally in sync with Master Data.
export type MasterOptions = {
  segment: string[];
  purchasing_size: string[];
  area: string[];
  top: string[];
};

export const apiMasterOptions = () => request<MasterOptions>("/admin/master-options");

// User-accessible filter values, sourced live from the database (master data +
// distinct customer values). Keeps the Customers screen filters in sync.
export type FilterOptions = {
  segment: string[];
  purchasing_size: string[];
  area: string[];
};

export const apiFilterOptions = () => request<FilterOptions>("/filter-options");

export const apiMasterList = (t: MasterType) => request<MasterItem[]>(`/admin/master/${t}`);

export const apiMasterCreate = (t: MasterType, body: { name: string; description: string }) =>
  request<MasterItem>(`/admin/master/${t}`, { method: "POST", body: JSON.stringify(body) });

export const apiMasterUpdate = (t: MasterType, id: string, body: { name: string; description: string }) =>
  request<MasterItem>(`/admin/master/${t}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const apiMasterDelete = (t: MasterType, id: string) =>
  request<{ success: boolean }>(`/admin/master/${t}/${encodeURIComponent(id)}`, { method: "DELETE" });

export const apiMasterBulkDelete = (t: MasterType, ids: string[]) =>
  request<{ success: boolean; deleted: number }>(`/admin/master/${t}/bulk-delete`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });

// ---- Trash (admin): Customer + Master Data ----
export type TrashEntity = "customer" | "purchasing_size" | "segment" | "top" | "area";
export type TrashItem = { id: string; title: string; subtitle: string; deleted_at: string };

export const apiTrashCounts = () => request<Record<string, number>>("/admin/trash-counts");
export const apiTrashList = (e: TrashEntity) => request<TrashItem[]>(`/admin/trash/${e}`);
export const apiTrashRestore = (e: TrashEntity, ids: string[]) =>
  request<{ success: boolean; restored: number }>(`/admin/trash/${e}/restore`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
export const apiTrashPurge = (e: TrashEntity, ids: string[]) =>
  request<{ success: boolean; purged: number }>(`/admin/trash/${e}/purge`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
export const apiTrashEmpty = (e: TrashEntity) =>
  request<{ success: boolean; purged: number }>(`/admin/trash/${e}/empty`, { method: "POST" });

// ---- Manual pull from Supabase (admin) ----
export type PullSummary = Record<string, { created: number; updated: number; skipped: number; error?: string }>;
export const apiSupabasePull = () =>
  request<{ success: boolean; summary: PullSummary }>("/admin/supabase/pull", { method: "POST" });

// ---- Live sync status (any authenticated user) ----
export type SyncStatusInfo = {
  online: boolean;
  status: "offline" | "syncing" | "synced" | "sync_failed" | "conflict";
  pending: number;
  failed: number;
  conflicts: number;
  last_sync_at: string | null;
  last_pull_at: string | null;
};

export const apiSyncStatus = () => request<SyncStatusInfo>("/sync/status");

// Manual "Sync Sekarang" for read-only users: pull latest into local cache.
export const apiSyncPullNow = () =>
  request<{ success: boolean; applied: number; last_pull_at: string | null }>("/sync/pull-now", {
    method: "POST",
  });

// ---- Conflicts (admin) ----
export type ConflictRecord = {
  id: string;
  entity_type: "customer" | "purchasing_size" | "segment" | "top" | "area";
  entity_id: string;
  reason: string;
  name: string;
  local_version: number;
  remote_version: number;
  local_snapshot: Record<string, unknown> | null;
  remote_snapshot: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  resolved: boolean;
  resolution?: string;
  resolved_at?: string;
};

export const apiConflicts = (resolved = false) =>
  request<ConflictRecord[]>(`/admin/conflicts?resolved=${resolved}`);

export const apiResolveConflict = (id: string, choice: "keep_local" | "keep_online") =>
  request<{ success: boolean; choice: string; version: number }>(`/admin/conflicts/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });

// ---- User management (admin) ----
export type ManagedUser = {
  username: string;
  name: string;
  role: "user" | "admin";
  created_at: string | null;
};

export type UserCreateInput = {
  username: string;
  name: string;
  role: "user" | "admin";
  password: string;
};

export const apiUsers = () => request<ManagedUser[]>("/admin/users");

export const apiCreateUser = (body: UserCreateInput) =>
  request<ManagedUser>("/admin/users", { method: "POST", body: JSON.stringify(body) });

export const apiUpdateUser = (username: string, body: { name?: string; role?: "user" | "admin" }) =>
  request<ManagedUser>(`/admin/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const apiDeleteUser = (username: string) =>
  request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });

export const apiResetUserPassword = (username: string, newPassword: string) =>
  request<{ success: boolean; message: string }>(
    `/admin/users/${encodeURIComponent(username)}/password`,
    { method: "POST", body: JSON.stringify({ new_password: newPassword }) },
  );

export const apiChangeOwnPassword = (currentPassword: string, newPassword: string) =>
  request<{ success: boolean; message: string }>("/admin/me/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

// ---- Own profile (any authenticated user) ----
export const apiUpdateMe = (name: string) =>
  request<PublicUser>("/me", { method: "PATCH", body: JSON.stringify({ name }) });

export const apiChangeMyPassword = (currentPassword: string, newPassword: string) =>
  request<{ success: boolean; message: string }>("/me/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
