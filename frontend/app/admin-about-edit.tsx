import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

import { AboutInfo, ApiError, apiAbout, apiUpdateAbout } from "@/src/api/client";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

type Key = keyof AboutInfo;

const FIELDS: { key: Key; label: string; multiline?: boolean }[] = [
  { key: "app_name", label: "Application Name" },
  { key: "tagline", label: "Tagline" },
  { key: "description", label: "Description", multiline: true },
  { key: "developer", label: "Developer" },
  { key: "author", label: "Author" },
  { key: "version", label: "Version" },
  { key: "copyright", label: "Copyright" },
];

export default function AdminAboutEditScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AboutInfo>({ queryKey: ["about"], queryFn: apiAbout });
  const [form, setForm] = useState<AboutInfo | null>(null);
  const [toast, setToast] = useState<ToastData>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const mutation = useMutation({
    mutationFn: () => apiUpdateAbout(form as AboutInfo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["about"] });
      setToast({ msg: "About berhasil diperbarui.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      setToast({ msg: e instanceof ApiError ? e.message : "Gagal menyimpan.", ok: false });
    },
  });

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: "Edit About",
        headerTitleAlign: "center",
        headerBackground: () => <HeaderGradient />,
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: colors.onBrandPrimary,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 },
        headerShadowVisible: true,
      }}
    />
  );

  if (isLoading || !form) {
    return (
      <View style={styles.container}>
        {header}
        <LoadingView label="Memuat data..." />
      </View>
    );
  }

  const setField = (k: Key, v: string) => setForm((p) => (p ? { ...p, [k]: v } : p));

  return (
    <View style={styles.container}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="about-edit-scroll"
        >
          {FIELDS.map((f) => (
            <View style={styles.field} key={f.key}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={[styles.input, f.multiline && styles.inputMultiline]}
                value={form[f.key]}
                onChangeText={(t) => setField(f.key, t)}
                placeholder={f.label}
                placeholderTextColor={colors.muted}
                multiline={f.multiline}
                testID={`about-field-${f.key}`}
              />
            </View>
          ))}

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={() => mutation.mutate()}
            disabled={mutation.isPending}
            testID="save-about-button"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>Save Changes</Text>
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
  inputMultiline: { minHeight: 110, paddingTop: 12, textAlignVertical: "top" },
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
