import { describe, expect, test, vi, beforeEach } from "vitest";

import {
  createComment,
  deleteComment,
  fetchAnnotationLayers,
  fetchOverlayChunkAtPath,
  fetchOverlayChunk,
  fetchOverlayDetail,
  fetchOverlayManifest,
  fetchOverlaySources,
  saveAnnotation,
  updateComment
} from "../src/infrastructure/workspaceClient";

describe("workspaceClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("fetchOverlaySources hits overlay summary endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "overlay-1", name: "Regions", kind: "vector", featureCount: 3, legend: [] }]), { status: 200 })
    );

    const result = await fetchOverlaySources("slide-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/slides/slide-1/overlays", { signal: undefined });
    expect(result[0].id).toBe("overlay-1");
  });

  test("fetchOverlayDetail hits overlay detail endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "overlay-1", name: "Regions", kind: "vector", delivery: {}, features: [], legend: [] }), { status: 200 })
    );

    const result = await fetchOverlayDetail("slide-1", "overlay-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/slides/slide-1/overlays/overlay-1", { signal: undefined });
    expect(result.id).toBe("overlay-1");
  });

  test("fetchOverlayManifest hits overlay manifest endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          schema: "overlay-manifest-v1",
          slideId: "slide-1",
          overlayId: "overlay-1",
          name: "Regions",
          kind: "vector",
          versionId: "v1",
          sourceFormat: "geojson",
          coordinateSpace: { origin: "top-left", unit: "level-0-pixel" },
          runtimeFormat: "inline",
          featureCount: 0,
          bounds: [0, 0, 0, 0],
          legend: [],
          metadata: {},
          chunking: { strategy: "spatial-fixed-grid", chunkSize: 2048, chunks: [] }
        }),
        { status: 200 }
      )
    );

    const result = await fetchOverlayManifest("slide-1", "overlay-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/slides/slide-1/overlays/overlay-1/manifest", { signal: undefined });
    expect(result.schema).toBe("overlay-manifest-v1");
  });

  test("fetchOverlayChunk hits overlay chunk endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "chunk-0-0", bounds: [0, 0, 10, 10], featureCount: 0, features: [] }), { status: 200 })
    );

    const result = await fetchOverlayChunk("slide-1", "overlay-1", "chunk-0-0");

    expect(fetchMock).toHaveBeenCalledWith("/api/slides/slide-1/overlays/overlay-1/chunks/chunk-0-0", { signal: undefined });
    expect(result.id).toBe("chunk-0-0");
  });

  test("fetchOverlayChunkAtPath hits direct chunk path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "chunk-0-0", bounds: [0, 0, 10, 10], featureCount: 0, features: [] }), { status: 200 })
    );

    const result = await fetchOverlayChunkAtPath("/storage/derived/chunk-0-0.ovsib");

    expect(fetchMock).toHaveBeenCalledWith("/storage/derived/chunk-0-0.ovsib", { signal: undefined });
    expect(result.id).toBe("chunk-0-0");
  });

  test("saveAnnotation uses PUT with serialized payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "annotation-1",
          layerId: "layer-1",
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: {},
          style: {},
          createdAt: "2026-06-17T00:00:00Z",
          updatedAt: "2026-06-17T00:00:00Z"
        }),
        { status: 200 }
      )
    );

    await saveAnnotation("slide-1", {
      layerId: "layer-1",
      geometry: { type: "Point", coordinates: [1, 2] },
      properties: { label: "A" },
      style: { color: "#fff" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/slides/slide-1/annotations",
      expect.objectContaining({ method: "PUT", headers: { "Content-Type": "application/json" } })
    );
  });

  test("createComment posts comment body and author", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "comment-1",
          annotationId: "annotation-1",
          body: "review",
          author: "tester",
          parentId: null,
          createdAt: "2026-06-17T00:00:00Z",
          updatedAt: "2026-06-17T00:00:00Z"
        }),
        { status: 200 }
      )
    );

    const result = await createComment("slide-1", "annotation-1", "review", "tester");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/slides/slide-1/annotations/annotation-1/comments",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.author).toBe("tester");
  });

  test("updateComment patches existing comment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "comment-1",
          annotationId: "annotation-1",
          body: "review updated",
          author: "tester",
          parentId: null,
          createdAt: "2026-06-17T00:00:00Z",
          updatedAt: "2026-06-17T00:01:00Z"
        }),
        { status: 200 }
      )
    );

    const result = await updateComment("slide-1", "annotation-1", "comment-1", "review updated", "tester");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/slides/slide-1/annotations/annotation-1/comments/comment-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(result.body).toBe("review updated");
  });

  test("deleteComment sends delete request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await deleteComment("slide-1", "annotation-1", "comment-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/slides/slide-1/annotations/annotation-1/comments/comment-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  test("fetchAnnotationLayers throws on failed response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(fetchAnnotationLayers("slide-1")).rejects.toThrow("workspace request failed: 500");
  });
});
