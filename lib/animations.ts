/**
 * The animation menu offered in the viewer.
 *
 * Presets are the rig v1.0-20240301 names (biped only, 90+ motions). v2.5 covers
 * more creature types but has no emotes — no wave, agree, complain or angry — which
 * is why this POC rigs with v1.0. If you switch TRIPO_RIG_VERSION back to v2.5,
 * these preset ids will not resolve.
 *
 * "Disappear" has no Tripo equivalent at all, so it is a viewer-side effect rather
 * than a retargeted motion. It costs nothing and works on every avatar.
 */

export interface AnimationOption {
  /** Stable id used in URLs and job records. */
  id: string;
  label: string;
  /** Tripo preset, or null for effects the viewer performs itself. */
  preset: string | null;
  /** Loops forever (idle, walk) vs plays once (jump, wave). */
  loop: boolean;
}

export const ANIMATION_LIBRARY: AnimationOption[] = [
  { id: "idle", label: "Idle", preset: "preset:biped:idle", loop: true },
  { id: "walk", label: "Walk", preset: "preset:biped:walk", loop: true },
  { id: "run", label: "Run", preset: "preset:biped:run", loop: true },
  { id: "jump", label: "Jump", preset: "preset:biped:jump", loop: false },
  { id: "wave", label: "Wave", preset: "preset:biped:wave_goodbye_01", loop: false },
  { id: "yes", label: "Yes", preset: "preset:biped:agree", loop: false },
  { id: "no", label: "No", preset: "preset:biped:complain_01", loop: false },
  { id: "angry", label: "Angry", preset: "preset:biped:angry_01", loop: false },
  { id: "dance", label: "Dance", preset: "preset:biped:dance_01", loop: true },
  { id: "clap", label: "Clap", preset: "preset:biped:clap", loop: false },
  { id: "cheer", label: "Cheer", preset: "preset:biped:cheer", loop: false },
  { id: "sit", label: "Sit", preset: "preset:biped:sit", loop: false },
  // Viewer-side effect: fades and shrinks the avatar away. No Tripo call.
  { id: "disappear", label: "Disappear", preset: null, loop: false },
];

export function findAnimation(id: string): AnimationOption | undefined {
  return ANIMATION_LIBRARY.find((a) => a.id === id);
}

/**
 * Compares presets by their motion name, ignoring the namespace.
 *
 * The same motion is spelled differently across rig versions — v2.5 calls it
 * `preset:idle`, v1.0 `preset:biped:idle` — and ANIMATIONS in .env may use either.
 * Matching on the leaf keeps the "already generated" check working regardless, so
 * Idle and Walk never show up as things to add.
 */
function motionName(preset: string): string {
  return preset.split(":").pop() ?? preset;
}

/** Maps a Tripo preset back to its library entry, for animations already generated. */
export function findByPreset(preset: string): AnimationOption | undefined {
  return (
    ANIMATION_LIBRARY.find((a) => a.preset === preset) ??
    ANIMATION_LIBRARY.find((a) => a.preset && motionName(a.preset) === motionName(preset))
  );
}

/** True when the job already has this motion, whatever preset spelling it used. */
export function hasMotion(ownedPresets: string[], option: AnimationOption): boolean {
  if (!option.preset) return false;
  const target = motionName(option.preset);
  return ownedPresets.some((owned) => motionName(owned) === target);
}

/** Friendly label for a preset that is not in the library (e.g. set via ANIMATIONS). */
export function labelForPreset(preset: string): string {
  const known = findByPreset(preset);
  if (known) return known.label;
  const leaf = preset.split(":").pop() ?? preset;
  return leaf.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Non-biped rigs only have a walk cycle, under their own namespace. */
export function fallbackPresetFor(creatureType: string): string {
  const motion = creatureType === "serpentine" || creatureType === "aquatic" ? "march" : "walk";
  return `preset:${creatureType}:${motion}`;
}
