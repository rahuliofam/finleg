export const API_BASE = "https://files.alpacaplayhouse.com";
export const PAGE_SIZE = 60;

export const IMG_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "heic"]);
export const VIDEO_EXTS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "flv", "m4v"]);
export const AUDIO_EXTS = new Set(["mp3", "flac", "wma", "aac", "wav", "ogg", "m4a"]);
export const DOC_EXTS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf"]);
export const FINANCIAL_EXTS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"]);

export function fileIcon(ext: string) {
  ext = (ext || "").toLowerCase();
  if (IMG_EXTS.has(ext)) return "\ud83d\uddbc\ufe0f";
  if (VIDEO_EXTS.has(ext)) return "\ud83c\udfa5";
  if (AUDIO_EXTS.has(ext)) return "\ud83c\udfa7";
  if (ext === "pdf") return "\ud83d\udcc4";
  if (DOC_EXTS.has(ext)) return "\ud83d\udcc3";
  if (["zip", "rar", "7z", "tgz", "gz", "tar"].includes(ext)) return "\ud83d\udce6";
  return "\ud83d\udcc1";
}

export function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

export interface FileResult {
  id: number;
  name: string;
  path: string;
  ext: string;
  dir: string;
  size: number;
  mtime_str: string;
  category: string;
  rank: number;
  exif?: ExifData;
}

export interface ExifData {
  camera_model?: string;
  date_taken?: string;
  focal_length?: string;
  aperture?: string;
  iso?: string;
  width?: number;
  height?: number;
}

export interface Stats {
  total_files?: number;
  total_size_tb?: string;
  total_photos?: number;
  photos_with_gps?: number;
  indexed_at?: string;
}

export interface UserOption {
  value: string;
  label: string;
}

export const USER_OPTIONS: UserOption[] = [
  { value: "", label: "All Drives" },
  { value: "tesloop", label: "Tesloop" },
  { value: "rahulioson", label: "Rahulioson" },
];
