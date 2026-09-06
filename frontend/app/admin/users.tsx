import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Key, Plus, UserCircle } from "phosphor-react-native";

import { apiUsers, ManagedUser } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { EmptyView, ErrorView, LoadingView } from "@/src/components/StateViews";
import { makeStyles, useTheme } from "@/src/theme";

export default function AdminUsersScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery<ManagedUser[]>({
    queryKey: ["users"],
    queryFn: apiUsers,
  });

  const renderItem = ({ item }: { item: ManagedUser }) => {
    const isMe = item.username === user?.username;
    const isAdmin = item.role === "admin";
    return (
      <Pressable
        testID={`user-row-${item.username}`}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => router.push(`/admin-user-form?username=${encodeURIComponent(item.username)}`)}
      >
        <View style={[styles.avatar, isAdmin && styles.avatarAdmin]}>
          <UserCircle size={24} color={isAdmin ? colors.brandSecondary : colors.brandPrimary} weight="fill" />
        </View>
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name} {isMe ? <Text style={styles.you}>(Anda)</Text> : null}
          </Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <View style={[styles.roleBadge, { backgroundColor: `${isAdmin ? colors.brandSecondary : colors.info}1A` }]}>
          <Text style={[styles.roleText, { color: isAdmin ? colors.brandSecondary : colors.info }]}>
            {item.role.toUpperCase()}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topWrap}>
        <Pressable
          style={styles.pwBtn}
          onPress={() => router.push("/admin-change-password")}
          testID="change-own-password-button"
        >
          <Key size={18} color={colors.brandPrimary} weight="bold" />
          <Text style={styles.pwText}>Ubah Password Saya</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <LoadingView label="Memuat user..." />
      ) : isError ? (
        <ErrorView title="Network Error" subtitle="Tidak dapat memuat data user." onRetry={refetch} />
      ) : !data || data.length === 0 ? (
        <EmptyView title="Belum ada user" subtitle="Tambah user baru dengan tombol di bawah." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(u) => u.username}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          showsVerticalScrollIndicator={false}
          testID="users-list"
        />
      )}

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push("/admin-user-form")}
        testID="add-user-button"
      >
        <Plus size={20} color={colors.onBrandPrimary} weight="bold" />
        <Text style={styles.fabText}>Add User</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  topWrap: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  pwBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brandPrimary,
    backgroundColor: colors.surfaceSecondary,
  },
  pwText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  listContent: { padding: 16, paddingTop: 12, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardPressed: { opacity: 0.7 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarAdmin: { backgroundColor: "#FFF7ED" },
  main: { flex: 1, gap: 2 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  you: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  username: { color: colors.muted, fontSize: 13 },
  roleBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
}));
