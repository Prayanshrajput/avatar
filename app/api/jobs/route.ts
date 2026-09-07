import { NextResponse } from "next/server";
import path from "node:path";
import { archiveRaw } from "@/lib/glb/ingest";
import { InvalidGlbError, inspectGlb } from "@/lib/glb/inspect";
import { startJob } from "@/lib/graph/runner";
import { ensureJobDir, jobDir, writeAsset } from "@/lib/store/files";
import { createJob, listJobs, newJobId, patchJob } from "@/lib/store/jobs";
import { pushAsset } from "@/lib/store/remote";
import { STEPS, type AnimationAsset, type JobInput } from "@/lib/types";
import fs from "node:fs/promises";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Whole file is read into memory to serve it, so this is a memory budget too. */
const MAX_GLB_BYTES = 50 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const prompt = (form.get("prompt") as string | null)?.trim() ?? "";
  const file = form.get("image");
  const glb = form.get("glb");

  const jobId = newJobId();
  let input: JobInput;

  // An uploaded GLB is already a finished avatar: no spec, no mesh, no rig to buy.
  // It is stored and recorded as a done job so it opens in the same viewer.
  if (glb instanceof File && glb.size > 0) {
    return uploadGlb(jobId, glb);
  }

  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type ${file.type}. Use PNG, JPEG or WebP.` },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image is larger than 20MB." }, { status: 400 });
    }

    await ensureJobDir(jobId);
    const ext = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
    const imagePath = path.join(jobDir(jobId), `source${ext}`);
    await fs.writeFile(imagePath, Buffer.from(await file.arrayBuffer()));
    // The source image is part of the job's record, so mirror it too.
    pushAsset(path.join(jobId, `source${ext}`));
    input = { kind: "image", imagePath, prompt: prompt || undefined };
  } else if (prompt) {
    input = { kind: "prompt", prompt };
  } else {
    return NextResponse.json({ error: "Provide an image or a prompt." }, { status: 400 });
  }

  const job = await createJob(jobId, input);
  startJob(job);

  return NextResponse.json({ job }, { status: 202 });
}

/**
 * Stores an uploaded GLB as a finished job.
 *
 * The file is archived under assets/raw/ like a vendor download and mirrored to
 * Supabase like a generated one, so an upload survives a container restart on the
 * same terms as everything else. Its clips are read out of the container up front
 * because the viewer needs their names to build the take picker.
 */
async function uploadGlb(jobId: string, file: File) {
  if (!file.name.toLowerCase().endsWith(".glb")) {
    return NextResponse.json(
      { error: `${file.name} is not a .glb file. Export your model as binary glTF.` },
      { status: 400 }
    );
  }
  if (file.size > MAX_GLB_BYTES) {
    return NextResponse.json(
      { error: `That GLB is ${(file.size / 1048576).toFixed(1)}MB, over the 50MB limit.` },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let info;
  try {
    info = inspectGlb(bytes);
  } catch (err) {
    if (err instanceof InvalidGlbError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const filename = "uploaded.glb";
  await archiveRaw(jobId, filename, bytes);
  const url = await writeAsset(jobId, filename, bytes);

  const animations: AnimationAsset[] = info.clips.map((clip) => ({
    name: clip,
    url,
    clip,
  }));

  const job = await createJob(jobId, {
    kind: "glb",
    glbPath: path.join(jobDir(jobId), filename),
    filename: file.name,
  });

  // Nothing is left to run, so the record goes straight to its terminal state —
  // which is also what makes saveJob flush the Supabase upload.
  return NextResponse.json(
    {
      job: await patchJob(job.id, {
        status: "done",
        step: "finalize",
        completed: [...STEPS],
        riggedUrl: url,
        animations,
        // No skin means the clips (if any) cannot deform a body — the viewer still
        // shows the model, and the job page explains why it may not move.
        riggingFailed: !info.hasSkin,
      }),
    },
    { status: 201 }
  );
}
