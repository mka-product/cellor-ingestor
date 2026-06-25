import type { ViewerLevel, ViewerManifest } from "../../domain/contracts";

export type ViewerSize = {
  width: number;
  height: number;
};

export type ViewState = {
  target: [number, number, number];
  zoom: number;
  rotationOrbit: number;
};

export const DEFAULT_VIEWER_SIZE: ViewerSize = { width: 1280, height: 800 };
export const MINIMAP_WIDTH = 150;

export function topDownToWorldY(manifestHeight: number, value: number): number {
  return value;
}

export function worldToTopDownY(manifestHeight: number, value: number): number {
  return value;
}

export function fitZoom(manifest: ViewerManifest, size: ViewerSize): number {
  const scale = Math.min(size.width / manifest.width, size.height / manifest.height);
  return Math.log2(Math.max(scale, 1 / 4096));
}

export function nativeZoomForLevel(level: ViewerLevel): number {
  return Math.log2(1 / Math.max(level.downsample, 1 / 4096));
}

export function createInitialViewState(manifest: ViewerManifest, size: ViewerSize): ViewState {
  return {
    target: [manifest.width / 2, manifest.height / 2, 0],
    zoom: fitZoom(manifest, size),
    rotationOrbit: 0
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
  const hw = viewerSize.width / (2 * scale);
  const hh = viewerSize.height / (2 * scale);

  // When the viewport is rotated, the visible slide area is a rotated rectangle.
  // Expand the AABB to its rotated envelope so overlay chunks and tile fetches
  // cover the full rotated viewport — without this, features at the rotated corners
  // are outside the unrotated window and never loaded.
  const theta = (viewState.rotationOrbit * Math.PI) / 180;
  const cosT = Math.abs(Math.cos(theta));
  const sinT = Math.abs(Math.sin(theta));
  const halfWidth  = hw * cosT + hh * sinT;
  const halfHeight = hw * sinT + hh * cosT;

  const left = Math.max(0, viewState.target[0] - halfWidth);
  const right = Math.min(manifest.width, viewState.target[0] + halfWidth);
  const worldTop = Math.max(0, viewState.target[1] - halfHeight);
  const worldBottom = Math.min(manifest.height, viewState.target[1] + halfHeight);
  return {
    left,
    right,
    top: Math.max(0, worldToTopDownY(manifest.height, worldTop)),
    bottom: Math.min(manifest.height, worldToTopDownY(manifest.height, worldBottom))
  };
}
