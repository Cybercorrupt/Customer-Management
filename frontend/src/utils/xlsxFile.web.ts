// Web helper: fetch an authed .xlsx blob and trigger a browser download.
export async function downloadXlsx(url: string, filename: string, token: string | null): Promise<void> {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    throw new Error(`Gagal mengunduh (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
}
