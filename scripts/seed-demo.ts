/**
 * Creates a fake completed job from Khronos sample assets, so the viewer can be
 * exercised end to end without an API key or a single 3D credit.
 *
 *   npm run seed:demo
 */
import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { config } from "../lib/config";
import { assetUrl } from "../lib/store/files";
import type { JobRecord } from "../lib/types";

const BASE =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

// Reuses two sample models across several preset names purely so the viewer's
// looping, one-shot and effect paths can all be clicked through offline.
const SOURCES = [
  { file: "anim-0-idle.glb", url: `${BASE}/CesiumMan/glTF-Binary/CesiumMan.glb`, name: "preset:biped:idle" },
  { file: "anim-1-walk.glb", url: `${BASE}/Fox/glTF-Binary/Fox.glb`, name: "preset:biped:walk" },
  { file: "anim-2-wave.glb", url: `${BASE}/CesiumMan/glTF-Binary/CesiumMan.glb`, name: "preset:biped:wave_goodbye_01" },
];

const JOB_ID = "job_demo";

async function main() {
  const dir = path.join(config.storageDir, JOB_ID);
  await fs.mkdir(dir, { recursive: true });

  for (const source of SOURCES) {
    const target = path.join(dir, source.file);
    process.stdout.write(`  downloading ${source.file}… `);
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${source.url}`);
    await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));

    // Same assertion the spike makes: it must actually be skinned and animated.
    const doc = await new NodeIO().read(target);
    const root = doc.getRoot();
    const joints = root.listSkins()[0]?.listJoints().length ?? 0;
    const clips = root.listAnimations().length;
    if (!joints) throw new Error(`${source.file} has no skin`);
    if (!clips) throw new Error(`${source.file} has no animation`);
    console.log(`ok (${joints} joints, ${clips} clips)`);
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    id: JOB_ID,
    createdAt: now,
    updatedAt: now,
    status: "done",
    step: "finalize",
    completed: ["understand", "stylize", "generate3d", "prerigCheck", "rig", "retarget", "finalize"],
    input: { kind: "prompt", prompt: "Khronos sample assets (viewer smoke test)" },
    stylizeAttempts: 1,
    // A rig task id is what makes "Add an animation" available in the viewer.
    rigTaskId: "fake_rig_demo",
    riggedUrl: assetUrl(JOB_ID, SOURCES[0].file),
    animations: SOURCES.map((s) => ({ name: s.name, url: assetUrl(JOB_ID, s.file) })),
  };
  await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2));

  console.log(`\n✓ Demo job seeded. Run \`npm run dev\` and open http://localhost:3000/jobs/${JOB_ID}`);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
