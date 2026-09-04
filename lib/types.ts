import { z } from "zod";

/**
 * Tripo's rig types. The LLM picks one from the user's input so a cat gets a
 * quadruped skeleton instead of being forced into a humanoid rig.
 */
export const CREATURE_TYPES = [
  "biped",
  "quadruped",
  "hexapod",
  "octopod",
  "avian",
  "serpentine",
  "aquatic",
] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

/** Structured description of the avatar, produced by Claude from an image or a prompt. */
export const AvatarSpecSchema = z.object({
  name: z.string().describe("Short display name for this avatar, 1-3 words"),
  characterType: z
    .enum(CREATURE_TYPES)
    .describe("Skeleton family. Use 'biped' for humans and humanoids."),
  bodyType: z.string().describe("e.g. 'slim adult male', 'stocky child', 'chubby house cat'"),
  ageRange: z.string(),
  skinTone: z.string().describe("Skin, fur or surface colour"),
  hair: z.object({ style: z.string(), color: z.string() }),
  face: z.object({
    eyes: z.string(),
    notableFeatures: z.array(z.string()).describe("Glasses, beard, freckles, markings..."),
  }),
  outfit: z.object({
    top: z.string(),
    bottom: z.string(),
    footwear: z.string(),
    accessories: z.array(z.string()),
  }),
  styleKeywords: z.array(z.string()).describe("Art-direction words for the stylised look"),
  imagePrompt: z
    .string()
    .describe(
      "The full prompt handed to the image model. Must describe a single full-body character in an A-pose on a plain background."
    ),
  negatives: z.array(z.string()).describe("Things the image must not contain"),
});
export type AvatarSpec = z.infer<typeof AvatarSpecSchema>;

/** Pipeline steps, in order. Drives the progress UI. */
export const STEPS = [
  "intake",
  "understand",
  "stylize",
  "approve",
  "generate3d",
  "prerigCheck",
  "rig",
  "retarget",
  "finalize",
] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  intake: "Reading your input",
  understand: "Understanding the character",
  stylize: "Drawing the character sheet",
  approve: "Waiting for your approval",
  generate3d: "Generating the 3D mesh",
  prerigCheck: "Checking the mesh can be rigged",
  rig: "Building the skeleton",
  retarget: "Applying animations",
  finalize: "Packaging the avatar",
};

export type JobStatus = "queued" | "running" | "awaiting_approval" | "done" | "error";

export type JobInput =
  | { kind: "prompt"; prompt: string }
  | { kind: "image"; imagePath: string; prompt?: string };

export interface AnimationAsset {
  name: string;
  /** Path under /api/assets */
  url: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  step: Step;
  /** Steps that have completed, for the stepper UI. */
  completed: Step[];
  input: JobInput;
  spec?: AvatarSpec;
  /** Stylised character sheet, served from /api/assets. */
  referenceImageUrl?: string;
  /** Feedback the user typed when rejecting a reference image. */
  feedback?: string;
  stylizeAttempts: number;
  meshTaskId?: string;
  meshUrl?: string;
  rigTaskId?: string;
  riggedUrl?: string;
  animations: AnimationAsset[];
  /** True when the mesh was produced but rigging failed - still worth showing. */
  riggingFailed?: boolean;
  error?: string;
}

/** Progress events pushed over SSE. */
export type JobEvent =
  | { type: "step"; step: Step; label: string }
  /** Free-text detail from a long-running vendor task, e.g. "mesh generation: running 40%". */
  | { type: "note"; message: string }
  | { type: "update"; job: JobRecord }
  | { type: "done"; job: JobRecord }
  | { type: "error"; message: string };
