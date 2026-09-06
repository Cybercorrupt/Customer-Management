import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, CircleIcon as Circle, PencilSimple, Plus, Tag, TrashSimple, X } from "phosphor-react-native";

import {
  ApiError,
  MasterItem,
  MasterType,
  apiMasterBulkDelete,
  apiMasterCreate,
  apiMasterDelete,
  apiMasterList,
  apiMasterUpdate,
} from "@/src/api/client";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

const TABS: { key: MasterType; label: string }[] = [
  { key: "purchasing_size", label: "Purchasing Size" },
  { key: "segment", label: "Segment" },
  { key: "area", label: "Area" },
  { key: "top", label: "TOP" },
];

export default function MasterDataScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [active, setActive] = useState<MasterType>("purchasing_size");
  const [toast, setToast] = useState<ToastData>(null);
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<MasterItem | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  const flash = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2600);
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data, isLoading, isError, refetch } = useQuery<MasterItem[]>({
    queryKey: ["master", active],
    queryFn: () => apiMasterList(active),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["master", active] });
    queryClient.invalidateQueries({ queryKey: ["trash-counts"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() };
      return editing ? apiMasterUpdate(active, editing.id, body) : apiMasterCreate(active, body);
    },
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      flash(editing ? "Perubahan disimpan." : "Data ditambahkan.", true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal menyimpan.", false),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: MasterItem) => apiMasterDelete(active, item.id),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
      flash("Data dipindah ke Trash.", true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal menghapus.", false),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => apiMasterBulkDelete(active, ids),
    onSuccess: (r) => {
      invalidate();
      setConfirmBulk(false);
      exitSelect();
      flash(`${r.deleted} item dipindah ke Trash.`, true);
    },
    onError: (e) => flash(e instanceof ApiError ? e.message : "Gagal menghapus.", false),
  });

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setFormOpen(true);
  };

  const openEdit = (item: MasterItem) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description);
    setFormOpen(true);
  };

  const activeLabel = TABS.find((t) => t.key === active)?.label ?? "";

  const renderItem = ({ item }: { item: MasterItem }) => {
    const on = selected.has(item.id);
    return (
      <Pressable
        style={styles.card}
        testID={`master-row-${item.id}`}
        onPress={() => selectMode && toggleSel(item.id)}
        onLongPress={() => {
          setSelectMode(true);
          toggleSel(item.id);
        }}
      >
        {selectMode ? (
          on ? (
            <CheckCircle size={24} color={colors.brandPrimary} weight="fill" />
          ) : (
            <Circle size={24} color={colors.muted} />
          )
        ) : (
          <View style={styles.iconBadge}>
            <Tag size={20} color={colors.brandPrimary} weight="fill" />
          </View>
        )}
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          {item.description ? (
            <Text style={styles.desc} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
        {!selectMode ? (
          <>
            <Pressable
              testID={`master-edit-${item.id}`}
              style={styles.actionBtn}
              onPress={() => openEdit(item)}
              hitSlop={8}
            >
              <PencilSimple size={18} color={colors.brandPrimary} weight="bold" />
            </Pressable>
            <Pressable
              testID={`master-delete-${item.id}`}
              style={styles.actionBtn}
              onPress={() => setConfirmDelete(item)}
              hitSlop={8}
            >
              <TrashSimple size={18} color={colors.error} weight="bold" />
            </Pressable>
          </>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Sticky header: type selector (horizontal, chips never wrap) */}
      <View style={styles.header}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
        >
          {TABS.map((t) => {
            const on = t.key === active;
            return (
              <Pressable
                key={t.key}
                testID={`master-tab-${t.key}`}
                onPress={() => setActive(t.key)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Selection toolbar */}
      {data && data.length > 0 ? (
        <View style={styles.selectBar}>
          {selectMode ? (
            <>
              <Pressable onPress={exitSelect} testID="master-select-cancel" hitSlop={8}>
                <Text style={styles.selectAction}>Batal</Text>
              </Pressable>
              <Text style={styles.selectCount}>{selected.size} dipilih</Text>
              <Pressable
                onPress={() => setSelected(new Set(data.map((d) => d.id)))}
                testID="master-select-all"
                hitSlop={8}
              >
                <Text style={styles.selectAction}>Pilih Semua</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setSelectMode(true)} testID="master-select-mode" hitSlop={8}>
              <Text style={styles.selectAction}>Pilih</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {isLoading ? (
        <LoadingView label="Memuat data..." />
      ) : isError ? (
        <ErrorView title="Tidak dapat memuat" subtitle="Periksa koneksi Anda." onRetry={refetch} />
      ) : !data || data.length === 0 ? (
        <EmptyView title={`Belum ada ${activeLabel}`} subtitle="Tambah data dengan tombol di bawah." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          showsVerticalScrollIndicator={false}
          testID="master-list"
        />
      )}

      {!selectMode ? (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={openCreate}
          testID="master-add-button"
        >
          <Plus size={20} color={colors.onBrandPrimary} weight="bold" />
          <Text style={styles.fabText}>Tambah {activeLabel}</Text>
        </Pressable>
      ) : null}

      {/* Bulk delete action bar */}
      {selectMode && selected.size > 0 ? (
        <View style={[styles.bulkBar, { paddingBottom: insets.bottom + 12 }]} testID="master-bulk-bar">
          <Pressable
            style={styles.bulkDeleteBtn}
            onPress={() => setConfirmBulk(true)}
            testID="master-bulk-delete"
          >
            <TrashSimple size={18} color={colors.onError} weight="bold" />
            <Text style={styles.bulkDeleteText}>Hapus {selected.size} item</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Bulk delete confirm */}
      <Modal visible={confirmBulk} transparent animationType="fade" onRequestClose={() => setConfirmBulk(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="master-bulk-modal">
            <Text style={styles.modalTitle}>Hapus {selected.size} {activeLabel}?</Text>
            <Text style={styles.confirmText}>
              Item dipindah ke Trash dan bisa dipulihkan nanti.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.secondaryBtn} onPress={() => setConfirmBulk(false)} testID="master-bulk-cancel">
                <Text style={styles.secondaryBtnText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, bulkDeleteMutation.isPending && styles.btnDisabled]}
                disabled={bulkDeleteMutation.isPending}
                onPress={() => bulkDeleteMutation.mutate([...selected])}
                testID="master-bulk-confirm"
              >
                {bulkDeleteMutation.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={styles.dangerBtnText}>Hapus</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create / Edit modal */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard} testID="master-form-modal">
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {editing ? `Edit ${activeLabel}` : `Tambah ${activeLabel}`}
              </Text>
              <Pressable onPress={() => setFormOpen(false)} testID="master-form-close" hitSlop={8}>
                <X size={22} color={colors.muted} weight="bold" />
              </Pressable>
            </View>

            <Text style={styles.label}>Nama</Text>
            <TextInput
              testID="master-name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={`Nama ${activeLabel}`}
              placeholderTextColor={colors.muted}
              autoFocus
            />

            <Text style={styles.label}>Deskripsi (opsional)</Text>
            <TextInput
              testID="master-desc-input"
              style={[styles.input, styles.inputMultiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Keterangan singkat"
              placeholderTextColor={colors.muted}
              multiline
            />

            <Pressable
              testID="master-save-button"
              style={[styles.primaryBtn, (!name.trim() || saveMutation.isPending) && styles.btnDisabled]}
              disabled={!name.trim() || saveMutation.isPending}
              onPress={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{editing ? "Simpan" : "Tambah"}</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        visible={!!confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="master-delete-modal">
            <Text style={styles.modalTitle}>Hapus {activeLabel}?</Text>
            <Text style={styles.confirmText}>
              &quot;{confirmDelete?.name}&quot; akan dihapus. Tindakan ini akan disinkronkan ke database.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable
                style={[styles.secondaryBtn]}
                onPress={() => setConfirmDelete(null)}
                testID="master-delete-cancel"
              >
                <Text style={styles.secondaryBtnText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, deleteMutation.isPending && styles.btnDisabled]}
                disabled={deleteMutation.isPending}
                onPress={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
                testID="master-delete-confirm"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={styles.dangerBtnText}>Hapus</Text>
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
  chipRowContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
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
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  selectAction: { color: colors.brandPrimary, fontSize: 14, fontWeight: "800" },
  selectCount: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  bulkBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  bulkDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.error,
  },
  bulkDeleteText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
  listContent: { padding: 16, paddingTop: 12, gap: 10 },
  card: {
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
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: 2 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  desc: { color: colors.muted, fontSize: 13 },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  primaryBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  btnDisabled: { opacity: 0.5 },
  confirmText: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  confirmRow: { flexDirection: "row", gap: 12, marginTop: 18 },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  dangerBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: { color: colors.onError, fontSize: 15, fontWeight: "800" },
}));
