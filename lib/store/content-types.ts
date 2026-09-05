/** Content types for generated assets.
 *
 * Its own module so the Supabase mirror can tag uploads without importing
 * lib/store/files.ts, which imports the mirror back.
 */
export const CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};
