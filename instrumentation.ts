/**
 * Runs once per server process, before the first request is served.
 *
 * The container starts with an empty disk, so this is where previously generated
 * avatars come back from the Supabase mirror. The restore is awaited: a request
 * that arrived first would otherwise 404 on assets that are seconds away from
 * existing.
 *
 * No-op when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset, which is the
 * local default.
 */
export async function register() {
  // Also invoked for the edge runtime, which has no filesystem to restore into.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { restore, remoteEnabled } = await import("@/lib/store/remote");
  if (!remoteEnabled()) return;

  try {
    await restore();
  } catch (err) {
    // Boot must not depend on Supabase being reachable — the app still works,
    // it just starts with whatever is already on disk.
    console.error("[remote] restore failed:", err instanceof Error ? err.message : err);
  }
}
