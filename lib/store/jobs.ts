import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { config } from "@/lib/config";
import { ensureJobDir, jobDir } from "@/lib/store/files";
import { flush, pushAsset } from "@/lib/store/remote";
import { STEP_LABELS, type JobEvent, type JobInput, type JobRecord, type Step } from "@/lib/types";

/**
 * Job state lives in `storage/<jobId>/job.json` — no database. At POC scale
 * (one job at a time, a few minutes each) the filesystem gives us durability
 * and a human-readable record for free. See the plan's "Why no database".
 */

const JOB_FILE = "job.json";

/** In-process fan-out for SSE subscribers. Fine while everything runs in one Next server. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createJob(id: string, input: JobInput): Promise<JobRecord> {
  const now = new Date().toISOString();
  const job: JobRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    step: "intake",
    completed: [],
    input,
    stylizeAttempts: 0,
    animations: [],
  };
  await saveJob(job);
  return job;
}

export async function getJob(id: string): Promise<JobRecord | null> {
  try {
    const raw = await fs.readFile(path.join(jobDir(id), JOB_FILE), "utf8");
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export async function saveJob(job: JobRecord): Promise<JobRecord> {
  const dir = await ensureJobDir(job.id);
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(dir, JOB_FILE), JSON.stringify(job, null, 2));
  pushAsset(path.join(job.id, JOB_FILE));
  // A finished job has no further writes to ride along with, so commit the
  // debounced batch now rather than risk losing it to a restart.
  if (job.status === "done" || job.status === "error") void flush();
  emit(job.id, { type: "update", job });
  return job;
}

/** Read-modify-write helper so nodes never have to juggle the file themselves. */
export async function patchJob(
  id: string,
  patch: Partial<JobRecord> | ((job: JobRecord) => Partial<JobRecord>)
): Promise<JobRecord> {
  const job = await getJob(id);
  if (!job) throw new Error(`Unknown job ${id}`);
  const delta = typeof patch === "function" ? patch(job) : patch;
  return saveJob({ ...job, ...delta });
}

/** Marks the job as entering a step and announces it to the progress stream. */
export async function enterStep(id: string, step: Step): Promise<JobRecord> {
  emit(id, { type: "step", step, label: STEP_LABELS[step] });
  return patchJob(id, (job) => ({
    step,
    status: step === "approve" ? "awaiting_approval" : "running",
    completed: job.completed.includes(step) ? job.completed : job.completed,
  }));
}

export async function completeStep(id: string, step: Step): Promise<JobRecord> {
  return patchJob(id, (job) => ({
    completed: job.completed.includes(step) ? job.completed : [...job.completed, step],
  }));
}

export async function failJob(id: string, message: string): Promise<JobRecord> {
  const job = await patchJob(id, { status: "error", error: message });
  emit(id, { type: "error", message });
  return job;
}

export async function listJobs(): Promise<JobRecord[]> {
  try {
    const entries = await fs.readdir(config.storageDir, { withFileTypes: true });
    const jobs = await Promise.all(
      entries.filter((e) => e.isDirectory()).map((e) => getJob(e.name))
    );
    return jobs
      .filter((j): j is JobRecord => j !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function emit(jobId: string, event: JobEvent): void {
  bus.emit(jobId, event);
}

export function subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
  bus.on(jobId, listener);
  return () => bus.off(jobId, listener);
}
