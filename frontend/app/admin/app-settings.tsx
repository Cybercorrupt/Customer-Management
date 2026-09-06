import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Palette, UploadSimple } from "phosphor-react-native";

import {
  AboutInfo,
  ApiError,
  apiAbout,
  apiUpdateAbout,
  apiUploadLogo,
  logoUri,
} from "@/src/api/client";
import { DEFAULT_LOGO } from "@/src/constants/branding";
import { LoadingView } from "@/src/components/StateViews";
import { Toast, ToastData } from "@/src/components/Toast";
import { makeStyles, useTheme } from "@/src/theme";

type Key = keyof AboutInfo;

const TEXT_FIELDS: { key: Key; label: string; multiline?: boolean }[] = [
  { key: "app_name", label: "Nama Aplikasi" },
  { key: "tagline", label: "Tagline" },
  { key: "description", label: "Deskripsi", multiline: true },
  { key: "developer", label: "Developer" },
  { key: "author", label: "Author" },
  { key: "version", label: "Versi" },
  { key: "copyright", label: "Copyright" },
];

const CONTACT_FIELDS: { key: Key; label: string; placeholder: string; keyboardType: "email-address" | "phone-pad" }[] = [
  { key: "admin_email", label: "Email Admin", placeholder: "admin@perusahaan.com", keyboardType: "email-address" },
  { key: "admin_phone", label: "Nomor Telepon", placeholder: "+62 812 3456 7890", keyboardType: "phone-pad" },
  { key: "admin_whatsapp", label: "WhatsApp", placeholder: "+62 812 3456 7890", keyboardType: "phone-pad" },
];

const PRIMARY_PRESETS = ["#1F5297", "#0F766E", "#7C3AED", "#B91C1C", "#1D4ED8", "#059669", "#0369A1"];
const SECONDARY_PRESETS = ["#EE8C28", "#F59E0B", "#10B981", "#3B82F6", "#EF4444", "#8B5CF6", "#DB2777"];

