import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { WifiSlash, MagnifyingGlass, Warning } from "phosphor-react-native";

import { makeStyles, useTheme } from "@/src/theme";

export function LoadingView({ label = "Memuat..." }: { label?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.center} testID="loading-view">
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

export function EmptyView({
  title = "Tidak ada data",
  subtitle,
  testID = "empty-view",
}: {
  title?: string;
  subtitle?: string;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.center} testID={testID}>
      <MagnifyingGlass size={44} color={colors.muted} weight="duotone" />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.text}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorView({
  title = "Network Error",
  subtitle = "Terjadi kesalahan saat memuat data.",
  onRetry,
  testID = "error-view",
}: {
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.center} testID={testID}>
      <WifiSlash size={44} color={colors.error} weight="duotone" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{subtitle}</Text>
      {onRetry ? (
        <Pressable style={styles.retryBtn} onPress={onRetry} testID="retry-button">
          <Text style={styles.retryText}>Coba Lagi</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function InlineWarning({ message }: { message: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.inline} testID="inline-warning">
      <Warning size={18} color={colors.error} weight="fill" />
      <Text style={styles.inlineText}>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  title: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  text: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 12,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryText: {
    color: colors.onBrandPrimary,
    fontWeight: "700",
    fontSize: 14,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineText: {
    color: colors.error,
    fontSize: 13,
    flex: 1,
    fontWeight: "500",
  },
}));
