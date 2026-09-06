import React from "react";
import { Text, View } from "react-native";

import { makeStyles, useTheme } from "@/src/theme";

type Status = "Active" | "Inactive" | "Bad Debt";

export function statusColor(status: string, colors: any): string {
  if (status === "Active") return colors.success;
  if (status === "Bad Debt") return colors.error;
  return colors.info; // Inactive
}

export function StatusBadge({ status }: { status: Status | string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = statusColor(status, colors);
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]} testID={`status-badge-${status}`}>
      <Text style={[styles.label, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
}));
