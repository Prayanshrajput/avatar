import type { ThreeDProvider } from "@/lib/three-d/provider";

/**
 * Placeholder for the Meshy fallback.
 *
 * The seam that matters (`ThreeDProvider`) is already in place — Tripo is the
 * verified implementation. This is deliberately left unimplemented rather than
 * filled with endpoint shapes nobody has run against the live API: Meshy's
 * rigging is humanoid-only, so it is a narrower fallback than Tripo anyway.
 *
 * To fill it in: implement the six methods against
 * https://docs.meshy.ai/en/api/rigging and set THREED_PROVIDER=meshy.
 */
const notImplemented = (method: string) => (): never => {
  throw new Error(
    `Meshy provider is not implemented (${method}). Set THREED_PROVIDER=tripo, or implement lib/three-d/meshy.ts.`
  );
};

export const meshyProvider: ThreeDProvider = {
  name: "meshy",
  uploadImage: notImplemented("uploadImage"),
  generateMesh: notImplemented("generateMesh"),
  checkRiggable: notImplemented("checkRiggable"),
  rig: notImplemented("rig"),
  retarget: notImplemented("retarget"),
};
