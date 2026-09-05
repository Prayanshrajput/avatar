import type { Document } from "@gltf-transform/core";
import { config } from "@/lib/config";

export class ValidationError extends Error {
  constructor(public readonly failures: string[]) {
    super(`Output failed validation:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    this.name = "ValidationError";
  }
}

/**
 * Gate between "the pipeline finished" and "this file is safe to ship".
 *
 * Every check here corresponds to a way the merge can succeed mechanically and
 * still produce a model that is broken in the viewer: a clip that plays nothing,
 * a duplicated body, or a file too heavy to be worth merging in the first place.
 * Collects all failures before throwing so one run reports everything wrong.
 */
export function validate(
  doc: Document,
  bytes: number,
  expectedClips: string[]
): void {
  const failures: string[] = [];
  const root = doc.getRoot();

  const animations = root.listAnimations();
  const names = animations.map((a) => a.getName());

  if (!animations.length) {
    failures.push("no animation clips in output");
  }

  for (const expected of expectedClips) {
    if (!names.includes(expected)) failures.push(`clip "${expected}" missing from output`);
  }

  // An empty clip loads and plays without error, showing a frozen avatar. This
  // is the failure the whole validation step exists to catch.
  for (const animation of animations) {
    const name = animation.getName() || "(unnamed)";
    const channels = animation.listChannels();

    if (!channels.length) {
      failures.push(`clip "${name}" has no channels`);
      continue;
    }

    const dead = channels.filter((c) => {
      const output = c.getSampler()?.getOutput();
      const input = c.getSampler()?.getInput();
      return !output || !input || output.getCount() === 0 || input.getCount() === 0;
    });
    if (dead.length) {
      failures.push(`clip "${name}" has ${dead.length}/${channels.length} empty tracks`);
    }

    const unbound = channels.filter((c) => !c.getTargetNode());
    if (unbound.length) {
      failures.push(`clip "${name}" has ${unbound.length} channels bound to no node`);
    }
  }

  // The merge keeps one body and retargets onto it. More than one skinned mesh
  // means a duplicate came across with a clip; zero means the base lost its skin.
  const skinned = root.listNodes().filter((n) => n.getSkin() && n.getMesh());
  if (skinned.length !== 1) {
    failures.push(`expected exactly 1 skinned mesh, found ${skinned.length}`);
  }

  const skins = root.listSkins();
  if (skins.length !== 1) {
    failures.push(`expected exactly 1 skin, found ${skins.length}`);
  }

  if (bytes > config.maxOutputBytes) {
    failures.push(
      `output is ${mb(bytes)}MB, over the ${mb(config.maxOutputBytes)}MB budget`
    );
  }

  if (failures.length) throw new ValidationError(failures);
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(2);
}
