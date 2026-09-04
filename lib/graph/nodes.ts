import fs from "node:fs/promises";
import path from "node:path";
import { Command, interrupt } from "@langchain/langgraph";
import { fallbackPresetFor } from "@/lib/animations";
import { config } from "@/lib/config";
import { ImageRefusedError, stylizeCharacterSheet } from "@/lib/image/nano-banana";
import { buildAvatarSpec } from "@/lib/llm/spec";
import { CONTENT_REFUSAL_FEEDBACK, RIG_FAILURE_FEEDBACK } from "@/lib/llm/prompts";
import { downloadAsset, jobDir, writeAsset } from "@/lib/store/files";
import { completeStep, emit, enterStep, patchJob } from "@/lib/store/jobs";
import { getProvider } from "@/lib/three-d";
import type { AnimationAsset } from "@/lib/types";
import type { AvatarStateType } from "@/lib/graph/state";

/** Vendor progress notes are surfaced verbatim in the UI's status line. */
const progressFor = (jobId: string) => (message: string) =>
  emit(jobId, { type: "note", message });

export async function understand(state: AvatarStateType): Promise<Partial<AvatarStateType>> {
  await enterStep(state.jobId, "understand");
  const spec = await buildAvatarSpec(state.input, {
    feedback: state.feedback,
    previous: state.spec,
  });
  await patchJob(state.jobId, { spec });
  await completeStep(state.jobId, "understand");
  return { spec };
}

/** Refusals worth one automatic retry with a de-branded spec. */
const RECOVERABLE_REFUSALS = new Set([
  "PROHIBITED_CONTENT",
  "IMAGE_PROHIBITED_CONTENT",
  "RECITATION",
]);

export async function stylize(state: AvatarStateType) {
  await enterStep(state.jobId, "stylize");
  if (!state.spec) throw new Error("stylize ran without a spec");

  const source = state.input.kind === "image" ? state.input.imagePath : undefined;

  let image;
  try {
    image = await stylizeCharacterSheet(state.spec, source);
  } catch (err) {
    // A copyrighted-character refusal is fixable: send it back to Claude to be
    // rewritten as an original character. Anything else is final — retrying the
    // same prompt would just fail identically.
    if (
      err instanceof ImageRefusedError &&
      RECOVERABLE_REFUSALS.has(err.reason) &&
      state.stylizeAttempts < config.maxStylizeRetries
    ) {
      emit(state.jobId, {
        type: "note",
        message: "Image model refused — rewriting as an original character…",
      });
      return new Command({
        goto: "understand",
        update: {
          feedback: CONTENT_REFUSAL_FEEDBACK,
          stylizeAttempts: state.stylizeAttempts + 1,
        },
      });
    }
    throw err;
  }

  const attempt = state.stylizeAttempts + 1;
  const ext = image.mimeType.includes("jpeg") ? "jpg" : "png";
  const filename = `reference-${attempt}.${ext}`;
  const url = await writeAsset(state.jobId, filename, image.bytes);

  await patchJob(state.jobId, { referenceImageUrl: url, stylizeAttempts: attempt });
  await completeStep(state.jobId, "stylize");

  return {
    referenceImagePath: path.join(jobDir(state.jobId), filename),
    referenceImageUrl: url,
    stylizeAttempts: attempt,
    feedback: undefined,
  };
}

/**
 * The credit gate. Pauses the graph until a human accepts the character sheet,
 * because everything after this point costs Tripo credits.
 */
export async function approve(state: AvatarStateType) {
  await enterStep(state.jobId, "approve");

  const decision = interrupt({
    referenceImageUrl: state.referenceImageUrl,
    spec: state.spec,
  }) as { approved: boolean; feedback?: string };

  if (decision.approved) {
    await completeStep(state.jobId, "approve");
    return new Command({ goto: "generate3d", update: { feedback: undefined } });
  }

  return new Command({
    goto: "understand",
    update: { feedback: decision.feedback ?? "The user rejected this character sheet." },
  });
}

