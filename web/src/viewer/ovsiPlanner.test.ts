import { describe, expect, test } from "vitest";

import { planOverlayRuntime } from "./ovsiPlanner";

describe("ovsiPlanner", () => {
  test("returns inline mode for small inline overlays", () => {
    const plan = planOverlayRuntime(
      {
        runtimeFormat: "inline",
        featureCount: 20,
        bounds: [0, 0, 100, 100],
        chunking: { strategy: "spatial-fixed-grid", chunkSize: 256, chunks: [] }
      } as any,
      null
    );
    expect(plan.mode).toBe("inline");
  });

  test("returns chunked mode and retained ids for ovsi overlays", () => {
    const plan = planOverlayRuntime(
      {
        runtimeFormat: "ovsi",
        featureCount: 5000,
        bounds: [0, 0, 1000, 1000],
        chunking: {
          strategy: "spatial-fixed-grid",
          chunkSize: 256,
          chunks: [
            { id: "chunk-0-0", bounds: [0, 0, 300, 300], featureCount: 1, path: "/storage/chunk-0-0" },
            { id: "chunk-4-4", bounds: [800, 800, 1000, 1000], featureCount: 1, path: "/storage/chunk-4-4" }
          ]
        }
      } as any,
      { left: 0, top: 0, right: 400, bottom: 400 }
    );
    expect(plan.mode).toBe("chunked");
    expect(plan.chunks.map((chunk) => chunk.id)).toContain("chunk-0-0");
    expect(plan.retainedChunkIds.has("chunk-0-0")).toBe(true);
  });
});
