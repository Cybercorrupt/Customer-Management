import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";
import { formatCompactRupiah, formatRupiah, groupThousands } from "@/src/utils/format";
import { Lang, translations } from "@/src/settings/translations";

export type CurrencyFormat = "full" | "plain" | "compact";

const LANG_KEY = "settings.language";
const CURRENCY_KEY = "settings.currency";

type SettingsState = {
  language: Lang;
  currency: CurrencyFormat;
  ready: boolean;
  setLanguage: (l: Lang) => void;
  setCurrency: (c: CurrencyFormat) => void;
  t: (key: string) => string;
  formatCurrency: (n: number) => string;
};

const SettingsContext = createContext<SettingsState | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Lang>("id");
  const [currency, setCurr] = useState<CurrencyFormat>("full");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const l = await storage.secureGet<string>(LANG_KEY, "id");
      const c = await storage.secureGet<string>(CURRENCY_KEY, "full");
      if (l === "id" || l === "en") setLang(l);
      if (c === "full" || c === "plain" || c === "compact") setCurr(c as CurrencyFormat);
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

  const t = useCallback(
    (key: string) => translations[language][key] ?? translations.id[key] ?? key,
    [language],
  );

  const formatCurrency = useCallback(
    (n: number) => {
      if (currency === "plain") return groupThousands(n);
      if (currency === "compact") return formatCompactRupiah(n);
      return formatRupiah(n);
    },
    [currency],
  );

  return (
    <SettingsContext.Provider
      value={{ language, currency, ready, setLanguage, setCurrency, t, formatCurrency }}
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
