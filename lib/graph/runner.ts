import { Command, START } from "@langchain/langgraph";
import { getGraph } from "@/lib/graph";
import { emit, failJob, getJob, patchJob } from "@/lib/store/jobs";
import type { AvatarStateType, NodeName } from "@/lib/graph/state";
import type { JobInput, JobRecord } from "@/lib/types";

type ResumeCommand = Command<unknown, Partial<AvatarStateType>, NodeName | typeof START>;

/**
 * Jobs run detached from the HTTP request that created them: a run takes minutes,
 * so the route returns a job id immediately and the browser follows progress over SSE.
 */

function threadConfig(jobId: string) {
  return { configurable: { thread_id: jobId }, recursionLimit: 50 };
}

async function run(jobId: string, payload: ResumeCommand | { jobId: string; input: JobInput }) {
  try {
    await getGraph().invoke(payload, threadConfig(jobId));
    const job = await getJob(jobId);
    // A run that stopped at the approve interrupt is paused, not finished.
    if (job && job.status !== "awaiting_approval" && job.status !== "error") {
      emit(jobId, { type: "done", job });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job ${jobId}]`, err);
    await failJob(jobId, message);
  }
}

/** Fire-and-forget: the caller does not await the pipeline. */
export function startJob(job: JobRecord): void {
  void run(job.id, { jobId: job.id, input: job.input });
}

export async function resumeJob(
  jobId: string,
  decision: { approved: boolean; feedback?: string }
): Promise<void> {
  await patchJob(jobId, {
    status: "running",
    feedback: decision.approved ? undefined : decision.feedback,
  });
  void run(jobId, new Command({ resume: decision }) as ResumeCommand);
}
