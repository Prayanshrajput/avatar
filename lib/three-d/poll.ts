export interface PollOptions<T> {
  /** Fetches the current state of the remote task. */
  fetchStatus: () => Promise<{ status: string; progress?: number; result?: T; error?: string }>;
  /** Terminal-success statuses. */
  successStatuses?: string[];
  /** Terminal-failure statuses. */
  failureStatuses?: string[];
  onProgress?: (note: string) => void;
  label?: string;
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_SUCCESS = ["success", "succeeded", "completed"];
const DEFAULT_FAILURE = ["failed", "cancelled", "canceled", "banned", "expired", "unknown"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One poller for every vendor task. Exponential backoff so a 3-minute mesh job
 * doesn't cost us 90 HTTP requests, with a hard timeout so a stuck task can't
 * wedge a pipeline run forever.
 */
export async function pollTask<T>(opts: PollOptions<T>): Promise<T> {
  const {
    fetchStatus,
    successStatuses = DEFAULT_SUCCESS,
    failureStatuses = DEFAULT_FAILURE,
    onProgress,
    label = "task",
    timeoutMs = 10 * 60 * 1000,
    initialDelayMs = 2000,
    maxDelayMs = 15000,
  } = opts;

  const started = Date.now();
  let delay = initialDelayMs;
  let lastNote = "";

  for (;;) {
    const { status, progress, result, error } = await fetchStatus();
    const normalized = status.toLowerCase();

    if (successStatuses.includes(normalized)) {
      if (result === undefined) throw new Error(`${label} succeeded but returned no result`);
      return result;
    }
    if (failureStatuses.includes(normalized)) {
      throw new Error(`${label} ${normalized}${error ? `: ${error}` : ""}`);
    }

    const note = `${label}: ${normalized}${progress != null ? ` ${progress}%` : ""}`;
    if (note !== lastNote) {
      lastNote = note;
      onProgress?.(note);
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s (last: ${normalized})`);
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, maxDelayMs);
  }
}
