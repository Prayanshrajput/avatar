/**
 * Vendor contract spike. Runs the whole 3D half of the pipeline against the live
 * Tripo API with a fixed image and no LLM involved, then verifies the result really
 * is a rigged, animated GLB that three.js can use.
 *
 *   npx tsx scripts/spike-tripo.ts ./fixtures/character.png
 *
 * Costs Tripo credits. This is the step that catches wrong endpoints, wrong field
 * names and skeleton incompatibilities before any orchestration code is involved.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { config } from "../lib/config";
import { tripoProvider } from "../lib/three-d/tripo";
import type { CreatureType } from "../lib/types";

const log = (msg: string) => console.log(`\n▸ ${msg}`);
const note = (msg: string) => console.log(`  ${msg}`);

async function main() {
  const imagePath = process.argv[2];
  const creatureType = (process.argv[3] ?? "biped") as CreatureType;

  if (!imagePath) {
    console.error("Usage: npx tsx scripts/spike-tripo.ts <image> [creatureType]");
    process.exit(1);
  }
  if (!config.tripoApiKey) {
    console.error("TRIPO_API_KEY is not set. Add it to .env.local and re-run with:");
    console.error("  node --env-file=.env.local ./node_modules/.bin/tsx scripts/spike-tripo.ts <image>");
    process.exit(1);
  }

  const outDir = path.join(config.storageDir, "spike");
  await fs.mkdir(outDir, { recursive: true });

  log(`Uploading ${imagePath}`);
  const bytes = await fs.readFile(imagePath);
  const imageRef = await tripoProvider.uploadImage(bytes, path.basename(imagePath));
  note(JSON.stringify(imageRef));

  log("Generating mesh");
  const mesh = await tripoProvider.generateMesh(imageRef, note);
  note(`task ${mesh.taskId}`);

  log("Checking riggability");
  const check = await tripoProvider.checkRiggable(mesh.taskId, note);
  note(`riggable=${check.riggable}${check.reason ? ` (${check.reason})` : ""}`);
  if (!check.riggable) {
    console.error("\n✗ Mesh is not riggable — the reference image pose is the thing to fix.");
    process.exit(1);
  }

  log(`Rigging as ${creatureType}`);
  const rigged = await tripoProvider.rig(mesh.taskId, creatureType, note);
  note(`task ${rigged.taskId}`);

  const presets = creatureType === "biped" ? config.animations : [`preset:${creatureType}:walk`];
  log(`Retargeting ${presets.join(", ")}`);
  const animations = await tripoProvider.retarget(rigged.taskId, presets, note);

  log("Downloading results");
  const files: string[] = [];
  for (const [name, url] of [
    ["mesh.glb", mesh.modelUrl],
    ["rigged.glb", rigged.modelUrl],
    ...animations.map((a, i) => [`anim-${i}-${a.name.replace(/[^a-z0-9]+/gi, "-")}.glb`, a.modelUrl] as const),
  ] as Array<readonly [string, string]>) {
    const res = await fetch(url);
    const target = path.join(outDir, name);
    await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
    files.push(target);
    note(target);
  }

  log("Verifying the rigged GLB");
  await verifyRig(path.join(outDir, "rigged.glb"));
  for (const [i, anim] of animations.entries()) {
    await verifyAnimation(
      path.join(outDir, `anim-${i}-${anim.name.replace(/[^a-z0-9]+/gi, "-")}.glb`),
      anim.name
    );
  }

  console.log(`\n✓ Spike passed. Files in ${outDir}`);
}

/** A GLB is only useful to us if it carries a skin (bones + weights), not just geometry. */
async function verifyRig(file: string) {
  const doc = await new NodeIO().read(file);
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (!skins.length) throw new Error(`${file} has no skin — the mesh is not actually rigged`);
  const joints = skins[0].listJoints();
  note(`skins=${skins.length} joints=${joints.length} meshes=${root.listMeshes().length}`);
  if (joints.length < 2) throw new Error(`${file} skin has only ${joints.length} joint(s)`);
}

async function verifyAnimation(file: string, name: string) {
  const doc = await new NodeIO().read(file);
  const animations = doc.getRoot().listAnimations();
  if (!animations.length) throw new Error(`${file} (${name}) contains no animation`);
  const channels = animations[0].listChannels().length;
  note(`${name}: animations=${animations.length} channels=${channels}`);
  if (!channels) throw new Error(`${file} (${name}) animation has no channels`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
