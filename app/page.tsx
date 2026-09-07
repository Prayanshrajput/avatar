import Link from "next/link";
import { InputForm } from "@/components/InputForm";
import { listJobs } from "@/lib/store/jobs";
import type { JobInput } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Fallback name for a job whose spec never got built — or never will, for an upload. */
function describeInput(input: JobInput): string {
  if (input.kind === "prompt") return input.prompt;
  if (input.kind === "glb") return input.filename.replace(/\.glb$/i, "");
  return "From a photo";
}

export default async function Home() {
  const jobs = (await listJobs()).slice(0, 8);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Avatar pipeline</h1>
        <p className="text-sm text-zinc-500">
          A photo or a prompt becomes a rigged, animated 3D avatar. Takes two to five minutes — or
          upload a GLB you already have and view it straight away.
        </p>
      </header>

      <InputForm />

      {jobs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Recent</h2>
          <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-70"
                >
                  <span className="truncate">
                    {job.spec?.name ?? describeInput(job.input)}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      job.status === "error"
                        ? "text-red-500"
                        : job.status === "done"
                          ? "text-emerald-600"
                          : "text-zinc-500"
                    }`}
                  >
                    {job.status.replace("_", " ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
