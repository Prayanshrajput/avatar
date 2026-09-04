"use client";

import { useEffect, useState } from "react";
import type { JobEvent, JobRecord } from "@/lib/types";

/** Subscribes to a job's SSE stream. The stream replays current state on connect. */
export function useJobStream(jobId: string) {
  const [job, setJob] = useState<JobRecord | null>(null);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as JobEvent;
      switch (event.type) {
        case "update":
        case "done":
          setJob(event.job);
          break;
        case "step":
          setNote(undefined);
          break;
        case "note":
          setNote(event.message);
          break;
        case "error":
          setError(event.message);
          break;
      }
    };

    // A closed stream after a terminal state is expected; only surface real drops.
    source.onerror = () => source.close();

    return () => source.close();
  }, [jobId]);

  return { job, note, error };
}
