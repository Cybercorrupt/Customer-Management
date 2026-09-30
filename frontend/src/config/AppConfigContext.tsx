import React, { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AboutInfo, apiAbout } from "@/src/api/client";
import { ThemeColors, ThemeOverrideContext, darken, withAlpha } from "@/src/theme";

type Ctx = { config: AboutInfo | null };

const AppConfigContext = createContext<Ctx>({ config: null });

// Fetches public app branding (name, tagline, logo, colors) and applies the
// admin-chosen brand colors app-wide via ThemeOverrideContext.
export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery<AboutInfo>({
    queryKey: ["app-config"],
    queryFn: apiAbout,
    staleTime: 60_000,
  });
  const config = data ?? null;

  const primary = config?.primary_color || "#1F5297";
  const secondary = config?.secondary_color || "#EE8C28";

  const overrides = useMemo<Partial<ThemeColors>>(
    () => ({
      brand: primary,
      brandPrimary: primary,
      onBrandTertiary: primary,
      brandSecondary: secondary,
      warning: secondary,
      brandTertiary: withAlpha(primary, 0.12),
      headerGradientFrom: primary,
      headerGradientTo: darken(primary, 0.72),
    }),
    [primary, secondary],
  );

  return (
    <AppConfigContext.Provider value={{ config }}>
      <ThemeOverrideContext.Provider value={overrides}>{children}</ThemeOverrideContext.Provider>
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
