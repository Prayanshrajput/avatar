import { NextResponse } from "next/server";
import path from "node:path";
import { startJob } from "@/lib/graph/runner";
import { ensureJobDir, jobDir } from "@/lib/store/files";
import { createJob, listJobs, newJobId } from "@/lib/store/jobs";
import type { JobInput } from "@/lib/types";
import fs from "node:fs/promises";

export const runtime = "nodejs";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const prompt = (form.get("prompt") as string | null)?.trim() ?? "";
  const file = form.get("image");

  const jobId = newJobId();
  let input: JobInput;

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
