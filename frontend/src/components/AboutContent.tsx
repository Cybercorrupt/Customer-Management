import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { EnvelopeSimple, Phone, WhatsappLogo } from "phosphor-react-native";

import { AboutInfo, apiAbout, logoUri } from "@/src/api/client";
import { DEFAULT_LOGO } from "@/src/constants/branding";
import { makeStyles, useTheme } from "@/src/theme";

const FALLBACK: AboutInfo = {
  app_name: "Customer Data Management",
  tagline: "Customer Data & Analytics",
  description:
    "Customer Management adalah aplikasi untuk membantu perusahaan mengelola informasi customer secara terstruktur serta memantau kondisi customer berdasarkan status, purchasing size, area dan bad debt.",
  developer: "MeO-Labs",
  author: "MeO-Labs",
  version: "1.0.0",
  copyright: "© 2026 MeO-Labs. All rights reserved.",
  logo_url: "",
  primary_color: "#1F5297",
  secondary_color: "#EE8C28",
};

// onUnlock is fired after the Version value is tapped 8 times (hidden admin access).
export function AboutContent({ onUnlock }: { onUnlock?: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const taps = useRef(0);

  const { data } = useQuery<AboutInfo>({ queryKey: ["app-config"], queryFn: apiAbout });
  const about = data ?? FALLBACK;
  const logo = logoUri(about.logo_url);

  const info = [
    { label: "Application Name", value: about.app_name },
    { label: "Version", value: about.version, tappable: true },
    { label: "Developer", value: about.developer },
    { label: "Author", value: about.author },
  ];

  const onVersionTap = () => {
    if (!onUnlock) return;
    taps.current += 1;
    if (taps.current >= 8) {
      taps.current = 0;
      onUnlock();
    }
  };

  const digits = (v: string) => v.replace(/[^\d]/g, "");
  const contacts = [
    about.admin_email
      ? { key: "email", label: "Email", value: about.admin_email, Icon: EnvelopeSimple, url: `mailto:${about.admin_email}` }
      : null,
    about.admin_phone
      ? { key: "phone", label: "Telepon", value: about.admin_phone, Icon: Phone, url: `tel:${digits(about.admin_phone)}` }
      : null,
    about.admin_whatsapp
      ? { key: "whatsapp", label: "WhatsApp", value: about.admin_whatsapp, Icon: WhatsappLogo, url: `https://wa.me/${digits(about.admin_whatsapp)}` }
      : null,
  ].filter(Boolean) as { key: string; label: string; value: string; Icon: typeof EnvelopeSimple; url: string }[];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        testID="about-scroll"
      >
        <View style={styles.heroCard}>
          <View style={styles.logoBadge}>
            <Image source={logo ? { uri: logo } : DEFAULT_LOGO} style={styles.logoImg} contentFit="cover" testID="about-logo" />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.appName}>{about.app_name}</Text>
            <Text style={styles.tagline}>{about.tagline}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>About Application</Text>
        <View style={styles.card}>
          <Text style={styles.description}>{about.description}</Text>
        </View>

        <Text style={styles.sectionTitle}>Application Information</Text>
        <View style={styles.card}>
          {info.map((row, i) => {
            const valueNode = (
              <Text style={styles.infoValue}>{row.value}</Text>
            );
            return (
              <View
                key={row.label}
                style={[styles.infoRow, i < info.length - 1 && styles.infoRowBorder]}
              >
                <Text style={styles.infoLabel}>{row.label}</Text>
                {row.tappable ? (
                  <Pressable onPress={onVersionTap} hitSlop={10} testID="about-version-value">
                    {valueNode}
                  </Pressable>
                ) : (
                  valueNode
                )}
              </View>
            );
          })}
        </View>

        {contacts.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Contact Admin</Text>
            <View style={styles.card}>
              {contacts.map((c, i) => (
                <Pressable
                  key={c.key}
                  onPress={() => Linking.openURL(c.url)}
                  style={[styles.contactRow, i < contacts.length - 1 && styles.infoRowBorder]}
                  testID={`about-contact-${c.key}`}
                >
                  <View style={styles.contactIcon}>
                    <c.Icon size={20} color={colors.brandPrimary} weight="fill" />
                  </View>
                  <View style={styles.contactText}>
                    <Text style={styles.contactLabel}>{c.label}</Text>
                    <Text style={styles.contactValue}>{c.value}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.footerText}>{about.copyright}</Text>
        <Text style={styles.footerVersion}>Version {about.version}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 16, gap: 12 },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  heroText: { flex: 1 },
  appName: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  tagline: { color: colors.brandSecondary, fontSize: 14, fontWeight: "600", marginTop: 2 },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 6,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  description: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    lineHeight: 22,
    paddingVertical: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
  },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoLabel: { color: colors.muted, fontSize: 14 },
  infoValue: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  infoValueHighlight: { color: colors.brandPrimary },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14 },
  contactIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  contactText: { flex: 1 },
  contactLabel: { color: colors.muted, fontSize: 12 },
  contactValue: { color: colors.onSurface, fontSize: 15, fontWeight: "700", marginTop: 1 },
  footer: {
    paddingTop: 12,
    alignItems: "center",
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  footerText: { color: colors.muted, fontSize: 12 },
  footerVersion: { color: colors.muted, fontSize: 11 },
}));
