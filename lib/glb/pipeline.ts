import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { ingestFromJob, readRawSources, type RawSource } from "./ingest";
import { createIO } from "./io";
import { mergeClips, type MergedClip } from "./merge";
import { optimizeDocument, triangleCount } from "./optimize";
import { manifestPath, optimizedDir, optimizedGlb, rawDir } from "./paths";
import { validate } from "./validate";

export interface BuildResult {
  characterId: string;
  output: string;
  bytes: number;
  rawBytes: number;
  triangles: number;
  clips: MergedClip[];
}

/**
 * Raw exports in, one validated GLB out.
 *
 * Reads only from assets/raw/ and writes only to assets/optimized/, so the build
 * is repeatable: delete the output, run again, get the same file. Nothing here
 * mutates the archive.
 */
export async function buildCharacter(
  characterId: string,
  opts: { ingest?: boolean } = {}
): Promise<BuildResult> {
  if (opts.ingest) await ingestFromJob(characterId);

  const io = await createIO();
  const { base, clips } = await readRawSources(characterId);
  const nameFor = await clipNamer(characterId);

  const doc = await io.read(base.file);
  const merged = await mergeClips(doc, clips, io, nameFor);

  await optimizeDocument(doc);

  const output = optimizedGlb(characterId);
  await fs.mkdir(optimizedDir(characterId), { recursive: true });

  // Build to a staging path and only promote it once validation passes, so a
  // failed run leaves the last good build in place instead of replacing it with
  // a broken one.
  // writeBinary/readBinary rather than write(path): NodeIO picks its format from
  // the file extension, so a staging path ending in anything but `.glb` silently
  // produces glTF JSON with external .bin and .webp sidecars.
  const staged = `${output}.staging`;
  const glb = await io.writeBinary(doc);
  await fs.writeFile(staged, glb);
  const bytes = glb.byteLength;

  // Validate the encoded bytes rather than the in-memory document — the write
  // itself is part of what we are checking.
  const written = await io.readBinary(glb);
  try {
    validate(written, bytes, merged.map((c) => c.name));
  } catch (err) {
    // Keep the bad file for inspection, but never where it could be mistaken
    // for something shippable.
    const rejected = `${output}.rejected`;
    await fs.rename(staged, rejected);
    throw new Error(`${(err as Error).message}\n\nRejected build kept at ${rejected}`);
  }

  await fs.rename(staged, output);

  const result: BuildResult = {
    characterId,
    output,
    bytes,
    rawBytes: await dirBytes(rawDir(characterId)),
    triangles: triangleCount(written),
    clips: merged,
  };

  await fs.writeFile(
    manifestPath(characterId),
    JSON.stringify(
      {
        characterId,
        builtAt: new Date().toISOString(),
        base: base.filename,
        textureSize: config.textureSize,
        triangles: result.triangles,
        bytes,
        clips: merged,
      },
      null,
      2
    )
  );

  return result;
}

/**
 * Names each clip after the Tripo action it came from.
 *
 * job.json holds the true action names (`preset:biped:idle`); the filenames
 * finalize() wrote are slugs of those, with the punctuation flattened. Prefer
 * the job record and fall back to the slug for characters with no job.json.
 */
async function clipNamer(
  characterId: string
): Promise<(source: RawSource, animation: { getName(): string }, index: number) => string> {
  const byIndex = new Map<number, string>();
  try {
    const raw = await fs.readFile(
      path.join(config.storageDir, characterId, "job.json"),
      "utf8"
    );
    const job = JSON.parse(raw) as { animations?: { name?: string }[] };
    job.animations?.forEach((a, i) => {
      if (a.name) byIndex.set(i, a.name);
    });
  } catch {
    // No job record — filenames and embedded names are enough.
  }

  return (source, animation) => {
    const match = /^anim-(\d+)-/.exec(source.filename);
    const fromJob = match ? byIndex.get(Number(match[1])) : undefined;
    return fromJob ?? animation.getName() ?? source.action ?? source.filename;
  };
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir)) {
    if (!entry.endsWith(".glb")) continue;
    total += (await fs.stat(path.join(dir, entry))).size;
  }
  return total;
}
