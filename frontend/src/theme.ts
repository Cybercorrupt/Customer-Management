// Design tokens for this app. Light theme only.Always modify the colors and theme to Dark, Light or Dark and Light according to the design guidelines.
//
// The keys match the "color" block of /app/design_guidelines.json. Fill the
// values from that file (or from the user's brand colors). Keep every key; do
// not add a second theme or colors file; do not write color literals in
// components.
//
// How the names work: a plain key is a background, and its `on` partner is the
// text or icon color that sits on top of it. Always use them as a pair.
//   <View style={{ backgroundColor: colors.brandPrimary }}>
//     <Text style={{ color: colors.onBrandPrimary }}>Continue</Text>
//   </View>
//
// Styling a screen or component: build the sheet with makeStyles so colors
// and layout live together and follow the active scheme:
//   const useStyles = makeStyles((colors) => ({
//     card: { backgroundColor: colors.surfaceSecondary, padding: 16 },
//     title: { color: colors.onSurfaceSecondary, fontSize: 16 },
//   }));
//   function Screen() {
//     const styles = useStyles();
//     return <View style={styles.card}><Text style={styles.title}>Hi</Text></View>;
//   }
// For color props that are not styles (icon color, placeholderTextColor,
// ActivityIndicator) read useTheme().colors inside the component.
// Never call StyleSheet.create with color values at module level; it cannot
// follow the scheme.
//
// To support dark mode later: add `dark` to `themes` with every key filled.
// Nothing else changes; the device setting takes over automatically.
// Feel free to add as many new colors as you need to support the design guidelines.

import { createContext, useContext, useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#F4F7F9",
  onSurface: "#111827",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#111827",
  surfaceTertiary: "#E2E8F0",
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#111827",
  onSurfaceInverse: "#FFFFFF",
  muted: "#64748B",

  // Brand
  brand: "#1F5297",
  onBrand: "#FFFFFF",
  brandPrimary: "#1F5297",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#EE8C28",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#E8F0FE",
  onBrandTertiary: "#1F5297",
  headerGradientFrom: "#2E6BB8",
  headerGradientTo: "#173F79",

  // Status
  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#EE8C28",
  onWarning: "#FFFFFF",
  error: "#EF4444",
  onError: "#FFFFFF",
  info: "#3B82F6",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  divider: "#F1F5F9",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

// In-app theme toggle, only after `dark` exists in `themes`. Call
// setColorScheme("dark"), setColorScheme("light"), or setColorScheme(null) to
// follow the device. Every useTheme() consumer re-renders. Persisting the
// choice and re-applying it on launch is the toggle's job.
export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme);
}

// Keep native surfaces (alerts, pickers, navigation chrome) on the schemes this
// app ships: light only forces light; once `dark` exists the device decides.
// Optional call because react-native-web does not implement it.
setColorScheme?.(themes.dark ? null : defaultScheme);

// Runtime brand-color overrides supplied by the admin's App Settings (logo &
// theme). AppConfigProvider fills this; default is empty so the base theme wins.
export const ThemeOverrideContext = createContext<Partial<ThemeColors>>({});

const HEX6 = /^#([0-9a-fA-F]{6})$/;

// Darken a #RRGGBB color by a factor (0..1). Returns input if not a hex color.
export function darken(hex: string, factor: number): string {
  const m = HEX6.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const to = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${to(((n >> 16) & 255) * factor)}${to(((n >> 8) & 255) * factor)}${to((n & 255) * factor)}`;
}

// Append an alpha (0..1) to a #RRGGBB color -> #RRGGBBAA. Returns input if invalid.
export function withAlpha(hex: string, alpha: number): string {
  const m = HEX6.exec(hex);
  if (!m) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, "0");
  return `#${m[1]}${a}`;
}

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const overrides = useContext(ThemeOverrideContext);
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  const base = themes[scheme] ?? themes.light;
  const colors = useMemo(
    () => (overrides && Object.keys(overrides).length ? { ...base, ...overrides } : base),
    [base, overrides],
  );
  return { scheme, colors };
}

// Themed StyleSheet: returns a hook that builds the sheet from the active
// scheme's colors and memoizes it until the scheme changes.
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}


