import fs from "node:fs/promises";
import path from "node:path";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { config, requireKey } from "@/lib/config";
import { detectImageMediaType } from "@/lib/image/detect";
import {
  IMAGE_INPUT_INSTRUCTION,
  PROMPT_INPUT_INSTRUCTION,
  SPEC_SYSTEM_PROMPT,
  revisionInstruction,
} from "@/lib/llm/prompts";
import { AvatarSpecSchema, type AvatarSpec, type JobInput } from "@/lib/types";

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function specModel() {
  return new ChatAnthropic({
    apiKey: requireKey("anthropicApiKey", "ANTHROPIC_API_KEY"),
    model: config.specModel,
    // No temperature: claude-sonnet-5 rejects non-default values.
    maxTokens: 4096,
  }).withStructuredOutput(AvatarSpecSchema, { name: "avatar_spec" });
}

/**
 * Turns either a photo or a text prompt into the same structured AvatarSpec.
 * Both paths share one system prompt so the house style stays consistent.
 */
export async function buildAvatarSpec(
  input: JobInput,
  opts: { feedback?: string; previous?: AvatarSpec } = {}
): Promise<AvatarSpec> {
  const parts: string[] = [];
  // LangChain v1 standard content blocks — provider-agnostic image + text.
  const content: Array<
    | { type: "image"; mimeType: string; data: string }
    | { type: "text"; text: string }
  > = [];

  if (input.kind === "image") {
    const bytes = await fs.readFile(input.imagePath);
    // Sniff the bytes: the extension can disagree with the real format, and Claude
    // rejects a mismatched media type outright.
    const mimeType = detectImageMediaType(bytes) ?? MEDIA_TYPES[path.extname(input.imagePath).toLowerCase()];
    if (!mimeType) {
      throw new Error(`Unrecognised image format: ${input.imagePath}`);
    }
    content.push({ type: "image", mimeType, data: bytes.toString("base64") });
    parts.push(IMAGE_INPUT_INSTRUCTION);
    if (input.prompt) parts.push(`Additional direction from the user: ${input.prompt}`);
  } else {
    parts.push(PROMPT_INPUT_INSTRUCTION, `User description: ${input.prompt}`);
  }

  if (opts.previous) {
    parts.push(`Previous specification:\n${JSON.stringify(opts.previous, null, 2)}`);
  }
  if (opts.feedback) {
    parts.push(revisionInstruction(opts.feedback));
  }

  content.push({ type: "text", text: parts.join("\n\n") });

  return specModel().invoke([
    new SystemMessage(SPEC_SYSTEM_PROMPT),
    new HumanMessage({ content }),
  ]);
}
