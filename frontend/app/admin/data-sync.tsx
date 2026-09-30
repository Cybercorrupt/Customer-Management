import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import {
  ArrowsClockwise,
  DownloadSimple,
  FileArrowDown,
  FileArrowUp,
  FileXls,
  Key,
} from "phosphor-react-native";

import {
  ApiError,
  XlsxPreview,
  XlsxSummary,
  apiImportXlsxCommit,
  apiImportXlsxPreview,
  apiUrl,
  getAuthToken,
} from "@/src/api/client";
import { InlineWarning } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { downloadXlsx } from "@/src/utils/xlsxFile";
import { makeStyles, useTheme } from "@/src/theme";

const XLSX_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "*/*",
];

const RESULT_META: Record<string, { key: "success" | "info" | "muted" | "error" }> = {
  CREATE: { key: "success" },
  UPDATE: { key: "info" },
  SKIP: { key: "muted" },
  ERROR: { key: "error" },
};

const MASTER_LABELS: Record<string, string> = {
  purchasing_size: "Purchasing Size",
  segment: "Segment",
  area: "Area",
  top: "TOP",
};

export default function DataSyncScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [file, setFile] = useState<{ uri: string; name: string } | null>(null);
  const [preview, setPreview] = useState<XlsxPreview | null>(null);
  const [summary, setSummary] = useState<XlsxSummary | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [toast, setToast] = useState<ToastData>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const resetImport = () => {
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
  };

  const onExport = async () => {
    try {
      setExporting(true);
      const token = await getAuthToken();
      await downloadXlsx(apiUrl("/admin/export.xlsx"), "customer_export.xlsx", token);
      setToast({ msg: "Export Excel berhasil.", ok: true });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Export gagal. Coba lagi.", ok: false });
    } finally {
      setExporting(false);
    }
  };

  const onTemplate = async () => {
    try {
      setDownloadingTemplate(true);
      const token = await getAuthToken();
      await downloadXlsx(apiUrl("/admin/template.xlsx"), "customer_import_template.xlsx", token);
      setToast({ msg: "Template Excel diunduh.", ok: true });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Gagal mengunduh template.", ok: false });
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const onChoose = async () => {
    try {
      setError(null);
      setSummary(null);
      setPreview(null);
      const res = await DocumentPicker.getDocumentAsync({ type: XLSX_TYPES, copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const name = asset.name ?? "data.xlsx";
      if (!name.toLowerCase().endsWith(".xlsx")) {
        setError("Harap pilih file Excel (.xlsx).");
        return;
      }
      setFile({ uri: asset.uri, name });
      setLoadingPreview(true);
      const p = await apiImportXlsxPreview(asset.uri, name);
      setPreview(p);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Gagal membaca file. Pastikan file Excel (.xlsx) valid.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const importMutation = useMutation({
    mutationFn: () => apiImportXlsxCommit(file!.uri, file!.name),
    onSuccess: (s) => {
      setSummary(s);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
      queryClient.invalidateQueries({ queryKey: ["master"] });
      queryClient.invalidateQueries({ queryKey: ["supabase"] });
    },
    onError: (e) => {
      setToast({ msg: e instanceof ApiError ? e.message : "Server error. Import gagal.", ok: false });
    },
  });

  const cc = preview?.customers.counts;
  const validCount = cc ? cc.create + cc.update : 0;
  const previewList = preview?.customers.results.slice(0, 15) ?? [];

  const masterSummaryText = useMemo(() => {
    if (!preview) return "";
    return (Object.keys(preview.master) as (keyof typeof preview.master)[])
      .map((k) => {
        const c = preview.master[k].counts;
        const added = c.create;
        return added > 0 ? `${MASTER_LABELS[k as string]}: +${added}` : null;
      })
      .filter(Boolean)
      .join(" • ");
  }, [preview]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        testID="data-sync-scroll"
      >
        {/* Smart Sync info */}
        <View style={styles.syncNote} testID="smart-sync-note">
          <View style={styles.syncIcon}>
            <Key size={20} color={colors.brandPrimary} weight="fill" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.syncTitle}>Smart Sync</Text>
            <Text style={styles.syncText}>
              Satu file Excel untuk Customer + Master Data. Kode Customer jadi kunci: data baru dibuat, data berubah
              diperbarui, data sama dilewati. Semua masuk antrean sinkron ke Supabase.
            </Text>
          </View>
        </View>

        {/* Export */}
        <Text style={styles.sectionTitle}>Export Data</Text>
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <View style={[styles.roundIcon, { backgroundColor: `${colors.brandPrimary}1A` }]}>
              <FileArrowDown size={22} color={colors.brandPrimary} weight="fill" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Unduh semua data</Text>
              <Text style={styles.cardSub}>File Excel (.xlsx) berisi Customer + Master Data, bisa diedit & di-import lagi.</Text>
            </View>
          </View>
          <Pressable
            style={[styles.primaryBtn, exporting && styles.btnDisabled]}
            onPress={onExport}
            disabled={exporting}
            testID="export-data-button"
          >
            {exporting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <FileArrowDown size={18} color={colors.onBrandPrimary} weight="bold" />
                <Text style={styles.primaryBtnText}>Export Excel</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Import */}
        <Text style={styles.sectionTitle}>Import Data</Text>

        {summary ? (
          <View style={styles.card} testID="import-summary">
            <Text style={styles.summaryTitle}>Import Selesai</Text>
            <Text style={styles.summaryMsg}>
              {summary.customers.failed === 0
                ? "Semua data valid dimasukkan & diantrekan ke Supabase."
                : "Import selesai dengan sebagian baris error."}
            </Text>
            <View style={styles.summaryGrid}>
              {[
                { label: "Total", value: summary.customers.total, color: colors.onSurface },
                { label: "Ditambahkan", value: summary.customers.created, color: colors.success },
                { label: "Diperbarui", value: summary.customers.updated, color: colors.info },
                { label: "Dilewati", value: summary.customers.skipped, color: colors.muted },
                { label: "Gagal", value: summary.customers.failed, color: colors.error },
                { label: "Antre Sync", value: summary.queue_pending, color: colors.brandPrimary },
              ].map((s) => (
                <View key={s.label} style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
                  <Text style={styles.summaryLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
            {summary.customers.errors.length > 0 ? (
              <View style={styles.errorBox}>
                {summary.customers.errors.slice(0, 8).map((er) => (
                  <Text key={er.no} style={styles.errorLine} testID={`import-error-${er.no}`}>
                    Baris {er.no} ({er.customer_code || "-"}): {er.error}
                  </Text>
                ))}
                {summary.customers.errors.length > 8 ? (
                  <Text style={styles.errorLine}>+{summary.customers.errors.length - 8} error lainnya</Text>
                ) : null}
              </View>
            ) : null}
            <Pressable style={styles.primaryBtn} onPress={() => router.push("/admin/customers")} testID="import-done">
              <Text style={styles.primaryBtnText}>Lihat Customer</Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={resetImport} testID="import-another">
              <Text style={styles.linkText}>Import file lain</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeadRow}>
                <View style={[styles.roundIcon, { backgroundColor: `${colors.brandSecondary}1A` }]}>
                  <FileArrowUp size={22} color={colors.brandSecondary} weight="fill" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Unggah file Excel</Text>
                  <Text style={styles.cardSub}>Gunakan template agar sheet & kolom sesuai sistem.</Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.outlineBtn, downloadingTemplate && styles.btnDisabled]}
                  onPress={onTemplate}
                  disabled={downloadingTemplate}
                  testID="download-template"
                >
                  <DownloadSimple size={18} color={colors.brandPrimary} weight="bold" />
                  <Text style={styles.outlineText}>Template</Text>
                </Pressable>
                <Pressable style={styles.primaryBtnSmall} onPress={onChoose} testID="choose-xlsx">
                  <FileArrowUp size={18} color={colors.onBrandPrimary} weight="bold" />
                  <Text style={styles.primaryBtnText}>Pilih Excel</Text>
                </Pressable>
              </View>
            </View>

            {error ? <InlineWarning message={error} /> : null}

            {loadingPreview ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={colors.brandPrimary} />
                <Text style={styles.loadingText}>Memproses file...</Text>
              </View>
            ) : null}

            {file && preview ? (
              <>
                <View style={styles.card}>
                  <View style={styles.fileRow}>
                    <FileXls size={26} color={colors.brandPrimary} weight="fill" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                      <Text style={styles.fileMeta}>Total baris customer: {cc?.total ?? 0}</Text>
                    </View>
                  </View>
                  <View style={styles.countsRow}>
                    <View style={styles.countItem}>
                      <Text style={[styles.countValue, { color: colors.success }]}>{cc?.create ?? 0}</Text>
                      <Text style={styles.countLabel}>Baru</Text>
                    </View>
                    <View style={styles.countItem}>
                      <Text style={[styles.countValue, { color: colors.info }]}>{cc?.update ?? 0}</Text>
                      <Text style={styles.countLabel}>Update</Text>
                    </View>
                    <View style={styles.countItem}>
                      <Text style={[styles.countValue, { color: colors.muted }]}>{cc?.skip ?? 0}</Text>
                      <Text style={styles.countLabel}>Skip</Text>
                    </View>
                    <View style={styles.countItem}>
                      <Text style={[styles.countValue, { color: colors.error }]}>{cc?.error ?? 0}</Text>
                      <Text style={styles.countLabel}>Error</Text>
                    </View>
                  </View>
                  {masterSummaryText ? (
                    <Text style={styles.masterNote} testID="master-preview-note">
                      Master data baru → {masterSummaryText}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.card}>
                  {previewList.map((r, idx) => {
                    const meta = RESULT_META[r.result];
                    const color = (colors as any)[meta.key];
                    return (
                      <View
                        key={r.no}
                        style={[styles.previewRow, idx < previewList.length - 1 && styles.previewRowBorder]}
                        testID={`preview-row-${r.no}`}
                      >
                        <Text style={styles.previewNo}>{r.no}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.previewCode}>{r.customer_code || "(kosong)"}</Text>
                          <Text style={styles.previewName} numberOfLines={1}>
                            {r.customer_name || "-"} • {r.status || "-"} • {r.area || "-"}
                          </Text>
                          {r.error ? <Text style={styles.previewError}>{r.error}</Text> : null}
                        </View>
                        <View style={[styles.resultBadge, { backgroundColor: `${color}1A` }]}>
                          <Text style={[styles.resultText, { color }]}>{r.result}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {(preview.customers.results.length ?? 0) > previewList.length ? (
                    <Text style={styles.moreText}>
                      +{preview.customers.results.length - previewList.length} baris lainnya
                    </Text>
                  ) : null}
                </View>

                <View style={styles.confirmCard}>
                  <Text style={styles.confirmText}>
                    {validCount} customer akan disinkronkan
                    {(cc?.skip ?? 0) > 0 ? ` • ${cc?.skip} dilewati` : ""}
                    {(cc?.error ?? 0) > 0 ? ` • ${cc?.error} error` : ""}.
                  </Text>
                </View>

                <Pressable
                  style={[styles.primaryBtn, validCount === 0 && (preview.master
                    ? Object.values(preview.master).every((m) => m.counts.create + m.counts.update === 0)
                    : true) && styles.btnDisabled]}
                  onPress={() => importMutation.mutate()}
                  disabled={importMutation.isPending}
                  testID="import-data-button"
                >
                  {importMutation.isPending ? (
                    <ActivityIndicator color={colors.onBrandPrimary} />
                  ) : (
                    <>
                      <ArrowsClockwise size={18} color={colors.onBrandPrimary} weight="bold" />
                      <Text style={styles.primaryBtnText}>Proses & Sinkronkan</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Toast toast={toast} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 16, gap: 12 },
  syncNote: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.brandTertiary,
    borderRadius: 12,
    padding: 14,
  },
  syncIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  syncTitle: { color: colors.brandPrimary, fontSize: 14, fontWeight: "800", marginBottom: 2 },
  syncText: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 6,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  cardHeadRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  roundIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  cardSub: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  actionsRow: { flexDirection: "row", gap: 12 },
  outlineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surface,
  },
  outlineText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  primaryBtnSmall: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
  },
  loadingBox: { alignItems: "center", gap: 8, paddingVertical: 24 },
  loadingText: { color: colors.muted, fontSize: 14 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  fileName: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  fileMeta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  countsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  countItem: { flex: 1, alignItems: "center", gap: 2 },
  countValue: { fontSize: 20, fontWeight: "800" },
  countLabel: { color: colors.muted, fontSize: 12 },
  masterNote: {
    color: colors.brandPrimary,
    fontSize: 12,
    fontWeight: "700",
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 10,
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  previewRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  previewNo: { color: colors.muted, fontSize: 13, width: 22, fontWeight: "700" },
  previewCode: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  previewName: { color: colors.muted, fontSize: 12, marginTop: 1 },
  previewError: { color: colors.error, fontSize: 12, marginTop: 2 },
  resultBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  resultText: { fontSize: 11, fontWeight: "800" },
  moreText: { color: colors.muted, fontSize: 12, paddingTop: 8, textAlign: "center" },
  confirmCard: { backgroundColor: colors.brandTertiary, borderRadius: 12, padding: 14 },
  confirmText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "600", textAlign: "center" },
  primaryBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  btnDisabled: { opacity: 0.5 },
  summaryTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", textAlign: "center" },
  summaryMsg: { color: colors.muted, fontSize: 14, textAlign: "center" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap" },
  summaryItem: { flexBasis: "33.33%", alignItems: "center", paddingVertical: 12, gap: 2 },
  summaryValue: { fontSize: 24, fontWeight: "800" },
  summaryLabel: { color: colors.muted, fontSize: 12 },
  errorBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  errorLine: { color: colors.error, fontSize: 12, lineHeight: 16 },
  linkBtn: { alignItems: "center", paddingVertical: 4 },
  linkText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "600" },
}));
