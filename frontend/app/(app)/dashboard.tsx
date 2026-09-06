import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CaretDown,
  CaretRight,
  CurrencyDollar,
  MagnifyingGlass,
  SlidersHorizontal,
  Users,
  Warning,
} from "phosphor-react-native";

import { apiDashboard, DashboardStats } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { DonutCard } from "@/src/components/DonutCard";
import { ErrorView, LoadingView } from "@/src/components/StateViews";
import { SyncBar } from "@/src/components/SyncBar";
import { useSettings } from "@/src/settings/SettingsContext";
import { makeStyles, useTheme } from "@/src/theme";

export default function DashboardScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { t, formatCurrency } = useSettings();
  const [showBadDebt, setShowBadDebt] = useState(true);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<DashboardStats>({
    queryKey: ["dashboard"],
    queryFn: apiDashboard,
  });

  if (isLoading) return <LoadingView label="Memuat dashboard..." />;
  if (isError || !data)
    return (
      <ErrorView
        title="Gagal memuat dashboard"
        subtitle="Tidak dapat mengambil data statistik."
        onRetry={refetch}
      />
    );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />
      }
      testID="dashboard-scroll"
    >
      {/* Greeting */}
      <View style={styles.greetWrap}>
        <Text style={styles.greetTitle}>{t("dashboard.greeting")}, {user?.name ?? "User"} 👋</Text>
        <Text style={styles.greetSub}>{t("dashboard.subtitle")}</Text>
      </View>

      {/* Manual sync + last synced time */}
      <SyncBar />

      {/* Search (navigates to customers) */}
      <Pressable
        style={styles.searchBox}
        onPress={() => router.push("/search")}
        testID="dashboard-search"
      >
        <MagnifyingGlass size={20} color={colors.muted} />
        <Text style={styles.searchPlaceholder}>{t("dashboard.search")}</Text>
        <SlidersHorizontal size={20} color={colors.brandPrimary} />
      </Pressable>

      {/* KPI stacked column */}
      <View style={styles.kpiCol}>
        {/* KPI 1 - Status Customer */}
        <View style={styles.kpiCard} testID="kpi-status-customer">
          <View style={styles.kpiHead}>
            <View style={[styles.kpiIcon, { backgroundColor: colors.brandTertiary }]}>
              <Users size={18} color={colors.brandPrimary} weight="fill" />
            </View>
            <Text style={styles.kpiTitle}>{t("dashboard.statusCustomer")}</Text>
          </View>
          <Text style={styles.kpiBig}>{data.total_customer}</Text>
          <Text style={styles.kpiCaption}>{t("dashboard.totalCustomer")}</Text>
          <View style={styles.divider} />
          <View style={styles.kpiSplit}>
            <View style={styles.kpiSplitItem}>
              <Text style={[styles.kpiSplitValue, { color: colors.success }]}>
                {data.active_customer}
              </Text>
              <Text style={styles.kpiSplitLabel}>{t("dashboard.active")}</Text>
            </View>
            <View style={styles.kpiVDivider} />
            <View style={styles.kpiSplitItem}>
              <Text style={[styles.kpiSplitValue, { color: colors.info }]}>
                {data.inactive_customer}
              </Text>
              <Text style={styles.kpiSplitLabel}>{t("dashboard.inactive")}</Text>
            </View>
          </View>
        </View>

        {/* KPI 2 - Status Bad Debt (below, with show/hide) */}
        <View style={[styles.kpiCard, styles.badDebtCard]} testID="kpi-bad-debt">
          <Pressable
            style={styles.kpiHead}
            onPress={() => setShowBadDebt((v) => !v)}
            hitSlop={8}
            testID="toggle-bad-debt"
          >
            <View style={[styles.kpiIcon, { backgroundColor: "#FEF2F2" }]}>
              <Warning size={18} color={colors.error} weight="fill" />
            </View>
            <Text style={[styles.kpiTitle, styles.kpiTitleGrow]}>{t("dashboard.badDebt")}</Text>
            {showBadDebt ? (
              <CaretDown size={18} color={colors.muted} weight="bold" />
            ) : (
              <CaretRight size={18} color={colors.muted} weight="bold" />
            )}
          </Pressable>
          {showBadDebt ? (
            <View style={styles.badDebtBody}>
              <View style={styles.badDebtCol}>
                <Text style={[styles.kpiBig, { color: colors.error }]}>{data.bad_debt_customer}</Text>
                <Text style={styles.kpiCaption}>{t("dashboard.customer")}</Text>
              </View>
              <View style={styles.kpiVDivider} />
              <View style={styles.badDebtCol}>
                <View style={styles.nominalWrap}>
                  <CurrencyDollar size={18} color={colors.brandSecondary} weight="fill" />
                  <Text style={styles.nominalValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(data.total_bad_debt_nominal)}
                  </Text>
                </View>
                <Text style={styles.kpiCaptionCenter}>{t("dashboard.totalNominal")}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {/* Charts */}
      <DonutCard
        title={t("chart.customerStatus")}
        slices={data.by_status}
        useStatusColors
        testID="chart-customer-status"
      />
      <DonutCard
        title={t("chart.bySegment")}
        slices={data.by_segment}
        testID="chart-by-segment"
      />
      <DonutCard
        title={t("chart.purchasingSize")}
        slices={data.by_purchasing_size}
        testID="chart-purchasing-size"
      />
      <DonutCard title={t("chart.byArea")} slices={data.by_area} testID="chart-by-area" />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  greetWrap: {
    gap: 2,
  },
  greetTitle: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "800",
  },
  greetSub: {
    color: colors.muted,
    fontSize: 14,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 48,
  },
  searchPlaceholder: {
    flex: 1,
    color: colors.muted,
    fontSize: 15,
  },
  kpiCol: {
    gap: 12,
  },
  kpiCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  badDebtCard: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FDE4C8",
  },
  kpiHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  kpiIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiTitle: {
    color: colors.onSurface,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  kpiTitleGrow: {
    flex: 1,
  },
  eyeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  badDebtBody: {
    flexDirection: "row",
    alignItems: "center",
  },
  badDebtCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  hiddenWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 4,
  },
  hiddenDots: {
    color: colors.error,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 2,
  },
  kpiBig: {
    color: colors.brandPrimary,
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  kpiCaption: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
  },
  kpiCaptionCenter: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 12,
  },
  kpiSplit: {
    flexDirection: "row",
    alignItems: "center",
  },
  kpiSplitItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  kpiVDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.divider,
  },
  kpiSplitValue: {
    fontSize: 20,
    fontWeight: "800",
  },
  kpiSplitLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  nominalWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  nominalValue: {
    color: colors.brandSecondary,
    fontSize: 17,
    fontWeight: "800",
    flexShrink: 1,
  },
}));
