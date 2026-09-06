import { useMutation } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, apiChangeOwnPassword } from "@/src/api/client";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

export default function AdminChangePasswordScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastData>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const mutation = useMutation({
    mutationFn: () => apiChangeOwnPassword(current, next),
    onSuccess: () => {
      setToast({ msg: "Password berhasil diubah.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      const msg =
        e instanceof ApiError
          ? e.status === 400
            ? "Password saat ini salah."
            : e.message || "Gagal mengubah password."
          : "Gagal mengubah password.";
      if (e instanceof ApiError && e.status === 400) setErrors((p) => ({ ...p, current: msg }));
      setToast({ msg, ok: false });
    },
  });

  const onSubmit = () => {
    const errs: Record<string, string> = {};
    if (!current) errs.current = "Password saat ini wajib diisi.";
    if (next.length < 6) errs.next = "Password baru minimal 6 karakter.";
    if (confirm !== next) errs.confirm = "Konfirmasi password tidak cocok.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    mutation.mutate();
  };

  const fields: {
    key: "current" | "next" | "confirm";
    label: string;
    value: string;
    set: (v: string) => void;
  }[] = [
    { key: "current", label: "Password Saat Ini", value: current, set: setCurrent },
    { key: "next", label: "Password Baru", value: next, set: setNext },
    { key: "confirm", label: "Konfirmasi Password Baru", value: confirm, set: setConfirm },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Ubah Password",
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
          testID="change-password-scroll"
        >
          {fields.map((f) => (
            <View style={styles.field} key={f.key}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={[styles.input, errors[f.key] && styles.inputError]}
                value={f.value}
                onChangeText={(t) => {
                  f.set(t);
                  if (errors[f.key]) setErrors((p) => ({ ...p, [f.key]: "" }));
                }}
                placeholder="••••••"
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
                testID={`field-${f.key}`}
              />
              {errors[f.key] ? <Text style={styles.errorText}>{errors[f.key]}</Text> : null}
            </View>
          ))}

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={onSubmit}
            disabled={mutation.isPending}
            testID="submit-change-password"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>Simpan Password</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

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
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 12 },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
}));
