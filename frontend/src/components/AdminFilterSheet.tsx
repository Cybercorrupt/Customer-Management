import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { apiFilterOptions, Customer } from "@/src/api/client";
import { STATUSES } from "@/src/constants/customer";
import { regionOptions } from "@/src/utils/region";
import { makeStyles, useTheme } from "@/src/theme";

export type CustomerFilters = {
  status: string;
  segment: string;
  size: string;
  area: string;
  province: string;
  city: string;
  district: string;
  village: string;
};

export const EMPTY_FILTERS: CustomerFilters = {
  status: "All",
  segment: "All",
  size: "All",
  area: "All",
  province: "All",
  city: "All",
  district: "All",
  village: "All",
};

export function AdminFilterSheet({
  visible,
  value,
  customers,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: CustomerFilters;
  customers: Customer[];
  onApply: (f: CustomerFilters) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [temp, setTemp] = useState<CustomerFilters>(value);

  // Live filter values from the database (master data + distinct customer
  // values), so Admin filters always match the latest master data.
  const { data: opts } = useQuery({
    queryKey: ["filter-options"],
    queryFn: apiFilterOptions,
  });

  // Cascading region options derived live from the customer dataset.
  const region = useMemo(
    () =>
      regionOptions(
        customers,
        { province: temp.province, city: temp.city, district: temp.district },
        { province: "All", city: "All", district: "All" },
      ),
    [customers, temp.province, temp.city, temp.district],
  );

  const GROUPS = useMemo(
    () => [
      { key: "status" as const, label: "Status", options: ["All", ...STATUSES] },
      { key: "segment" as const, label: "Segment", options: ["All", ...(opts?.segment ?? [])] },
      { key: "size" as const, label: "Purchasing Size", options: ["All", ...(opts?.purchasing_size ?? [])] },
      { key: "area" as const, label: "Area", options: ["All", ...(opts?.area ?? [])] },
      { key: "province" as const, label: "Provinsi", options: ["All", ...region.provinces] },
      { key: "city" as const, label: "Kota/Kabupaten", options: ["All", ...region.cities] },
      { key: "district" as const, label: "Kecamatan", options: ["All", ...region.districts] },
      { key: "village" as const, label: "Kelurahan/Desa", options: ["All", ...region.villages] },
    ],
    [opts, region],
  );

  useEffect(() => {
    if (visible) setTemp(value);
  }, [visible, value]);

  // Selecting a parent region resets its descendants so the cascade stays valid.
  const pick = (key: keyof CustomerFilters, opt: string) =>
    setTemp((t) => {
      const n = { ...t, [key]: opt };
      if (key === "province") {
        n.city = "All";
        n.district = "All";
        n.village = "All";
      } else if (key === "city") {
        n.district = "All";
        n.village = "All";
      } else if (key === "district") {
        n.village = "All";
      }
      return n;
    });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} testID="admin-filter-overlay">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Filter Customer</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {GROUPS.map((g) => (
              <View key={g.key} style={styles.group}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                <View style={styles.chips}>
                  {g.options.map((opt) => {
                    const active = temp[g.key] === opt;
                    return (
                      <Pressable
                        key={opt}
                        testID={`filter-${g.key}-${opt}`}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => pick(g.key, opt)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.resetBtn]}
              onPress={() => setTemp(EMPTY_FILTERS)}
              testID="filter-reset"
            >
              <Text style={[styles.btnText, { color: colors.brandPrimary }]}>Reset</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.applyBtn]}
              onPress={() => {
                onApply(temp);
                onClose();
              }}
              testID="filter-apply"
            >
              <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>Apply</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: { flex: 1, backgroundColor: "rgba(17,24,39,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    maxHeight: "85%",
  },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  scroll: { flexGrow: 0 },
  group: { marginBottom: 16 },
  groupLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.brandPrimary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 12, marginTop: 4 },
  btn: { flex: 1, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  resetBtn: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  applyBtn: { backgroundColor: colors.brandPrimary },
  btnText: { fontSize: 15, fontWeight: "700" },
}));
