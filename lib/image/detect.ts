/**
 * Detects an image's real media type from its magic bytes.
 *
 * Filename extensions lie — Gemini hands back JPEG regardless of what we call the
 * file, and a user can upload `photo.png` containing JPEG data. Both Claude and
 * Gemini reject a declared media type that disagrees with the bytes, so every
 * base64 upload path must sniff rather than trust the extension.
 */
export function detectImageMediaType(bytes: Buffer | Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }

  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";

  return null;
}

/** File extension matching a media type, for naming what we write to disk. */
export function extensionForMediaType(mediaType: string): string {
  if (mediaType.includes("jpeg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  if (mediaType.includes("gif")) return "gif";
  return "png";
}