export default function AppSettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AboutInfo>({ queryKey: ["app-config"], queryFn: apiAbout });
  const [form, setForm] = useState<AboutInfo | null>(null);
  const [toast, setToast] = useState<ToastData>(null);
  const [uploading, setUploading] = useState(false);
  const [permDenied, setPermDenied] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const mutation = useMutation({
    mutationFn: () => apiUpdateAbout(form as AboutInfo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-config"] });
      setToast({ msg: "Pengaturan aplikasi tersimpan.", ok: true });
    },
    onError: (e) => setToast({ msg: e instanceof ApiError ? e.message : "Gagal menyimpan.", ok: false }),
  });

  const setField = (k: Key, v: string) => setForm((p) => (p ? { ...p, [k]: v } : p));

  const pickLogo = async () => {
    setPermDenied(false);
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = perm.status;
    if (status !== "granted" && (perm.canAskAgain || status === "undetermined")) {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      setPermDenied(true);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const type = asset.mimeType ?? "image/jpeg";
      const name = asset.fileName ?? `logo.${type.split("/")[1] ?? "jpg"}`;
      const res = await apiUploadLogo(asset.uri, name, type);
      setForm((p) => (p ? { ...p, logo_url: res.logo_url } : p));
      queryClient.invalidateQueries({ queryKey: ["app-config"] });
      setToast({ msg: "Logo berhasil diunggah.", ok: true });
    } catch (e) {
      setToast({ msg: e instanceof ApiError ? e.message : "Gagal mengunggah logo.", ok: false });
    } finally {
      setUploading(false);
    }
  };

  if (isLoading || !form) {
    return (
      <View style={styles.container}>
        <LoadingView label="Memuat pengaturan..." />
      </View>
    );
  }

  const logo = logoUri(form.logo_url);

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="app-settings-scroll"
        >
          {/* Logo */}
          <Text style={styles.sectionTitle}>LOGO APLIKASI</Text>
          <View style={styles.card}>
            <View style={styles.logoRow}>
              <View style={styles.logoPreview}>
                <Image
                  source={logo ? { uri: logo } : DEFAULT_LOGO}
                  style={styles.logoImg}
                  contentFit="cover"
                  testID="settings-logo-preview"
                />
              </View>
              <View style={styles.logoInfo}>
                <Text style={styles.logoHint}>PNG / JPG, disarankan persegi. Maks 5MB.</Text>
                <Pressable
                  style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.85 }]}
                  onPress={pickLogo}
                  disabled={uploading}
                  testID="upload-logo-button"
                >
                  {uploading ? (
                    <ActivityIndicator color={colors.onBrandPrimary} size="small" />
                  ) : (
                    <>
                      <UploadSimple size={18} color={colors.onBrandPrimary} weight="bold" />
                      <Text style={styles.uploadText}>{logo ? "Ganti Logo" : "Unggah Logo"}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
            {permDenied ? (
              <View style={styles.permBox}>
                <Text style={styles.permText}>Izin galeri ditolak. Buka Pengaturan untuk mengaktifkan.</Text>
                <Pressable onPress={() => Linking.openSettings()} testID="open-settings-button">
                  <Text style={styles.permLink}>Buka Pengaturan</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* Theme colors */}
          <Text style={styles.sectionTitle}>WARNA / TEMA</Text>
          <View style={styles.card}>
            <ColorField
              label="Warna Utama (Primary)"
              value={form.primary_color}
              presets={PRIMARY_PRESETS}
              onChange={(v) => setField("primary_color", v)}
              testPrefix="primary"
            />
            <View style={styles.innerDivider} />
            <ColorField
              label="Warna Aksen (Secondary)"
              value={form.secondary_color}
              presets={SECONDARY_PRESETS}
              onChange={(v) => setField("secondary_color", v)}
              testPrefix="secondary"
            />
            <View style={styles.previewRow}>
              <Palette size={16} color={colors.muted} />
              <Text style={styles.previewLabel}>Pratinjau:</Text>
              <View style={[styles.previewSwatch, { backgroundColor: form.primary_color }]} />
              <View style={[styles.previewSwatch, { backgroundColor: form.secondary_color }]} />
              <Text style={styles.previewNote}>Tersimpan setelah Save</Text>
            </View>
          </View>

          {/* Text fields */}
          <Text style={styles.sectionTitle}>DATA APLIKASI</Text>
          <View style={styles.card}>
            {TEXT_FIELDS.map((f, i) => (
              <View style={[styles.field, i < TEXT_FIELDS.length - 1 && styles.fieldBorder]} key={f.key}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  style={[styles.input, f.multiline && styles.inputMultiline]}
                  value={String(form[f.key] ?? "")}
                  onChangeText={(t) => setField(f.key, t)}
                  placeholder={f.label}
                  placeholderTextColor={colors.muted}
                  multiline={f.multiline}
                  testID={`app-field-${f.key}`}
                />
              </View>
            ))}
          </View>

          {/* Admin contact */}
          <Text style={styles.sectionTitle}>KONTAK ADMIN</Text>
          <Text style={styles.sectionHint}>Ditampilkan di halaman Tentang agar user bisa menghubungi admin.</Text>
          <View style={styles.card}>
            {CONTACT_FIELDS.map((f, i) => (
              <View style={[styles.field, i < CONTACT_FIELDS.length - 1 && styles.fieldBorder]} key={f.key}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  style={styles.input}
                  value={String(form[f.key] ?? "")}
                  onChangeText={(t) => setField(f.key, t)}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.muted}
                  keyboardType={f.keyboardType}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID={`app-field-${f.key}`}
                />
              </View>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={() => mutation.mutate()}
            disabled={mutation.isPending}
            testID="save-app-settings-button"
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>Simpan Perubahan</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast toast={toast} />
    </View>
  );
}

function ColorField({
  label,
  value,
  presets,
  onChange,
  testPrefix,
}: {
  label: string;
  value: string;
  presets: string[];
  onChange: (v: string) => void;
  testPrefix: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.colorField}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.hexRow}>
        <View style={[styles.hexSwatch, { backgroundColor: value }]} />
        <TextInput
          style={styles.hexInput}
          value={value}
          onChangeText={(t) => onChange(t.startsWith("#") ? t : `#${t}`)}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholder="#1F5297"
          placeholderTextColor={colors.muted}
          testID={`color-input-${testPrefix}`}
        />
      </View>
      <View style={styles.presetRow}>
        {presets.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={c}
              onPress={() => onChange(c)}
              style={[styles.presetSwatch, { backgroundColor: c }, active && styles.presetActive]}
              testID={`preset-${testPrefix}-${c}`}
            />
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 8,
  },
  sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  logoPreview: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  logoInfo: { flex: 1, gap: 10 },
  logoHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  uploadText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "800" },
  permBox: {
    marginTop: 14,
    backgroundColor: colors.brandTertiary,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  permText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  permLink: { color: colors.brandPrimary, fontSize: 14, fontWeight: "800" },
  colorField: { gap: 10 },
  innerDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 16 },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hexSwatch: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  hexInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 44,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
  },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  presetSwatch: { width: 32, height: 32, borderRadius: 999, borderWidth: 2, borderColor: "transparent" },
  presetActive: { borderColor: colors.onSurface },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  previewLabel: { color: colors.muted, fontSize: 13 },
  previewSwatch: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  previewNote: { color: colors.muted, fontSize: 11, marginLeft: "auto" },
  field: { gap: 6, paddingVertical: 12 },
  fieldBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 46,
    color: colors.onSurface,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 100, paddingTop: 12, textAlignVertical: "top" },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  saveText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
}));
