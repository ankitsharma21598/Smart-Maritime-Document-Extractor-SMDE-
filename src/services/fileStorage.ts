import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

export async function ensureUploadsDir(): Promise<void> {
  await mkdir(config.uploadsDir, { recursive: true });
}

export function pathForHash(fileHash: string): string {
  return join(config.uploadsDir, fileHash);
}

export async function saveUpload(fileHash: string, buffer: Buffer): Promise<string> {
  await ensureUploadsDir();
  const p = pathForHash(fileHash);
  await writeFile(p, buffer);
  return p;
}
