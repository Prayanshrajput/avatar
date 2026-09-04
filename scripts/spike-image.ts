/**
 * Front-half spike: prompt -> Claude AvatarSpec -> Gemini character sheet.
 * Writes the PNG to storage/spike/ so it can be fed straight into spike:tripo.
 *
 *   npm run spike:image -- "a chunky cartoon astronaut with a red scarf"
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../lib/config";
import { stylizeCharacterSheet } from "../lib/image/nano-banana";
import { buildAvatarSpec } from "../lib/llm/spec";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error('Usage: npm run spike:image -- "a chunky cartoon astronaut"');
    process.exit(1);
  }

  const outDir = path.join(config.storageDir, "spike");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n▸ Claude (${config.specModel}): building AvatarSpec`);
  const spec = await buildAvatarSpec({ kind: "prompt", prompt });
  console.log(`  name           ${spec.name}`);
  console.log(`  characterType  ${spec.characterType}`);
  console.log(`  imagePrompt    ${spec.imagePrompt.slice(0, 160)}…`);
  await fs.writeFile(path.join(outDir, "spec.json"), JSON.stringify(spec, null, 2));

  console.log(`\n▸ Gemini (${config.imageModel}): drawing character sheet`);
  const image = await stylizeCharacterSheet(spec);
  const ext = image.mimeType.includes("jpeg") ? ".jpg" : ".png";
  const file = path.join(outDir, `character${ext}`);
  await fs.writeFile(file, image.bytes);
  console.log(`  ${image.mimeType}, ${(image.bytes.length / 1024).toFixed(0)}KB`);

  console.log(`\n✓ ${file}`);
  console.log(`\nNext: npm run spike:tripo -- ${file} ${spec.characterType}`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
