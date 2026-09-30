import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowsClockwise, CloudArrowDown, HardDrive, Warning } from "phosphor-react-native";

import { ApiError, ConflictRecord, apiConflicts, apiResolveConflict } from "@/src/api/client";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

const ENTITY_LABEL: Record<string, string> = {
  customer: "Customer",
  purchasing_size: "Purchasing Size",
  segment: "Segment",
  area: "Area",
  top: "TOP",
};

const HIDE = new Set(["_id", "version", "change_id", "updated_at", "deleted_at", "created_at", "id"]);

function fmtTime(iso?: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function snapshotFields(snap: Record<string, unknown> | null): { k: string; v: string }[] {
  if (!snap) return [];
  return Object.entries(snap)
    .filter(([k, v]) => !HIDE.has(k) && v !== null && v !== undefined && `${v}` !== "")
    .slice(0, 5)
    .map(([k, v]) => ({ k, v: `${v}` }));
}

export default function ConflictsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastData>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const flash = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  };

  const { data, isLoading, isError, refetch } = useQuery<ConflictRecord[]>({
    queryKey: ["conflicts"],
    queryFn: () => apiConflicts(false),
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: "keep_local" | "keep_online" }) =>
      apiResolveConflict(id, choice),
    onMutate: (v) => setBusyId(v.id),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: ["conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["master"] });
      flash(v.choice === "keep_local" ? "Versi lokal disimpan & dikirim." : "Versi online diterapkan.", true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal menyelesaikan konflik.", false),
    onSettled: () => setBusyId(null),
  });

  const items = data ?? [];

  if (isLoading) return <LoadingView label="Memuat konflik..." />;
  if (isError) return <ErrorView title="Tidak dapat memuat" subtitle="Coba lagi." onRetry={refetch} />;
  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyView title="Tidak ada konflik" subtitle="Semua perubahan tersinkron dengan aman." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        testID="conflicts-list"
      >
        <View style={styles.banner}>
          <Warning size={18} color={colors.warning} weight="fill" />
          <Text style={styles.bannerText}>
            {items.length} record berbeda antara data lokal dan online. Pilih versi yang benar.
          </Text>
        </View>

        {items.map((c) => {
          const busy = busyId === c.id && resolveMut.isPending;
          return (
            <View key={c.id} style={styles.card} testID={`conflict-${c.id}`}>
              <View style={styles.cardHead}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{ENTITY_LABEL[c.entity_type] ?? c.entity_type}</Text>
                </View>
                <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              </View>

              <View style={styles.cols}>
                <View style={[styles.col, styles.colLocal]}>
                  <View style={styles.colHead}>
                    <HardDrive size={15} color={colors.brandPrimary} weight="fill" />
                    <Text style={styles.colTitle}>Lokal (Admin)</Text>
                  </View>
                  <Text style={styles.ver}>v{c.local_version}</Text>
                  <Text style={styles.time}>{fmtTime(c.local_snapshot?.updated_at as string)}</Text>
                  {snapshotFields(c.local_snapshot).map((f) => (
                    <Text key={f.k} style={styles.field} numberOfLines={1}>
                      <Text style={styles.fieldKey}>{f.k}: </Text>{f.v}
                    </Text>
                  ))}
                </View>

                <View style={[styles.col, styles.colOnline]}>
                  <View style={styles.colHead}>
                    <CloudArrowDown size={15} color={colors.info} weight="fill" />
                    <Text style={styles.colTitle}>Online</Text>
                  </View>
                  <Text style={styles.ver}>v{c.remote_version}</Text>
                  <Text style={styles.time}>{fmtTime(c.remote_snapshot?.updated_at as string)}</Text>
                  {snapshotFields(c.remote_snapshot).map((f) => (
                    <Text key={f.k} style={styles.field} numberOfLines={1}>
                      <Text style={styles.fieldKey}>{f.k}: </Text>{f.v}
                    </Text>
                  ))}
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.keepLocal]}
                  disabled={busy}
                  onPress={() => resolveMut.mutate({ id: c.id, choice: "keep_local" })}
                  testID={`conflict-keep-local-${c.id}`}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                  ) : (
                    <Text style={styles.keepLocalText}>Simpan Versi Lokal</Text>
                  )}
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.keepOnline]}
                  disabled={busy}
                  onPress={() => resolveMut.mutate({ id: c.id, choice: "keep_online" })}
                  testID={`conflict-keep-online-${c.id}`}
                >
                  <ArrowsClockwise size={16} color={colors.brandPrimary} weight="bold" />
                  <Text style={styles.keepOnlineText}>Ambil Versi Online</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Toast toast={toast} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  list: { padding: 16, gap: 12 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    backgroundColor: colors.brandTertiary,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
  name: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "800" },
  cols: { flexDirection: "row", gap: 10 },
  col: { flex: 1, borderRadius: 10, padding: 10, gap: 3, borderWidth: 1 },
  colLocal: { borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  colOnline: { borderColor: colors.info, backgroundColor: colors.surface },
  colHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  colTitle: { color: colors.onSurface, fontSize: 12, fontWeight: "800" },
  ver: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  time: { color: colors.muted, fontSize: 11, marginBottom: 4 },
  field: { color: colors.onSurfaceSecondary, fontSize: 12 },
  fieldKey: { color: colors.muted, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  keepLocal: { backgroundColor: colors.brandPrimary },
  keepLocalText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
  keepOnline: { borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surface },
  keepOnlineText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "800" },
}));
