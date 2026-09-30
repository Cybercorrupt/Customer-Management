export function groupThousands(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return sign + out;
}

export function formatWithSymbol(n: number, symbol: string): string {
  return `${symbol} ${groupThousands(n)}`;
}

// Compact formatting. `idStyle` uses Indonesian suffixes (Jt = juta, M = miliar);
// other currencies use the international K / M / B suffixes.
export function formatCompactCurrency(n: number, symbol: string, idStyle: boolean): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (idStyle) {
    if (abs >= 1_000_000_000) return `${sign}${symbol} ${(abs / 1_000_000_000).toFixed(1)} M`;
    if (abs >= 1_000_000) return `${sign}${symbol} ${(abs / 1_000_000).toFixed(0)} Jt`;
    return formatWithSymbol(n, symbol);
  }
  if (abs >= 1_000_000_000) return `${sign}${symbol} ${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${symbol} ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol} ${(abs / 1_000).toFixed(1)}K`;
  return formatWithSymbol(n, symbol);
}
