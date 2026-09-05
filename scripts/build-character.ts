/**
 * Merges a character's Tripo exports into one optimized, validated GLB.
 *
 * Reads assets/raw/<characterId>/ and writes assets/optimized/<characterId>/.
 * The raw archive is never modified, so this is safe to re-run at any time.
 *
 *   npm run build:character -- job_abc123            # build one character
 *   npm run build:character -- job_abc123 --ingest   # seed raw/ from storage/ first
 *   npm run build:character -- --all --ingest        # every job in storage/
 *
 * Exits non-zero if any character fails to build or validate.
 */
import fs from "node:fs/promises";
import { config } from "../lib/config";
import { buildCharacter, type BuildResult } from "../lib/glb/pipeline";

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(2);
}

function report(result: BuildResult) {
  const saved = result.rawBytes ? (1 - result.bytes / result.rawBytes) * 100 : 0;
  console.log(
    `  ${mb(result.rawBytes)}MB raw -> ${mb(result.bytes)}MB merged ` +
      `(-${saved.toFixed(0)}%), ${result.triangles.toLocaleString()} tris`
  );
  for (const clip of result.clips) {
    console.log(`  clip ${clip.name.padEnd(26)} ${clip.channels} tracks, ${clip.duration}s`);
  }
  console.log(`  -> ${result.output}`);
}

async function main() {
  const args = process.argv.slice(2);
  const ingest = args.includes("--ingest");
  const all = args.includes("--all");
  const ids = args.filter((a) => !a.startsWith("--"));

  let characters = ids;
  if (all) {
    const entries = await fs.readdir(config.storageDir, { withFileTypes: true });
    characters = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  if (!characters.length) {
    console.error("Usage: npm run build:character -- <characterId> [--ingest] | --all");
    process.exit(1);
  }

  const failures: string[] = [];
  for (const characterId of characters) {
    console.log(`\n${characterId}`);
    try {
      report(await buildCharacter(characterId, { ingest }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${message}`);
      failures.push(characterId);
    }
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length}/${characters.length} failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n✓ Built ${characters.length} character(s).`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
