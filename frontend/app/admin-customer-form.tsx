import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretDown, CheckCircle, Trash, WarningCircle } from "phosphor-react-native";

import {
  ApiError,
  apiCreateCustomer,
  apiCustomer,
  apiDeleteCustomer,
  apiMasterOptions,
  apiUpdateCustomer,
  Customer,
  CustomerInput,
  MasterOptions,
} from "@/src/api/client";
import { FilterModal } from "@/src/components/FilterModal";
import { HeaderGradient } from "@/src/components/HeaderGradient";
import { ErrorView, LoadingView } from "@/src/components/StateViews";
import { STATUSES } from "@/src/constants/customer";
import { makeStyles, useTheme } from "@/src/theme";

type SelectKey = "segment" | "size" | "status" | "paymentTerms" | "area";

const toNum = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export default function CustomerFormScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [size, setSize] = useState("");
  const [status, setStatus] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [area, setArea] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [picName, setPicName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [badDebtNominal, setBadDebtNominal] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openSelect, setOpenSelect] = useState<SelectKey | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const existing = useQuery<Customer>({
    queryKey: ["customer", id],
    queryFn: () => apiCustomer(id!),
    enabled: isEdit,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  // Dropdown options come from Master Data so customer fields stay relational.
  const masterOptions = useQuery<MasterOptions>({
    queryKey: ["master-options"],
    queryFn: apiMasterOptions,
    staleTime: 30_000,
  });
  const opts = masterOptions.data;

  useEffect(() => {
    const c = existing.data;
    if (c) {
      setCode(c.customer_code);
      setName(c.customer_name);
      setSegment(c.segment);
      setSize(c.purchasing_size);
      setStatus(c.status);
      setPaymentTerms(c.payment_terms);
      setArea(c.area);
      setCreditLimit(String(c.credit_limit ?? ""));
      setPhone(c.phone ?? "");
      setWhatsapp(c.whatsapp ?? "");
      setPicName(c.pic_name ?? "");
      setAddress(c.address ?? "");
      setLatitude(c.latitude != null ? String(c.latitude) : "");
      setLongitude(c.longitude != null ? String(c.longitude) : "");
      setBadDebtNominal(c.bad_debt_nominal ? String(c.bad_debt_nominal) : "");
    }
  }, [existing.data]);

  const header = (title: string) => (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerTitleAlign: "center",
        headerBackground: () => <HeaderGradient />,
        headerStyle: { backgroundColor: colors.brandPrimary },
        headerTintColor: colors.onBrandPrimary,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 },
        headerShadowVisible: true,
      }}
    />
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["admin-stats"] });
    if (isEdit) queryClient.invalidateQueries({ queryKey: ["customer", id] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload: CustomerInput) =>
      isEdit ? apiUpdateCustomer(id!, payload) : apiCreateCustomer(payload),
    onSuccess: () => {
      invalidate();
      setToast({ msg: isEdit ? "Customer updated successfully." : "Customer added successfully.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setErrors((p) => ({ ...p, code: "Customer code sudah digunakan." }));
        setToast({ msg: "Customer code sudah digunakan.", ok: false });
      } else if (e instanceof ApiError && e.status === 403) {
        setToast({ msg: "Access denied.", ok: false });
      } else if (e instanceof ApiError && e.status === 422) {
        setToast({ msg: "Validation error. Periksa isian form.", ok: false });
      } else if (e instanceof ApiError && e.status === 0) {
        setToast({ msg: "Network error.", ok: false });
      } else {
        setToast({ msg: isEdit ? "Update failed." : "Save failed.", ok: false });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDeleteCustomer(id!),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      setToast({ msg: "Customer deleted successfully.", ok: true });
      setTimeout(() => router.back(), 900);
    },
    onError: (e) => {
      setConfirmDelete(false);
      setToast({ msg: e instanceof ApiError && e.status === 403 ? "Access denied." : "Delete failed.", ok: false });
    },
  });

  const validate = (): CustomerInput | null => {
    const errs: Record<string, string> = {};
    if (!code.trim()) errs.code = "Customer Code wajib diisi.";
    if (!name.trim()) errs.name = "Customer Name wajib diisi.";
    if (!segment) errs.segment = "Segment wajib dipilih.";
    if (!size) errs.size = "Purchasing Size wajib dipilih.";
    if (!status) errs.status = "Status wajib dipilih.";
    if (!paymentTerms) errs.paymentTerms = "Payment Terms wajib dipilih.";
    if (!area) errs.area = "Area wajib dipilih.";

    const credit = toNum(creditLimit || "0");
    if (credit === null || Number.isNaN(credit) || credit < 0) errs.creditLimit = "Credit Limit harus angka.";

    const lat = toNum(latitude);
    if (lat !== null && Number.isNaN(lat)) errs.latitude = "Latitude harus angka.";
    const lng = toNum(longitude);
    if (lng !== null && Number.isNaN(lng)) errs.longitude = "Longitude harus angka.";

    let nominal = 0;
    if (status === "Bad Debt") {
      const bd = toNum(badDebtNominal);
      if (bd === null || Number.isNaN(bd) || bd <= 0) errs.badDebtNominal = "Nominal Bad Debt wajib diisi.";
      else nominal = bd;
    }

    setErrors(errs);
    if (Object.keys(errs).length > 0) return null;

    return {
      customer_code: code.trim(),
      customer_name: name.trim(),
      segment,
      purchasing_size: size,
      area,
      status: status as CustomerInput["status"],
      payment_terms: paymentTerms,
      credit_limit: credit ?? 0,
      phone: phone.trim(),
      whatsapp: whatsapp.trim(),
      pic_name: picName.trim(),
      address: address.trim(),
      latitude: lat,
      longitude: lng,
      bad_debt_nominal: nominal,
    };
  };

  const onSave = () => {
    const payload = validate();
    if (payload) saveMutation.mutate(payload);
  };

  const selectConfig: Record<SelectKey, { title: string; options: string[]; value: string; set: (v: string) => void }> = {
    segment: { title: "Segment", options: opts?.segment ?? [], value: segment, set: setSegment },
    size: { title: "Purchasing Size", options: opts?.purchasing_size ?? [], value: size, set: setSize },
    status: { title: "Status", options: STATUSES, value: status, set: setStatus },
    paymentTerms: { title: "Payment Terms", options: opts?.top ?? [], value: paymentTerms, set: setPaymentTerms },
    area: { title: "Area", options: opts?.area ?? [], value: area, set: setArea },
  };

  if (isEdit && existing.isLoading) {
    return (
      <View style={styles.container}>
        {header("Edit Customer")}
        <LoadingView label="Memuat data..." />
      </View>
    );
  }
  if (isEdit && existing.isError) {
    const notFound = existing.error instanceof ApiError && existing.error.status === 404;
    return (
      <View style={styles.container}>
        {header("Edit Customer")}
        <ErrorView
          title={notFound ? "Customer Not Found" : "Network Error"}
          subtitle={notFound ? "Data tidak ditemukan." : "Gagal memuat data."}
          onRetry={notFound ? undefined : existing.refetch}
        />
      </View>
    );
  }

  const renderField = ({
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    errorKey,
    multiline,
  }: any) => (
    <View style={styles.field} key={errorKey}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, errors[errorKey] && styles.inputError]}
        value={value}
        onChangeText={(t: string) => {
          onChangeText(t);
          if (errors[errorKey]) setErrors((p) => ({ ...p, [errorKey]: "" }));
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize="none"
        testID={`field-${errorKey}`}
      />
      {errors[errorKey] ? <Text style={styles.errorText}>{errors[errorKey]}</Text> : null}
    </View>
  );

  const renderSelect = ({ label, k, placeholder }: { label: string; k: SelectKey; placeholder: string }) => {
    const cfg = selectConfig[k];
    return (
      <View style={styles.field} key={k}>
        <Text style={styles.label}>{label}</Text>
        <Pressable
          style={[styles.input, styles.selectRow, errors[k] && styles.inputError]}
          onPress={() => setOpenSelect(k)}
          testID={`select-${k}`}
        >
          <Text style={[styles.selectText, !cfg.value && { color: colors.muted }]}>
            {cfg.value || placeholder}
          </Text>
          <CaretDown size={18} color={colors.muted} />
        </Pressable>
        {errors[k] ? <Text style={styles.errorText}>{errors[k]}</Text> : null}
      </View>
    );
  };

  const title = isEdit ? "Edit Customer" : "Add Customer";

  return (
    <View style={styles.container}>
      {header(title)}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="customer-form-scroll"
        >
          {renderField({ label: "Customer Code *", value: code, onChangeText: setCode, placeholder: "Contoh: C012345", errorKey: "code" })}
          {renderField({ label: "Customer Name *", value: name, onChangeText: setName, placeholder: "Nama customer", errorKey: "name" })}
          {renderSelect({ label: "Segment *", k: "segment", placeholder: "Pilih segment" })}
          {renderSelect({ label: "Purchasing Size *", k: "size", placeholder: "Pilih ukuran" })}
          {renderSelect({ label: "Payment Terms *", k: "paymentTerms", placeholder: "Pilih payment terms" })}
          {renderField({ label: "Credit Limit (Rp)", value: creditLimit, onChangeText: setCreditLimit, placeholder: "0", keyboardType: "numeric", errorKey: "creditLimit" })}
          {renderSelect({ label: "Status *", k: "status", placeholder: "Pilih status" })}
          {status === "Bad Debt"
            ? renderField({
                label: "Bad Debt Nominal (Rp) *",
                value: badDebtNominal,
                onChangeText: setBadDebtNominal,
                placeholder: "0",
                keyboardType: "numeric",
                errorKey: "badDebtNominal",
              })
            : null}
          {renderSelect({ label: "Area *", k: "area", placeholder: "Pilih area" })}
          {renderField({ label: "Phone", value: phone, onChangeText: setPhone, placeholder: "(021) 1234-5678", errorKey: "phone" })}
          {renderField({ label: "WhatsApp", value: whatsapp, onChangeText: setWhatsapp, placeholder: "0812-3456-7890", errorKey: "whatsapp" })}
          {renderField({ label: "PIC Name", value: picName, onChangeText: setPicName, placeholder: "Nama PIC customer", errorKey: "picName" })}
          {renderField({ label: "Address", value: address, onChangeText: setAddress, placeholder: "Alamat customer", errorKey: "address", multiline: true })}
          <View style={styles.rowTwo}>
            <View style={styles.flex}>
              {renderField({ label: "Latitude", value: latitude, onChangeText: setLatitude, placeholder: "-6.2088", keyboardType: "numeric", errorKey: "latitude" })}
            </View>
            <View style={styles.flex}>
              {renderField({ label: "Longitude", value: longitude, onChangeText: setLongitude, placeholder: "106.8456", keyboardType: "numeric", errorKey: "longitude" })}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
            onPress={onSave}
            disabled={saveMutation.isPending}
            testID="save-customer-button"
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <Text style={styles.saveText}>{isEdit ? "Save Changes" : "Save"}</Text>
            )}
          </Pressable>

          {isEdit ? (
            <Pressable style={styles.deleteBtn} onPress={() => setConfirmDelete(true)} testID="delete-customer-button">
              <Trash size={18} color={colors.error} weight="fill" />
              <Text style={styles.deleteText}>Delete Customer</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {openSelect ? (
        <FilterModal
          visible
          title={selectConfig[openSelect].title}
          options={selectConfig[openSelect].options}
          selected={selectConfig[openSelect].value}
          onSelect={(v) => {
            selectConfig[openSelect].set(v);
            if (errors[openSelect]) setErrors((p) => ({ ...p, [openSelect]: "" }));
          }}
          onClose={() => setOpenSelect(null)}
        />
      ) : null}

      {/* Delete confirmation */}
      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox} testID="delete-confirm-dialog">
            <Text style={styles.confirmTitle}>Delete this customer?</Text>
            <Text style={styles.confirmSub}>Tindakan ini tidak dapat dibatalkan.</Text>
            <View style={styles.confirmActions}>
              <Pressable style={[styles.confirmBtn, styles.cancelBtn]} onPress={() => setConfirmDelete(false)} testID="cancel-delete">
                <Text style={[styles.confirmBtnText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmBtn, styles.deleteConfirmBtn]}
                onPress={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                testID="confirm-delete"
              >
                {deleteMutation.isPending ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: colors.onError }]}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toast ? (
        <View
          style={[styles.toast, { top: insets.top + 12, backgroundColor: toast.ok ? colors.success : colors.error }]}
          testID="form-toast"
        >
          {toast.ok ? (
            <CheckCircle size={20} color={colors.onSuccess} weight="fill" />
          ) : (
            <WarningCircle size={20} color={colors.onError} weight="fill" />
          )}
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 14 },
  field: { gap: 6 },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    minHeight: 50,
    color: colors.onSurface,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 76, paddingTop: 12, textAlignVertical: "top" },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.error, fontSize: 12 },
  selectRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText: { color: colors.onSurface, fontSize: 15 },
  rowTwo: { flexDirection: "row", gap: 12 },
  saveBtn: {
    backgroundColor: colors.brandPrimary,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: "800" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surface,
  },
  deleteText: { color: colors.error, fontSize: 15, fontWeight: "700" },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  confirmBox: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  confirmTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  confirmSub: { color: colors.muted, fontSize: 14 },
  confirmActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cancelBtn: { borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  deleteConfirmBtn: { backgroundColor: colors.error },
  confirmBtnText: { fontSize: 15, fontWeight: "700" },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  toastText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700", flex: 1 },
}));
