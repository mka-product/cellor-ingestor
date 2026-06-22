/*
Purpose: resolve overlay chunk fetches from either storage-backed artifact paths or API fallback endpoints.
Owner context: Viewer.
Invariants: direct artifact paths are preferred when present; API fallback remains deterministic.
Failure modes: network failures reject the specific chunk load only.
*/

import type { OverlayChunk, OverlayChunkSummary } from "../domain/workspace";
import { fetchOverlayChunk, fetchOverlayChunkAtPath } from "../infrastructure/workspaceClient";

type StorageRepresentation = "raw" | "simplified" | "cluster";

export async function loadOverlayChunk(
  slideId: string,
  overlayId: string,
  chunk: OverlayChunkSummary,
  representation: StorageRepresentation = "raw",
  signal?: AbortSignal
): Promise<OverlayChunk> {
  const targetPath = chunk.representations?.[representation]?.path ?? chunk.path;
  if (typeof targetPath === "string" && targetPath.startsWith("/storage/")) {
    try {
      return await fetchOverlayChunkAtPath(targetPath, signal);
    } catch {
      return fetchOverlayChunk(slideId, overlayId, chunk.id, representation, signal);
    }
  }
  return fetchOverlayChunk(slideId, overlayId, chunk.id, representation, signal);
}
