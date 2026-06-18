import { OrthographicView } from "@deck.gl/core";
import {
  EditableGeoJsonLayer,
  DrawLineStringMode,
  DrawPolygonMode,
  ModifyMode,
  ViewMode
} from "@deck.gl-community/editable-layers";
import { BitmapLayer, PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { Matrix4 } from "@math.gl/core";
import { RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ViewerManifest } from "../../domain/contracts";
import type { AnnotationFeature, AnnotationLayer, OverlayFeature } from "../../domain/workspace";
import { TileIndexLookup, decodeTileIndex } from "../../infrastructure/indexCodec";
import { buildTileGroupUrl, fetchTileGroup, fetchTileIndex } from "../../infrastructure/manifestClient";
import { applyAnnotationBooleanOperation, type AnnotationBooleanMode } from "../../viewer/annotationBoolean";
import { selectLevel } from "../../viewer/lod";
import { TileCache } from "../../viewer/tileCache";
import {
  DEFAULT_VIEWER_SIZE,
  MINIMAP_WIDTH,
  createInitialViewState,
  tileBounds,
  topDownToWorldY,
  type ViewerSize,
  type ViewState,
  visibleSlideWindow,
  worldToTopDownY
} from "./viewerMath";
import { MiniMap } from "./MiniMap";
import { ScaleBar } from "./ScaleBar";

type Props = {
  manifest: ViewerManifest;
  overlayFeatures: OverlayFeature[];
  annotationLayers: AnnotationLayer[];
  annotations: AnnotationFeature[];
  tool: string;
  annotationOperation: AnnotationBooleanMode;
  activeLayerId: string | null;
  selectedOverlayId: string | null;
  selectedAnnotationId: string | null;
  onSelectOverlay: (overlayId: string | null) => void;
  onSelectAnnotation: (annotationId: string | null) => void;
  onPersistAnnotations: (features: AnnotationFeature[]) => void;
  onViewportStatsChange?: (payload: { level: number; visibleTiles: number; totalVisibleReferences: number }) => void;
};

type TileReference = {
  key: string;
  levelKey: string;
  tileX: number;
  tileY: number;
  groupId: number;
  offset: number;
  length: number;
  bounds: [number, number, number, number];
};

type RenderLevelState = {
  level: ViewerManifest["levels"][number];
  tiles: TileReference[];
  isFallback: boolean;
};

type RenderableImage = HTMLImageElement;

const OVERSCAN_TILES = 1;
const TILE_CACHE_CAPACITY = 320;
const VIEW = new OrthographicView({ id: "wsi-view" });

function cursorForTool(tool: string, isDragging: boolean): string {
  if (tool === "view") {
    return isDragging ? "grabbing" : "grab";
  }
  if (tool === "modify") {
    return "default";
  }
  if (tool === "line") {
    return "cell";
  }
  if (tool === "polygon") {
    return "crosshair";
  }
  return "default";
}

function isDrawTool(tool: string): boolean {
  return tool === "line" || tool === "polygon";
}

function clampTileRange(minimum: number, maximum: number, limit: number): [number, number] {
  const clampedMinimum = Math.max(0, Math.min(minimum, limit - 1));
  const clampedMaximum = Math.max(0, Math.min(maximum, limit - 1));
  return [clampedMinimum, clampedMaximum];
}

function collectVisibleTiles(
  manifest: ViewerManifest,
  level: ViewerManifest["levels"][number],
  lookup: TileIndexLookup,
  viewState: ViewState,
  viewerSize: ViewerSize,
  scale: number
): TileReference[] {
  const worldTileSize = manifest.tileSize * level.downsample;
  const window = visibleSlideWindow(manifest, viewState, viewerSize, scale);
  const [minTileX, maxTileX] = clampTileRange(
    Math.floor(window.left / worldTileSize) - OVERSCAN_TILES,
    Math.floor((Math.max(window.right - 1, 0)) / worldTileSize) + OVERSCAN_TILES,
    level.tilesX
  );
  const [minTileY, maxTileY] = clampTileRange(
    Math.floor(window.top / worldTileSize) - OVERSCAN_TILES,
    Math.floor((Math.max(window.bottom - 1, 0)) / worldTileSize) + OVERSCAN_TILES,
    level.tilesY
  );
  const tiles: TileReference[] = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const reference = lookup.lookup(tileX, tileY);
      if (!reference || reference.empty || reference.length === 0) continue;
      tiles.push({
        key: `${level.indexPath}:${tileX}:${tileY}`,
        levelKey: level.indexPath,
        tileX,
        tileY,
        groupId: reference.groupId,
        offset: reference.offset,
        length: reference.length,
        bounds: tileBounds(manifest, level, tileX, tileY)
      });
    }
  }
  return tiles;
}

