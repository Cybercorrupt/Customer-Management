import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  CloudCheck,
  Copy,
  Database,
  DownloadSimple,
  HardDrives,
  Plugs,
  WarningCircle,
} from "phosphor-react-native";

import {
  ApiError,
  SchemaStatus,
  SupabaseConfig,
  apiSupabaseEnsureSchema,
  apiSupabaseGet,
  apiSupabasePull,
  apiSupabaseSave,
  apiSupabaseSchemaStatus,
  apiSupabaseSync,
  apiSupabaseSyncToggle,
  apiSupabaseTest,
} from "@/src/api/client";
import { LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

const TABLE_SQL = `-- ============================================================
-- Customer Management — Supabase schema (jalankan sekali)
-- Aman dijalankan ulang (idempotent).
-- ============================================================

create table if not exists public.customers (
  id text primary key,
  customer_code text unique not null,
  customer_name text,
  segment text,
  purchasing_size text,
  area text,
  status text,
  bad_debt boolean default false,
  bad_debt_nominal double precision default 0,
  address text,
  latitude double precision,
  longitude double precision,
  phone text,
  whatsapp text,
  pic_name text,
  payment_terms text,
  credit_limit double precision default 0,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  version bigint default 1,
  change_id text
);
-- Migrasi jika tabel customers sudah ada sebelumnya:
alter table public.customers add column if not exists version bigint default 1;
alter table public.customers add column if not exists change_id text;
grant select, insert, update on public.customers to service_role;

create table if not exists public.app_config (
  id text primary key,
  app_name text, tagline text, description text, developer text,
  author text, version text, copyright text, logo_url text,
  primary_color text, secondary_color text,
  admin_email text, admin_phone text, admin_whatsapp text,
  updated_at timestamptz not null default now(),
  change_id text
);
alter table public.app_config add column if not exists author text;
alter table public.app_config add column if not exists change_id text;
grant select, insert, update on public.app_config to service_role;

-- Master data (Purchasing Size / Segment / Area / TOP) + User profile
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
-- Migrasi kolom untuk tabel master/user yang sudah dibuat sebelumnya:
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
grant select, insert, update on public.app_users to service_role;`;

const TUTORIAL = [
  "Buka dashboard Supabase, lalu pilih project Anda.",
  "Masuk ke Settings → API (atau tombol Connect).",
  "Salin nilai Project URL (format https://xxxx.supabase.co).",
  "Di Settings → API Keys → Legacy API Keys, salin service_role key.",
  "Buka SQL Editor, tempel SQL tabel di bawah, lalu Run (sekali saja).",
  "Tempel URL & key di form, tekan Tes Koneksi, lalu Simpan.",
];

function fmtTime(iso: string | null): string {
  if (!iso) return "belum pernah";
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function SupabaseScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<SupabaseConfig>({
    queryKey: ["supabase"],
    queryFn: apiSupabaseGet,
  });

  const [projectUrl, setProjectUrl] = useState("");
  const [key, setKey] = useState("");
  const [toast, setToast] = useState<ToastData>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [schemaStatus, setSchemaStatus] = useState<SchemaStatus | null>(null);

  useEffect(() => {
    if (status && !prefilled) {
      setProjectUrl(status.project_url ?? "");
      setPrefilled(true);
    }
  }, [status, prefilled]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const testMut = useMutation({
    mutationFn: () => apiSupabaseTest(projectUrl.trim(), key.trim()),
    onSuccess: (res) => setToast({ msg: res.message, ok: res.ok }),
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal menguji koneksi.", ok: false }),
  });

  const saveMut = useMutation({
    mutationFn: () => apiSupabaseSave(projectUrl.trim(), key.trim()),
    onSuccess: (res) => {
      setToast({ msg: res.ok ? "Koneksi tersimpan." : res.message, ok: res.ok });
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
      if (res.ok) setKey("");
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal menyimpan.", ok: false }),
  });

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => apiSupabaseSyncToggle(enabled),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
      setToast({ msg: res.sync_enabled ? "Sinkron otomatis diaktifkan." : "Sinkron otomatis dimatikan.", ok: true });
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal mengubah.", ok: false }),
  });

  const syncMut = useMutation({
    mutationFn: apiSupabaseSync,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["app-config"] });
      const tail = res.failed > 0 ? ` • ${res.failed} gagal (akan dicoba lagi)` : "";
      setToast({ msg: `Sinkron selesai • ${res.pushed} terkirim, ${res.pending} menunggu${tail}.`, ok: res.failed === 0 });
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Sinkron gagal.", ok: false }),
  });

  const pullMut = useMutation({
    mutationFn: apiSupabasePull,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["master"] });
      const s = res.summary || {};
      const added = Object.values(s).reduce((a, v) => a + (v.created || 0), 0);
      const upd = Object.values(s).reduce((a, v) => a + (v.updated || 0), 0);
      setToast({ msg: `Tarik selesai • ${added} baru, ${upd} diperbarui.`, ok: true });
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal menarik data.", ok: false }),
  });

  const copySql = async () => {
    await Clipboard.setStringAsync(TABLE_SQL);
    setToast({ msg: "SQL disalin ke clipboard.", ok: true });
  };

  const checkMut = useMutation({
    mutationFn: apiSupabaseSchemaStatus,
    onSuccess: (res) => {
      setSchemaStatus(res);
      setToast({
        msg: res.all_present ? "Semua tabel sudah ada." : `${res.missing.length} tabel belum dibuat.`,
        ok: res.all_present,
      });
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal memeriksa tabel.", ok: false }),
  });

  const ensureMut = useMutation({
    mutationFn: () => apiSupabaseEnsureSchema(accessToken.trim()),
    onSuccess: (res) => {
      setToast({ msg: res.message, ok: res.ok });
      setAccessToken("");
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
      checkMut.mutate();
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal membuat tabel.", ok: false }),
  });

  if (isLoading) {
    return (
      <View style={styles.container}>
        <LoadingView label="Memuat konfigurasi..." />
      </View>
    );
  }

  const configured = !!status?.configured;
  const lastOk = status?.last_test_ok;
  const canSubmit = projectUrl.trim().length > 8 && (key.trim().length > 0 || configured);

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="supabase-scroll"
        >
          {/* Database mode summary */}
          <View style={styles.modeRow}>
            <View style={[styles.modeCard, styles.modeActive]}>
              <HardDrives size={22} color={colors.success} weight="fill" />
              <Text style={styles.modeTitle}>Offline (MongoDB)</Text>
              <Text style={[styles.modeState, { color: colors.success }]}>Aktif</Text>
            </View>
            <View style={styles.modeCard}>
              <Database size={22} color={configured ? colors.brandPrimary : colors.muted} weight="fill" />
              <Text style={styles.modeTitle}>Online (Supabase)</Text>
              <Text style={[styles.modeState, { color: configured ? colors.brandPrimary : colors.muted }]}>
                {configured ? "Terhubung" : "Belum diatur"}
              </Text>
            </View>
          </View>

          {/* Sync controls (only when configured) */}
          {configured ? (
            <>
              <Text style={styles.sectionTitle}>SINKRONISASI (SATU ARAH)</Text>
              <View style={styles.card}>
                <View style={styles.syncToggleRow}>
                  <View style={styles.flex}>
                    <Text style={styles.syncLabel}>Sinkron Otomatis</Text>
                    <Text style={styles.syncHint}>
                      Setiap tambah/edit/hapus langsung masuk antrean & dikirim ke Supabase di latar belakang.
                    </Text>
                  </View>
                  <Switch
                    value={!!status?.sync_enabled}
                    onValueChange={(v) => toggleMut.mutate(v)}
                    trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
                    thumbColor={colors.onBrandPrimary}
                    testID="sync-auto-toggle"
                  />
                </View>
                <View style={styles.innerDivider} />

                {/* Queue status */}
                <View style={styles.queueRow}>
                  <View style={styles.queuePill}>
                    <Text style={styles.queueNum} testID="queue-pending">{status?.queue_pending ?? 0}</Text>
                    <Text style={styles.queueLabel}>Menunggu</Text>
                  </View>
                  <View style={[styles.queuePill, (status?.queue_failed ?? 0) > 0 && styles.queuePillWarn]}>
                    <Text
                      style={[styles.queueNum, (status?.queue_failed ?? 0) > 0 && { color: colors.error }]}
                      testID="queue-failed"
                    >
                      {status?.queue_failed ?? 0}
                    </Text>
                    <Text style={styles.queueLabel}>Gagal</Text>
                  </View>
                </View>
                {status?.queue_last_error ? (
                  <Text style={styles.queueError} testID="queue-last-error" numberOfLines={3}>
                    Error terakhir: {status.queue_last_error}
                  </Text>
                ) : null}

                <View style={styles.syncBottomRow}>
                  <Text style={styles.syncMeta}>Sinkron terakhir: {fmtTime(status?.last_sync_at ?? null)}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.syncNowBtn, pressed && { opacity: 0.85 }]}
                    onPress={() => syncMut.mutate()}
                    disabled={syncMut.isPending}
                    testID="sync-now-button"
                  >
                    {syncMut.isPending ? (
                      <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                    ) : (
                      <>
                        <ArrowsClockwise size={18} color={colors.onBrandPrimary} weight="bold" />
                        <Text style={styles.syncNowText}>Sync Sekarang</Text>
                      </>
                    )}
                  </Pressable>
                </View>
                <Text style={styles.lwwNote}>
                  Database lokal (MongoDB) adalah sumber kebenaran. Perubahan dikirim satu arah ke Supabase lewat antrean tahan-restart — data yang dihapus tidak akan muncul kembali, dan percobaan ulang tidak membuat duplikat.
                </Text>

                <View style={styles.innerDivider} />
                <Text style={styles.pullTitle}>Tarik Data dari Supabase</Text>
                <Text style={styles.pullHint}>
                  Ambil data yang Anda tambah/ubah LANGSUNG di Supabase ke aplikasi. Data yang sudah dihapus di aplikasi TIDAK akan dihidupkan kembali.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.pullBtn, pressed && { opacity: 0.85 }, pullMut.isPending && styles.btnDisabled]}
                  onPress={() => pullMut.mutate()}
                  disabled={pullMut.isPending}
                  testID="pull-now-button"
                >
                  {pullMut.isPending ? (
                    <ActivityIndicator color={colors.brandPrimary} size="small" />
                  ) : (
                    <>
                      <DownloadSimple size={18} color={colors.brandPrimary} weight="bold" />
                      <Text style={styles.pullText}>Tarik dari Supabase</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </>
          ) : null}

          {/* Status badge */}
          {configured ? (
            <View style={[styles.statusBox, lastOk === false && styles.statusBoxWarn]}>
              {lastOk === false ? (
                <WarningCircle size={20} color={colors.error} weight="fill" />
              ) : (
                <CloudCheck size={20} color={colors.success} weight="fill" />
              )}
              <Text style={styles.statusText}>
                {lastOk === false
                  ? "Tersimpan, namun tes terakhir gagal. Periksa kembali key."
                  : "Supabase terkonfigurasi. Service_role key tersimpan aman (terenkripsi)."}
              </Text>
            </View>
          ) : null}

          {/* Auto-create schema (Management API) */}
          {configured ? (
            <>
              <Text style={styles.sectionTitle}>BUAT TABEL OTOMATIS</Text>
              <View style={styles.card}>
                <Text style={styles.lwwNote}>
                  Cek & buat semua tabel yang diperlukan langsung di Supabase — tanpa menjalankan SQL manual.
                  {status?.has_access_token
                    ? " Personal Access Token sudah tersimpan."
                    : " Perlu Personal Access Token (sbp_...) sekali saja."}
                </Text>
                {!status?.has_access_token ? (
                  <View style={styles.field}>
                    <Text style={styles.label}>Personal Access Token (sbp_...)</Text>
                    <TextInput
                      style={styles.input}
                      value={accessToken}
                      onChangeText={setAccessToken}
                      placeholder="sbp_… (Account → Access Tokens)"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry
                      testID="supabase-access-token-input"
                    />
                  </View>
                ) : null}
                {schemaStatus ? (
                  <View style={styles.schemaGrid}>
                    {schemaStatus.tables.map((tb) => (
                      <View key={tb.table} style={styles.schemaChip}>
                        {tb.exists ? (
                          <CheckCircle size={14} color={colors.success} weight="fill" />
                        ) : (
                          <WarningCircle size={14} color={colors.error} weight="fill" />
                        )}
                        <Text style={styles.schemaChipText}>{tb.table}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <View style={styles.btnRow}>
                  <Pressable
                    style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.85 }, checkMut.isPending && styles.btnDisabled]}
                    onPress={() => checkMut.mutate()}
                    disabled={checkMut.isPending}
                    testID="check-schema-button"
                  >
                    {checkMut.isPending ? (
                      <ActivityIndicator color={colors.brandPrimary} size="small" />
                    ) : (
                      <>
                        <Database size={18} color={colors.brandPrimary} weight="bold" />
                        <Text style={styles.testText}>Cek Tabel</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, ensureMut.isPending && styles.btnDisabled]}
                    onPress={() => ensureMut.mutate()}
                    disabled={ensureMut.isPending}
                    testID="ensure-schema-button"
                  >
                    {ensureMut.isPending ? (
                      <ActivityIndicator color={colors.onBrandPrimary} />
                    ) : (
                      <>
                        <CheckCircle size={18} color={colors.onBrandPrimary} weight="bold" />
                        <Text style={styles.saveText}>Buat Tabel Otomatis</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}

          {/* Tutorial */}
          <Pressable
            style={styles.collapseHeader}
            onPress={() => setShowTutorial((v) => !v)}
            testID="toggle-tutorial"
          >
            <Text style={styles.sectionTitle}>CARA MENGHUBUNGKAN</Text>
            {showTutorial ? (
              <CaretDown size={16} color={colors.muted} weight="bold" />
            ) : (
              <CaretRight size={16} color={colors.muted} weight="bold" />
            )}
          </Pressable>
          {showTutorial ? (
            <View style={styles.card}>
              {TUTORIAL.map((step, i) => (
                <View style={styles.stepRow} key={i}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
              <Pressable
                style={styles.docLink}
                onPress={() => Linking.openURL("https://supabase.com/dashboard/project/_/sql/new")}
                testID="supabase-docs-link"
              >
                <ArrowSquareOut size={16} color={colors.brandPrimary} weight="bold" />
                <Text style={styles.docLinkText}>Buka SQL Editor Supabase</Text>
              </Pressable>
            </View>
          ) : null}

          {/* SQL to create table */}
          <Pressable
            style={styles.collapseHeader}
            onPress={() => setShowSql((v) => !v)}
            testID="toggle-sql"
          >
            <Text style={styles.sectionTitle}>SQL TABEL (JALANKAN SEKALI)</Text>
            {showSql ? (
              <CaretDown size={16} color={colors.muted} weight="bold" />
            ) : (
              <CaretRight size={16} color={colors.muted} weight="bold" />
            )}
          </Pressable>
          {showSql ? (
            <View style={styles.card}>
              <View style={styles.sqlBox}>
                <Text style={styles.sqlText} selectable testID="table-sql">
                  {TABLE_SQL}
                </Text>
              </View>
              <Pressable style={styles.copyBtn} onPress={copySql} testID="copy-sql-button">
                <Copy size={18} color={colors.brandPrimary} weight="bold" />
                <Text style={styles.copyText}>Salin SQL</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Form */}
          <Text style={styles.sectionTitle}>PENGATURAN KONEKSI</Text>
          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Project URL</Text>
              <TextInput
                style={styles.input}
                value={projectUrl}
                onChangeText={setProjectUrl}
                placeholder="https://xxxx.supabase.co"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                testID="supabase-url-input"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>service_role key</Text>
              <TextInput
                style={styles.input}
                value={key}
                onChangeText={setKey}
                placeholder={configured ? "•••••• (tersimpan — isi untuk mengganti)" : "Tempel service_role key"}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                testID="supabase-key-input"
              />
              <Text style={styles.helper}>
                Key hanya dikirim ke server aplikasi Anda, tidak pernah disimpan di perangkat.
              </Text>
            </View>

            <View style={styles.btnRow}>
              <Pressable
                style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.85 }, !canSubmit && styles.btnDisabled]}
                onPress={() => testMut.mutate()}
                disabled={!canSubmit || testMut.isPending}
                testID="supabase-test-button"
              >
                {testMut.isPending ? (
                  <ActivityIndicator color={colors.brandPrimary} size="small" />
                ) : (
                  <>
                    <Plugs size={18} color={colors.brandPrimary} weight="bold" />
                    <Text style={styles.testText}>Tes Koneksi</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }, !canSubmit && styles.btnDisabled]}
                onPress={() => saveMut.mutate()}
                disabled={!canSubmit || saveMut.isPending}
                testID="supabase-save-button"
              >
                {saveMut.isPending ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <>
                    <CheckCircle size={18} color={colors.onBrandPrimary} weight="bold" />
                    <Text style={styles.saveText}>Simpan</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast toast={toast} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
  modeRow: { flexDirection: "row", gap: 12 },
  modeCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
    alignItems: "flex-start",
  },
  modeActive: { borderColor: colors.success },
  modeTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "700", marginTop: 4 },
  modeState: { fontSize: 12, fontWeight: "800" },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 12,
  },
  statusBoxWarn: { backgroundColor: "#FEF2F2" },
  statusText: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginTop: 8 },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  syncToggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  syncLabel: { color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  syncHint: { color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  innerDivider: { height: 1, backgroundColor: colors.divider },
  syncBottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  syncMeta: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  syncNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  syncNowText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800" },
  lwwNote: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  pullTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  pullHint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  pullBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surface,
  },
  pullText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "800" },
  queueRow: { flexDirection: "row", gap: 12 },
  queuePill: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: "center",
    gap: 2,
  },
  queuePillWarn: { borderColor: colors.error, backgroundColor: "#FEF2F2" },
  queueNum: { color: colors.onSurface, fontSize: 20, fontWeight: "800" },
  queueLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  queueError: { color: colors.error, fontSize: 12, lineHeight: 16 },
  stepRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  stepText: { color: colors.onSurfaceSecondary, fontSize: 14, flex: 1, lineHeight: 20 },
  docLink: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  docLinkText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  sqlBox: {
    backgroundColor: colors.surfaceInverse,
    borderRadius: 10,
    padding: 12,
  },
  sqlText: {
    color: colors.onSurfaceInverse,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  copyText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "800" },
  schemaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  schemaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  schemaChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  field: { gap: 6 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
    color: colors.onSurface,
    fontSize: 15,
  },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 2 },
  testBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surface,
  },
  testText: { color: colors.brandPrimary, fontSize: 15, fontWeight: "800" },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
  },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  btnDisabled: { opacity: 0.45 },
}));
