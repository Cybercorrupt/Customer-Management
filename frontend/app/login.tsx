import { useRouter } from "expo-router";
import { useState } from "react";
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
import { Image } from "expo-image";
import { Eye, EyeSlash, Lock, User as UserIcon } from "phosphor-react-native";

import { ApiError, logoUri } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useAppConfig } from "@/src/config/AppConfigContext";
import { DEFAULT_LOGO } from "@/src/constants/branding";
import { InlineWarning } from "@/src/components/StateViews";
import { makeStyles, useTheme } from "@/src/theme";

export default function LoginScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const { config } = useAppConfig();
  const logo = logoUri(config?.logo_url);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSubmit = async () => {
    setNotice(null);
    if (!username.trim() || !password) {
      setError("Username dan password wajib diisi.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await signIn(username.trim(), password);
      router.replace("/dashboard");
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setError("Network Error. Periksa koneksi internet Anda.");
      } else if (e instanceof ApiError && e.status === 401) {
        setError("Username atau password salah.");
      } else {
        setError("Gagal login. Silakan coba lagi.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Image
                source={logo ? { uri: logo } : DEFAULT_LOGO}
                style={styles.logoImg}
                contentFit="cover"
                testID="brand-logo"
              />
            </View>
            <Text style={styles.brandName}>{config?.app_name ?? "Customer Management"}</Text>
            <Text style={styles.brandTag}>{config?.tagline ?? "Customer Data & Analytics"}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Username</Text>
              <View style={styles.inputWrap}>
                <UserIcon size={20} color={colors.muted} />
                <TextInput
                  testID="login-username-input"
                  style={styles.input}
                  placeholder="Masukkan username"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={setUsername}
                  returnKeyType="next"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <Lock size={20} color={colors.muted} />
                <TextInput
                  testID="login-password-input"
                  style={styles.input}
                  placeholder="Masukkan password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="go"
                  onSubmitEditing={onSubmit}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={8}
                  testID="toggle-password-visibility"
                >
                  {showPassword ? (
                    <EyeSlash size={20} color={colors.muted} />
                  ) : (
                    <Eye size={20} color={colors.muted} />
                  )}
                </Pressable>
              </View>
            </View>

            {error ? <InlineWarning message={error} /> : null}

            <Pressable
              testID="login-submit-button"
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={onSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.buttonText}>LOGIN</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => setNotice("Silakan hubungi administrator untuk reset password.")}
              testID="forgot-password"
              hitSlop={8}
              style={styles.forgotWrap}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </Pressable>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.footerText}>{config?.copyright ?? "© 2026 MeO-Labs. All rights reserved."}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    gap: 28,
  },
  header: {
    alignItems: "center",
    gap: 8,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    overflow: "hidden",
  },
  logoImg: {
    width: "100%",
    height: "100%",
  },
  brandName: {
    color: colors.brandPrimary,
    fontSize: 24,
    fontWeight: "800",
  },
  brandTag: {
    color: colors.muted,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  field: { gap: 6 },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 52,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    height: "100%",
  },
  button: {
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: colors.onBrandPrimary,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  forgotWrap: {
    alignItems: "center",
  },
  forgotText: {
    color: colors.brandPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  notice: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
  },
  footer: {
    paddingTop: 12,
    alignItems: "center",
  },
  footerText: {
    color: colors.muted,
    fontSize: 12,
  },
}));
