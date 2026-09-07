"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { JobRecord } from "@/lib/types";

const PRESETS = [
  "a chunky cartoon astronaut with a red scarf",
  "a friendly barista with round glasses and a green apron",
  "a fluffy orange house cat wearing a tiny backpack",
  "a retro robot with a boxy head and antenna",
];

const MODE_LABELS = {
  image: "From a photo",
  prompt: "From a prompt",
  glb: "Upload a GLB",
} as const;

type Mode = keyof typeof MODE_LABELS;

export function InputForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [glb, setGlb] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const glbInput = useRef<HTMLInputElement>(null);

  function pickFile(next: File | null) {
    setFile(next);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return next ? URL.createObjectURL(next) : null;
    });
  }

  function pickGlb(next: File | null) {
    setError(null);
    if (next && !next.name.toLowerCase().endsWith(".glb")) {
      setGlb(null);
      return setError(`${next.name} is not a .glb file.`);
    }
    setGlb(next);
  }

  async function submit() {
    setError(null);
    if (mode === "image" && !file) return setError("Choose a photo first.");
    if (mode === "prompt" && !prompt.trim()) return setError("Describe the character first.");
    if (mode === "glb" && !glb) return setError("Choose a .glb file first.");

    setBusy(true);
    try {
      const body = new FormData();
      if (mode === "image" && file) body.set("image", file);
      // An upload skips the generator entirely, so no prompt rides along with it.
      if (mode === "glb" && glb) body.set("glb", glb);
      if (mode !== "glb" && prompt.trim()) body.set("prompt", prompt.trim());

      const res = await fetch("/api/jobs", { method: "POST", body });
      const data = (await res.json()) as { job?: JobRecord; error?: string };
      if (!res.ok || !data.job) throw new Error(data.error ?? "Failed to start the job");
      router.push(`/jobs/${data.job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10">
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-white"
                : "text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === "image" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) pickFile(dropped);
            }}
            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-black/15 text-sm text-zinc-500 transition-colors hover:border-black/30 dark:border-white/20 dark:hover:border-white/40"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected photo" className="h-full w-full object-contain" />
            ) : (
              <>
                <span className="text-2xl">📷</span>
                <span>Drop a photo here, or click to choose</span>
                <span className="text-xs">PNG, JPEG or WebP · up to 20MB</span>
              </>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional: extra direction, e.g. 'give them a denim jacket'"
            className="w-full rounded-xl border border-black/10 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          />
        </div>
      ) : mode === "prompt" ? (
        <div className="flex flex-col gap-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Describe the character…"
            className="w-full resize-none rounded-xl border border-black/10 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40"
          />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPrompt(p)}
                className="rounded-full bg-black/5 px-3 py-1.5 text-xs text-zinc-600 hover:bg-black/10 dark:bg-white/10 dark:text-zinc-300 dark:hover:bg-white/20"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => glbInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) pickGlb(dropped);
            }}
            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/15 px-6 text-center text-sm text-zinc-500 transition-colors hover:border-black/30 dark:border-white/20 dark:hover:border-white/40"
          >
            {glb ? (
              <>
                <span className="text-2xl">🧊</span>
                <span className="max-w-full truncate font-medium text-zinc-700 dark:text-zinc-200">
                  {glb.name}
                </span>
                <span className="text-xs">
                  {(glb.size / 1048576).toFixed(1)}MB · click to choose another
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl">🧊</span>
                <span>Drop a .glb here, or click to choose</span>
                <span className="text-xs">Binary glTF · up to 50MB</span>
              </>
            )}
          </button>
          <input
            ref={glbInput}
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            onChange={(e) => pickGlb(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      <p className="text-xs text-zinc-500">
        {mode === "image"
          ? "Photos of real, recognisable people are often refused by the image model. A prompt works more reliably."
          : mode === "prompt"
            ? "Describe the look in your own words — naming a copyrighted character (a superhero, a film character) gets refused."
            : "Your model is saved and opens in the same viewer, with every animation clip inside it playable. Nothing is generated, so this costs no credits."}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {busy
          ? mode === "glb"
            ? "Uploading…"
            : "Starting…"
          : mode === "glb"
            ? "Upload & view"
            : "Generate avatar"}
      </button>
    </div>
  );
}
