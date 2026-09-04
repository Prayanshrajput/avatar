import { config, requireKey } from "@/lib/config";
import { pollTask } from "@/lib/three-d/poll";
import type {
  AnimationResult,
  ImageRef,
  MeshResult,
  ProgressFn,
  RigResult,
  ThreeDProvider,
} from "@/lib/three-d/provider";
import type { CreatureType } from "@/lib/types";

const BASE = process.env.TRIPO_BASE_URL ?? "https://api.tripo3d.ai/v2/openapi";

interface TripoEnvelope<T> {
  code: number;
  data: T;
  message?: string;
  suggestion?: string;
}

interface TripoTaskOutput {
  model?: string;
  base_model?: string;
  pbr_model?: string;
  rendered_image?: string;
  riggable?: boolean;
}

interface TripoTask {
  task_id: string;
  status: string;
  progress?: number;
  output?: TripoTaskOutput;
  error_msg?: string;
}

async function tripoFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${requireKey("tripoApiKey", "TRIPO_API_KEY")}`);
  if (json !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const text = await res.text();
  let payload: TripoEnvelope<T>;
  try {
    payload = JSON.parse(text) as TripoEnvelope<T>;
  } catch {
    throw new Error(`Tripo ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || payload.code !== 0) {
    const detail = [payload.message, payload.suggestion].filter(Boolean).join(" — ");
    throw new Error(`Tripo ${path} failed (${res.status}, code ${payload.code}): ${detail || text.slice(0, 200)}`);
  }
  return payload.data;
}

async function createTask(body: Record<string, unknown>): Promise<string> {
  const data = await tripoFetch<{ task_id: string }>("/task", { method: "POST", json: body });
  return data.task_id;
}

async function getTask(taskId: string): Promise<TripoTask> {
  return tripoFetch<TripoTask>(`/task/${taskId}`, { method: "GET" });
}

/** Polls a Tripo task to completion and hands back its raw output block. */
async function awaitTask(
  taskId: string,
  label: string,
  onProgress?: ProgressFn
): Promise<TripoTaskOutput> {
  return pollTask<TripoTaskOutput>({
    label,
    onProgress,
    fetchStatus: async () => {
      const task = await getTask(taskId);
      return {
        status: task.status,
        progress: task.progress,
        error: task.error_msg,
        result: task.output ?? {},
      };
    },
  });
}

/** Tripo returns the textured model under different keys depending on task type. */
function pickModelUrl(output: TripoTaskOutput, label: string): string {
  const url = output.pbr_model ?? output.model ?? output.base_model;
  if (!url) throw new Error(`${label} produced no model URL (got ${JSON.stringify(output)})`);
  return url;
}

export const tripoProvider: ThreeDProvider = {
  name: "tripo",

  async uploadImage(bytes, filename) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), filename);
    const data = await tripoFetch<{ image_token: string }>("/upload", {
      method: "POST",
      body: form,
    });
    const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
    return { type: ext === "jpg" ? "jpeg" : ext, file_token: data.image_token };
  },

  async generateMesh(image: ImageRef, onProgress) {
    const taskId = await createTask({
      type: "image_to_model",
      file: image,
      model_version: config.meshModelVersion,
      texture: true,
      pbr: true,
      // The character sheet is authoritative for silhouette; keep the mesh aligned to it.
      texture_alignment: "original_image",
      orientation: "align_image",
    });
    onProgress?.(`mesh task ${taskId} created`);
    const output = await awaitTask(taskId, "mesh generation", onProgress);
    const result: MeshResult = {
      taskId,
      modelUrl: pickModelUrl(output, "mesh generation"),
      renderedImageUrl: output.rendered_image,
    };
    return result;
  },

  async checkRiggable(meshTaskId, onProgress) {
    const taskId = await createTask({
      type: "animate_prerigcheck",
      original_model_task_id: meshTaskId,
    });
    const output = await awaitTask(taskId, "rig check", onProgress);
    return {
      riggable: output.riggable === true,
      reason: output.riggable === true ? undefined : "Tripo reports this mesh cannot be auto-rigged",
    };
  },

  async rig(meshTaskId, creatureType: CreatureType, onProgress) {
    const taskId = await createTask({
      type: "animate_rig",
      original_model_task_id: meshTaskId,
      model_version: config.rigModelVersion,
      rig_type: creatureType,
      spec: "tripo",
      out_format: "glb",
    });
    onProgress?.(`rig task ${taskId} created`);
    const output = await awaitTask(taskId, "rigging", onProgress);
    const result: RigResult = { taskId, modelUrl: pickModelUrl(output, "rigging") };
    return result;
  },

  async retarget(rigTaskId, animations, onProgress) {
    // One task per preset: Tripo returns a single GLB per task, and doing them
    // separately means one bad preset doesn't sink the whole set.
    const results: AnimationResult[] = [];
    for (const animation of animations) {
      try {
        const taskId = await createTask({
          type: "animate_retarget",
          original_model_task_id: rigTaskId,
          animation,
          out_format: "glb",
          bake_animation: true,
          export_with_geometry: true,
        });
        const output = await awaitTask(taskId, `animation ${animation}`, onProgress);
        results.push({ name: animation, modelUrl: pickModelUrl(output, `animation ${animation}`) });
      } catch (err) {
        onProgress?.(`animation ${animation} failed: ${(err as Error).message}`);
      }
    }
    return results;
  },
};
