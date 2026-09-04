/**
 * Shrinks GLBs that are already on disk.
 *
 * Jobs generated before TRIPO_FACE_LIMIT was set came back at ~1.4M triangles and
 * ~50MB each — fine on desktop, fatal on a phone GPU. This decimates the mesh and
 * quantises the vertex data in place so existing avatars become mobile-viewable
 * without regenerating them (and without spending credits).
 *
 *   npm run optimize:glb                 # every job in storage/
 *   npm run optimize:glb -- job_abc123   # one job
 */
import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, weld, quantize, prune, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { config } from "../lib/config";

const TARGET_RATIO_FLOOR = 0.02;

async function countTriangles(io: NodeIO, file: string) {
  const doc = await io.read(file);
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

async function optimize(file: string, io: NodeIO) {
  const before = (await fs.stat(file)).size;
  const doc = await io.read(file);

  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      tris += indices
        ? indices.getCount() / 3
        : (prim.getAttribute("POSITION")?.getCount() ?? 0) / 3;
    }
  }

  const ratio = Math.max(TARGET_RATIO_FLOOR, Math.min(1, config.faceLimit / Math.max(tris, 1)));

  await doc.transform(
    dedup(),
    // weld() merges coincident vertices, which simplify() requires to work well.
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }),
    prune(),
    // Quantisation is where most of the remaining file size goes.
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 })
  );

  await io.write(file, doc);
  const after = (await fs.stat(file)).size;
  const afterTris = await countTriangles(io, file);

  console.log(
    `  ${path.basename(file).padEnd(34)} ` +
      `${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB   ` +
      `${tris.toLocaleString()} -> ${afterTris.toLocaleString()} tris`
  );
}

async function main() {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  const only = process.argv[2];
  const entries = await fs.readdir(config.storageDir, { withFileTypes: true });
  const jobs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !only || name === only);

  if (!jobs.length) {
    console.error(only ? `No such job: ${only}` : "No jobs in storage/");
    process.exit(1);
  }

  for (const job of jobs) {
    const dir = path.join(config.storageDir, job);
    const glbs = (await fs.readdir(dir)).filter((f) => f.endsWith(".glb"));
    if (!glbs.length) continue;

    console.log(`\n${job}`);
    for (const glb of glbs) {
      try {
        await optimize(path.join(dir, glb), io);
      } catch (err) {
        console.log(`  ${glb}: skipped — ${(err as Error).message}`);
      }
    }
  }

  console.log("\n✓ Done. Reload the job page — the viewer serves these files directly.");
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
