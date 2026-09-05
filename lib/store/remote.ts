import fs from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";
import { CONTENT_TYPES } from "@/lib/store/content-types";

/**
 * Durable mirror of ./storage in a Supabase Storage bucket.
 *
 * Container hosts give the app a writable disk that is wiped on every restart or
 * rebuild, so anything generated at runtime is gone the next boot. This module
 * keeps the local disk as the working copy — every read path in the app still
 * hits the filesystem, unchanged — and treats the bucket as the durable copy:
 * uploaded to as jobs write, downloaded back on boot.
 *
 * Only ./storage is mirrored. That is what the browser is served (see
 * lib/store/files.ts assetUrl -> app/api/assets), whereas ./assets is a rebuild
 * archive for scripts/build-character.ts and an order of magnitude larger.
 *
 * Disabled — every function a no-op — unless both SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set, so local development keeps working with no
 * Supabase project at all.
 */

/** One page of a bucket listing; Supabase caps this well above our job counts. */
const LIST_PAGE = 1000;

export function remoteEnabled(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

let cached: SupabaseClient | null = null;
function client(): SupabaseClient {
  cached ??= createClient(config.supabaseUrl, config.supabaseServiceKey, {
    // A background mirror has no user session to persist or refresh.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function bucket() {
  return client().storage.from(config.supabaseBucket);
}

/** Object keys are always posix, even when the local disk is not. */
function toKey(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

function contentType(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

// --- push -------------------------------------------------------------------

/**
 * Uploads in flight. Object storage handles concurrent writes to distinct keys
 * fine, so these run unbatched — the set exists only so flush() can await them.
 */
const inflight = new Set<Promise<void>>();

/**
 * Mirrors a file that was just written to disk. Returns immediately — callers
 * are on the job's critical path and a slow upload must not stall the pipeline.
 */
export function pushAsset(relPath: string): void {
  if (!remoteEnabled()) return;
  const task = upload(relPath).finally(() => void inflight.delete(task));
  inflight.add(task);
}

/** Waits for every queued upload. Await at a job's terminal state so the last
 *  write cannot be lost to a restart that lands mid-upload. */
export async function flush(): Promise<void> {
  if (!remoteEnabled()) return;
  await Promise.all([...inflight]);
}

async function upload(relPath: string): Promise<void> {
  const key = toKey(relPath);
  try {
    await ensureBucket();
    const body = await fs.readFile(path.join(config.storageDir, relPath));

    const { error } = await bucket().upload(key, body, {
      // job.json is rewritten on every step, and a retried asset keeps its name.
      upsert: true,
      contentType: contentType(key),
    });
    if (error) throw error;
  } catch (err) {
    // A mirror failure must never fail the job that triggered it — the bytes are
    // on local disk either way, and the next write to this job re-uploads.
    console.error(`[remote] upload ${key} failed:`, err instanceof Error ? err.message : err);
  }
}

let ensured = false;
async function ensureBucket(): Promise<void> {
  if (ensured) return;
  const { error } = await client().storage.getBucket(config.supabaseBucket);
  if (error) {
    // Private: assets are served through app/api/assets, never straight from the
    // bucket, so nothing here needs to be world-readable.
    const created = await client().storage.createBucket(config.supabaseBucket, { public: false });
    if (created.error) throw created.error;
    console.log(`[remote] created bucket ${config.supabaseBucket}`);
  }
  ensured = true;
}

// --- pull -------------------------------------------------------------------

/**
 * Restores ./storage from the bucket. Called once at server boot; on a fresh
 * container this is what makes previously generated avatars reappear.
 *
 * Files already on disk at the expected size are left alone, so a restart that
 * kept its disk costs a listing rather than a full re-download.
 */
export async function restore(): Promise<void> {
  if (!remoteEnabled()) return;

  const probe = await bucket().list("", { limit: 1 });
  if (probe.error) {
    console.log(`[remote] bucket ${config.supabaseBucket} unavailable — nothing to restore`);
    return;
  }
  ensured = true;

  const root = path.resolve(config.storageDir);
  let restored = 0;
  let skipped = 0;

  for await (const entry of walk("")) {
    const dest = path.resolve(root, entry.key);
    // The bucket is ours, but a crafted key must still not escape storageDir.
    if (!dest.startsWith(root + path.sep)) continue;

    try {
      const stat = await fs.stat(dest);
      if (stat.size === entry.size) {
        skipped++;
        continue;
      }
    } catch {
      // not on disk — fall through and download
    }

    const { data, error } = await bucket().download(entry.key);
    if (error || !data) {
      console.error(`[remote] download ${entry.key} failed:`, error?.message);
      continue;
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(await data.arrayBuffer()));
    restored++;
  }

  console.log(`[remote] restore complete: ${restored} downloaded, ${skipped} already present`);
}

/**
 * Yields every object under a prefix.
 *
 * Supabase's list() is one level deep and has no recursive flag, so folders are
 * walked by hand. A folder entry is the one whose `id` is null.
 */
async function* walk(prefix: string): AsyncGenerator<{ key: string; size: number }> {
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket().list(prefix, { limit: LIST_PAGE, offset });
    if (error) {
      console.error(`[remote] list ${prefix || "/"} failed:`, error.message);
      return;
    }
    if (!data || data.length === 0) return;

    for (const entry of data) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        yield* walk(key);
      } else {
        yield { key, size: entry.metadata?.size ?? -1 };
      }
    }

    if (data.length < LIST_PAGE) return;
  }
}
