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

import { ApiError, apiUpdateMe } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { Toast, ToastData } from "@/src/components/Toast";
import { useSettings } from "@/src/settings/SettingsContext";
import { makeStyles, useTheme } from "@/src/theme";

export default function EditProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateUser } = useAuth();
  const { t } = useSettings();

  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastData>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const mutation = useMutation({
    mutationFn: () => apiUpdateMe(name.trim()),
    onSuccess: (updated) => {
      updateUser({ name: updated.name });
      setToast({ msg: t("profile.saved"), ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      setToast({ msg: e instanceof ApiError ? e.message : "Error", ok: false });
    },
  });

  const onSave = () => {
    if (!name.trim()) {
      setError(t("profile.nameRequired"));
      return;
    }
    setError("");
    mutation.mutate();
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("profile.title"),
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
          testID="edit-profile-scroll"
        >
          <View style={styles.field}>
            <Text style={styles.label}>{t("profile.username")}</Text>
            <View style={[styles.input, styles.inputDisabled]}>
              <Text style={styles.disabledText}>@{user?.username ?? "user"}</Text>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t("profile.name")} *</Text>
            <TextInput
              style={[styles.input, error && styles.inputError]}
              value={name}
              onChangeText={(v) => {
                setName(v);
                if (error) setError("");
              }}
              placeholder={t("profile.name")}
              placeholderTextColor={colors.muted}
              testID="field-profile-name"
            />
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={onSave}
            disabled={mutation.isPending}
            testID="save-profile-button"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>{t("profile.save")}</Text>
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
    justifyContent: "center",
    color: colors.onSurface,
    fontSize: 15,
  },
  inputDisabled: { backgroundColor: colors.surfaceTertiary },
  disabledText: { color: colors.muted, fontSize: 15 },
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
