import sharp from "sharp";

/**
 * Trims hallucinated interface chrome off a character sheet.
 *
 * Gemini sometimes frames the avatar as if it were a screenshot — an iOS status
 * bar, a bottom toolbar, thumbnail strips. Prompt wording reduces this but does not
 * eliminate it, and any of it that survives becomes geometry once the sheet reaches
 * image-to-3D. So we detect it structurally instead of asking nicely.
 *
 * The detection: a character sheet's background is a plain, near-uniform light grey.
 * Interface chrome is a full-width band that differs sharply from that background —
 * usually much darker. We scan rows in from the top and bottom, and crop any
 * contiguous run of such bands, stopping as soon as rows look like background again.
 */

/**
 * Interface chrome is *dark* — an iOS status bar or toolbar sits far below a light
 * grey background. A row must be at least this much darker than the background to
 * count, which distinguishes a toolbar from the soft gradient of a blurred backdrop.
 */
const CHROME_DARKNESS = 90;
/**
 * Never crop more than this fraction off either end. Chrome bands are thin; a large
 * dark region is more likely part of the character, and cropping into the avatar
 * (losing the feet) is worse than leaving an artifact behind.
 */
const MAX_TRIM_RATIO = 0.12;
/**
 * Chrome spans the full width; the avatar does not. A row only counts as chrome if
 * at least this fraction of its edge margins are dark too — true of a toolbar,
 * false of the character's legs.
 */
const EDGE_COVERAGE = 0.7;

export interface CleanupResult {
  bytes: Buffer;
  mimeType: string;
  /** Pixels removed from the top and bottom, for logging. */
  trimmedTop: number;
  trimmedBottom: number;
}

export async function stripInterfaceChrome(
  input: Buffer,
  mimeType: string
): Promise<CleanupResult> {
  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (!width || !height) {
    return { bytes: input, mimeType, trimmedTop: 0, trimmedBottom: 0 };
  }

  // Greyscale row means are enough to spot a full-width band, and cheap.
  const { data } = await image
    .clone()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // The background is whatever the middle-height rows agree on at their edges —
  // sample the left and right margins, which the character rarely occupies.
  const background = estimateBackground(data, width, height);

  // Only the outer margins are examined. A toolbar reaches the left and right edges;
  // the avatar's legs sit in the middle, so they never register as chrome.
  const margin = Math.max(4, Math.floor(width * 0.08));
  const threshold = background - CHROME_DARKNESS;
  const isChromeRow = (y: number): boolean => {
    const row = y * width;
    let dark = 0;
    let checked = 0;
    for (let x = 0; x < margin; x++) {
      checked += 2;
      if (data[row + x] < threshold) dark++;
      if (data[row + width - 1 - x] < threshold) dark++;
    }
    return dark / checked >= EDGE_COVERAGE;
  };

  const maxTrim = Math.floor(height * MAX_TRIM_RATIO);
  let top = 0;
  while (top < maxTrim && isChromeRow(top)) top++;

  let bottom = 0;
  while (bottom < maxTrim && isChromeRow(height - 1 - bottom)) bottom++;

  if (!top && !bottom) {
    return { bytes: input, mimeType, trimmedTop: 0, trimmedBottom: 0 };
  }

  const cropped = await sharp(input, { failOn: "none" })
    .extract({ left: 0, top, width, height: height - top - bottom })
    .jpeg({ quality: 92 })
    .toBuffer();

  return { bytes: cropped, mimeType: "image/jpeg", trimmedTop: top, trimmedBottom: bottom };
}

/**
 * Median of the left/right margin pixels across the vertical middle of the image.
 * The character stands centred, so the margins are background even when it is wide.
 */
function estimateBackground(data: Buffer, width: number, height: number): number {
  const margin = Math.max(2, Math.floor(width * 0.04));
  const samples: number[] = [];

  for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.7); y += 4) {
    const row = y * width;
    for (let x = 0; x < margin; x += 2) {
      samples.push(data[row + x]);
      samples.push(data[row + width - 1 - x]);
    }
  }

  if (!samples.length) return 235; // Light grey, per the prompt rules.
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}
