import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle, WarningCircle } from "phosphor-react-native";

import { makeStyles, useTheme } from "@/src/theme";

export type ToastData = { msg: string; ok: boolean } | null;

export function Toast({ toast }: { toast: ToastData }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View
      style={[styles.toast, { top: insets.top + 12, backgroundColor: toast.ok ? colors.success : colors.error }]}
      testID="toast"
    >
      {toast.ok ? (
        <CheckCircle size={20} color={colors.onSuccess} weight="fill" />
      ) : (
        <WarningCircle size={20} color={colors.onError} weight="fill" />
      )}
      <Text style={styles.text}>{toast.msg}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    zIndex: 50,
  },
  text: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", flex: 1 },
}));
