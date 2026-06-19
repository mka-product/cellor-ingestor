/*
Purpose: plan visible OVSI overlay blocks for the current viewport.
Owner context: Viewer.
Invariants: planning is pure and based only on the manifest plus visible window.
Failure modes: malformed chunk metadata yields fewer planned blocks, never invalid ids.
*/

import type { OverlayChunkSummary, OverlayManifest } from "../domain/workspace";
import { selectOverlayChunks, shouldUseChunkedOverlay, type OverlayWindow } from "./overlayManifest";

export type OvsiChunkPlan = {
  mode: "inline" | "chunked";
  chunks: OverlayChunkSummary[];
  retainedChunkIds: Set<string>;
};

export function planOverlayRuntime(manifest: OverlayManifest, window: OverlayWindow | null): OvsiChunkPlan {
  if (!shouldUseChunkedOverlay(manifest)) {
    return { mode: "inline", chunks: [], retainedChunkIds: new Set() };
  }
  const effectiveWindow =
    window ?? {
      left: manifest.bounds[0],
      top: manifest.bounds[1],
      right: manifest.bounds[2],
      bottom: manifest.bounds[3],
    };
  const chunks = selectOverlayChunks(manifest, effectiveWindow);
  return {
    mode: "chunked",
    retainedChunkIds: new Set(chunks.map((chunk) => chunk.id)),
    chunks,
  };
}
