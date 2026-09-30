// Minimal CSV helpers (parse + template + filename). No external deps.

export const TEMPLATE_HEADERS = [
  "Customer Code",
  "Customer Name",
  "Segment",
  "Purchasing Size",
  "Area",
  "Status",
  "Bad Debt",
  "Bad Debt Nominal",
  "Address",
  "Latitude",
  "Longitude",
  "Phone",
  "WhatsApp",
  "PIC Name",
  "Payment Terms",
  "Credit Limit",
];

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cur.push(field);
      field = "";
    } else if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const dataRows = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows: dataRows };
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function templateCSV(): string {
  const examples = [
    ["C001", "PT. Contoh Satu", "Distributor", "Large", "Jakarta", "Active", "No", "0", "Jl. Contoh No. 1, Jakarta", "-6.2088", "106.8456", "(021) 1234-5678", "0812-3456-7890", "Budi Santoso", "30 Days", "500000000"],
    ["C002", "CV. Contoh Dua", "Retail", "Small", "Bandung", "Bad Debt", "Yes", "15000000", "Jl. Contoh No. 2, Bandung", "-6.9175", "107.6191", "(022) 8765-4321", "0813-2222-3333", "Sri Wahyuni", "Cash", "100000000"],
  ];
  return [TEMPLATE_HEADERS.join(","), ...examples.map((r) => r.map(csvCell).join(","))].join("\n");
}

export function exportFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `customers_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
}
