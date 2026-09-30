import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretRight, Database, Users, Warning } from "phosphor-react-native";

import { AdminStats, apiAdminStats } from "@/src/api/client";
import { ErrorView, LoadingView } from "@/src/components/StateViews";
import { makeStyles, useTheme } from "@/src/theme";

export default function AdminDashboardScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: apiAdminStats,
  });

  if (isLoading) return <LoadingView label="Memuat dashboard..." />;
  if (isError || !data)
    return <ErrorView title="Gagal memuat data" subtitle="Tidak dapat mengambil ringkasan." onRetry={refetch} />;

  const summary = [
    { label: "Total Customer", value: data.total_customer, color: colors.brandPrimary },
    { label: "Active", value: data.active_customer, color: colors.success },
    { label: "Inactive", value: data.inactive_customer, color: colors.info },
    { label: "Bad Debt", value: data.bad_debt_customer, color: colors.error },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />
      }
      testID="admin-dashboard-scroll"
    >
      <Text style={styles.heading}>Data Summary</Text>

      <View style={styles.grid}>
        {summary.map((s) => (
          <View key={s.label} style={styles.summaryCard} testID={`summary-${s.label}`}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Management</Text>

      <Pressable
        style={styles.actionCard}
        onPress={() => router.push("/admin/customers")}
        testID="action-customer-data"
      >
        <View style={styles.actionIcon}>
          <Database size={24} color={colors.brandPrimary} weight="fill" />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.actionTitle}>Customer Data</Text>
          <Text style={styles.actionSub}>Kelola data customer (add, edit, delete)</Text>
        </View>
        <CaretRight size={22} color={colors.muted} />
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 16, gap: 12 },
  heading: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  summaryCard: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  summaryValue: { fontSize: 30, fontWeight: "800" },
  summaryLabel: { color: colors.muted, fontSize: 13 },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { flex: 1 },
  actionTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  actionSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
}));
