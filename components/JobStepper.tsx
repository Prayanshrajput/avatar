"use client";

import { STEPS, STEP_LABELS, type JobRecord, type Step } from "@/lib/types";

/** Steps we hide when the human gate is switched off or already cleared. */
function visibleSteps(job: JobRecord): Step[] {
  return STEPS.filter((s) => s !== "intake" && (s !== "approve" || job.status === "awaiting_approval"));
}

export function JobStepper({ job, note }: { job: JobRecord; note?: string }) {
  const steps = visibleSteps(job);

  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((step) => {
        const done = job.completed.includes(step);
        const current = job.step === step && job.status !== "done" && job.status !== "error";
        const failed = current && job.status === "error";

        return (
          <li key={step} className="flex items-start gap-3 text-sm">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                failed
                  ? "bg-red-500 text-white"
                  : done
                    ? "bg-emerald-500 text-white"
                    : current
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                      : "bg-black/10 text-zinc-500 dark:bg-white/10"
              }`}
            >
              {failed ? "!" : done ? "✓" : current ? "•" : ""}
            </span>
            <div className="min-w-0">
              <span className={done || current ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}>
                {STEP_LABELS[step]}
              </span>
              {current && note && (
                <p className="truncate text-xs text-zinc-500" title={note}>
                  {note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
