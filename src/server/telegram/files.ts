import type { Api } from "grammy";

export type TelegramDownloader = (api: Api, fileId: string) => Promise<Buffer>;

/** Unduh file dari Telegram. URL berisi token bot, jadi tidak pernah dicatat ke log. */
const defaultDownloader: TelegramDownloader = async (api, fileId) => {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("File Telegram tidak tersedia");
  const res = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Gagal mengunduh file Telegram (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
};

let downloader: TelegramDownloader = defaultDownloader;
export const downloadTelegramFile: TelegramDownloader = (api, fileId) => downloader(api, fileId);

/** Hanya untuk test. */
export function setTelegramDownloader(d: TelegramDownloader | null) {
  downloader = d ?? defaultDownloader;
}
