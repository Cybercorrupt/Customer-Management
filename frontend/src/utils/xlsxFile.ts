// Native (iOS/Android) helper: download an authed .xlsx from the API and share it.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { XLSX_MIME } from "@/src/api/client";

export async function downloadXlsx(url: string, filename: string, token: string | null): Promise<void> {
  const dest = `${FileSystem.documentDirectory}${filename}`;
  const res = await FileSystem.downloadAsync(url, dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status !== 200) {
    throw new Error(`Gagal mengunduh (HTTP ${res.status})`);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, {
      mimeType: XLSX_MIME,
      dialogTitle: filename,
      UTI: "org.openxmlformats.spreadsheetml.sheet",
    });
  }
}