export async function generate3d(state: AvatarStateType): Promise<Partial<AvatarStateType>> {
  await enterStep(state.jobId, "generate3d");
  if (!state.referenceImagePath) throw new Error("generate3d ran without a reference image");

  const provider = getProvider();
  const onProgress = progressFor(state.jobId);

  const bytes = await fs.readFile(state.referenceImagePath);
  const imageRef = await provider.uploadImage(bytes, path.basename(state.referenceImagePath));

  const mesh = await provider.generateMesh(imageRef, onProgress);
  await patchJob(state.jobId, { meshTaskId: mesh.taskId });
  await completeStep(state.jobId, "generate3d");

  return { meshTaskId: mesh.taskId, meshUrl: mesh.modelUrl };
}

/**
 * Cheap pre-flight before paying for a rig. A failure here almost always means the
 * A-pose was wrong, so we route back to re-draw the sheet rather than giving up.
 */
export async function prerigCheck(state: AvatarStateType) {
  await enterStep(state.jobId, "prerigCheck");
  if (!state.meshTaskId) throw new Error("prerigCheck ran without a mesh");

  const { riggable, reason } = await getProvider().checkRiggable(
    state.meshTaskId,
    progressFor(state.jobId)
  );

  if (riggable) {
    await completeStep(state.jobId, "prerigCheck");
    return new Command({ goto: "rig" });
  }

  if (state.stylizeAttempts <= config.maxStylizeRetries) {
    return new Command({
      goto: "understand",
      update: { feedback: `${RIG_FAILURE_FEEDBACK}\n\n(${reason ?? "not riggable"})` },
    });
  }

  // Out of retries: still deliver the un-rigged mesh rather than nothing.
  await patchJob(state.jobId, { riggingFailed: true });
  return new Command({ goto: "finalize", update: { riggingFailed: true } });
}

export async function rig(state: AvatarStateType): Promise<Partial<AvatarStateType>> {
  await enterStep(state.jobId, "rig");
  if (!state.meshTaskId || !state.spec) throw new Error("rig ran without a mesh or spec");

  const result = await getProvider().rig(
    state.meshTaskId,
    state.spec.characterType,
    progressFor(state.jobId)
  );
  await patchJob(state.jobId, { rigTaskId: result.taskId });
  await completeStep(state.jobId, "rig");

  return { rigTaskId: result.taskId, riggedUrl: result.modelUrl };
}

export async function retarget(state: AvatarStateType): Promise<Partial<AvatarStateType>> {
  await enterStep(state.jobId, "retarget");
  if (!state.rigTaskId) throw new Error("retarget ran without a rigged model");

  const results = await getProvider().retarget(
    state.rigTaskId,
    animationsFor(state),
    progressFor(state.jobId)
  );
  await completeStep(state.jobId, "retarget");

  // Held as remote URLs here; finalize pulls them local.
  return { animations: results.map((r) => ({ name: r.name, url: r.modelUrl })) };
}

/**
 * Only the starter motions are generated here — the viewer adds the rest on demand
 * via /api/jobs/[id]/animations, so a new avatar costs 2 retargets, not 12.
 */
function animationsFor(state: AvatarStateType): string[] {
  const type = state.spec?.characterType ?? "biped";
  // Non-biped rigs live in their own preset namespace and only have a walk cycle.
  return type === "biped" ? config.animations : [fallbackPresetFor(type)];
}

/** Pulls every vendor URL into local storage so the demo survives their expiry. */
export async function finalize(state: AvatarStateType): Promise<Partial<AvatarStateType>> {
  await enterStep(state.jobId, "finalize");

  const meshUrl = state.meshUrl ? await downloadAsset(state.jobId, "mesh.glb", state.meshUrl) : undefined;
  const riggedUrl = state.riggedUrl
    ? await downloadAsset(state.jobId, "rigged.glb", state.riggedUrl)
    : undefined;

  const animations: AnimationAsset[] = [];
  for (const [i, anim] of state.animations.entries()) {
    const slug = anim.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const url = await downloadAsset(state.jobId, `anim-${i}-${slug}.glb`, anim.url);
    animations.push({ name: anim.name, url });
  }

  await patchJob(state.jobId, {
    status: "done",
    meshUrl,
    riggedUrl,
    animations,
    riggingFailed: state.riggingFailed,
  });
  await completeStep(state.jobId, "finalize");

  return { meshUrl, riggedUrl, animations };
}
