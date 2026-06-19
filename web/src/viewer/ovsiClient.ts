/*
Purpose: provide a stable viewer runtime client for OVSI-style overlay manifests and chunk loading.
Owner context: Viewer.
Invariants: manifest fetch and chunk fetch are separated so planning and cache policy remain testable.
Failure modes: missing manifests or chunks surface as rejected promises to the caller.
*/

import type { OverlayChunk, OverlayManifest } from "../domain/workspace";
import { fetchOverlayManifest } from "../infrastructure/workspaceClient";
import { loadOverlayChunk } from "./ovsiLoader";

export async function openOverlayRuntime(slideId: string, overlayId: string, signal?: AbortSignal): Promise<OverlayManifest> {
  return fetchOverlayManifest(slideId, overlayId, signal);
}

export async function loadOverlayRuntimeChunk(
  slideId: string,
  overlayId: string,
  chunk: { id: string; path: string }
): Promise<OverlayChunk> {
  return loadOverlayChunk(slideId, overlayId, chunk);
}
