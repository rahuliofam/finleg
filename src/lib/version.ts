import fs from "fs";
import path from "path";

interface VersionInfo {
  version: string;
  release: number;
  sha: string;
  fullSha: string;
  actor: string;
  pushedAt: string;
  commits: Array<{ sha: string; message: string; author: string }>;
}

/**
 * Read the current version from version.json at project root.
 * Works at build time in Next.js server components (static export).
 * Returns "dev" if version.json doesn't exist or is invalid.
 */
export function getVersion(): string {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "version.json"),
      "utf8"
    );
    const data: VersionInfo = JSON.parse(raw);
    return data.version || "dev";
  } catch {
    return "dev";
  }
}

/**
 * Read full version info from version.json.
 * Returns null if version.json doesn't exist or is invalid.
 */
export function getVersionInfo(): VersionInfo | null {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "version.json"),
      "utf8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}