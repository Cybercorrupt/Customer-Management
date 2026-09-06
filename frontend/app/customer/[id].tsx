import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Buildings,
  ChatCircleDots,
  IdentificationBadge,
  MapPin,
  MapTrifold,
  Phone,
  ShareNetwork,
} from "phosphor-react-native";

import { ApiError, apiCustomer, Customer } from "@/src/api/client";
import { CustomerMap } from "@/src/components/CustomerMap";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { StatusBadge } from "@/src/components/StatusBadge";
import { ErrorView, LoadingView } from "@/src/components/StateViews";
import { useSettings } from "@/src/settings/SettingsContext";
import { makeStyles, useTheme } from "@/src/theme";

// Normalizes a latitude/longitude coming from DB/API into a valid number.
// Accepts number or numeric string; rejects null/undefined/empty/NaN/Infinity
// and values outside the given range. Returns null when invalid.
function toCoordinate(value: unknown, min: number, max: number): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return null;
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function CustomerDetailScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { formatCurrency } = useSettings();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery<Customer>({
    queryKey: ["customer", id],
    queryFn: () => apiCustomer(id!),
    enabled: !!id,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: "Customer Detail",
        headerTitleAlign: "center",
        headerBackground: () => <HeaderGradient />,
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: colors.onBrandPrimary,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 },
        headerShadowVisible: true,
      }}
    />
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        {header}
        <LoadingView label="Memuat detail customer..." />
      </View>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <View style={styles.container}>
        {header}
        <ErrorView
          title={notFound ? "Customer Not Found" : "Network Error"}
          subtitle={
            notFound
              ? "Data customer tidak ditemukan."
              : "Tidak dapat memuat detail customer."
          }
          onRetry={notFound ? undefined : refetch}
        />
      </View>
    );
  }

  const lat = toCoordinate(data.latitude, -90, 90);
  const lng = toCoordinate(data.longitude, -180, 180);
  const hasCoords = lat != null && lng != null;

  const openMaps = () => {
    if (!hasCoords) return;
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    );
  };

  const callPhone = () => Linking.openURL(`tel:${data.phone.replace(/[^0-9]/g, "")}`);

  const openWhatsApp = () => {
    const digits = data.whatsapp.replace(/[^0-9]/g, "");
    const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
    Linking.openURL(`https://wa.me/${intl}`);
  };

  const shareViaWhatsApp = () => {
    const lines = [
      `*${data.customer_name}* (${data.customer_code})`,
      `Status: ${data.status}`,
      `Segment: ${data.segment} • ${data.purchasing_size}`,
      `Area: ${data.area}`,
      data.pic_name ? `PIC: ${data.pic_name}` : null,
      data.phone ? `Telp: ${data.phone}` : null,
      data.whatsapp ? `WA: ${data.whatsapp}` : null,
      data.address ? `Alamat: ${data.address}` : null,
      hasCoords
        ? `Lokasi: https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        : null,
    ].filter(Boolean);
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Customer Detail",
          headerTitleAlign: "center",
          headerBackground: () => <HeaderGradient />,
          headerStyle: { backgroundColor: colors.brandPrimary },
          headerTintColor: colors.onBrandPrimary,
          headerTitleStyle: { fontWeight: "800", fontSize: 18 },
          headerShadowVisible: true,
          headerRight: () => (
            <Pressable
              onPress={shareViaWhatsApp}
              hitSlop={10}
              style={{ marginRight: 12 }}
              testID="share-whatsapp"
            >
              <ShareNetwork size={24} color={colors.onBrandPrimary} weight="bold" />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        testID="customer-detail-scroll"
      >
        {/* Header card */}
        <View style={styles.headerCard}>
          <View style={styles.avatar}>
            <Buildings size={26} color={colors.brandPrimary} weight="fill" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name}>{data.customer_name}</Text>
            <Text style={styles.code}>{data.customer_code}</Text>
          </View>
          <StatusBadge status={data.status} />
        </View>

        {/* Business info */}
        <Text style={styles.sectionTitle}>Business Information</Text>
        <View style={styles.card}>
          <InfoRow label="Segment" value={data.segment} />
          <InfoRow label="Purchasing Size" value={data.purchasing_size} />
          <InfoRow label="Payment Terms" value={data.payment_terms} />
          <InfoRow label="Credit Limit" value={formatCurrency(data.credit_limit)} last />
        </View>

        {/* Contact */}
        <Text style={styles.sectionTitle}>Contact</Text>
        <View style={styles.card}>
          <View style={[styles.contactRow, styles.infoRowBorder]}>
            <IdentificationBadge size={20} color={colors.brandSecondary} weight="fill" />
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>PIC Name</Text>
              <Text style={styles.contactValue} testID="pic-name-value">{data.pic_name || "-"}</Text>
            </View>
          </View>
          <View style={[styles.contactRow, styles.infoRowBorder]}>
            <Phone size={20} color={colors.brandPrimary} weight="fill" />
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>Phone</Text>
              <Text style={styles.contactValue}>{data.phone}</Text>
            </View>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]}
              onPress={callPhone}
              testID="call-phone"
            >
              <Phone size={18} color={colors.onBrandPrimary} weight="fill" />
            </Pressable>
          </View>
          <View style={styles.contactRow}>
            <ChatCircleDots size={20} color={colors.success} weight="fill" />
            <View style={styles.contactInfo}>
              <Text style={styles.contactLabel}>WhatsApp</Text>
              <Text style={styles.contactValue}>{data.whatsapp}</Text>
            </View>
            <Pressable
              style={[styles.actionBtn, { backgroundColor: colors.success }]}
              onPress={openWhatsApp}
              testID="open-whatsapp"
            >
              <ChatCircleDots size={18} color={colors.onSuccess} weight="fill" />
            </Pressable>
          </View>
        </View>

        {/* Address */}
        <Text style={styles.sectionTitle}>Address</Text>
        <View style={styles.card}>
          <View style={styles.addressRow}>
            <MapPin size={20} color={colors.brandSecondary} weight="fill" />
            <Text style={styles.addressText}>{data.address}</Text>
          </View>
        </View>

        {/* Location */}
        <Text style={styles.sectionTitle}>Location Information</Text>
        <View style={styles.card}>
          {hasCoords ? (
            <>
              <InfoRow label="Latitude" value={String(lat)} />
              <InfoRow label="Longitude" value={String(lng)} last />
              <View style={{ marginTop: 14 }}>
                <CustomerMap
                  latitude={lat}
                  longitude={lng}
                  title={data.customer_name}
                />
              </View>
              <Pressable style={styles.mapsButton} onPress={openMaps} testID="open-google-maps">
                <MapTrifold size={20} color={colors.brandPrimary} weight="fill" />
                <Text style={styles.mapsButtonText}>Open in Google Maps</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.noLocation} testID="no-location">
              <MapPin size={32} color={colors.muted} weight="duotone" />
              <Text style={styles.noLocationText}>📍 Lokasi customer belum tersedia</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
  },
  name: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
  },
  code: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 6,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 14,
  },
  infoValue: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "right",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  contactInfo: {
    flex: 1,
  },
  contactLabel: {
    color: colors.muted,
    fontSize: 12,
  },
  contactValue: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
  },
  addressText: {
    color: colors.onSurface,
    fontSize: 14,
    lineHeight: 21,
    flex: 1,
  },
  mapsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    height: 48,
    marginVertical: 14,
  },
  mapsButtonText: {
    color: colors.brandPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  noLocation: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 28,
  },
  noLocationText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "500",
  },
}));
