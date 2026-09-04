"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import {
  Box3,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from "three";

export interface Take {
  /** Label shown in the picker, e.g. "Idle". */
  label: string;
  url: string;
  /** One-shot motions (jump, wave) hold their last frame instead of looping. */
  loop?: boolean;
  /** Viewer-side effect with no Tripo motion behind it. */
  effect?: "disappear";
}

/** Every avatar is fitted inside a box this big, so the camera can stay fixed. */
const TARGET_SIZE = 1.8;
/** Where the fitted model's centre sits, and what OrbitControls looks at. */
const FOCUS_Y = TARGET_SIZE / 2;

/**
 * Measures how the model actually stands.
 *
 * `Box3.setFromObject` is useless for a SkinnedMesh: it transforms the geometry's
 * bind-pose bounds by the node matrix and ignores the skeleton entirely. Khronos'
 * CesiumMan, for instance, is authored lying along X and only stands up once its
 * bones are posed — its bind-pose box reports a height of 0.31 against a length of
 * 1.5. So for skinned models we measure the posed bone positions instead, and fall
 * back to geometry bounds only for a plain unrigged mesh.
 */
function posedBounds(root: Object3D): Box3 | null {
  root.updateMatrixWorld(true);

  const box = new Box3();
  const point = new Vector3();
  let sawBones = false;

  root.traverse((child) => {
    const skeleton = (child as SkinnedMesh).skeleton;
    if (!skeleton) return;
    for (const bone of skeleton.bones) {
      box.expandByPoint(bone.getWorldPosition(point));
      sawBones = true;
    }
  });

  if (!sawBones) {
    box.setFromObject(root);
    return box.isEmpty() ? null : box;
  }
  if (box.isEmpty()) return null;

  // Joints sit inside the silhouette, so pad for scalp, soles and body depth.
  const size = box.getSize(new Vector3());
  box.expandByVector(size.multiplyScalar(0.06));
  return box;
}

/**
 * Plays one self-contained GLB. Each retargeted animation Tripo returns already
 * includes the geometry, so switching takes swaps the model rather than merging
 * AnimationClips onto a shared mixer — one less place for bone-name mismatches to
 * bite, and drei caches every GLB after its first load.
 */
function Take({
  url,
  loop = true,
  effect,
  replayKey,
}: {
  url: string;
  loop?: boolean;
  effect?: "disappear";
  replayKey: number;
}) {
  const { scene, animations } = useGLTF(url);

  // Skinned meshes must be cloned with SkeletonUtils; a plain clone shares bones.
  const model = useMemo(() => SkeletonUtils.clone(scene) as Group, [scene]);
  const { actions, names } = useAnimations(animations, model);

  useEffect(() => {
    const action = names.length ? actions[names[0]] : undefined;
    if (!action) return;

    // A jump or a wave looks broken on repeat — hold the final pose instead.
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(0.3).play();

    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, names, loop, replayKey]);

  // "Disappear" has no Tripo preset, so the viewer performs it: fade the materials
  // out while shrinking, then hold the avatar hidden.
  const disappear = useRef(0);
  useEffect(() => {
    disappear.current = 0;
    if (effect !== "disappear") return;
    forEachMaterial(model, (material) => {
      material.transparent = true;
      material.opacity = 1;
    });
    model.visible = true;
  }, [effect, model, replayKey]);

  useFrame((_, delta) => {
    if (effect !== "disappear") return;
    disappear.current = Math.min(disappear.current + delta / 1.4, 1);
    const t = disappear.current;
    forEachMaterial(model, (material) => {
      material.opacity = 1 - t;
    });
    model.scale.multiplyScalar(1 - delta * 0.25 * t);
    if (t >= 1) model.visible = false;
  });

  // Generated avatars arrive at arbitrary scale and origin, so normalise them into a
  // fixed box centred on FOCUS_Y. Fitting on the largest dimension rather than height
  // keeps long, low subjects (a quadruped) in frame as well as standing bipeds.
  // This has to wait for the mixer to pose the skeleton, hence a frame counter.
  const frames = useRef(0);
  const fitted = useRef(false);
  const [floorY, setFloorY] = useState<number | null>(null);

  useFrame(() => {
    if (fitted.current) return;
    if (frames.current++ < 2) return;

    const box = posedBounds(model);
    if (!box) return;

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const scale = TARGET_SIZE / (Math.max(size.x, size.y, size.z) || 1);

    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, FOCUS_Y - center.y * scale, -center.z * scale);

    setFloorY(FOCUS_Y - (size.y * scale) / 2);
    fitted.current = true;
  });

  return (
    <>
      <primitive object={model} />
      {floorY !== null && (
        <ContactShadows
          position={[0, floorY + 0.002, 0]}
          opacity={0.32}
          scale={TARGET_SIZE * 3}
          blur={2.4}
          far={2}
        />
      )}
    </>
  );
}

/** Walks every material on the model, handling multi-material meshes. */
function forEachMaterial(root: Object3D, fn: (material: Material) => void) {
  root.traverse((child) => {
    const material = (child as Mesh).material;
    if (!material) return;
    if (Array.isArray(material)) material.forEach(fn);
    else fn(material);
  });
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} castShadow />
      <directionalLight position={[-4, 2, -2]} intensity={0.6} />
      <directionalLight position={[0, 2, -5]} intensity={0.8} />
    </>
  );
}

export function AvatarViewer({
  takes,
  children,
}: {
  takes: Take[];
  /** Slot for the "add animation" controls, laid out under the picker. */
  children?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const active = takes[Math.min(index, takes.length - 1)];

  // Warm the cache so switching takes is instant.
  useEffect(() => {
    takes.forEach((t) => {
      if (!t.effect) useGLTF.preload(t.url);
    });
  }, [takes]);

  function select(i: number) {
    // Re-tapping a one-shot should replay it rather than do nothing.
    if (i === index) setReplayKey((k) => k + 1);
    else setIndex(i);
  }

  if (!active) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl border border-black/10 bg-gradient-to-b from-zinc-100 to-zinc-200 dark:border-white/10 dark:from-zinc-800 dark:to-zinc-900">
        <Canvas
          shadows
          camera={{ position: [0, 1.1, 4.2], fov: 32 }}
          gl={{ alpha: true, antialias: true }}
        >
          <Lighting />
          <Suspense fallback={null}>
            {/* Each take normalises itself into a fixed box centred on FOCUS_Y, so one
                camera frames every avatar the same way. */}
            <Take
              key={`${active.url}:${active.effect ?? ""}`}
              url={active.url}
              loop={active.loop ?? true}
              effect={active.effect}
              replayKey={replayKey}
            />
          </Suspense>
          <OrbitControls
            makeDefault
            enablePan={false}
            target={[0, FOCUS_Y, 0]}
            minDistance={1.5}
            maxDistance={12}
          />
        </Canvas>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {takes.map((take, i) => (
          <button
            key={`${take.label}:${take.url}`}
            type="button"
            onClick={() => select(i)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              i === index
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "bg-black/5 text-zinc-700 hover:bg-black/10 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20"
            }`}
          >
            {take.label}
          </button>
        ))}
        <a
          href={active.url}
          download
          className="ml-auto rounded-full border border-black/10 px-3.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-black/5 dark:border-white/15 dark:text-zinc-200 dark:hover:bg-white/10"
        >
          Download GLB
        </a>
      </div>
      <p className="text-xs text-zinc-500">
        Drag to orbit · scroll to zoom{active.loop === false && " · tap again to replay"}
      </p>

      {children}
    </div>
  );
}
