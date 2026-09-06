import { Redirect, useRouter } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowsClockwise, ChartBar, Database, GearSix, HardDrives, Info, ShieldCheck, SignOut, Tag, Trash, UsersThree, Warning } from "phosphor-react-native";

import { apiConflictsCount } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { SyncStatus } from "@/src/components/SyncStatus";
import { makeStyles, useTheme } from "@/src/theme";

const ITEMS = [
  { name: "dashboard", label: "Dashboard", Icon: ChartBar },
  { name: "customers", label: "Customer Management", Icon: Database },
  { name: "master-data", label: "Master Data", Icon: Tag },
  { name: "data-sync", label: "Import / Export", Icon: ArrowsClockwise },
  { name: "trash", label: "Trash", Icon: Trash },
  { name: "conflicts", label: "Sync Conflicts", Icon: Warning },
  { name: "users", label: "User Management", Icon: UsersThree },
  { name: "app-settings", label: "App Settings", Icon: GearSix },
  { name: "supabase", label: "Database Connection", Icon: HardDrives },
  { name: "about", label: "About", Icon: Info },
] as const;

function CustomDrawer(props: any) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const { data: conflictInfo } = useQuery({
    queryKey: ["conflicts-count"],
    queryFn: apiConflictsCount,
    refetchInterval: 20000,
  });
  const conflictCount = conflictInfo?.count ?? 0;

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
          <ShieldCheck size={24} color={colors.onBrandSecondary} weight="fill" />
        </View>
        <Text style={styles.drawerTitle}>Admin Panel</Text>
        <Text style={styles.drawerUser}>{user?.name ?? "Administrator"}</Text>
        <Text style={styles.drawerEmail}>Role: {user?.role ?? "admin"}</Text>
        <SyncStatus style={{ marginTop: 12 }} />
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.itemsWrap}>
        {ITEMS.map(({ name, label, Icon }) => {
          const active = activeRoute === name;
          return (
            <Pressable
              key={name}
              testID={`admin-drawer-${name}`}
              onPress={() => props.navigation.navigate(name)}
              style={[styles.item, active && styles.itemActive]}
            >
              <Icon
                size={22}
                color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                weight={active ? "fill" : "regular"}
              />
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{label}</Text>
              {name === "conflicts" && conflictCount > 0 ? (
                <View style={styles.badge} testID="conflicts-badge">
                  <Text style={styles.badgeText}>{conflictCount > 99 ? "99+" : conflictCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable testID="admin-drawer-logout" onPress={onLogout} style={styles.item}>
          <SignOut size={22} color={colors.brandSecondary} />
          <Text style={[styles.itemLabel, { color: colors.brandSecondary }]}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminLayout() {
  const { colors } = useTheme();
  const { user, initializing } = useAuth();

  if (!initializing && !user) return <Redirect href="/login" />;
  if (!initializing && user && user.role !== "admin") return <Redirect href="/dashboard" />;

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
      <Drawer.Screen name="dashboard" options={{ title: "Admin Dashboard" }} />
      <Drawer.Screen name="customers" options={{ title: "Customer Management" }} />
      <Drawer.Screen name="master-data" options={{ title: "Master Data" }} />
      <Drawer.Screen name="data-sync" options={{ title: "Import / Export" }} />
      <Drawer.Screen name="trash" options={{ title: "Trash" }} />
      <Drawer.Screen name="conflicts" options={{ title: "Sync Conflicts" }} />
      <Drawer.Screen name="users" options={{ title: "User Management" }} />
      <Drawer.Screen name="app-settings" options={{ title: "App Settings" }} />
      <Drawer.Screen name="supabase" options={{ title: "Database Connection" }} />
      <Drawer.Screen name="about" options={{ title: "About" }} />
    </Drawer>
  );
}

const useStyles = makeStyles((colors) => ({
  drawer: { flex: 1, backgroundColor: colors.surfaceSecondary },
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
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  drawerTitle: { color: colors.onBrandPrimary, fontSize: 17, fontWeight: "800" },
  drawerUser: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "600" },
  drawerEmail: { color: colors.onBrandPrimary, opacity: 0.8, fontSize: 12 },
  itemsWrap: { paddingTop: 12, paddingHorizontal: 12 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  itemActive: { backgroundColor: colors.brandTertiary },
  itemLabel: { color: colors.onSurfaceSecondary, fontSize: 15, fontWeight: "600", flex: 1 },
  itemLabelActive: { color: colors.brandPrimary, fontWeight: "700" },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: "800" },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
}));
