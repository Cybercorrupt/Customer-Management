import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CaretRight,
  Coins,
  Info,
  Lifebuoy,
  Lock,
  SignOut,
  Translate,
  UserCircle,
} from "phosphor-react-native";

import { useAuth } from "@/src/auth/AuthContext";
import { FilterModal } from "@/src/components/FilterModal";
import { CurrencyFormat, useSettings } from "@/src/settings/SettingsContext";
import { Lang } from "@/src/settings/translations";
import { makeStyles, useTheme } from "@/src/theme";

const SUPPORT_EMAIL = "support@meolabs.com";

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { language, currency, setLanguage, setCurrency, t } = useSettings();

  const [langOpen, setLangOpen] = useState(false);
  const [currOpen, setCurrOpen] = useState(false);

  const onLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  const langLabel = language === "id" ? t("lang.id") : t("lang.en");
  const currLabel = t(`currency.${currency}`);

  const Row = ({
    icon,
    title,
    subtitle,
    onPress,
    value,
    testID,
    danger,
  }: {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    onPress: () => void;
    value?: string;
    testID: string;
    danger?: boolean;
  }) => (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress} testID={testID}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>{icon}</View>
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, danger && { color: colors.error }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {!danger ? <CaretRight size={18} color={colors.muted} /> : null}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        testID="settings-scroll"
      >
        {/* Profile summary */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <UserCircle size={34} color={colors.brandPrimary} weight="fill" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.name ?? "User"}</Text>
            <Text style={styles.profileUser}>@{user?.username ?? "user"}</Text>
          </View>
        </View>

        <Text style={styles.section}>{t("settings.account")}</Text>
        <View style={styles.group}>
          <Row
            testID="settings-edit-profile"
            icon={<UserCircle size={20} color={colors.brandPrimary} weight="fill" />}
            title={t("settings.editProfile")}
            subtitle={t("settings.editProfileSub")}
            onPress={() => router.push("/edit-profile")}
          />
          <View style={styles.rowDivider} />
          <Row
            testID="settings-change-password"
            icon={<Lock size={20} color={colors.brandPrimary} weight="fill" />}
            title={t("settings.changePassword")}
            subtitle={t("settings.changePasswordSub")}
            onPress={() => router.push("/change-password")}
          />
        </View>

        <Text style={styles.section}>{t("settings.preferences")}</Text>
        <View style={styles.group}>
          <Row
            testID="settings-language"
            icon={<Translate size={20} color={colors.brandSecondary} weight="fill" />}
            title={t("settings.language")}
            value={langLabel}
            onPress={() => setLangOpen(true)}
          />
          <View style={styles.rowDivider} />
          <Row
            testID="settings-currency"
            icon={<Coins size={20} color={colors.brandSecondary} weight="fill" />}
            title={t("settings.currency")}
            value={currLabel}
            onPress={() => setCurrOpen(true)}
          />
        </View>

        <Text style={styles.section}>{t("settings.help")}</Text>
        <View style={styles.group}>
          <Row
            testID="settings-app-info"
            icon={<Info size={20} color={colors.info} weight="fill" />}
            title={t("settings.appInfo")}
            subtitle={t("settings.appInfoSub")}
            onPress={() => router.push("/about")}
          />
          <View style={styles.rowDivider} />
          <Row
            testID="settings-contact-support"
            icon={<Lifebuoy size={20} color={colors.info} weight="fill" />}
            title={t("settings.contactSupport")}
            subtitle={t("settings.contactSupportSub")}
            onPress={() =>
              Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Customer Management Support")}`)
            }
          />
        </View>

        <View style={[styles.group, { marginTop: 8 }]}>
          <Row
            testID="settings-logout"
            icon={<SignOut size={20} color={colors.error} weight="fill" />}
            title={t("settings.logout")}
            onPress={onLogout}
            danger
          />
        </View>
      </ScrollView>

      {langOpen ? (
        <FilterModal
          visible
          title={t("settings.language")}
          options={[t("lang.id"), t("lang.en")]}
          selected={langLabel}
          onSelect={(v) => setLanguage((v === t("lang.en") ? "en" : "id") as Lang)}
          onClose={() => setLangOpen(false)}
        />
      ) : null}

      {currOpen ? (
        <FilterModal
          visible
          title={t("settings.currency")}
          options={[t("currency.full"), t("currency.plain"), t("currency.compact")]}
          selected={currLabel}
          onSelect={(v) => {
            const map: Record<string, CurrencyFormat> = {
              [t("currency.full")]: "full",
              [t("currency.plain")]: "plain",
              [t("currency.compact")]: "compact",
            };
            setCurrency(map[v] ?? "full");
          }}
          onClose={() => setCurrOpen(false)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 16, gap: 8 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  profileUser: { color: colors.muted, fontSize: 14, marginTop: 2 },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 4,
    marginLeft: 4,
  },
  group: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: colors.surfaceTertiary },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconDanger: { backgroundColor: "#FEF2F2" },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowValue: { color: colors.brandPrimary, fontSize: 14, fontWeight: "700" },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 66 },
}));
