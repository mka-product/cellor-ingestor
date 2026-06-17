export type ViewerLevel = {
  level: number;
  downsample: number;
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  indexPath: string;
};

export type ViewerManifest = {
  schema: "wsi-tile-manifest-v1";
  slideId: string;
  versionId: string;
  width: number;
  height: number;
  tileSize: number;
  groupSize: [number, number];
  levels: ViewerLevel[];
  artifacts: {
    manifestPath: string;
    thumbnailPath: string;
    tissueMaskPath?: string;
  };
  metadata?: {
    vendor?: string;
    objectivePower?: number;
    micronsPerPixel?: {
      x?: number | null;
      y?: number | null;
      source: "openslide" | "ome" | "vendor";
    };
    sourceProperties?: Record<string, string>;
  };
  provenance: {
    ingestionVersion: string;
    sourceChecksum: string;
    publishedAt: string;
    sourceName?: string;
    metrics?: {
      levelCount?: number;
      tileCount?: number;
      nonEmptyTileCount?: number;
      groupCount?: number;
      artifactBytes?: number;
    };
  };
};

export type TileIndexRecord = {
  tileX: number;
  tileY: number;
  groupId: number;
  offset: number;
  length: number;
  flags: number;
  codec: number;
};

export type TileReference = TileIndexRecord & {
  empty: boolean;
};
