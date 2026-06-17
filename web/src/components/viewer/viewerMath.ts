import type { ViewerLevel, ViewerManifest } from "../../domain/contracts";

export type ViewerSize = {
  width: number;
  height: number;
};

export type ViewState = {
  target: [number, number, number];
  zoom: number;
};

export const DEFAULT_VIEWER_SIZE: ViewerSize = { width: 1280, height: 800 };
export const MINIMAP_WIDTH = 200;

export function topDownToWorldY(manifestHeight: number, value: number): number {
  return manifestHeight - value;
}

export function worldToTopDownY(manifestHeight: number, value: number): number {
  return manifestHeight - value;
}

export function fitZoom(manifest: ViewerManifest, size: ViewerSize): number {
  const scale = Math.min(size.width / manifest.width, size.height / manifest.height);
  return Math.log2(Math.max(scale, 1 / 4096));
}

export function createInitialViewState(manifest: ViewerManifest, size: ViewerSize): ViewState {
  return {
    target: [manifest.width / 2, manifest.height / 2, 0],
    zoom: fitZoom(manifest, size)
  };
}

export function tileBounds(
  manifest: ViewerManifest,
  level: ViewerLevel,
  tileX: number,
  tileY: number
): [number, number, number, number] {
  const left = tileX * manifest.tileSize * level.downsample;
  const top = tileY * manifest.tileSize * level.downsample;
  const right = Math.min(level.width, (tileX + 1) * manifest.tileSize) * level.downsample;
  const bottom = Math.min(level.height, (tileY + 1) * manifest.tileSize) * level.downsample;
  return [
    Math.min(left, manifest.width),
    topDownToWorldY(manifest.height, Math.min(bottom, manifest.height)),
    Math.min(right, manifest.width),
    topDownToWorldY(manifest.height, Math.min(top, manifest.height))
  ];
}

export function visibleSlideWindow(
  manifest: ViewerManifest,
  viewState: ViewState,
  viewerSize: ViewerSize,
  scale: number
) {
  const halfWidth = viewerSize.width / (2 * scale);
  const halfHeight = viewerSize.height / (2 * scale);
  const left = Math.max(0, viewState.target[0] - halfWidth);
  const right = Math.min(manifest.width, viewState.target[0] + halfWidth);
  const worldBottom = Math.max(0, viewState.target[1] - halfHeight);
  const worldTop = Math.min(manifest.height, viewState.target[1] + halfHeight);
  return {
    left,
    right,
    top: Math.max(0, worldToTopDownY(manifest.height, worldTop)),
    bottom: Math.min(manifest.height, worldToTopDownY(manifest.height, worldBottom))
  };
}
