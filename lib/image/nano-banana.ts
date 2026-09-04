import fs from "node:fs/promises";
import path from "node:path";
import { config, requireKey } from "@/lib/config";
import { stripInterfaceChrome } from "@/lib/image/cleanup";
import { detectImageMediaType } from "@/lib/image/detect";
import { IMAGE_RULES, STYLE_GUIDE } from "@/lib/llm/prompts";
import type { AvatarSpec } from "@/lib/types";

const API_BASE =
  process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export interface StylizedImage {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Thrown when Gemini declines to draw the character. This is a content decision,
 * not a transport failure — retrying the same prompt will fail the same way, so the
 * pipeline surfaces it to the user instead of looping.
 */
export class ImageRefusedError extends Error {
  constructor(
    readonly reason: string,
    message: string
  ) {
    super(message);
    this.name = "ImageRefusedError";
  }
}

/**
 * Gemini's refusal codes, translated into something a user can act on. These fire
 * most often on copyrighted characters ("like Spider-Man") and on photos of real,
 * recognisable people.
 */
function explainRefusal(reason: string, hasSource: boolean): string {
  switch (reason) {
    case "PROHIBITED_CONTENT":
    case "IMAGE_PROHIBITED_CONTENT":
      return (
        "The image model refused this character, usually because the description " +
        "resembles a copyrighted or trademarked character (a named superhero, a film " +
        "or game character). Describe the look you want in your own words instead — " +
        'e.g. "a teenage boy in a red and blue hooded suit" rather than naming a character.'
      );
    case "IMAGE_SAFETY":
    case "SAFETY":
      return "The image model blocked this character on safety grounds. Try a different description.";
    case "IMAGE_OTHER":
      return hasSource
        ? "The image model would not stylise this photo. It declines photos of real, " +
            "recognisable people. Try a photo that is less identifiable, or describe the " +
            "character with a prompt instead."
        : "The image model declined this request without giving a reason. Rewording the " +
          "description usually fixes it.";
    case "RECITATION":
      return "The image model refused because the result too closely reproduced existing artwork.";
    default:
      return `The image model returned no image (${reason}). Try rewording the description.`;
  }
}

/**
 * Renders the canonical character sheet: one full-body A-pose character on a plain
 * background. This single image is what the image-to-3D model actually consumes, so
 * everything about mesh quality traces back to here.
 *
 * With a source photo this is an *edit* (identity preserved, style replaced); with a
 * prompt-only job it is a generation.
 */
export async function stylizeCharacterSheet(
  spec: AvatarSpec,
  sourceImagePath?: string
): Promise<StylizedImage> {
  const apiKey = requireKey("googleApiKey", "GOOGLE_API_KEY");

  const parts: GeminiPart[] = [];

  if (sourceImagePath) {
    const bytes = await fs.readFile(sourceImagePath);
    // Sniff the bytes rather than trusting the extension — see lib/image/detect.ts.
    const mimeType =
      detectImageMediaType(bytes) ?? MEDIA_TYPES[path.extname(sourceImagePath).toLowerCase()];
    if (!mimeType) throw new Error(`Unrecognised image format: ${sourceImagePath}`);
    parts.push({ inlineData: { mimeType, data: bytes.toString("base64") } });
  }

  parts.push({ text: buildPrompt(spec, Boolean(sourceImagePath)) });

  const res = await fetch(`${API_BASE}/models/${config.imageModel}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        // Tall frame: a standing full-body character wastes most of a square canvas.
        imageConfig: { aspectRatio: "3:4", imageSize: "2K" },
      },
    }),
  });

  const payload = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status}): ${payload.error?.message ?? "unknown error"}`);
  }
  const hasSource = Boolean(sourceImagePath);

  if (payload.promptFeedback?.blockReason) {
    const reason = payload.promptFeedback.blockReason;
    throw new ImageRefusedError(reason, explainRefusal(reason, hasSource));
  }

  const image = payload.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!image) {
    const reason = payload.candidates?.[0]?.finishReason ?? "NO_CANDIDATE";
    // Gemini sometimes explains itself in a text part alongside the refusal.
    const note = payload.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text?.trim();
    const explanation = explainRefusal(reason, hasSource);
    throw new ImageRefusedError(reason, note ? `${explanation}\n\nModel said: ${note}` : explanation);
  }

  // Gemini occasionally frames the avatar as a screenshot. Anything left over would
  // become geometry in image-to-3D, so crop it before the sheet goes any further.
  const raw = Buffer.from(image.data, "base64");
  try {
    const cleaned = await stripInterfaceChrome(raw, image.mimeType);
    if (cleaned.trimmedTop || cleaned.trimmedBottom) {
      console.log(
        `[stylize] trimmed interface chrome: ${cleaned.trimmedTop}px top, ${cleaned.trimmedBottom}px bottom`
      );
    }
    return { bytes: cleaned.bytes, mimeType: cleaned.mimeType };
  } catch (err) {
    // Cropping is a nicety — never fail the job over it.
    console.warn(`[stylize] chrome cleanup skipped: ${(err as Error).message}`);
    return { bytes: raw, mimeType: image.mimeType };
  }
}

function buildPrompt(spec: AvatarSpec, hasSource: boolean): string {
  const identity = hasSource
    ? `Redraw the person in the supplied photograph as a stylised 3D character sheet.
Preserve what makes them recognisable — face shape, hair style and colour, skin tone,
glasses, facial hair — but replace the photographic look entirely with the house style below.`
    : `Draw a stylised 3D character sheet from the description below.`;

  return `
${identity}

${spec.imagePrompt}

${STYLE_GUIDE}

${IMAGE_RULES}

Do not include: ${spec.negatives.join(", ")}.

Framing is critical: full-length studio shot, the entire character from the top of the
head to the soles of the shoes inside the frame, with empty background above the head
and a clear margin of empty background below the feet. Nothing may touch or run off
any edge of the image.

Output a single image that contains nothing but the character on a plain light-grey
background — no user interface, screenshot framing, device chrome, status bar,
toolbar, thumbnails, borders or text of any kind.
`.trim();
}
