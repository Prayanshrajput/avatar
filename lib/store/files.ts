import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";

export function jobDir(jobId: string): string {
  return path.join(config.storageDir, jobId);
}

export async function ensureJobDir(jobId: string): Promise<string> {
  const dir = jobDir(jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Writes bytes into the job folder and returns the URL the browser should use. */
export async function writeAsset(
  jobId: string,
  filename: string,
  data: Buffer | Uint8Array
): Promise<string> {
  const dir = await ensureJobDir(jobId);
  await fs.writeFile(path.join(dir, filename), data);
  return assetUrl(jobId, filename);
}

export function assetUrl(jobId: string, filename: string): string {
  return `/api/assets/${jobId}/${filename}`;
}

/** Pulls a vendor result (mesh, animation GLB) into local storage so the demo keeps working
 *  after the vendor's signed URLs expire. */
export async function downloadAsset(
  jobId: string,
  filename: string,
  url: string
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${filename}: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return writeAsset(jobId, filename, buf);
}

/** Guards the asset route against `..` traversal out of the storage dir. */
export function resolveAssetPath(segments: string[]): string | null {
  const target = path.resolve(config.storageDir, ...segments);
  const root = path.resolve(config.storageDir);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

export const CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};
