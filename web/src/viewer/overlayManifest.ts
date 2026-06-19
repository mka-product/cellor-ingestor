/*
Purpose: resolve viewport-driven overlay chunk selection from manifest metadata.
Owner context: Viewer.
Invariants: chunk selection is pure and depends only on manifest chunk bounds plus the visible image-space window.
Failure modes: malformed chunk bounds are ignored so the viewer can continue rendering other overlays.
*/

import type { OverlayChunkSummary, OverlayManifest } from "../domain/workspace";

export type OverlayWindow = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function intersects(a: OverlayWindow, b: OverlayWindow): boolean {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}

function chunkWindow(chunk: OverlayChunkSummary): OverlayWindow | null {
  if (!Array.isArray(chunk.bounds) || chunk.bounds.length < 4) {
    return null;
  }
  return {
    left: Number(chunk.bounds[0]),
    top: Number(chunk.bounds[1]),
    right: Number(chunk.bounds[2]),
    bottom: Number(chunk.bounds[3]),
  };
}

export function shouldUseChunkedOverlay(manifest: OverlayManifest): boolean {
  return manifest.chunking.chunks.length > 4 || manifest.featureCount > 2000 || manifest.runtimeFormat === "ovsi";
}

export function expandWindow(window: OverlayWindow, ratio: number): OverlayWindow {
  const width = Math.max(0, window.right - window.left);
  const height = Math.max(0, window.bottom - window.top);
  const padX = width * ratio;
  const padY = height * ratio;
  return {
    left: window.left - padX,
    top: window.top - padY,
    right: window.right + padX,
    bottom: window.bottom + padY,
  };
}

export function selectOverlayChunks(manifest: OverlayManifest, window: OverlayWindow): OverlayChunkSummary[] {
  const expanded = expandWindow(window, 0.25);
  return manifest.chunking.chunks.filter((chunk) => {
    const bounds = chunkWindow(chunk);
    return bounds ? intersects(bounds, expanded) : false;
  });
}
