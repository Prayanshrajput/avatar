import type { CreatureType } from "@/lib/types";

/** How a provider refers to an already-uploaded image. Opaque to callers. */
export type ImageRef = Record<string, unknown>;

export interface MeshResult {
  taskId: string;
  modelUrl: string;
  renderedImageUrl?: string;
}

export interface RigResult {
  taskId: string;
  modelUrl: string;
}

export interface AnimationResult {
  /** Preset id, e.g. "preset:walk" */
  name: string;
  modelUrl: string;
}

export type ProgressFn = (note: string) => void;

/**
 * Every hosted 3D vendor sits behind this. Swapping Tripo for Meshy — or later for
 * self-hosted TRELLIS + UniRig — is a new implementation file, not a rewrite.
 */
export interface ThreeDProvider {
  readonly name: string;
  uploadImage(bytes: Buffer, filename: string): Promise<ImageRef>;
  generateMesh(image: ImageRef, onProgress?: ProgressFn): Promise<MeshResult>;
  /** Cheap pre-flight: can this mesh be auto-rigged at all? */
  checkRiggable(meshTaskId: string, onProgress?: ProgressFn): Promise<{ riggable: boolean; reason?: string }>;
  rig(meshTaskId: string, creatureType: CreatureType, onProgress?: ProgressFn): Promise<RigResult>;
  retarget(rigTaskId: string, animations: string[], onProgress?: ProgressFn): Promise<AnimationResult[]>;
}
