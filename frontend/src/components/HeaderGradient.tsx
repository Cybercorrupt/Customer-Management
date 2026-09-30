import React from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "@/src/theme";

/**
 * Diagonal brand gradient used as the navigation header background.
 * Pair with `headerShadowVisible: true` for a subtle drop shadow.
 */
export function HeaderGradient() {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={[colors.headerGradientFrom, colors.headerGradientTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
