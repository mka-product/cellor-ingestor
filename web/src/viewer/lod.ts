import type { ViewerLevel, ViewerManifest } from "../domain/contracts";

export function selectLevel(manifest: ViewerManifest, viewportScale: number): ViewerLevel {
  const sorted = [...manifest.levels].sort((a, b) => a.downsample - b.downsample);
  return sorted.find((level) => level.downsample >= viewportScale) ?? sorted[sorted.length - 1];
}
