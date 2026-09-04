"use client";

import { useState } from "react";
import { ANIMATION_LIBRARY, hasMotion } from "@/lib/animations";
import type { JobRecord } from "@/lib/types";

/**
 * Adds a motion to a finished avatar. Each click is one animate_retarget call off
 * the saved rig task (~10 credits) — the mesh and skeleton are never rebuilt.
 */
export function AddAnimations({ job }: { job: JobRecord }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owned = job.animations.map((a) => a.name);
  // Hide anything the avatar already has — Idle and Walk come from the pipeline by
  // default. Matching ignores the preset namespace so a job generated under a
  // different rig version still counts as owning the motion.
  const available = ANIMATION_LIBRARY.filter(
    (option) => option.preset && job.rigTaskId && !hasMotion(owned, option)
  );

  if (!available.length) return null;

  async function add(animationId: string, label: string) {
    setPending(animationId);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/animations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animationId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Could not add ${label}`);
      // The job's SSE stream pushes the updated record, so no local merge needed.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-black/[0.03] p-3.5 dark:bg-white/5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Add an animation
        </h3>
        <span className="text-xs text-zinc-500">~10 credits each</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {available.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={pending !== null}
            onClick={() => add(option.id, option.label)}
            className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/10"
          >
            {pending === option.id ? `Adding ${option.label}…` : `+ ${option.label}`}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </section>
  );
}
