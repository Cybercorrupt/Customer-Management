import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import { CaretDown, Trash } from "phosphor-react-native";

import {
  ApiError,
  apiCreateUser,
  apiDeleteUser,
  apiResetUserPassword,
  apiUpdateUser,
  apiUsers,
  ManagedUser,
} from "@/src/api/client";
import { FilterModal } from "@/src/components/FilterModal";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

const ROLES = ["user", "admin"];

export default function AdminUserFormScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { username: editUsername } = useLocalSearchParams<{ username?: string }>();
  const isEdit = !!editUsername;

  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("user");
  const [password, setPassword] = useState("");
  const [roleOpen, setRoleOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastData>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const usersQuery = useQuery<ManagedUser[]>({
    queryKey: ["users"],
    queryFn: apiUsers,
    enabled: isEdit,
  });
  const existing = usersQuery.data?.find((u) => u.username === editUsername);

  useEffect(() => {
    if (existing) {
      setUsername(existing.username);
      setName(existing.name);
      setRole(existing.role);
    }
  }, [existing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        await apiUpdateUser(editUsername!, { name: name.trim(), role: role as "user" | "admin" });
        if (password.trim()) await apiResetUserPassword(editUsername!, password.trim());
      } else {
        await apiCreateUser({
          username: username.trim(),
          name: name.trim(),
          role: role as "user" | "admin",
          password: password.trim(),
        });
      }
    },
    onSuccess: () => {
      invalidate();
      setToast({ msg: isEdit ? "User berhasil diperbarui." : "User berhasil ditambahkan.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      const msg =
        e instanceof ApiError
          ? e.status === 409
            ? "Username sudah digunakan."
            : e.message || "Gagal menyimpan."
          : "Gagal menyimpan.";
      if (e instanceof ApiError && e.status === 409) setErrors((p) => ({ ...p, username: msg }));
      setToast({ msg, ok: false });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDeleteUser(editUsername!),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      setToast({ msg: "User dihapus.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      setConfirmDelete(false);
      setToast({ msg: e instanceof ApiError ? e.message : "Gagal menghapus.", ok: false });
    },
  });

  const onSave = () => {
    const errs: Record<string, string> = {};
    if (!isEdit && !username.trim()) errs.username = "Username wajib diisi.";
    if (!name.trim()) errs.name = "Nama wajib diisi.";
    if (!isEdit && password.trim().length < 6) errs.password = "Password minimal 6 karakter.";
    if (isEdit && password.trim() && password.trim().length < 6)
      errs.password = "Password minimal 6 karakter.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveMutation.mutate();
  };

  const title = isEdit ? "Edit User" : "Add User";

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerTitleAlign: "center",
          headerBackground: () => <HeaderGradient />,
          headerStyle: { backgroundColor: colors.brandPrimary },
          headerTintColor: colors.onBrandPrimary,
          headerTitleStyle: { fontWeight: "800", fontSize: 18 },
          headerShadowVisible: true,
        }}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="user-form-scroll"
        >
          <View style={styles.field}>
            <Text style={styles.label}>Username *</Text>
            <TextInput
              style={[styles.input, isEdit && styles.inputDisabled, errors.username && styles.inputError]}
              value={username}
              onChangeText={(t) => {
                setUsername(t);
                if (errors.username) setErrors((p) => ({ ...p, username: "" }));
              }}
              editable={!isEdit}
              placeholder="mis. sales01"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              testID="field-username"
            />
            {errors.username ? <Text style={styles.errorText}>{errors.username}</Text> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Nama *</Text>
            <TextInput
              style={[styles.input, errors.name && styles.inputError]}
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (errors.name) setErrors((p) => ({ ...p, name: "" }));
              }}
              placeholder="Nama lengkap"
              placeholderTextColor={colors.muted}
              testID="field-name"
            />
            {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Role *</Text>
            <Pressable style={[styles.input, styles.selectRow]} onPress={() => setRoleOpen(true)} testID="select-role">
              <Text style={styles.selectText}>{role === "admin" ? "Admin" : "User"}</Text>
              <CaretDown size={18} color={colors.muted} />
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{isEdit ? "Reset Password (opsional)" : "Password *"}</Text>
            <TextInput
              style={[styles.input, errors.password && styles.inputError]}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (errors.password) setErrors((p) => ({ ...p, password: "" }));
              }}
              placeholder={isEdit ? "Kosongkan jika tidak diubah" : "Minimal 6 karakter"}
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              testID="field-password"
            />
            {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={onSave}
            disabled={saveMutation.isPending}
            testID="save-user-button"
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>{isEdit ? "Save Changes" : "Save"}</Text>
            )}
          </Pressable>

          {isEdit ? (
            <Pressable style={styles.deleteBtn} onPress={() => setConfirmDelete(true)} testID="delete-user-button">
              <Trash size={18} color={colors.error} weight="fill" />
              <Text style={styles.deleteText}>Delete User</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {roleOpen ? (
        <FilterModal
          visible
          title="Role"
          options={ROLES.map((r) => (r === "admin" ? "Admin" : "User"))}
          selected={role === "admin" ? "Admin" : "User"}
          onSelect={(v) => setRole(v === "Admin" ? "admin" : "user")}
          onClose={() => setRoleOpen(false)}
        />
      ) : null}

      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox} testID="delete-user-dialog">
            <Text style={styles.confirmTitle}>Hapus user ini?</Text>
            <Text style={styles.confirmSub}>Akun @{username} akan dihapus permanen.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={[styles.confirmBtn, styles.cancelBtn]} onPress={() => setConfirmDelete(false)} testID="cancel-delete-user">
                <Text style={[styles.confirmBtnText, { color: colors.onSurface }]}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, styles.deleteConfirmBtn]}
                onPress={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                testID="confirm-delete-user"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: colors.onError }]}>Hapus</Text>
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
  flex: { flex: 1 },
  content: { padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
    color: colors.onSurface,
    fontSize: 15,
  },
  inputDisabled: { backgroundColor: colors.surfaceTertiary, color: colors.muted },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 12 },
  selectRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText: { color: colors.onSurface, fontSize: 15 },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  deleteText: { color: colors.error, fontSize: 15, fontWeight: "700" },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  confirmBox: { width: "100%", backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 8 },
  confirmTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  confirmSub: { color: colors.muted, fontSize: 14 },
  confirmActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cancelBtn: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  deleteConfirmBtn: { backgroundColor: colors.error },
  confirmBtnText: { fontSize: 15, fontWeight: "700" },
}));
