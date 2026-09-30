// Native file helpers for CSV read/save (iOS/Android). Web uses csvFile.web.ts.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export async function readTextFile(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}

export async function saveCSV(filename: string, content: string): Promise<void> {
  const uri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: filename, UTI: "public.comma-separated-values-text" });
  }
}
