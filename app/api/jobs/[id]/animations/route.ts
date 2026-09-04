import { NextResponse } from "next/server";
import { findAnimation, hasMotion } from "@/lib/animations";
import { downloadAsset } from "@/lib/store/files";
import { emit, getJob, patchJob } from "@/lib/store/jobs";
import { getProvider } from "@/lib/three-d";

export const runtime = "nodejs";

/**
 * Adds one animation to an already-finished avatar.
 *
 * This is the whole point of keeping `rigTaskId` on the job record: retargeting
 * chains off the *rig* task, so adding a motion later is a single
 * animate_retarget call (~10 credits). No mesh, no rig, no LLM, no pipeline re-run.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { animationId?: string };
  const option = body.animationId ? findAnimation(body.animationId) : undefined;

  if (!option) {
    return NextResponse.json({ error: "Unknown animation" }, { status: 400 });
  }
  if (!option.preset) {
    // Viewer-side effects (Disappear) never reach the API.
    return NextResponse.json({ error: `${option.label} is a viewer effect` }, { status: 400 });
  }
  if (!job.rigTaskId) {
    return NextResponse.json(
      { error: "This avatar has no rig, so animations cannot be added." },
      { status: 409 }
    );
  }
  // Namespace-insensitive so a preset spelled for another rig version still counts.
  if (hasMotion(job.animations.map((a) => a.name), option)) {
    return NextResponse.json({ job }); // Already present — no charge.
  }

  const onProgress = (message: string) => emit(id, { type: "note", message });

  try {
    await patchJob(id, { status: "running", error: undefined });
    emit(id, { type: "note", message: `Adding ${option.label}…` });

    const [result] = await getProvider().retarget(job.rigTaskId, [option.preset], onProgress);
    if (!result) throw new Error(`Tripo returned no model for ${option.label}`);

    const index = job.animations.length;
    const url = await downloadAsset(
      id,
      `anim-${index}-${option.id}.glb`,
      result.modelUrl
    );

    const updated = await patchJob(id, (current) => ({
      status: "done",
      animations: [...current.animations, { name: option.preset!, url }],
    }));

    emit(id, { type: "done", job: updated });
    return NextResponse.json({ job: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The avatar itself is still fine — only this one motion failed.
    const reverted = await patchJob(id, { status: "done", error: message });
    emit(id, { type: "error", message });
    return NextResponse.json({ error: message, job: reverted }, { status: 502 });
  }
}
