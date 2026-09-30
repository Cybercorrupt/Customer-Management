import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowCounterClockwise, CheckCircle, CircleIcon as Circle, Trash, TrashSimple } from "phosphor-react-native";

import {
  ApiError,
  TrashEntity,
  TrashItem,
  apiTrashEmpty,
  apiTrashList,
  apiTrashPurge,
  apiTrashRestore,
} from "@/src/api/client";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

const TABS: { key: TrashEntity; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "purchasing_size", label: "Purchasing Size" },
  { key: "segment", label: "Segment" },
  { key: "area", label: "Area" },
  { key: "top", label: "TOP" },
];

export default function TrashScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [active, setActive] = useState<TrashEntity>("customer");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastData>(null);
  const [confirm, setConfirm] = useState<null | { kind: "purge" | "empty"; ids?: string[] }>(null);

  const flash = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  };

  const { data, isLoading, isError, refetch } = useQuery<TrashItem[]>({
    queryKey: ["trash", active],
    queryFn: () => apiTrashList(active),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["trash", active] });
    queryClient.invalidateQueries({ queryKey: ["trash-counts"] });
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["master"] });
  };

  const clearSel = () => setSelected(new Set());

  const restoreMut = useMutation({
    mutationFn: (ids: string[]) => apiTrashRestore(active, ids),
    onSuccess: (r) => {
      invalidateAll();
      clearSel();
      flash(`${r.restored} item dipulihkan.`, true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal memulihkan.", false),
  });

  const purgeMut = useMutation({
    mutationFn: (ids: string[]) => apiTrashPurge(active, ids),
    onSuccess: (r) => {
      invalidateAll();
      clearSel();
      setConfirm(null);
      flash(`${r.purged} item dihapus permanen.`, true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal menghapus.", false),
  });

  const emptyMut = useMutation({
    mutationFn: () => apiTrashEmpty(active),
    onSuccess: (r) => {
      invalidateAll();
      clearSel();
      setConfirm(null);
      flash(`Trash dikosongkan (${r.purged} item).`, true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal mengosongkan.", false),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = [...selected];
  const hasItems = (data?.length ?? 0) > 0;

  const renderItem = ({ item }: { item: TrashItem }) => {
    const on = selected.has(item.id);
    return (
      <Pressable style={styles.row} onPress={() => toggle(item.id)} testID={`trash-row-${item.id}`}>
        {on ? (
          <CheckCircle size={24} color={colors.brandPrimary} weight="fill" />
        ) : (
          <Circle size={24} color={colors.muted} />
        )}
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title || "(tanpa nama)"}</Text>
          {item.subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {TABS.map((t) => {
            const sel = t.key === active;
            return (
              <Pressable
                key={t.key}
                testID={`trash-tab-${t.key}`}
                onPress={() => {
                  setActive(t.key);
                  clearSel();
                }}
                style={[styles.chip, sel && styles.chipOn]}
              >
                <Text style={[styles.chipText, sel && styles.chipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <LoadingView label="Memuat Trash..." />
      ) : isError ? (
        <ErrorView title="Tidak dapat memuat" subtitle="Coba lagi." onRetry={refetch} />
      ) : !hasItems ? (
        <EmptyView title="Trash kosong" subtitle="Data yang dihapus akan muncul di sini." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + (selectedIds.length ? 96 : 88) }]}
          showsVerticalScrollIndicator={false}
          testID="trash-list"
          ListHeaderComponent={
            <Pressable
              style={styles.emptyTrashBtn}
              onPress={() => setConfirm({ kind: "empty" })}
              testID="empty-trash-button"
            >
              <Trash size={18} color={colors.error} weight="bold" />
              <Text style={styles.emptyTrashText}>Kosongkan Trash ({data?.length ?? 0})</Text>
            </Pressable>
          }
        />
      )}

      {/* Selection action bar */}
      {selectedIds.length > 0 ? (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]} testID="trash-action-bar">
          <Text style={styles.selCount}>{selectedIds.length} dipilih</Text>
          <View style={styles.actionBtns}>
            <Pressable
              style={styles.restoreBtn}
              onPress={() => restoreMut.mutate(selectedIds)}
              disabled={restoreMut.isPending}
              testID="restore-selected"
            >
              {restoreMut.isPending ? (
                <ActivityIndicator color={colors.onBrandPrimary} size="small" />
              ) : (
                <>
                  <ArrowCounterClockwise size={18} color={colors.onBrandPrimary} weight="bold" />
                  <Text style={styles.restoreText}>Pulihkan</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={styles.purgeBtn}
              onPress={() => setConfirm({ kind: "purge", ids: selectedIds })}
              testID="purge-selected"
            >
              <TrashSimple size={18} color={colors.onError} weight="bold" />
              <Text style={styles.purgeText}>Hapus Permanen</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Confirm destructive */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog} testID="trash-confirm-modal">
            <Text style={styles.dialogTitle}>
              {confirm?.kind === "empty" ? "Kosongkan Trash?" : "Hapus Permanen?"}
            </Text>
            <Text style={styles.dialogText}>
              {confirm?.kind === "empty"
                ? "Semua item di Trash tab ini akan dihapus permanen dan tidak bisa dikembalikan."
                : `${confirm?.ids?.length ?? 0} item akan dihapus permanen dan tidak bisa dikembalikan.`}
            </Text>
            <View style={styles.dialogRow}>
              <Pressable style={styles.cancelBtn} onPress={() => setConfirm(null)} testID="trash-confirm-cancel">
                <Text style={styles.cancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={styles.dangerBtn}
                disabled={purgeMut.isPending || emptyMut.isPending}
                onPress={() => (confirm?.kind === "empty" ? emptyMut.mutate() : purgeMut.mutate(confirm?.ids ?? []))}
                testID="trash-confirm-ok"
              >
                {purgeMut.isPending || emptyMut.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={styles.dangerText}>Hapus</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Toast toast={toast} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    height: 56,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipRow: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip: {
    flexShrink: 0,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "700" },
  chipTextOn: { color: colors.onBrandPrimary },
  list: { padding: 16, paddingTop: 12, gap: 8 },
  emptyTrashBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: 8,
  },
  emptyTrashText: { color: colors.error, fontSize: 14, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: 13 },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  selCount: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  actionBtns: { flexDirection: "row", gap: 12 },
  restoreBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
  },
  restoreText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  purgeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.error,
  },
  purgeText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", paddingHorizontal: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 8 },
  dialogTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  dialogText: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  dialogRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  dangerBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
}));
