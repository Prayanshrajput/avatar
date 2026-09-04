"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AddAnimations } from "@/components/AddAnimations";
import { AvatarViewer, type Take } from "@/components/AvatarViewer";
import { JobStepper } from "@/components/JobStepper";
import { findByPreset, labelForPreset } from "@/lib/animations";
import { useJobStream } from "@/lib/useJobStream";
import type { JobRecord } from "@/lib/types";

function takesFor(job: JobRecord): Take[] {
  const takes: Take[] = job.animations.map((a) => {
    const known = findByPreset(a.name);
    return {
      label: labelForPreset(a.name),
      url: a.url,
      // Unknown presets default to looping, which is right for walk-style motions.
      loop: known?.loop ?? true,
    };
  });

  if (job.riggedUrl) {
    takes.push({ label: "Rig (no motion)", url: job.riggedUrl, loop: true });
    // Disappear has no Tripo preset — the viewer fades the rigged model out.
    takes.push({
      label: "Disappear",
      url: job.riggedUrl,
      loop: true,
      effect: "disappear",
    });
  }

  // Rigging failed but the mesh is still worth showing.
  if (!takes.length && job.meshUrl) takes.push({ label: "Mesh", url: job.meshUrl, loop: true });
  return takes;
}

export function JobView({ initialJob }: { initialJob: JobRecord }) {
  const { job: streamed, note, error } = useJobStream(initialJob.id);
  const job = streamed ?? initialJob;

  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const takes = useMemo(() => takesFor(job), [job]);
  const message = error ?? job.error;

  async function decide(approved: boolean) {
    setSubmitting(true);
    try {
      await fetch(`/api/jobs/${job.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, feedback: approved ? undefined : feedback }),
      });
      setShowFeedback(false);
      setFeedback("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-zinc-500 hover:opacity-70">
          ← New avatar
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {job.spec?.name ?? (job.status === "done" ? "Avatar" : "Generating…")}
        </h1>
        {job.spec && (
          <p className="text-sm text-zinc-500">
            {job.spec.bodyType} · {job.spec.characterType} rig
          </p>
        )}
      </header>

      {job.status === "done" && takes.length > 0 ? (
        <>
          <AvatarViewer takes={takes}>
            <AddAnimations job={job} />
          </AvatarViewer>
          {job.riggingFailed && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Auto-rigging did not succeed for this mesh, so there are no animations. The mesh
              itself is above and downloadable.
            </p>
          )}
        </>
      ) : (
        <JobStepper job={job} note={note} />
      )}

      {message && (
        <div className="flex flex-col gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-medium">This run failed</p>
          {/* Refusal explanations are multi-paragraph and worth keeping readable. */}
          {message.split("\n").filter(Boolean).map((line, i) => (
            <p key={i} className="break-words">
              {line}
            </p>
          ))}
          <Link href="/" className="mt-1 font-medium underline">
            Try another avatar
          </Link>
        </div>
      )}

      {job.referenceImageUrl && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Character sheet
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={job.referenceImageUrl}
            alt="Stylised character sheet"
            className="w-full rounded-2xl border border-black/10 dark:border-white/10"
          />

          {job.status === "awaiting_approval" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-500">
                Everything after this point costs 3D credits. Approve the sheet, or say what to
                change.
              </p>
              {showFeedback ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={3}
                    placeholder="e.g. make the arms further from the body, lose the long coat"
                    className="w-full resize-none rounded-xl border border-black/10 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-black/30 dark:border-white/15"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => decide(false)}
                      className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
                    >
                      Redraw
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFeedback(false)}
                      className="rounded-full px-4 py-2 text-sm text-zinc-500"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => decide(true)}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Approve &amp; build 3D
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFeedback(true)}
                    className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium dark:border-white/15"
                  >
                    Change something
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
