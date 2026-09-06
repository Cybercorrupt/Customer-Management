import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowsClockwise,
  Buildings,
  CheckSquare,
  FunnelSimple,
  MagnifyingGlass,
  MapPin,
  Plus,
  Square,
  Trash,
  X,
} from "phosphor-react-native";

import { apiBulkDelete, apiBulkStatus, apiCustomers, Customer } from "@/src/api/client";
import { AdminFilterSheet, CustomerFilters, EMPTY_FILTERS } from "@/src/components/AdminFilterSheet";
import { StatusBadge, statusColor } from "@/src/components/StatusBadge";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { STATUSES } from "@/src/constants/customer";
import { makeStyles, useTheme } from "@/src/theme";

export default function AdminCustomersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<CustomerFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [toast, setToast] = useState<ToastData>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusSheet, setStatusSheet] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery<Customer[]>({
    queryKey: ["customers", debounced],
    queryFn: () => apiCustomers(debounced || undefined),
  });

  const activeCount = Object.values(filters).filter((v) => v !== "All").length;

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((c) => {
      if (filters.status !== "All" && c.status !== filters.status) return false;
      if (filters.segment !== "All" && c.segment !== filters.segment) return false;
      if (filters.size !== "All" && c.purchasing_size !== filters.size) return false;
      if (filters.area !== "All" && c.area !== filters.area) return false;
      return true;
    });
  }, [data, filters]);

  const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const ids = Array.from(selected);

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleId = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))));
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => apiBulkDelete(ids),
    onSuccess: (r) => {
      setConfirmDelete(false);
      exitSelect();
      invalidateAll();
      setToast({ msg: `${r.deleted} customer dihapus.`, ok: true });
    },
    onError: () => {
      setConfirmDelete(false);
      setToast({ msg: "Gagal menghapus. Coba lagi.", ok: false });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: "Active" | "Inactive" | "Bad Debt") => apiBulkStatus(ids, status),
    onSuccess: (r) => {
      setStatusSheet(false);
      exitSelect();
      invalidateAll();
      setToast({ msg: `${r.updated} customer diperbarui.`, ok: true });
    },
    onError: () => {
      setStatusSheet(false);
      setToast({ msg: "Gagal mengubah status. Coba lagi.", ok: false });
    },
  });

  const onCardPress = (item: Customer) => {
    if (selectMode) toggleId(item.id);
    else router.push(`/admin-customer-form?id=${item.id}`);
  };

  const renderItem = ({ item }: { item: Customer }) => {
    const isSel = selected.has(item.id);
    return (
      <Pressable
        testID={`admin-customer-${item.id}`}
        style={({ pressed }) => [styles.card, isSel && styles.cardSelected, pressed && styles.cardPressed]}
        onPress={() => onCardPress(item)}
      >
        {selectMode ? (
          isSel ? (
            <CheckSquare size={26} color={colors.brandPrimary} weight="fill" />
          ) : (
            <Square size={26} color={colors.muted} />
          )
        ) : (
          <View style={styles.avatar}>
            <Buildings size={22} color={colors.brandPrimary} weight="fill" />
          </View>
        )}
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
        <StatusBadge status={item.status} />
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topWrap}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <MagnifyingGlass size={20} color={colors.muted} />
            <TextInput
              testID="admin-search-input"
              style={styles.searchInput}
              placeholder="Search name, code, address..."
              placeholderTextColor={colors.muted}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch("")} testID="admin-clear-search" hitSlop={8}>
                <X size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            style={[styles.filterBtn, activeCount > 0 && styles.filterBtnActive]}
            onPress={() => setFilterOpen(true)}
            testID="admin-filter-button"
          >
            <FunnelSimple
              size={22}
              color={activeCount > 0 ? colors.onBrandPrimary : colors.brandPrimary}
              weight={activeCount > 0 ? "fill" : "regular"}
            />
            {activeCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {selectMode ? (
          <View style={styles.selectBar}>
            <Pressable style={styles.selectBarBtn} onPress={toggleAll} testID="select-all-button">
              {allSelected ? (
                <CheckSquare size={22} color={colors.brandPrimary} weight="fill" />
              ) : (
                <Square size={22} color={colors.muted} />
              )}
              <Text style={styles.selectBarText}>{selected.size} dipilih</Text>
            </Pressable>
            <Pressable style={styles.toolBtn} onPress={exitSelect} testID="cancel-select-button">
              <X size={18} color={colors.brandPrimary} weight="bold" />
              <Text style={styles.toolText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.toolbar}>
            <Pressable
              style={styles.toolBtn}
              onPress={() => {
                setSelected(new Set());
                setSelectMode(true);
              }}
              testID="select-mode-button"
            >
              <CheckSquare size={18} color={colors.brandPrimary} weight="bold" />
              <Text style={styles.toolText}>Select</Text>
            </Pressable>
          </View>
        )}
      </View>

      {isLoading ? (
        <LoadingView label="Memuat customer..." />
      ) : isError ? (
        <ErrorView title="Network Error" subtitle="Tidak dapat memuat data." onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <EmptyView
          title="Customer tidak ditemukan"
          subtitle={debounced || activeCount > 0 ? "Coba ubah pencarian atau filter." : "Belum ada data customer."}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          showsVerticalScrollIndicator={false}
          testID="admin-customers-list"
        />
      )}

      {!selectMode ? (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => router.push("/admin-customer-form")}
          testID="add-customer-button"
        >
          <Plus size={20} color={colors.onBrandPrimary} weight="bold" />
          <Text style={styles.fabText}>Add Customer</Text>
        </Pressable>
      ) : null}

      {selectMode && selected.size > 0 ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]} testID="bulk-action-bar">
          <Pressable style={styles.actionBtn} onPress={() => setStatusSheet(true)} testID="bulk-status-button">
            <ArrowsClockwise size={20} color={colors.brandPrimary} weight="bold" />
            <Text style={styles.actionText}>Ubah Status</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionBtnDanger]}
            onPress={() => setConfirmDelete(true)}
            testID="bulk-delete-button"
          >
            <Trash size={20} color={colors.error} weight="bold" />
            <Text style={[styles.actionText, { color: colors.error }]}>Hapus</Text>
          </Pressable>
        </View>
      ) : null}

      <AdminFilterSheet
        visible={filterOpen}
        value={filters}
        onApply={setFilters}
        onClose={() => setFilterOpen(false)}
      />

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <Pressable style={styles.backdrop} onPress={() => !deleteMutation.isPending && setConfirmDelete(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <View style={styles.dialogIcon}>
              <Trash size={26} color={colors.error} weight="fill" />
            </View>
            <Text style={styles.dialogTitle}>Hapus {selected.size} customer?</Text>
            <Text style={styles.dialogText}>
              Data akan dihapus dari daftar. Tindakan ini tidak dapat dibatalkan dari aplikasi.
            </Text>
            <View style={styles.dialogActions}>
              <Pressable style={styles.dialogCancel} onPress={() => setConfirmDelete(false)} testID="confirm-delete-cancel">
                <Text style={styles.dialogCancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={styles.dialogDanger}
                onPress={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                testID="confirm-delete-ok"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={styles.dialogDangerText}>Hapus</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={statusSheet} transparent animationType="slide" onRequestClose={() => setStatusSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => !statusMutation.isPending && setStatusSheet(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Ubah status {selected.size} customer</Text>
            {STATUSES.map((s) => {
              const c = statusColor(s, colors);
              return (
                <Pressable
                  key={s}
                  style={styles.statusOption}
                  onPress={() => statusMutation.mutate(s as "Active" | "Inactive" | "Bad Debt")}
                  disabled={statusMutation.isPending}
                  testID={`bulk-status-option-${s}`}
                >
                  <View style={[styles.statusDot, { backgroundColor: c }]} />
                  <Text style={styles.statusOptionText}>{s}</Text>
                  {statusMutation.isPending ? <ActivityIndicator color={colors.muted} /> : null}
                </Pressable>
              );
            })}
            <Pressable style={styles.sheetCancel} onPress={() => setStatusSheet(false)} testID="bulk-status-cancel">
              <Text style={styles.sheetCancelText}>Batal</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Toast toast={toast} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  searchRow: { flexDirection: "row", gap: 10 },
  searchBox: {
    flex: 1,
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
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 15, height: "100%" },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.onBrandSecondary, fontSize: 11, fontWeight: "800" },
  listContent: { padding: 16, paddingTop: 8, gap: 12 },
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
  cardMain: { flex: 1, gap: 3 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  code: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  metaLine: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 1 },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.muted, fontSize: 13 },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  toolbar: { flexDirection: "row", gap: 10, marginTop: 10 },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surfaceSecondary,
    alignSelf: "flex-start",
  },
  toolText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
  },
  selectBarBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectBarText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  cardSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surface,
  },
  actionBtnDanger: { borderColor: colors.error },
  actionText: { color: colors.brandPrimary, fontSize: 15, fontWeight: "800" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 10,
  },
  dialogIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: `${colors.error}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800", textAlign: "center" },
  dialogText: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  dialogActions: { flexDirection: "row", gap: 12, marginTop: 8, width: "100%" },
  dialogCancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogCancelText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  dialogDanger: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogDangerText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 4,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 10,
  },
  sheetTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusOptionText: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  sheetCancel: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  sheetCancelText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
}));
