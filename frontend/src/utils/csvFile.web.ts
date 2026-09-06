// Web file helpers for CSV read/save (browser). Native uses csvFile.ts.

export async function readTextFile(uri: string): Promise<string> {
  const res = await fetch(uri);
  return res.text();
}

export async function saveCSV(filename: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
