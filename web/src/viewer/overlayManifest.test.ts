import { describe, expect, test } from "vitest";

import { selectOverlayChunks, shouldUseChunkedOverlay } from "./overlayManifest";

describe("overlayManifest", () => {
  test("selects only chunks intersecting the visible window", () => {
    const manifest = {
      chunking: {
        chunks: [
          { id: "chunk-0-0", bounds: [0, 0, 100, 100], featureCount: 10, path: "chunks/chunk-0-0" },
          { id: "chunk-1-0", bounds: [100, 0, 200, 100], featureCount: 10, path: "chunks/chunk-1-0" },
          { id: "chunk-5-5", bounds: [500, 500, 600, 600], featureCount: 10, path: "chunks/chunk-5-5" },
        ],
      },
    } as any;

    const result = selectOverlayChunks(manifest, { left: 10, top: 10, right: 120, bottom: 90 });

    expect(result.map((chunk) => chunk.id)).toEqual(["chunk-0-0", "chunk-1-0"]);
  });

  test("prefers chunked loading for large or ovsi overlays", () => {
    expect(
      shouldUseChunkedOverlay({
        runtimeFormat: "inline",
        featureCount: 120,
        chunking: { chunks: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }] },
      } as any)
    ).toBe(true);
    expect(
      shouldUseChunkedOverlay({
        runtimeFormat: "ovsi",
        featureCount: 10,
        chunking: { chunks: [] },
      } as any)
    ).toBe(true);
    expect(
      shouldUseChunkedOverlay({
        runtimeFormat: "inline",
        featureCount: 10,
        chunking: { chunks: [{ id: "a" }] },
      } as any)
    ).toBe(false);
  });
});
