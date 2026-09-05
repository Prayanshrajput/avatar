import path from "node:path";

/** Central place for every env-var read, so nothing else has to touch process.env. */
export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  tripoApiKey: process.env.TRIPO_API_KEY ?? "",
  meshyApiKey: process.env.MESHY_API_KEY ?? "",

  /** Which ThreeDProvider implementation to use. */
  provider: (process.env.THREED_PROVIDER ?? "tripo") as "tripo" | "meshy",

  /** Skip the human approval gate before spending 3D credits. */
  autoApprove: process.env.AUTO_APPROVE === "true",

  specModel: process.env.SPEC_MODEL ?? "claude-sonnet-5",
  imageModel: process.env.IMAGE_MODEL ?? "gemini-3-pro-image",

  /**
   * Tripo rig version.
   *
   * v1.0 is biped-only but ships 90+ motions including the emotes (wave, agree,
   * complain, angry). v2.5 supports 7 creature types but only 11 biped motions and
   * no emotes. We use v1.0 because this POC is about human-style avatars — see
   * ANIMATION_LIBRARY in lib/animations.ts.
   */
  rigModelVersion: process.env.TRIPO_RIG_VERSION ?? "v1.0-20240301",
  meshModelVersion: process.env.TRIPO_MESH_VERSION ?? "v3.1-20260211",

  /**
   * Triangle budget for the generated mesh.
   *
   * Without this Tripo returns its maximum-detail mesh — 1.4M triangles and ~50MB
   * per GLB, which desktop survives and mobile GPUs do not. A stylised avatar reads
   * identically at 30k, and every retargeted animation carries the geometry again,
   * so this multiplies across the whole job.
   */
  faceLimit: Number(process.env.TRIPO_FACE_LIMIT ?? 30000),

  /** Motions generated up front. Everything else is added on demand from the viewer. */
  animations: (process.env.ANIMATIONS ?? "preset:biped:idle,preset:biped:walk")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean),

  storageDir: process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage"),

  /**
   * Durable mirror for ./storage, as a Supabase Storage bucket.
   *
   * A container's disk is wiped on every restart, so without this every generated
   * avatar is lost on redeploy. Both the URL and the key must be set for the
   * mirror to run at all — see lib/store/remote.ts.
   *
   * The service role key, not the anon key: this runs server-side only and has to
   * write to a private bucket without a user session. It must never reach the
   * browser, which is why it has no NEXT_PUBLIC_ prefix.
   */
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  supabaseBucket: process.env.SUPABASE_BUCKET ?? "avatars",

  /**
   * Root of the two-tier asset archive: `raw/` holds untouched vendor downloads,
   * `optimized/` holds the merged browser build. See lib/glb/paths.ts.
   */
  assetsDir: process.env.ASSETS_DIR ?? path.join(process.cwd(), "assets"),

  /**
   * Texture edge length in the optimized build.
   *
   * Tripo ships 2048px colour, normal and ORM maps. At the size an avatar is
   * actually drawn, 1024 is indistinguishable and cuts texture weight to a
   * quarter — and textures, not geometry, are what makes these files heavy.
   */
  textureSize: Number(process.env.GLB_TEXTURE_SIZE ?? 1024),

  /** Hard ceiling for the merged GLB. Over this, the build fails rather than ships. */
  maxOutputBytes: Number(process.env.GLB_MAX_BYTES ?? 5 * 1024 * 1024),

  /** Max stylize -> prerigcheck retries before we give up on rigging. */
  maxStylizeRetries: Number(process.env.MAX_STYLIZE_RETRIES ?? 2),
} as const;

export function requireKey(name: keyof typeof config, label: string): string {
  const value = config[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${label}. Add it to .env.local — see .env.local.example`);
  }
  return value;
}
