import type { Document } from "@gltf-transform/core";
import { Format } from "@gltf-transform/core";
import {
  dedup,
  prune,
  resample,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { config } from "@/lib/config";

/**
 * Shrinks the merged document for the browser.
 *
 * Deliberately no Draco: it needs a decoder shipped to the client and costs a
 * decode pass on load, and the win over plain WebP textures plus a simplified
 * mesh is small for a 30k-triangle stylised avatar. Textures dominate the file
 * here, not geometry.
 */
export async function optimizeDocument(doc: Document): Promise<void> {
  await MeshoptSimplifier.ready;

  const tris = triangleCount(doc);
  // simplify() takes a keep-ratio, not a target count.
  const ratio = Math.max(0.02, Math.min(1, config.faceLimit / Math.max(tris, 1)));

  await doc.transform(
    // Merge identical accessors/materials/textures first — every action export
    // carried its own copy of the same three textures.
    dedup(),
    // Clear out the skeletons and meshes the merge orphaned, so nothing below
    // spends time simplifying or recompressing geometry that is already dead.
    prune({ keepLeaves: false, keepAttributes: false }),
    // Drops keyframes that linear interpolation reproduces. Retargeted clips are
    // baked at a fixed rate, so this is where most animation weight goes.
    resample(),
    // simplify() needs coincident vertices merged to collapse edges across them.
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [config.textureSize, config.textureSize],
    }),
    // textureCompress can leave solid-colour textures worth folding into material
    // factors, and simplify can strip the last user of an attribute.
    prune({ keepLeaves: false, keepAttributes: false })
  );
}

export function triangleCount(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += indices
        ? indices.getCount() / 3
        : (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(tris);
}

/** Written as a single self-contained .glb — no sidecar .bin or image files. */
export const OUTPUT_FORMAT = Format.GLB;
