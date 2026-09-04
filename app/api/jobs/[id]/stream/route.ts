import { getJob, subscribe } from "@/lib/store/jobs";
import type { JobEvent } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Server-sent events for one job. Replays the current record on connect so a page
 * refresh mid-run — or a job that finished before the browser subscribed — still
 * renders the right state.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: JobEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client went away between the event firing and this write.
        }
      };

      send({ type: "update", job });
      if (job.status === "done") send({ type: "done", job });
      if (job.status === "error") send({ type: "error", message: job.error ?? "Job failed" });

      unsubscribe = subscribe(id, send);

      // Keeps proxies from closing an idle connection during a long mesh job.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* ignore */
        }
      }, 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
