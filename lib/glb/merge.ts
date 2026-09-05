import type { Animation, Document, Node, NodeIO } from "@gltf-transform/core";
import { copyToDocument } from "@gltf-transform/functions";
import type { RawSource } from "./ingest";

export interface MergedClip {
  name: string;
  sourceFile: string;
  channels: number;
  /** Seconds; the largest keyframe time across the clip's samplers. */
  duration: number;
}

/**
 * Merges every per-action export into the base document.
 *
 * Tripo returns each retargeted action as a complete copy of the character —
 * same mesh, same 41-joint skeleton, same three 2048px textures — so naively
 * concatenating the files would multiply the geometry by the number of actions.
 * Since the rig is identical across exports, we keep the base document's mesh
 * and skeleton and lift only the animation out of each action file, re-pointing
 * its channels at the base skeleton's joints by name.
 *
 * Joint names are the contract. If an action targets a bone the base rig does
 * not have, the export did not come from this rig and merging it would produce
 * a clip that silently animates nothing — so that throws.
 */
export async function mergeClips(
  base: Document,
  clips: RawSource[],
  io: NodeIO,
  nameFor: (source: RawSource, animation: Animation, index: number) => string
): Promise<MergedClip[]> {
  const joints = nodesByName(base);
  const merged: MergedClip[] = [];
  const taken = new Set<string>();

  for (const source of clips) {
    const doc = await io.read(source.file);
    const animations = doc.getRoot().listAnimations();

    if (!animations.length) {
      throw new Error(`${source.filename} contains no animation clip`);
    }

    for (const [i, animation] of animations.entries()) {
      // Copies the animation and, unavoidably, the source nodes its channels
      // point at. Those duplicates are disposed below once the channels have
      // been moved onto the base skeleton.
      const copies = copyToDocument(base, doc, [animation]);
      const copied = copies.get(animation) as Animation;

      const orphans: Node[] = [];
      for (const channel of copied.listChannels()) {
        const target = channel.getTargetNode();
        const name = target?.getName();
        const joint = name ? joints.get(name) : undefined;

        if (!joint) {
          throw new Error(
            `${source.filename}: channel targets bone "${name ?? "(unnamed)"}", ` +
              `which is not in the base rig (${base.getRoot().listSkins()[0]?.listJoints().length ?? 0} joints). ` +
              `Rigs must match across exports.`
          );
        }

        channel.setTargetNode(joint);
        if (target) orphans.push(target);
      }

      const name = unique(nameFor(source, animation, i), taken);
      copied.setName(name);
      taken.add(name);

      merged.push({
        name,
        sourceFile: source.filename,
        channels: copied.listChannels().length,
        duration: durationOf(copied),
      });

      // Drop the duplicated skeleton/mesh this copy dragged in. Their accessors,
      // materials and textures fall out of reference and prune() collects them.
      for (const node of orphans) {
        if (!node.isDisposed()) node.dispose();
      }
    }
  }

  if (!merged.length) {
    throw new Error("No animation clips were merged");
  }

  consolidateBuffers(base);
  return merged;
}

/**
 * Points every accessor at a single buffer.
 *
 * Each copied animation arrives with its source document's buffer attached, and
 * a .glb is only allowed one. Without this the write fails outright with
 * "GLB must have 0–1 buffers".
 */
function consolidateBuffers(doc: Document): void {
  const root = doc.getRoot();
  const [primary] = root.listBuffers();
  if (!primary) return;

  for (const accessor of root.listAccessors()) {
    accessor.setBuffer(primary);
  }
  for (const buffer of root.listBuffers()) {
    if (buffer !== primary) buffer.dispose();
  }
}

/**
 * Base-rig joints, indexed by name.
 *
 * Built from the whole node list rather than the skin's joints because clips
 * often drive the armature root — which carries root motion but is not itself
 * a joint.
 */
function nodesByName(doc: Document): Map<string, Node> {
  const map = new Map<string, Node>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (name && !map.has(name)) map.set(name, node);
  }
  return map;
}

function durationOf(animation: Animation): number {
  let max = 0;
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (!input) continue;
    const count = input.getCount();
    if (count) max = Math.max(max, input.getScalar(count - 1));
  }
  return Number(max.toFixed(3));
}

function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}
