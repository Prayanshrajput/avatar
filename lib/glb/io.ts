import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

/**
 * Reader/writer for every GLB this pipeline touches.
 *
 * The meshopt dependencies are not optional: some GLBs already on disk are
 * EXT_meshopt_compression-encoded, and NodeIO throws on read without a decoder
 * rather than degrading. Registering both means we can read those files and
 * still write plain (uncompressed) output.
 */
export async function createIO(): Promise<NodeIO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
}