function pickFallbackLevel(manifest: ViewerManifest, selectedLevel: ViewerManifest["levels"][number], cache: Map<string, TileIndexLookup>) {
  const sorted = [...manifest.levels].sort((a, b) => a.downsample - b.downsample);
  const selectedIndex = sorted.findIndex((candidate) => candidate.indexPath === selectedLevel.indexPath);
  for (let index = selectedIndex + 1; index < sorted.length; index += 1) {
    if (cache.has(sorted[index].indexPath)) {
      return sorted[index];
    }
  }
  return null;
}

async function decodeTileImage(payload: Uint8Array): Promise<HTMLImageElement> {
  const copy = new Uint8Array(payload.byteLength);
  copy.set(payload);
  const blob = new Blob([copy], { type: "image/jpeg" });
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("failed to decode tile"));
    };
    image.src = url;
  });
}

function imagePointToWorld(manifest: ViewerManifest, point: [number, number]): [number, number] {
  return [point[0], topDownToWorldY(manifest.height, point[1])];
}

function imageCoordinatesToWorld(manifest: ViewerManifest, coordinates: unknown): unknown {
  if (!Array.isArray(coordinates)) return coordinates;
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return imagePointToWorld(manifest, [coordinates[0], coordinates[1]]);
  }
  return coordinates.map((entry) => imageCoordinatesToWorld(manifest, entry));
}

function worldCoordinatesToImage(manifest: ViewerManifest, coordinates: unknown): unknown {
  if (!Array.isArray(coordinates)) return coordinates;
  if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    return [coordinates[0], worldToTopDownY(manifest.height, coordinates[1])];
  }
  return coordinates.map((entry) => worldCoordinatesToImage(manifest, entry));
}

function overlayStrokeWidth(feature: OverlayFeature): number {
  return typeof feature.styleHints.strokeWidth === "number" ? feature.styleHints.strokeWidth : 2;
}

function overlayColor(feature: OverlayFeature, fallback: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(feature.styleHints.color) && feature.styleHints.color.length >= 3) {
    const values = feature.styleHints.color as number[];
    return [values[0] ?? fallback[0], values[1] ?? fallback[1], values[2] ?? fallback[2], values[3] ?? fallback[3]];
  }
  return fallback;
}

function annotationColor(layer: AnnotationLayer | undefined): [number, number, number, number] {
  if (!layer) return [251, 191, 36, 180];
  const normalized = layer.color.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  const parsed = Number.parseInt(value, 16);
  return [parsed >> 16, (parsed >> 8) & 255, parsed & 255, 180];
}

function alphaFromOpacity(opacity: unknown, fallback: number): number {
  const normalized = Number(opacity);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(0, Math.min(255, Math.round(normalized * 255)));
}

function colorFromHex(
  value: unknown,
  fallback: [number, number, number, number],
  opacity?: unknown
): [number, number, number, number] {
  const alpha = alphaFromOpacity(opacity, fallback[3]);
  if (typeof value !== "string" || !value.startsWith("#")) return fallback;
  const normalized = value.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  const parsed = Number.parseInt(full, 16);
  if (Number.isNaN(parsed)) return fallback;
  return [parsed >> 16, (parsed >> 8) & 255, parsed & 255, alpha];
}

function formatPhysicalDistanceFromPixels(pixelDistance: number, micronsPerPixel: number | null): string {
  if (!Number.isFinite(pixelDistance) || pixelDistance <= 0) {
    return "";
  }
  if (!micronsPerPixel || !Number.isFinite(micronsPerPixel) || micronsPerPixel <= 0) {
    return `Distance: ${pixelDistance.toFixed(0)} px`;
  }
  const microns = pixelDistance * micronsPerPixel;
  if (microns >= 10_000) {
    return `Distance: ${(microns / 1000).toFixed(1)} mm`;
  }
  if (microns >= 1000) {
    return `Distance: ${(microns / 1000).toFixed(2)} mm`;
  }
  return `Distance: ${microns.toFixed(0)} μm`;
}

