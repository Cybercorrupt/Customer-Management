import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Buildings,
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  MapPin,
  SlidersHorizontal,
  X,
} from "phosphor-react-native";

import { apiCustomers, apiFilterOptions, Customer, FilterOptions } from "@/src/api/client";
import { FilterModal } from "@/src/components/FilterModal";
import { StatusBadge } from "@/src/components/StatusBadge";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { makeStyles, useTheme } from "@/src/theme";

// Status is a fixed enum; the rest are sourced live from the database.
const STATUS_OPTS = ["All Status", "Active", "Inactive", "Bad Debt"];
const ALL_SEGMENT = "All Segment";
const ALL_SIZE = "All Size";
const ALL_AREA = "All Area";

type FilterKey = "status" | "segment" | "size" | "area";

export default function CustomersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  const [statusF, setStatusF] = useState(STATUS_OPTS[0]);
  const [segmentF, setSegmentF] = useState(ALL_SEGMENT);
  const [sizeF, setSizeF] = useState(ALL_SIZE);
  const [areaF, setAreaF] = useState(ALL_AREA);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery<Customer[]>({
    queryKey: ["customers", debounced],
    queryFn: () => apiCustomers(debounced || undefined),
  });

  // Filter values pulled live from the DB (master data + distinct customer
  // values) so filters always stay in sync with the database.
  const { data: filterOpts } = useQuery<FilterOptions>({
    queryKey: ["filter-options"],
    queryFn: apiFilterOptions,
  });

  const SEGMENT_OPTS = useMemo(() => [ALL_SEGMENT, ...(filterOpts?.segment ?? [])], [filterOpts]);
  const SIZE_OPTS = useMemo(() => [ALL_SIZE, ...(filterOpts?.purchasing_size ?? [])], [filterOpts]);
  const AREA_OPTS = useMemo(() => [ALL_AREA, ...(filterOpts?.area ?? [])], [filterOpts]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((c) => {
      if (statusF !== STATUS_OPTS[0] && c.status !== statusF) return false;
      if (segmentF !== ALL_SEGMENT && c.segment !== segmentF) return false;
      if (sizeF !== ALL_SIZE && c.purchasing_size !== sizeF) return false;
      if (areaF !== ALL_AREA && c.area !== areaF) return false;
      return true;
    });
  }, [data, statusF, segmentF, sizeF, areaF]);

  const chips: { key: FilterKey; value: string; def: string }[] = [
    { key: "status", value: statusF, def: STATUS_OPTS[0] },
    { key: "segment", value: segmentF, def: ALL_SEGMENT },
    { key: "size", value: sizeF, def: ALL_SIZE },
    { key: "area", value: areaF, def: ALL_AREA },
  ];

  const modalConfig: Record<
    FilterKey,
    { title: string; options: string[]; selected: string; onSelect: (v: string) => void }
  > = {
    status: { title: "Status", options: STATUS_OPTS, selected: statusF, onSelect: setStatusF },
    segment: { title: "Segment", options: SEGMENT_OPTS, selected: segmentF, onSelect: setSegmentF },
    size: { title: "Purchasing Size", options: SIZE_OPTS, selected: sizeF, onSelect: setSizeF },
    area: { title: "Area", options: AREA_OPTS, selected: areaF, onSelect: setAreaF },
  };

  const renderItem = ({ item }: { item: Customer }) => (
    <Pressable
      testID={`customer-card-${item.id}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/customer/${item.id}`)}
    >
      <View style={styles.avatar}>
        <Buildings size={22} color={colors.brandPrimary} weight="fill" />
      </View>
      <View style={styles.cardMain}>
        <Text style={styles.name} numberOfLines={1}>
          {item.customer_name}
        </Text>
        <Text style={styles.code}>{item.customer_code}</Text>
        <Text style={styles.metaLine}>
          {item.segment} • {item.purchasing_size}
        </Text>
        <View style={styles.pinRow}>
          <MapPin size={14} color={colors.muted} />
          <Text style={styles.metaText}>{item.area}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <StatusBadge status={item.status} />
        <CaretRight size={20} color={colors.muted} />
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topWrap}>
        <View style={styles.searchBox}>
          <MagnifyingGlass size={20} color={colors.muted} />
          <TextInput
            testID="customer-search-input"
            style={styles.searchInput}
            placeholder="Search customer..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} testID="clear-search" hitSlop={8}>
              <X size={18} color={colors.muted} />
            </Pressable>
          ) : (
            <SlidersHorizontal size={20} color={colors.brandPrimary} />
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((c) => {
            const active = c.value !== c.def;
            return (
              <Pressable
                key={c.key}
                testID={`filter-chip-${c.key}`}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setOpenFilter(c.key)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.value}</Text>
                <CaretDown size={14} color={active ? colors.brandPrimary : colors.onSurfaceTertiary} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView label="Memuat customer..." />
      ) : isError ? (
        <ErrorView
          title="Network Error"
          subtitle="Tidak dapat memuat daftar customer."
          onRetry={refetch}
        />
      ) : filtered.length === 0 ? (
        <EmptyView
          title="Customer tidak ditemukan"
          subtitle={
            debounced || chips.some((c) => c.value !== c.def)
              ? "Tidak ada hasil untuk pencarian/filter ini."
              : "Belum ada data customer."
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          testID="customers-list"
        />
      )}

      {openFilter ? (
        <FilterModal
          visible
          title={modalConfig[openFilter].title}
          options={modalConfig[openFilter].options}
          selected={modalConfig[openFilter].selected}
          onSelect={modalConfig[openFilter].onSelect}
          onClose={() => setOpenFilter(null)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  topWrap: {
    paddingTop: 16,
    paddingBottom: 4,
    backgroundColor: colors.surface,
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
    marginHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    height: "100%",
  },
  chipRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  chipActive: {
    borderColor: colors.brandPrimary,
    backgroundColor: colors.brandTertiary,
  },
  chipText: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.brandPrimary,
    fontWeight: "700",
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    gap: 12,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardPressed: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMain: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
  },
  code: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  metaLine: {
    color: colors.onSurfaceTertiary,
    fontSize: 13,
    marginTop: 1,
  },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    color: colors.muted,
    fontSize: 13,
  },
  cardRight: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "stretch",
    gap: 8,
  },
}));
