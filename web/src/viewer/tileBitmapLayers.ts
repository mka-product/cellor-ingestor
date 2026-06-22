/*
Purpose: create memoizable bitmap layers from resolved tile references and decoded tile cache entries.
Owner context: Viewer.
Invariants: only decoded tile images become layers and layer ids remain stable per tile key.
Failure modes: cache misses are skipped and recovered by the caller on later rerenders.
*/

import { BitmapLayer } from "@deck.gl/layers";
import type { Matrix4 } from "@math.gl/core";

type RenderLevelState = {
  level: { indexPath: string };
  tiles: Array<{ key: string; bounds: [number, number, number, number] }>;
  isFallback: boolean;
};

export function createBitmapLayers(
  renderLevels: RenderLevelState[],
  tileImageLookup: (tileKey: string) => HTMLImageElement | undefined,
  modelMatrix: Matrix4
): BitmapLayer[] {
  const layers = renderLevels
    .flatMap((renderLevel) =>
      renderLevel.tiles.map((tile) => {
        const image = tileImageLookup(tile.key);
        if (!image) return null;
        return new BitmapLayer({
          id: `${renderLevel.isFallback ? "fallback" : "primary"}:${tile.key}`,
          image,
          bounds: tile.bounds,
          opacity: 1,
          modelMatrix
        });
      })
    );
  return layers.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}
