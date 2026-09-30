import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";
import { formatCompactCurrency, formatWithSymbol, groupThousands } from "@/src/utils/format";
import { Lang, translations } from "@/src/settings/translations";

export type CurrencyFormat = "full" | "plain" | "compact";
export type CurrencyType = "IDR" | "USD" | "EUR" | "SGD" | "MYR" | "JPY";

export const CURRENCY_TYPES: CurrencyType[] = ["IDR", "USD", "EUR", "SGD", "MYR", "JPY"];
export const CURRENCY_SYMBOLS: Record<CurrencyType, string> = {
  IDR: "Rp",
  USD: "$",
  EUR: "€",
  SGD: "S$",
  MYR: "RM",
  JPY: "¥",
};

const LANG_KEY = "settings.language";
const CURRENCY_KEY = "settings.currency";
const CURRENCY_TYPE_KEY = "settings.currencyType";

type SettingsState = {
  language: Lang;
  currency: CurrencyFormat;
  currencyType: CurrencyType;
  ready: boolean;
  setLanguage: (l: Lang) => void;
  setCurrency: (c: CurrencyFormat) => void;
  setCurrencyType: (c: CurrencyType) => void;
  t: (key: string) => string;
  formatCurrency: (n: number) => string;
};

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Lang>("id");
  const [currency, setCurr] = useState<CurrencyFormat>("full");
  const [currencyType, setCurrType] = useState<CurrencyType>("IDR");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const l = await storage.secureGet<string>(LANG_KEY, "id");
      const c = await storage.secureGet<string>(CURRENCY_KEY, "full");
      const ct = await storage.secureGet<string>(CURRENCY_TYPE_KEY, "IDR");
      if (l === "id" || l === "en") setLang(l);
      if (c === "full" || c === "plain" || c === "compact") setCurr(c as CurrencyFormat);
      if (ct && CURRENCY_TYPES.includes(ct as CurrencyType)) setCurrType(ct as CurrencyType);
      setReady(true);
    })();
  }, []);

  const setLanguage = useCallback((l: Lang) => {
    setLang(l);
    storage.secureSet(LANG_KEY, l);
  }, []);

  const setCurrency = useCallback((c: CurrencyFormat) => {
    setCurr(c);
    storage.secureSet(CURRENCY_KEY, c);
  }, []);

  const setCurrencyType = useCallback((c: CurrencyType) => {
    setCurrType(c);
    storage.secureSet(CURRENCY_TYPE_KEY, c);
  }, []);

  const t = useCallback(
    (key: string) => translations[language][key] ?? translations.id[key] ?? key,
    [language],
  );

  const formatCurrency = useCallback(
    (n: number) => {
      const symbol = CURRENCY_SYMBOLS[currencyType];
      const idStyle = currencyType === "IDR";
      if (currency === "plain") return groupThousands(n);
      if (currency === "compact") return formatCompactCurrency(n, symbol, idStyle);
      return formatWithSymbol(n, symbol);
    },
    [currency, currencyType],
  );

  return (
    <SettingsContext.Provider
      value={{ language, currency, currencyType, ready, setLanguage, setCurrency, setCurrencyType, t, formatCurrency }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
