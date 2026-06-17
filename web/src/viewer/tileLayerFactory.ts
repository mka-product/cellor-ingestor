import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";

import type { ViewerManifest } from "../domain/contracts";
import { TileIndexLookup } from "../infrastructure/indexCodec";

type TileLayerDependencies = {
  manifest: ViewerManifest;
  indexLookup: TileIndexLookup;
  fetchTile: (groupId: number, offset: number, length: number, signal?: AbortSignal) => Promise<ImageBitmap | null>;
};

export function createWsiTileLayer({ manifest, indexLookup, fetchTile }: TileLayerDependencies): TileLayer {
  return new TileLayer({
    id: "wsi-tiles",
    tileSize: manifest.tileSize,
    minZoom: 0,
    maxZoom: Math.max(...manifest.levels.map((level) => level.level)),
    getTileData: async (tile) => {
      const { x, y, signal } = tile as unknown as { x: number; y: number; signal?: AbortSignal };
      const reference = indexLookup.lookup(x, y);
      if (!reference || reference.empty) {
        return { empty: true, bounds: [0, 0, 0, 0] };
      }
      const image = await fetchTile(reference.groupId, reference.offset, reference.length, signal);
      return {
        empty: false,
        image,
        bounds: [x * manifest.tileSize, y * manifest.tileSize, (x + 1) * manifest.tileSize, (y + 1) * manifest.tileSize]
      };
    },
    renderSubLayers: (props) => {
      const data = props.data as { empty: boolean; image?: ImageBitmap; bounds: [number, number, number, number] };
      if (data.empty || !data.image) return null;
      return new BitmapLayer(props, {
        image: data.image,
        bounds: data.bounds
      });
    }
  });
}
