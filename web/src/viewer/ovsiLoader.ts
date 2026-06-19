/*
Purpose: resolve overlay chunk fetches from either storage-backed artifact paths or API fallback endpoints.
Owner context: Viewer.
Invariants: direct artifact paths are preferred when present; API fallback remains deterministic.
Failure modes: network failures reject the specific chunk load only.
*/

import type { OverlayChunk, OverlayChunkSummary } from "../domain/workspace";
import { fetchOverlayChunk, fetchOverlayChunkAtPath } from "../infrastructure/workspaceClient";

export async function loadOverlayChunk(
  slideId: string,
  overlayId: string,
  chunk: OverlayChunkSummary,
  signal?: AbortSignal
): Promise<OverlayChunk> {
  if (typeof chunk.path === "string" && chunk.path.startsWith("/storage/")) {
    return fetchOverlayChunkAtPath(chunk.path, signal);
  }
  return fetchOverlayChunk(slideId, overlayId, chunk.id, signal);
}
