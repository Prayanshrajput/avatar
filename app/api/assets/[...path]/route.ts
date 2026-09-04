import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CONTENT_TYPES, resolveAssetPath } from "@/lib/store/files";

export const runtime = "nodejs";

/** Serves generated assets out of ./storage (which is outside /public by design). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const filePath = resolveAssetPath(segments);
  if (!filePath) return new Response("Forbidden", { status: 403 });

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

  const ext = path.extname(filePath).toLowerCase();
  const body = await fsp.readFile(filePath);

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      // Filenames are attempt-numbered, so a generated asset never changes in place.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