function distanceBetweenPoints(a: number[], b: number[]): number {
  const dx = (b[0] ?? 0) - (a[0] ?? 0);
  const dy = (b[1] ?? 0) - (a[1] ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function isFinitePosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function positionsEqual(a: number[], b: number[]) {
  return a[0] === b[0] && a[1] === b[1];
}

function sanitizeLineCoordinates(coordinates: unknown): number[][] | null {
  if (!Array.isArray(coordinates)) return null;
  const points = coordinates.filter(isFinitePosition).map((point) => [Number(point[0]), Number(point[1])]);
  return points.length >= 2 ? points : null;
}

function sanitizePolygonRing(ring: unknown): number[][] | null {
  if (!Array.isArray(ring)) return null;
  const points = ring.filter(isFinitePosition).map((point) => [Number(point[0]), Number(point[1])]);
  if (points.length < 3) return null;
  const uniquePoints = points.filter(
    (point, index) => index === 0 || !positionsEqual(point, points[index - 1] as number[])
  );
  if (uniquePoints.length < 3) return null;
  const closedRing = positionsEqual(uniquePoints[0] as number[], uniquePoints[uniquePoints.length - 1] as number[])
    ? uniquePoints
    : [...uniquePoints, uniquePoints[0] as number[]];
  return closedRing.length >= 4 ? closedRing : null;
}

function sanitizePolygonCoordinates(coordinates: unknown): number[][][] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
  const rings = coordinates
    .map((ring) => sanitizePolygonRing(ring))
    .filter((ring): ring is number[][] => ring !== null);
  return rings.length > 0 ? rings : null;
}

function sanitizeAnnotationGeometry(geometry: Record<string, unknown>): Record<string, unknown> | null {
  const type = String(geometry.type ?? "");
  if (type === "Polygon") {
    const coordinates = sanitizePolygonCoordinates(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "LineString") {
    const coordinates = sanitizeLineCoordinates(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "Point") {
    const coordinates = isFinitePosition(geometry.coordinates)
      ? [Number((geometry.coordinates as number[])[0]), Number((geometry.coordinates as number[])[1])]
      : null;
    return coordinates ? { type, coordinates } : null;
  }
  return null;
}

function sanitizeAnnotationFeature(feature: AnnotationFeature): AnnotationFeature | null {
  const geometry = sanitizeAnnotationGeometry(feature.geometry);
  return geometry ? { ...feature, geometry } : null;
}

class PixelAccurateDrawLineStringMode extends DrawLineStringMode {
  calculateInfoDraw(clickSequence: number[][]) {
    if (clickSequence.length > 1) {
      this.position = clickSequence[clickSequence.length - 1] as any;
      this.dist += distanceBetweenPoints(clickSequence[clickSequence.length - 2], clickSequence[clickSequence.length - 1]);
    }
  }
}

export function ViewerCanvas(props: Props) {
  const { manifest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indexCacheRef = useRef(new Map<string, TileIndexLookup>());
  const tileCacheRef = useRef(new TileCache<RenderableImage>(TILE_CACHE_CAPACITY));
  const groupCacheRef = useRef(new Map<string, Promise<ArrayBuffer>>());
  const pendingTileRef = useRef(new Map<string, Promise<void>>());
  const scaleBarDraggedRef = useRef(false);
  const rotationDragRef = useRef<{ pointerId: number; startX: number; startRotation: number } | null>(null);
  const annotationCollectionRef = useRef<any>({ type: "FeatureCollection", features: [] });
  const pendingAnnotationCollectionRef = useRef<any | null>(null);
  const annotationFrameRef = useRef<number | null>(null);
  const [viewerSize, setViewerSize] = useState<ViewerSize>(DEFAULT_VIEWER_SIZE);
  const [viewState, setViewState] = useState<ViewState>(createInitialViewState(manifest, DEFAULT_VIEWER_SIZE));
  const [status, setStatus] = useState("loading");
  const [indexRevision, setIndexRevision] = useState(0);
  const [tileRevision, setTileRevision] = useState(0);
  const [annotationCollection, setAnnotationCollection] = useState<any>({ type: "FeatureCollection", features: [] });
  const [scaleBarPosition, setScaleBarPosition] = useState({ x: 16, y: DEFAULT_VIEWER_SIZE.height - 64 });
  const [rotationTooltip, setRotationTooltip] = useState<string | null>(null);
  const resetViewer = () => setViewState(createInitialViewState(manifest, viewerSize));
  const zoomInViewer = () => setViewState((current) => ({ ...current, zoom: Math.min(current.zoom + 0.5, 10) }));
  const zoomOutViewer = () => setViewState((current) => ({ ...current, zoom: Math.max(current.zoom - 0.5, -10) }));

  const commitAnnotationCollection = (nextCollection: any) => {
    annotationCollectionRef.current = nextCollection;
    setAnnotationCollection(nextCollection);
  };

  const scheduleAnnotationCollectionUpdate = (nextCollection: any) => {
    pendingAnnotationCollectionRef.current = nextCollection;
    if (annotationFrameRef.current != null) return;
    annotationFrameRef.current = window.requestAnimationFrame(() => {
      annotationFrameRef.current = null;
      const pending = pendingAnnotationCollectionRef.current;
      pendingAnnotationCollectionRef.current = null;
      if (pending) {
        commitAnnotationCollection(pending);
      }
    });
  };

  useEffect(() => {
    const nextCollection = {
      type: "FeatureCollection",
      features: props.annotations
        .map((annotation) => sanitizeAnnotationFeature(annotation))
        .filter((annotation): annotation is AnnotationFeature => annotation !== null)
        .map((annotation) => ({
          type: "Feature",
          id: annotation.id,
          geometry: {
            type: String(annotation.geometry["type"] ?? "Polygon"),
            coordinates: imageCoordinatesToWorld(manifest, annotation.geometry["coordinates"])
          },
          properties: {
            ...annotation.properties,
            style: annotation.style,
            layerId: annotation.layerId
          }
        }))
    };
    commitAnnotationCollection(nextCollection);
  }, [manifest, props.annotations]);

  useEffect(() => {
    return () => {
      if (annotationFrameRef.current != null) {
        window.cancelAnimationFrame(annotationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setViewState(createInitialViewState(manifest, viewerSize));
    setStatus("loading");
    indexCacheRef.current.clear();
    groupCacheRef.current.clear();
    pendingTileRef.current.clear();
    setTileRevision((current) => current + 1);
    setIndexRevision((current) => current + 1);
  }, [manifest, viewerSize.height, viewerSize.width]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => {
      setViewerSize({
        width: Math.max(1, Math.floor(element.clientWidth || DEFAULT_VIEWER_SIZE.width)),
        height: Math.max(1, Math.floor(element.clientHeight || 640))
      });
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (scaleBarDraggedRef.current) return;
    setScaleBarPosition({ x: 16, y: Math.max(16, viewerSize.height - 64) });
  }, [viewerSize.height]);

  const scale = useMemo(() => 2 ** viewState.zoom, [viewState.zoom]);
  const drawToolActive = useMemo(() => isDrawTool(props.tool), [props.tool]);
  const viewportScale = useMemo(() => Math.max(1, 1 / scale), [scale]);
  const level = useMemo(() => selectLevel(manifest, viewportScale), [manifest, viewportScale]);
  const selectedLookup = useMemo(() => indexCacheRef.current.get(level.indexPath) ?? null, [indexRevision, level.indexPath]);
  const fallbackLevel = useMemo(() => pickFallbackLevel(manifest, level, indexCacheRef.current), [indexRevision, level, manifest]);

  useEffect(() => {
    const cached = indexCacheRef.current.get(level.indexPath);
    if (cached) {
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchTileIndex(level.indexPath, controller.signal)
      .then((payload) => {
        indexCacheRef.current.set(level.indexPath, new TileIndexLookup(decodeTileIndex(payload)));
        setIndexRevision((current) => current + 1);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [level.indexPath]);

  const renderLevels = useMemo(() => {
    const levelsToRender: RenderLevelState[] = [];
    if (fallbackLevel) {
      const lookup = indexCacheRef.current.get(fallbackLevel.indexPath);
      if (lookup) {
        levelsToRender.push({
          level: fallbackLevel,
          tiles: collectVisibleTiles(manifest, fallbackLevel, lookup, viewState, viewerSize, scale),
          isFallback: true
        });
      }
    }
    if (selectedLookup) {
      levelsToRender.push({
        level,
        tiles: collectVisibleTiles(manifest, level, selectedLookup, viewState, viewerSize, scale),
        isFallback: false
      });
    }
    return levelsToRender;
  }, [fallbackLevel, level, manifest, scale, selectedLookup, viewState, viewerSize]);

  const allVisibleTiles = useMemo(() => renderLevels.flatMap((entry) => entry.tiles), [renderLevels]);

  useEffect(() => {
    const controller = new AbortController();
    const loadTile = async (tile: TileReference) => {
      const cached = tileCacheRef.current.get(tile.key);
      if (cached || pendingTileRef.current.has(tile.key)) return;
      const job = (async () => {
        const groupUrl = buildTileGroupUrl(tile.levelKey, tile.groupId);
        let groupPayload = groupCacheRef.current.get(groupUrl);
        if (!groupPayload) {
          groupPayload = fetchTileGroup(groupUrl, controller.signal);
          groupCacheRef.current.set(groupUrl, groupPayload);
        }
        const buffer = await groupPayload;
        const payload = new Uint8Array(buffer, tile.offset + 4, tile.length);
        const image = await decodeTileImage(payload);
        tileCacheRef.current.set(tile.key, image);
      })()
        .then(() => setTileRevision((current) => current + 1))
        .catch(() => {
          groupCacheRef.current.delete(buildTileGroupUrl(tile.levelKey, tile.groupId));
        })
        .finally(() => {
          pendingTileRef.current.delete(tile.key);
        });
      pendingTileRef.current.set(tile.key, job);
    };
    allVisibleTiles.forEach((tile) => void loadTile(tile));
    return () => controller.abort();
  }, [allVisibleTiles]);

  const layerModelMatrix = useMemo(
    () =>
      new Matrix4()
        .translate([manifest.width / 2, manifest.height / 2, 0])
        .rotateZ((viewState.rotationOrbit * Math.PI) / 180)
        .translate([-manifest.width / 2, -manifest.height / 2, 0]),
    [manifest.height, manifest.width, viewState.rotationOrbit]
  );

  const bitmapLayers = useMemo(() => {
    return renderLevels
      .flatMap((renderLevel) =>
        renderLevel.tiles.map((tile) => {
          const image = tileCacheRef.current.get(tile.key);
          if (!image) return null;
          return new BitmapLayer({
            id: `${renderLevel.isFallback ? "fallback" : "primary"}:${tile.key}`,
            image,
            bounds: tile.bounds,
            opacity: 1,
            modelMatrix: layerModelMatrix
          });
        })
      )
      .filter(Boolean);
  }, [layerModelMatrix, renderLevels, tileRevision]) as BitmapLayer[];

  useEffect(() => {
    props.onViewportStatsChange?.({
      level: level.level,
      visibleTiles: bitmapLayers.length,
      totalVisibleReferences: allVisibleTiles.length
    });
  }, [allVisibleTiles.length, bitmapLayers.length, level.level, props.onViewportStatsChange]);

  useEffect(() => {
    window.addEventListener("viewer-zoom-in", zoomInViewer as EventListener);
    window.addEventListener("viewer-zoom-out", zoomOutViewer as EventListener);
    window.addEventListener("viewer-reset", resetViewer as EventListener);
    return () => {
      window.removeEventListener("viewer-zoom-in", zoomInViewer as EventListener);
      window.removeEventListener("viewer-zoom-out", zoomOutViewer as EventListener);
      window.removeEventListener("viewer-reset", resetViewer as EventListener);
    };
  }, [manifest, viewerSize]);

  const polygonOverlays = useMemo(
    () =>
      props.overlayFeatures.filter((feature) => feature.kind === "polygon").map((feature) => ({
        ...feature,
        polygon: imageCoordinatesToWorld(manifest, feature.geometry["coordinates"]) as number[][][]
      })),
    [manifest, props.overlayFeatures]
  );
  const lineOverlays = useMemo(
    () =>
      props.overlayFeatures.filter((feature) => feature.kind === "polyline").map((feature) => ({
        ...feature,
        path: imageCoordinatesToWorld(manifest, feature.geometry["coordinates"]) as number[][]
      })),
    [manifest, props.overlayFeatures]
  );
  const pointOverlays = useMemo(
    () =>
      props.overlayFeatures.filter((feature) => feature.kind === "point").map((feature) => ({
        ...feature,
        position: imageCoordinatesToWorld(manifest, feature.geometry["coordinates"]) as number[]
      })),
    [manifest, props.overlayFeatures]
  );

  const overlayLayers = useMemo(
    () => [
      new PolygonLayer({
        id: "overlay-polygons",
        data: polygonOverlays,
        getPolygon: (item: (typeof polygonOverlays)[number]) => item.polygon[0] ?? [],
        getLineColor: (item: (typeof polygonOverlays)[number]) => overlayColor(item, [56, 189, 248, 255]),
        getFillColor: (item: (typeof polygonOverlays)[number]) => overlayColor(item, [56, 189, 248, 70]),
        lineWidthUnits: "pixels",
        getLineWidth: (item: (typeof polygonOverlays)[number]) => overlayStrokeWidth(item),
        modelMatrix: layerModelMatrix,
        pickable: true,
        onClick: (info: { object?: { id: string } }) => props.onSelectOverlay(info.object?.id ?? null)
      }),
      new PathLayer({
        id: "overlay-lines",
        data: lineOverlays,
        getPath: (item: (typeof lineOverlays)[number]) => item.path as any,
        getColor: (item: (typeof lineOverlays)[number]) => overlayColor(item, [244, 114, 182, 255]),
        widthUnits: "pixels",
        getWidth: (item: (typeof lineOverlays)[number]) => overlayStrokeWidth(item),
        modelMatrix: layerModelMatrix,
        pickable: true,
        onClick: (info: { object?: { id: string } }) => props.onSelectOverlay(info.object?.id ?? null)
      }),
      new ScatterplotLayer({
        id: "overlay-points",
        data: pointOverlays,
        getPosition: (item: (typeof pointOverlays)[number]) => item.position as [number, number],
        getRadius: () => 16,
        radiusUnits: "pixels",
        getFillColor: (item: (typeof pointOverlays)[number]) => overlayColor(item, [251, 191, 36, 255]),
        modelMatrix: layerModelMatrix,
        pickable: true,
        onClick: (info: { object?: { id: string } }) => props.onSelectOverlay(info.object?.id ?? null)
      })
    ],
    [layerModelMatrix, lineOverlays, pointOverlays, polygonOverlays, props.onSelectOverlay]
  );

  const selectedFeatureIndexes = useMemo(
    () =>
      props.selectedAnnotationId == null
        ? []
        : (annotationCollection.features as Array<{ id?: string }>).reduce((indexes: number[], feature, index) => {
            if (feature.id === props.selectedAnnotationId) indexes.push(index);
            return indexes;
          }, []),
    [annotationCollection.features, props.selectedAnnotationId]
  );

  const annotationLayerById = useMemo(
    () => new Map(props.annotationLayers.map((layer) => [layer.id, layer])),
    [props.annotationLayers]
  );

  const editableLayer = useMemo(() => new EditableGeoJsonLayer({
    id: "annotations",
    data: annotationCollection,
    coordinateSystem: "cartesian",
    modeConfig: {
      formatTooltip: (distance: number) =>
        formatPhysicalDistanceFromPixels(distance, manifest.metadata?.micronsPerPixel?.x ?? manifest.metadata?.micronsPerPixel?.y ?? null)
    },
    mode:
      props.tool === "modify"
        ? ModifyMode
        : props.tool === "line"
            ? PixelAccurateDrawLineStringMode
            : props.tool === "polygon"
              ? DrawPolygonMode
              : ViewMode,
    selectedFeatureIndexes,
    getFillColor: (feature: { properties?: { layerId?: string; style?: { color?: string; opacity?: number } } }) =>
      colorFromHex(
        feature.properties?.style?.color,
        annotationColor(annotationLayerById.get(String(feature.properties?.layerId ?? ""))),
        feature.properties?.style?.opacity
      ),
    getLineColor: (feature: { properties?: { layerId?: string; style?: { color?: string; opacity?: number } } }) =>
      colorFromHex(
        feature.properties?.style?.color,
        annotationColor(annotationLayerById.get(String(feature.properties?.layerId ?? ""))),
        feature.properties?.style?.opacity
      ),
    getLineWidth: (feature: { properties?: { style?: { lineWidth?: number } } }) => Number(feature.properties?.style?.lineWidth ?? 2),
    modelMatrix: layerModelMatrix,
    pickable: true,
    onClick: (info: { object?: { id?: string } }) => props.onSelectAnnotation((info.object?.id as string | null) ?? null),
    onEdit: ({ updatedData, editType }: { updatedData: any; editType: string }) => {
      const isCommittedAdd = editType === "addFeature";
      const isTentative =
        editType === "addTentativePosition" ||
        editType === "updateTentativeFeature" ||
        editType === "invalidPolygon" ||
        editType === "invalidHole" ||
        editType === "movePosition";

      if (isTentative) {
        scheduleAnnotationCollectionUpdate(updatedData);
        return;
      }

      if (editType === "cancelFeature") {
        commitAnnotationCollection(updatedData);
        return;
      }

      const nextData =
        isCommittedAdd
          ? {
              ...updatedData,
              features: applyAnnotationBooleanOperation({
                previousFeatures: annotationCollectionRef.current.features as any[],
                updatedFeatures: updatedData.features as any[],
                operation: props.annotationOperation,
                activeLayerId: props.activeLayerId
              })
            }
          : updatedData;

      const sanitizedFeatures = (nextData.features as any[])
        .map((feature) => {
          const geometry = sanitizeAnnotationGeometry(feature.geometry ?? {});
          return geometry ? { ...feature, geometry } : null;
        })
        .filter(Boolean);
      const sanitizedData = { ...nextData, features: sanitizedFeatures };

      commitAnnotationCollection(sanitizedData);
      const targetLayerId = props.activeLayerId ?? props.annotationLayers[0]?.id ?? "default-layer";
      props.onPersistAnnotations(
        sanitizedData.features.map((feature: any) => ({
          id: String(feature.id ?? crypto.randomUUID()),
          layerId: String(feature.properties?.layerId ?? targetLayerId),
          geometry: {
            type: feature.geometry.type,
            coordinates: worldCoordinatesToImage(manifest, feature.geometry.coordinates)
          },
          properties: feature.properties ?? {},
          style: feature.properties?.style ?? {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))
      );
    }
  }), [
    annotationCollection,
    annotationLayerById,
    layerModelMatrix,
    manifest,
    props.activeLayerId,
    props.annotationLayers,
    props.annotationOperation,
    props.onPersistAnnotations,
    props.onSelectAnnotation,
    props.selectedAnnotationId,
    props.tool,
    selectedFeatureIndexes
  ]);

  const visibleWindow = useMemo(() => visibleSlideWindow(manifest, viewState, viewerSize, scale), [manifest, scale, viewState, viewerSize]);
  const minimapHeight = useMemo(() => Math.round((MINIMAP_WIDTH * manifest.height) / manifest.width), [manifest.height, manifest.width]);
  const minimapRect = useMemo(() => {
    const left = (visibleWindow.left / manifest.width) * MINIMAP_WIDTH;
    const top = (visibleWindow.top / manifest.height) * minimapHeight;
    const width = ((visibleWindow.right - visibleWindow.left) / manifest.width) * MINIMAP_WIDTH;
    const height = ((visibleWindow.bottom - visibleWindow.top) / manifest.height) * minimapHeight;
    return { left, top, width, height };
  }, [manifest.height, manifest.width, minimapHeight, visibleWindow]);

  const scaleBar = useMemo(() => {
    const mpp = manifest.metadata?.micronsPerPixel?.x ?? manifest.metadata?.micronsPerPixel?.y;
    if (!mpp) return { label: "", pixels: 0 };
    const pixels = 100;
    const microns = (pixels / scale) * mpp;
    if (microns >= 100_000) {
      return { label: `${(microns / 1000).toFixed(0)} mm`, pixels };
    }
    if (microns >= 10_000) {
      return { label: `${(microns / 1000).toFixed(1)} mm`, pixels };
    }
    if (microns >= 1000) {
      return { label: `${(microns / 1000).toFixed(2)} mm`, pixels };
    }
    return { label: `${microns.toFixed(0)} μm`, pixels };
  }, [manifest.metadata?.micronsPerPixel?.x, manifest.metadata?.micronsPerPixel?.y, scale]);

  if (status === "error") {
    return <div role="alert">Viewer failed to load</div>;
  }

  const normalizedRotation = ((viewState.rotationOrbit % 360) + 360) % 360;

  return (
    <div ref={containerRef} className="workspace-canvas">
      <DeckGL
        controller={drawToolActive ? false : { dragPan: true, touchRotate: false, scrollZoom: { speed: 0.01 }, doubleClickZoom: true, keyboard: true }}
        getCursor={({ isDragging }) => cursorForTool(props.tool, isDragging)}
        layers={[...bitmapLayers, ...overlayLayers, editableLayer]}
        views={VIEW}
        viewState={viewState}
        onViewStateChange={drawToolActive ? undefined : ({ viewState: next }) => {
          const zoom = typeof next.zoom === "number" ? next.zoom : viewState.zoom;
          const target: [number, number, number] = Array.isArray(next.target)
            ? [Number(next.target[0] ?? viewState.target[0]), Number(next.target[1] ?? viewState.target[1]), 0]
            : viewState.target;
          setViewState({
            target,
            zoom,
            rotationOrbit: typeof next.rotationOrbit === "number" ? next.rotationOrbit : viewState.rotationOrbit
          });
        }}
        style={{ position: "absolute", inset: "0" }}
      />
      {status === "loading" ? (
        <div style={{ position: "absolute", left: 12, top: 12, padding: "6px 10px", borderRadius: 999, background: "rgba(15,23,42,0.72)", color: "white", zIndex: 4 }}>
          Loading level {level.level}…
        </div>
      ) : null}
      <ScaleBar
        label={scaleBar.label}
        pixels={scaleBar.pixels}
        position={scaleBarPosition}
        onPositionChange={(position) => {
          scaleBarDraggedRef.current = true;
          setScaleBarPosition(position);
        }}
      />
      <MiniMap
        slideId={manifest.slideId}
        thumbnailPath={manifest.artifacts.thumbnailPath}
        width={MINIMAP_WIDTH}
        height={minimapHeight}
        rect={minimapRect}
        onMoveToPoint={(normalizedX, normalizedY) => {
          setViewState((current) => ({
            ...current,
            target: [normalizedX * manifest.width, topDownToWorldY(manifest.height, normalizedY * manifest.height), 0]
          }));
        }}
        onDragDelta={(deltaX, deltaY) => {
          setViewState((current) => ({
            ...current,
            target: [
              current.target[0] + deltaX * manifest.width,
              current.target[1] - deltaY * manifest.height,
              0
            ]
          }));
        }}
      />
      <div className="workspace-rotation-control" aria-label="Rotation control">
        <button
          type="button"
          className="workspace-rotation-control__button"
          aria-label="Rotate slide"
          title="Drag to rotate"
          onPointerDown={(event) => {
            rotationDragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startRotation: viewState.rotationOrbit
            };
            setRotationTooltip(`${Math.round(normalizedRotation)}°`);
            (event.currentTarget as HTMLButtonElement).setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = rotationDragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - drag.startX;
            const nextRotation = drag.startRotation + deltaX;
            setViewState((current) => ({ ...current, rotationOrbit: nextRotation }));
            const normalized = ((nextRotation % 360) + 360) % 360;
            setRotationTooltip(`${Math.round(normalized)}°`);
          }}
          onPointerUp={(event) => {
            if (rotationDragRef.current?.pointerId === event.pointerId) {
              rotationDragRef.current = null;
              setRotationTooltip(null);
            }
            (event.currentTarget as HTMLButtonElement).releasePointerCapture?.(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (rotationDragRef.current?.pointerId === event.pointerId) {
              rotationDragRef.current = null;
              setRotationTooltip(null);
            }
            (event.currentTarget as HTMLButtonElement).releasePointerCapture?.(event.pointerId);
          }}
        >
          {rotationTooltip ? <div className="workspace-rotation-control__tooltip">{rotationTooltip}</div> : null}
          <RotateCw className="workspace-rotation-control__icon" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
