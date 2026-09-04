import { Annotation } from "@langchain/langgraph";
import type { AnimationAsset, AvatarSpec, JobInput } from "@/lib/types";

const last = <T>() => ({ reducer: (_prev: T, next: T) => next });

/**
 * Graph state. Deliberately small: durable job data lives in job.json, and this
 * only carries what the nodes need to hand each other during a single run.
 */
export const AvatarState = Annotation.Root({
  jobId: Annotation<string>(last<string>()),
  input: Annotation<JobInput>(last<JobInput>()),
  spec: Annotation<AvatarSpec | undefined>(last<AvatarSpec | undefined>()),
  referenceImagePath: Annotation<string | undefined>(last<string | undefined>()),
  referenceImageUrl: Annotation<string | undefined>(last<string | undefined>()),
  /** Why the last character sheet was rejected — fed back into the spec on retry. */
  feedback: Annotation<string | undefined>(last<string | undefined>()),
  stylizeAttempts: Annotation<number>({ reducer: (_p, n: number) => n, default: () => 0 }),
  meshTaskId: Annotation<string | undefined>(last<string | undefined>()),
  meshUrl: Annotation<string | undefined>(last<string | undefined>()),
  rigTaskId: Annotation<string | undefined>(last<string | undefined>()),
  riggedUrl: Annotation<string | undefined>(last<string | undefined>()),
  animations: Annotation<AnimationAsset[]>({
    reducer: (_p, n: AnimationAsset[]) => n,
    default: () => [],
  }),
  riggingFailed: Annotation<boolean>({ reducer: (_p, n: boolean) => n, default: () => false }),
});

export type AvatarStateType = typeof AvatarState.State;

/** Node names, so Command routing is checked rather than stringly typed. */
export const NODE_NAMES = [
  "understand",
  "stylize",
  "approve",
  "generate3d",
  "prerigCheck",
  "rig",
  "retarget",
  "finalize",
] as const;
export type NodeName = (typeof NODE_NAMES)[number];
