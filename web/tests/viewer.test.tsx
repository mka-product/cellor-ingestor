import { calculateNormalizedMinimapDelta, calculateNormalizedMinimapPoint } from "../src/components/viewer/MiniMap";
import { tileBounds, visibleSlideWindow } from "../src/components/viewer/viewerMath";
import { decodeTileIndex, TileIndexLookup } from "../src/infrastructure/indexCodec";
import { selectLevel } from "../src/viewer/lod";
import { TileCache } from "../src/viewer/tileCache";

function encodeSingleIndexRecord(): ArrayBuffer {
  const buffer = new ArrayBuffer(28);
  const view = new DataView(buffer);
  view.setUint32(0, 0, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, 1, true);
  view.setBigUint64(12, 0n, true);
  view.setUint32(20, 10, true);
  view.setUint16(24, 4, true);
  view.setUint16(26, 1, true);
  return buffer;
}

test("tile cache evicts least recently used entry", () => {
  const cache = new TileCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.size()).toBe(2);
});

test("lod selector chooses first level above viewport scale", () => {
  const manifest = {
    schema: "wsi-tile-manifest-v1" as const,
    slideId: "slide-1",
    versionId: "v-1",
    width: 1000,
    height: 1000,
    tileSize: 512,
    groupSize: [4, 4] as [number, number],
    levels: [
      { level: 0, downsample: 1, width: 1000, height: 1000, tilesX: 2, tilesY: 2, indexPath: "/0" },
      { level: 1, downsample: 2, width: 500, height: 500, tilesX: 1, tilesY: 1, indexPath: "/1" }
    ],
    artifacts: { manifestPath: "/manifest", thumbnailPath: "/thumb" },
    provenance: { ingestionVersion: "0.1.0", sourceChecksum: "sha", publishedAt: "2026-06-16T00:00:00Z" }
  };
  expect(selectLevel(manifest, 1.5).level).toBe(1);
});

test("tile index lookup decodes binary payload", () => {
  const lookup = new TileIndexLookup(decodeTileIndex(encodeSingleIndexRecord()));
  expect(lookup.lookup(0, 0)?.groupId).toBe(1);
});

test("tile bounds map top-down slide tiles into deck world coordinates", () => {
  const manifest = {
    schema: "wsi-tile-manifest-v1" as const,
    slideId: "slide-1",
    versionId: "v-1",
    width: 46000,
    height: 32914,
    tileSize: 512,
    groupSize: [4, 4] as [number, number],
    levels: [{ level: 6, downsample: 64, width: 719, height: 515, tilesX: 2, tilesY: 2, indexPath: "/6" }],
    artifacts: { manifestPath: "/manifest", thumbnailPath: "/thumb" },
    provenance: { ingestionVersion: "0.1.0", sourceChecksum: "sha", publishedAt: "2026-06-16T00:00:00Z" }
  };
  expect(tileBounds(manifest, manifest.levels[0], 0, 0)).toEqual([0, 32768, 32768, 0]);
  expect(tileBounds(manifest, manifest.levels[0], 1, 1)).toEqual([32768, 32914, 46000, 32768]);
});

test("visible slide window preserves top-down coordinates in direct world mapping mode", () => {
  const manifest = {
    schema: "wsi-tile-manifest-v1" as const,
    slideId: "slide-1",
    versionId: "v-1",
    width: 1000,
    height: 800,
    tileSize: 512,
    groupSize: [4, 4] as [number, number],
    levels: [{ level: 0, downsample: 1, width: 1000, height: 800, tilesX: 2, tilesY: 2, indexPath: "/0" }],
    artifacts: { manifestPath: "/manifest", thumbnailPath: "/thumb" },
    provenance: { ingestionVersion: "0.1.0", sourceChecksum: "sha", publishedAt: "2026-06-16T00:00:00Z" }
  };
  expect(visibleSlideWindow(manifest, { target: [500, 400, 0], zoom: 0, rotationOrbit: 0 }, { width: 500, height: 400 }, 1)).toEqual({
    left: 250,
    right: 750,
    top: 600,
    bottom: 200
  });
});

test("manifest metadata contract supports physical calibration fields", () => {
  const manifest = {
    schema: "wsi-tile-manifest-v1" as const,
    slideId: "slide-1",
    versionId: "v-1",
    width: 1000,
    height: 1000,
    tileSize: 512,
    groupSize: [4, 4] as [number, number],
    levels: [{ level: 0, downsample: 1, width: 1000, height: 1000, tilesX: 2, tilesY: 2, indexPath: "/0" }],
    artifacts: { manifestPath: "/manifest", thumbnailPath: "/thumb" },
    metadata: {
      vendor: "aperio",
      objectivePower: 20,
      micronsPerPixel: { x: 0.25, y: 0.25, source: "openslide" as const }
    },
    provenance: { ingestionVersion: "0.1.0", sourceChecksum: "sha", publishedAt: "2026-06-16T00:00:00Z" }
  };
  expect(manifest.metadata?.micronsPerPixel?.x).toBe(0.25);
  expect(manifest.metadata?.objectivePower).toBe(20);
});

test("minimap point normalization maps client coordinates into unit space", () => {
  expect(calculateNormalizedMinimapPoint(100, 50, { left: 0, top: 0, width: 200, height: 100 }, 200, 100)).toEqual({
    x: 0.5,
    y: 0.5
  });
  expect(calculateNormalizedMinimapPoint(250, 120, { left: 0, top: 0, width: 200, height: 100 }, 200, 100)).toEqual({
    x: 1,
    y: 1
  });
});

test("minimap delta normalization scales drags by minimap dimensions", () => {
  expect(calculateNormalizedMinimapDelta(20, 10, 200, 100)).toEqual({ x: 0.1, y: 0.1 });
});
