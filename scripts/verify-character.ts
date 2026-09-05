/**
 * Loads an optimized character with the same loader the browser uses.
 *
 * The pipeline's own validation runs through gltf-transform, which will happily
 * accept a file three.js cannot use — during development it passed a build that
 * had been written as glTF JSON referencing .bin and .webp sidecars that were
 * never emitted. Parsing with GLTFLoader is the only check that catches that
 * class of bug, so it is worth the awkwardness of running it under Node.
 *
 *   npm run verify:character -- job_abc123
 *
 * Texture decoding is skipped (Node has no image decoder for the blob URLs
 * GLTFLoader creates); geometry, skinning and clip binding are all real.
 */
// GLTFLoader reaches for `self` at import time.
(globalThis as Record<string, unknown>).self ??= globalThis;

import fs from "node:fs/promises";
import type { Object3D, SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { optimizedGlb } from "../lib/glb/paths";

async function verify(characterId: string): Promise<string[]> {
  const file = optimizedGlb(characterId);
  const buf = await fs.readFile(file);
  const gltf = await new GLTFLoader().parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    ""
  );

  const failures: string[] = [];
  const skinned: SkinnedMesh[] = [];
  gltf.scene.traverse((o: Object3D) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh);
  });

  if (skinned.length !== 1) failures.push(`expected 1 skinned mesh, found ${skinned.length}`);
  if (!gltf.animations.length) failures.push("no clips");

  const names = new Set<string>();
  gltf.scene.traverse((o: Object3D) => {
    if (o.name) names.add(o.name);
  });

  console.log(`  ${skinned.length} skinned mesh, ${skinned[0]?.skeleton?.bones.length ?? 0} bones`);
  for (const clip of gltf.animations) {
    // A track whose target node is missing is silently ignored at playback —
    // the avatar just stands still. This is what we are really looking for.
    const unbound = clip.tracks.filter((t) => !names.has(t.name.split(".")[0]));
    const status = unbound.length ? `${unbound.length} UNBOUND` : "ok";
    console.log(
      `  ${clip.name.padEnd(26)} ${String(clip.tracks.length).padStart(3)} tracks  ` +
        `${clip.duration.toFixed(2)}s  ${status}`
    );
    if (unbound.length) {
      failures.push(`clip "${clip.name}" has ${unbound.length} tracks bound to no node`);
    }
    if (!clip.duration) failures.push(`clip "${clip.name}" has zero duration`);
  }

  return failures;
}

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!ids.length) {
    console.error("Usage: npm run verify:character -- <characterId>...");
    process.exit(1);
  }

  let failed = 0;
  for (const id of ids) {
    console.log(`\n${id}`);
    try {
      const failures = await verify(id);
      if (failures.length) {
        failed++;
        for (const f of failures) console.error(`  ✗ ${f}`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${err instanceof Error ? err.message : err}`);
    }
  }

  if (failed) {
    console.error(`\n✗ ${failed}/${ids.length} failed verification.`);
    process.exit(1);
  }
  console.log(`\n✓ ${ids.length} character(s) load and animate.`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
