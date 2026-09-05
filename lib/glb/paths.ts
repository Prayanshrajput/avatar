import path from "node:path";
import { config } from "@/lib/config";

/**
 * Two-tier asset layout.
 *
 * `raw/` is an archive: bytes exactly as Tripo returned them, written once and
 * never modified. `optimized/` is disposable output — deleting all of it and
 * re-running the pipeline must reproduce the same result, which is only true as
 * long as nothing ever writes back into `raw/`.
 */
export function rawDir(characterId: string): string {
  return path.join(config.assetsDir, "raw", characterId);
}

export function optimizedDir(characterId: string): string {
  return path.join(config.assetsDir, "optimized", characterId);
}

/** The single merged, optimized GLB the browser loads. */
export function optimizedGlb(characterId: string): string {
  return path.join(optimizedDir(characterId), "character.glb");
}

/** Records what went in, what came out, and how the clips were named. */
export function manifestPath(characterId: string): string {
  return path.join(optimizedDir(characterId), "manifest.json");
}
