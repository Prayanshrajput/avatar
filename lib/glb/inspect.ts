/**
 * Reads the JSON chunk out of a GLB, without a glTF library.
 *
 * An uploaded GLB has to be checked before it is saved (a renamed ZIP must not
 * become a job) and its clip names have to be known so the viewer can offer them
 * as takes. @gltf-transform would do both, but it is a devDependency used only by
 * the offline scripts — pulling it into the server runtime for a header read is
 * not worth it. The container layout is fixed by the spec: a 12-byte header, then
 * length-prefixed chunks, the first of which must be the JSON.
 */

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

export class InvalidGlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGlbError";
  }
}

export interface GlbInfo {
  /** Animation clip names, in file order. Unnamed clips get their index. */
  clips: string[];
  /** A skinned mesh means the clips can actually deform the body. */
  hasSkin: boolean;
  /** Whatever authored the file, e.g. "Khronos glTF Blender I/O". */
  generator?: string;
}

export function inspectGlb(data: Buffer | Uint8Array): GlbInfo {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 20) throw new InvalidGlbError("File is too small to be a GLB.");

  if (buf.readUInt32LE(0) !== MAGIC) {
    throw new InvalidGlbError(
      "That is not a binary glTF file. Export or convert to .glb (a .gltf + textures folder will not work)."
    );
  }
  const version = buf.readUInt32LE(4);
  if (version !== 2) {
    throw new InvalidGlbError(`Unsupported GLB version ${version}. Only glTF 2.0 is supported.`);
  }

  // The spec requires the JSON chunk to come first; anything else is malformed.
  const chunkLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) {
    throw new InvalidGlbError("GLB is malformed: its first chunk is not JSON.");
  }
  if (20 + chunkLength > buf.length) {
    throw new InvalidGlbError("GLB is truncated: its JSON chunk runs past the end of the file.");
  }

  let gltf: {
    animations?: { name?: string }[];
    skins?: unknown[];
    asset?: { generator?: string };
  };
  try {
    gltf = JSON.parse(buf.toString("utf8", 20, 20 + chunkLength));
  } catch {
    throw new InvalidGlbError("GLB is malformed: its JSON chunk could not be parsed.");
  }

  return {
    clips: (gltf.animations ?? []).map((a, i) => a.name?.trim() || `Clip ${i + 1}`),
    hasSkin: Boolean(gltf.skins?.length),
    generator: gltf.asset?.generator,
  };
}
