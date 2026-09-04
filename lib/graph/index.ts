import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { config } from "@/lib/config";
import { AvatarState } from "@/lib/graph/state";
import {
  approve,
  finalize,
  generate3d,
  prerigCheck,
  retarget,
  rig,
  stylize,
  understand,
} from "@/lib/graph/nodes";

/**
 * The pipeline. Two loops make this a graph rather than a chain:
 *   approve -> understand   (user rejected the character sheet)
 *   prerigCheck -> understand (the mesh could not be auto-rigged)
 */
function build() {
  const graph = new StateGraph(AvatarState)
    .addNode("understand", understand)
    // stylize can bounce back to understand when the image model refuses on
    // content grounds, so the spec can be rewritten as an original character.
    .addNode("stylize", stylize, { ends: ["generate3d", "approve", "understand"] })
    .addNode("approve", approve, { ends: ["generate3d", "understand"] })
    .addNode("generate3d", generate3d)
    .addNode("prerigCheck", prerigCheck, { ends: ["rig", "understand", "finalize"] })
    .addNode("rig", rig)
    .addNode("retarget", retarget)
    .addNode("finalize", finalize)
    .addEdge(START, "understand")
    .addEdge("understand", "stylize")
    // AUTO_APPROVE=true skips the human gate entirely (useful for the spike / CI).
    .addConditionalEdges("stylize", () => (config.autoApprove ? "generate3d" : "approve"), [
      "generate3d",
      "approve",
    ])
    .addEdge("generate3d", "prerigCheck")
    .addEdge("rig", "retarget")
    .addEdge("retarget", "finalize")
    .addEdge("finalize", END);

  return graph.compile({ checkpointer: new MemorySaver() });
}

/**
 * One compiled graph per server process. The MemorySaver holds paused runs, so the
 * approve/resume round-trip works as long as it is the same process — which it is
 * for a single `next dev` / `next start`.
 */
let compiled: ReturnType<typeof build> | undefined;

export function getGraph() {
  compiled ??= build();
  return compiled;
}
