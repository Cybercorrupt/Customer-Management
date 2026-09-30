import { Redirect, useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChartPieSlice,
  GearSix,
  Info,
  SignOut,
  UserCircle,
  Users,
} from "phosphor-react-native";

import { logoUri } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useAppConfig } from "@/src/config/AppConfigContext";
import { DEFAULT_LOGO } from "@/src/constants/branding";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { SyncStatus } from "@/src/components/SyncStatus";
import { useSettings } from "@/src/settings/SettingsContext";
import { makeStyles, useTheme } from "@/src/theme";

const ITEMS = [
  { name: "dashboard", labelKey: "drawer.dashboard", Icon: ChartPieSlice },
  { name: "customers", labelKey: "drawer.customers", Icon: Users },
  { name: "settings", labelKey: "drawer.settings", Icon: GearSix },
  { name: "about", labelKey: "drawer.about", Icon: Info },
] as const;

function CustomDrawer(props: any) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { t } = useSettings();
  const { config } = useAppConfig();
  const logo = logoUri(config?.logo_url);

  const activeRoute = props.state.routeNames[props.state.index];

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <View style={styles.drawer}>
      <LinearGradient
        colors={[colors.headerGradientFrom, colors.headerGradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.drawerHeader, { paddingTop: insets.top + 20 }]}
      >
        <View style={styles.logoBadge}>
          <Image source={logo ? { uri: logo } : DEFAULT_LOGO} style={styles.logoImg} contentFit="cover" />
        </View>
        <Text style={styles.drawerTitle}>{config?.app_name ?? "Customer Management"}</Text>
        <Text style={styles.drawerUser}>{user?.name ?? "User"}</Text>
        <Text style={styles.drawerEmail}>{user?.username ?? "user"}@company.com</Text>
        <SyncStatus style={{ marginTop: 12 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.itemsWrap}>
        {ITEMS.map(({ name, labelKey, Icon }) => {
          const active = activeRoute === name;
          return (
            <Pressable
              key={name}
              testID={`drawer-item-${name}`}
              onPress={() => props.navigation.navigate(name)}
              style={[styles.item, active && styles.itemActive]}
            >
              <Icon
                size={22}
                color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                weight={active ? "fill" : "regular"}
              />
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{t(labelKey)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable testID="drawer-item-logout" onPress={onLogout} style={styles.item}>
          <SignOut size={22} color={colors.brandSecondary} />
          <Text style={[styles.itemLabel, { color: colors.brandSecondary }]}>{t("drawer.logout")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileButton() {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/about")}
      hitSlop={8}
      style={{ marginRight: 12 }}
      testID="header-profile-button"
    >
      <UserCircle size={28} color={colors.onBrandPrimary} weight="fill" />
    </Pressable>
  );
}

export default function AppLayout() {
  const { colors } = useTheme();
  const { user, initializing } = useAuth();
  const { t } = useSettings();

  if (!initializing && !user) {
    return <Redirect href="/login" />;
  }

  return (
    <Drawer
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerBackground: () => <HeaderGradient />,
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: colors.onBrandPrimary,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 },
        headerTitleAlign: "center",
        headerShadowVisible: true,
        drawerType: "front",
      }}
    >
      <Drawer.Screen
        name="dashboard"
        options={{ title: t("drawer.dashboard"), headerRight: () => <ProfileButton /> }}
      />
      <Drawer.Screen name="customers" options={{ title: t("drawer.customers") }} />
      <Drawer.Screen name="settings" options={{ title: t("settings.title") }} />
      <Drawer.Screen name="about" options={{ title: t("drawer.about") }} />
    </Drawer>
  );
}

const useStyles = makeStyles((colors) => ({
  drawer: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
  },
  drawerHeader: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 4,
  },
  logoBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.onBrandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  drawerTitle: {
    color: colors.onBrandPrimary,
    fontSize: 17,
    fontWeight: "800",
  },
  drawerUser: {
    color: colors.onBrandPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  drawerEmail: {
    color: colors.onBrandPrimary,
    opacity: 0.8,
    fontSize: 12,
  },
  itemsWrap: {
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  itemActive: {
    backgroundColor: colors.brandTertiary,
  },
  itemLabel: {
    color: colors.onSurfaceSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  itemLabelActive: {
    color: colors.brandPrimary,
    fontWeight: "700",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
}));
