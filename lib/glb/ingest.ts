import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { rawDir } from "./paths";

export interface RawSource {
  /** Absolute path inside assets/raw/<characterId>/. */
  file: string;
  filename: string;
  /** The Tripo action this GLB came from, or null for the base mesh/rig. */
  action: string | null;
}

/**
 * Copies a downloaded GLB into the raw archive, byte for byte.
 *
 * Refuses to overwrite. A raw file that already exists is the original by
 * definition, and a second download of the same name is either a retry (same
 * bytes, nothing to do) or a regeneration that would destroy the archive. Both
 * cases are better served by keeping what we have.
 */
export async function archiveRaw(
  characterId: string,
  filename: string,
  data: Buffer | Uint8Array
): Promise<string> {
  const dir = rawDir(characterId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, filename);

  // 'wx' fails with EEXIST rather than truncating — the archive's whole guarantee.
  try {
    await fs.writeFile(target, data, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return target;
}

/**
 * Seeds the raw archive from a job folder for characters generated before this
 * pipeline existed.
 *
 * Only copies files that are not already archived, so running it after
 * `scripts/optimize-glb.ts` has decimated a job folder cannot replace good
 * originals with degraded ones.
 */
export async function ingestFromJob(characterId: string): Promise<number> {
  const dir = path.join(config.storageDir, characterId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`No job folder at ${dir} to ingest from`);
  }

  let copied = 0;
  for (const filename of entries.filter((f) => f.endsWith(".glb"))) {
    const target = path.join(rawDir(characterId), filename);
    const exists = await fs
      .stat(target)
      .then(() => true)
      .catch(() => false);
    if (exists) continue;
    await archiveRaw(characterId, filename, await fs.readFile(path.join(dir, filename)));
    copied++;
  }
  return copied;
}

/**
 * Sorts the archive into the base rig and the animation exports.
 *
 * `rigged.glb` is preferred as the base: it carries the mesh and skeleton with
 * no animation, so nothing has to be stripped from it. `mesh.glb` is the
 * unrigged mesh and is deliberately ignored — it has no skin to merge onto.
 */
export async function readRawSources(
  characterId: string
): Promise<{ base: RawSource; clips: RawSource[] }> {
  const dir = rawDir(characterId);
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith(".glb")).sort();
  } catch {
    // Distinguish "not archived yet" from "this job has nothing to archive" —
    // most jobs that land here failed before 3D generation and never will.
    const job = path.join(config.storageDir, characterId);
    const inStorage = await fs
      .readdir(job)
      .then((f) => f.filter((n) => n.endsWith(".glb")).length)
      .catch(() => 0);
    throw new Error(
      inStorage
        ? `No raw archive at ${dir}, but ${job} has ${inStorage} GLB(s). Re-run with --ingest.`
        : `No GLB exports for ${characterId} — nothing in ${dir} or ${job}. ` +
          `The job likely never reached 3D generation.`
    );
  }

  const animFiles = entries.filter((f) => f.startsWith("anim-"));
  const clips: RawSource[] = animFiles.map((filename) => ({
    file: path.join(dir, filename),
    filename,
    action: actionFromFilename(filename),
  }));

  const baseFile = entries.includes("rigged.glb") ? "rigged.glb" : animFiles[0];
  if (!baseFile) {
    throw new Error(
      `No rigged.glb or anim-*.glb in ${dir} — nothing to merge (mesh.glb alone has no skeleton)`
    );
  }

  return {
    base: { file: path.join(dir, baseFile), filename: baseFile, action: null },
    clips,
  };
}

/** `anim-1-preset-biped-walk.glb` -> `preset-biped-walk`, the slug finalize() wrote. */
function actionFromFilename(filename: string): string | null {
  const match = /^anim-\d+-(.+)\.glb$/.exec(filename);
  return match ? match[1] : null;
}
