import { config } from "@/lib/config";
import { meshyProvider } from "@/lib/three-d/meshy";
import { tripoProvider } from "@/lib/three-d/tripo";
import type { ThreeDProvider } from "@/lib/three-d/provider";

export function getProvider(): ThreeDProvider {
  return config.provider === "meshy" ? meshyProvider : tripoProvider;
}

export type * from "@/lib/three-d/provider";
