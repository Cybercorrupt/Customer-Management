import { Customer } from "@/src/api/client";

const uniqSorted = (arr: (string | null | undefined)[]) =>
  Array.from(new Set(arr.map((s) => (s || "").trim()).filter(Boolean))).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

// Cascading region options (Province -> City/Regency -> District -> Village).
// Each level is limited by the selected parents. The "all" sentinels mean
// "no filter at that level". Always derived from the live customer dataset,
// so options stay in sync with the database (single source of truth).
export function regionOptions(
  customers: Customer[],
  sel: { province: string; city: string; district: string },
  all: { province: string; city: string; district: string },
) {
  const byProvince = (c: Customer) =>
    sel.province === all.province || c.province === sel.province;
  const byCity = (c: Customer) => sel.city === all.city || c.city_regency === sel.city;
  const byDistrict = (c: Customer) =>
    sel.district === all.district || c.district === sel.district;
  return {
    provinces: uniqSorted(customers.map((c) => c.province)),
    cities: uniqSorted(customers.filter(byProvince).map((c) => c.city_regency)),
    districts: uniqSorted(
      customers.filter((c) => byProvince(c) && byCity(c)).map((c) => c.district),
    ),
    villages: uniqSorted(
      customers
        .filter((c) => byProvince(c) && byCity(c) && byDistrict(c))
        .map((c) => c.village),
    ),
  };
}
