import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ArrowsClockwise, CheckCircle, CloudSlash, Warning } from "phosphor-react-native";

import { apiSyncPullNow, apiSyncStatus, SyncStatusInfo } from "@/src/api/client";
import { makeStyles, useTheme } from "@/src/theme";

const STATUS_META: Record<SyncStatusInfo["status"], { label: string; colorKey: string }> = {
  synced: { label: "Tersinkron", colorKey: "success" },
  syncing: { label: "Menyinkronkan", colorKey: "info" },
  sync_failed: { label: "Sinkron Gagal", colorKey: "error" },
  conflict: { label: "Konflik", colorKey: "warning" },
  offline: { label: "Offline", colorKey: "muted" },
};

function relTime(iso: string | null): string {
  if (!iso) return "belum pernah";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "belum pernah";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return d.toLocaleDateString();
}

// User-facing "Sync Sekarang" bar: shows live status + last synced time and
// lets a read-only user pull the latest data from the online DB on demand.
export function SyncBar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data } = useQuery<SyncStatusInfo>({
    queryKey: ["sync-status"],
    queryFn: apiSyncStatus,
    refetchInterval: 8000,
  });

  const pullMut = useMutation({
    mutationFn: apiSyncPullNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });

  const status = data?.status ?? "synced";
  const meta = STATUS_META[status];
  const color = (colors as Record<string, string>)[meta.colorKey];
  const Icon =
    status === "synced" ? CheckCircle : status === "offline" ? CloudSlash : status === "conflict" || status === "sync_failed" ? Warning : ArrowsClockwise;

  return (
    <View style={styles.bar} testID="sync-bar">
      <View style={styles.left}>
        <Icon size={18} color={color} weight="fill" />
        <View style={styles.texts}>
          <Text style={[styles.status, { color }]}>{meta.label}</Text>
          <Text style={styles.sub}>Terakhir: {relTime(data?.last_pull_at ?? null)}</Text>
        </View>
      </View>
      <Pressable
        style={[styles.btn, pullMut.isPending && styles.btnBusy]}
        onPress={() => pullMut.mutate()}
        disabled={pullMut.isPending}
        testID="sync-now-button"
      >
        {pullMut.isPending ? (
          <ActivityIndicator size="small" color={colors.onBrandPrimary} />
        ) : (
          <>
            <ArrowsClockwise size={16} color={colors.onBrandPrimary} weight="bold" />
            <Text style={styles.btnText}>Sync Sekarang</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  texts: { flexShrink: 1 },
  status: { fontSize: 14, fontWeight: "800" },
  sub: { color: colors.muted, fontSize: 12 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brandPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 40,
    minWidth: 44,
    justifyContent: "center",
  },
  btnBusy: { opacity: 0.7 },
  btnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: "800" },
}));
