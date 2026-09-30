import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  Buildings,
  CaretRight,
  ClockCounterClockwise,
  IdentificationCard,
  MagnifyingGlass,
  MapPin,
  Phone,
  X,
} from "phosphor-react-native";

import { apiCustomers, Customer } from "@/src/api/client";
import { StatusBadge } from "@/src/components/StatusBadge";
import { EmptyView, ErrorView } from "@/src/components/StateViews";
import { storage } from "@/src/utils/storage";
import { makeStyles, useTheme } from "@/src/theme";

const RECENT_KEY = "search.recent";
const MAX_RECENT = 8;

type MatchHint = { icon: "code" | "pic" | "phone" | "map"; label: string } | null;

// Figure out which field the query matched so the user understands the result.
function matchHint(c: Customer, q: string): MatchHint {
  const s = q.trim().toLowerCase();
  if (!s) return null;
  if (c.customer_code.toLowerCase().includes(s)) return { icon: "code", label: c.customer_code };
  if (c.pic_name && c.pic_name.toLowerCase().includes(s))
    return { icon: "pic", label: `PIC: ${c.pic_name}` };
  if (c.phone && c.phone.toLowerCase().includes(s))
    return { icon: "phone", label: c.phone };
  if (c.whatsapp && c.whatsapp.toLowerCase().includes(s))
    return { icon: "phone", label: `WA: ${c.whatsapp}` };
  if (c.address && c.address.toLowerCase().includes(s))
    return { icon: "map", label: c.address };
  return null;
}

export default function SearchScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const stored = await storage.getItem<string[]>(RECENT_KEY, []);
      if (Array.isArray(stored)) setRecent(stored);
    })();
    const focus = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(focus);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const enabled = debounced.length >= 1;

  const { data, isLoading, isFetching, isError, refetch } = useQuery<Customer[]>({
    queryKey: ["search", debounced],
    queryFn: () => apiCustomers(debounced),
    enabled,
    placeholderData: keepPreviousData,
  });

  const results = enabled ? data ?? [] : [];

  const persistRecent = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecent((prev) => {
      const next = [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
        0,
        MAX_RECENT,
      );
      storage.setItem(RECENT_KEY, next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecent([]);
    storage.setItem(RECENT_KEY, []);
  }, []);

  const openCustomer = useCallback(
    (item: Customer) => {
      persistRecent(debounced);
      router.push(`/customer/${item.id}`);
    },
    [debounced, persistRecent, router],
  );

  const HintIcon = useCallback(
    ({ hint }: { hint: MatchHint }) => {
      if (!hint) return null;
      const props = { size: 13, color: colors.brandSecondary, weight: "fill" as const };
      if (hint.icon === "code") return <IdentificationCard {...props} />;
      if (hint.icon === "pic") return <IdentificationCard {...props} />;
      if (hint.icon === "phone") return <Phone {...props} />;
      return <MapPin {...props} />;
    },
    [colors.brandSecondary],
  );

  const renderItem = useCallback(
    ({ item }: { item: Customer }) => {
      const hint = matchHint(item, debounced);
      return (
        <Pressable
          testID={`search-result-${item.id}`}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => openCustomer(item)}
        >
          <View style={styles.avatar}>
            <Buildings size={20} color={colors.brandPrimary} weight="fill" />
          </View>
          <View style={styles.cardMain}>
            <Text style={styles.name} numberOfLines={1}>
              {item.customer_name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {item.customer_code} • {item.area}
            </Text>
            {hint ? (
              <View style={styles.hintRow}>
                <HintIcon hint={hint} />
                <Text style={styles.hintText} numberOfLines={1}>
                  {hint.label}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cardRight}>
            <StatusBadge status={item.status} />
            <CaretRight size={18} color={colors.muted} />
          </View>
        </Pressable>
      );
    },
    [HintIcon, colors, debounced, openCustomer, styles],
  );

  return (
    <View style={styles.container}>
      {/* Header with back + search input */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          testID="search-back"
        >
          <ArrowLeft size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.searchBox}>
          <MagnifyingGlass size={19} color={colors.muted} />
          <TextInput
            ref={inputRef}
            testID="global-search-input"
            style={styles.input}
            placeholder="Nama, kode, PIC, atau telepon..."
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => persistRecent(debounced)}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8} testID="search-clear">
              <X size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Body */}
      {!enabled ? (
        <View style={styles.body}>
          {recent.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <Text style={styles.recentTitle}>Pencarian Terakhir</Text>
                <Pressable onPress={clearRecent} hitSlop={8} testID="recent-clear">
                  <Text style={styles.clearLink}>Hapus</Text>
                </Pressable>
              </View>
              <View style={styles.recentWrap}>
                {recent.map((term, i) => (
                  <Pressable
                    key={`${term}-${i}`}
                    testID={`recent-search-${i}`}
                    style={styles.recentChip}
                    onPress={() => setSearch(term)}
                  >
                    <ClockCounterClockwise size={15} color={colors.muted} />
                    <Text style={styles.recentChipText} numberOfLines={1}>
                      {term}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.hintCenter} testID="search-hint">
              <MagnifyingGlass size={44} color={colors.muted} weight="duotone" />
              <Text style={styles.hintTitle}>Cari customer dengan cepat</Text>
              <Text style={styles.hintSub}>
                Ketik nama, kode customer, nama PIC, atau nomor telepon.
              </Text>
            </View>
          )}
        </View>
      ) : isError ? (
        <ErrorView
          title="Network Error"
          subtitle="Tidak dapat memuat hasil pencarian."
          onRetry={refetch}
        />
      ) : isLoading ? (
        <View style={styles.loading} testID="search-loading">
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : results.length === 0 ? (
        <EmptyView
          title="Tidak ada hasil"
          subtitle={`Tidak ditemukan customer untuk "${debounced}".`}
          testID="search-empty"
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          ListHeaderComponent={
            <Text style={styles.resultCount}>
              {results.length} hasil{isFetching ? " • memuat..." : ""}
            </Text>
          }
          testID="search-results-list"
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 46,
  },
  input: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    height: "100%",
  },
  body: {
    flex: 1,
    padding: 16,
  },
  recentHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  recentTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "800",
  },
  clearLink: {
    color: colors.brandSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  recentWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  recentChipText: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  hintCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 60,
  },
  hintTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 4,
  },
  hintSub: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  resultCount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  cardPressed: { opacity: 0.65 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMain: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "700",
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  hintText: {
    color: colors.brandSecondary,
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  cardRight: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "stretch",
    gap: 8,
  },
}));
