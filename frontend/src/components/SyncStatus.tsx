import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, StyleProp, Text, View, ViewStyle } from "react-native";
import { ArrowsClockwise, CheckCircle, CloudSlash, Warning, WarningOctagon } from "phosphor-react-native";

import { apiSyncStatus, SyncStatusInfo } from "@/src/api/client";
import { makeStyles, useTheme } from "@/src/theme";

const META: Record<
  SyncStatusInfo["status"],
  { label: string; colorKey: "success" | "info" | "error" | "warning" | "muted" }
> = {
  synced: { label: "Synced", colorKey: "success" },
  syncing: { label: "Syncing", colorKey: "info" },
  sync_failed: { label: "Sync Failed", colorKey: "error" },
  conflict: { label: "Conflict", colorKey: "warning" },
  offline: { label: "Offline", colorKey: "muted" },
};

// Compact live sync badge. Polls /api/sync/status so the UI reflects the
// background sync/pull without any page reload.
export function SyncStatus({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { colors } = useTheme();

  const { data } = useQuery<SyncStatusInfo>({
    queryKey: ["sync-status"],
    queryFn: apiSyncStatus,
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });

  const status = data?.status ?? "synced";
  const meta = META[status];
  const color = (colors as any)[meta.colorKey] as string;

  const Icon =
    status === "syncing"
      ? ArrowsClockwise
      : status === "synced"
        ? CheckCircle
        : status === "offline"
          ? CloudSlash
          : status === "conflict"
            ? Warning
            : WarningOctagon;

  const extra =
    status === "syncing" && data?.pending
      ? ` (${data.pending})`
      : status === "conflict" && data?.conflicts
        ? ` (${data.conflicts})`
        : status === "sync_failed" && data?.failed
          ? ` (${data.failed})`
          : "";

  return (
    <View style={[styles.pill, { borderColor: color }, style]} testID={`sync-status-${status}`}>
      {status === "syncing" ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon size={14} color={color} weight="fill" />
      )}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {meta.label}
        {extra}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 12, fontWeight: "800" },
}));
