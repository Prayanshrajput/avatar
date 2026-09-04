import { NextResponse } from "next/server";
import { resumeJob } from "@/lib/graph/runner";
import { getJob } from "@/lib/store/jobs";

export const runtime = "nodejs";

/** Resumes a run paused at the approve interrupt. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "awaiting_approval") {
    return NextResponse.json(
      { error: `Job is ${job.status}, not awaiting approval.` },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    approved?: boolean;
    feedback?: string;
  };

  await resumeJob(id, {
    approved: body.approved === true,
    feedback: body.feedback?.trim() || undefined,
  });

  return NextResponse.json({ ok: true });
}
