import { OrthographicView } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { Matrix4 } from "@math.gl/core";
import { RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ViewerManifest } from "../../domain/contracts";
import type { AnnotationFeature, AnnotationLayer, OverlayFeature } from "../../domain/workspace";
import { TileIndexLookup, decodeTileIndex } from "../../infrastructure/indexCodec";
import { buildTileGroupUrl, fetchTileGroup, fetchTileIndex } from "../../infrastructure/manifestClient";
import type { AnnotationBooleanMode } from "../../viewer/annotationBoolean";
import { sanitizeAnnotationFeature } from "../../viewer/annotationGeometry";
import { selectLevel } from "../../viewer/lod";
import { buildOverlayRenderPlan, computeOverlayLodThresholds, type OverlayRenderMode } from "../../viewer/overlayLod";
import type { OverlayWindow } from "../../viewer/overlayManifest";
import { createOverlayLayers } from "../../viewer/overlayLayers";
import { sanitizeOverlayLabel } from "../../viewer/overlayStyling";
import { TileCache } from "../../viewer/tileCache";
import { createBitmapLayers } from "../../viewer/tileBitmapLayers";
import { createAnnotationEditorLayer } from "./AnnotationEditorLayer";
import { useBufferedFeatureCollection } from "./useBufferedFeatureCollection";
import type { EditableGeoJsonFeatureCollection, EditableGeoJsonFeature } from "./useBufferedFeatureCollection";
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

function presenceColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) & 0xfffffff;
  return `hsl(${h % 360}, 80%, 62%)`;
}

export type OverlayGroup = {
  id: string;
  features: OverlayFeature[];
  /** Precomputed representation mode from the chunk runtime — skips frontend LOD computation. */
  runtimeMode: OverlayRenderMode | null;
};

type Props = {
  manifest: ViewerManifest;
  initialViewport?: { cx: number; cy: number; zoom: number } | null;
  overlayGroups: OverlayGroup[];
  annotationLayers: AnnotationLayer[];
  annotations: AnnotationFeature[];
  tool: string;
  annotationOperation: AnnotationBooleanMode;
  activeLayerId: string | null;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string | null) => void;
  onPersistAnnotations: (features: AnnotationFeature[]) => void;
  remotePresence?: Array<{
    userId: string;
    x: number;
    y: number;
    zoom: number;
    slideX?: number;
    slideY?: number;
    viewport?: OverlayWindow;
    centerX?: number;
    centerY?: number;
  }>;
  onPresenceUpdate?: (payload: {
    x: number;
    y: number;
    zoom: number;
    slideX: number;
    slideY: number;
    viewport: OverlayWindow;
    centerX: number;
    centerY: number;
  }) => void;
  onViewportStatsChange?: (payload: { level: number; visibleTiles: number; totalVisibleReferences: number }) => void;
  onVisibleWindowChange?: (payload: OverlayWindow) => void;
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

const OVERSCAN_TILES = 2;
const TILE_CACHE_CAPACITY = 1024;
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

function overlayTooltip(info: { object?: { name?: string; properties?: Record<string, unknown> } | null; layer?: { id?: string } | null }) {
  if (!info.object || !info.layer?.id?.includes("overlay-")) {
    return null;
  }
  const properties = info.object.properties ?? {};
  const isHeatmap = Boolean(properties.isHeatmap);
  const lines = [
    isHeatmap
      ? (properties.class != null ? `${sanitizeOverlayLabel(String(properties.class))} — density cell` : "Density cell")
      : (typeof info.object.name === "string" ? sanitizeOverlayLabel(info.object.name) : null),
    !isHeatmap && properties.class != null ? `Class: ${sanitizeOverlayLabel(String(properties.class))}` : null,
    typeof properties.score === "number" ? `Score: ${properties.score.toFixed(3)}` : null,
    typeof properties.count === "number" ? `${isHeatmap ? "Features" : "Count"}: ${properties.count}` : null
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? { text: lines.join("\n") } : null;
}

function formatPresenceMagnification(manifest: ViewerManifest, zoom: number): string {
  const scale = 2 ** zoom;
  const objectivePower = manifest.metadata?.objectivePower;
  if (typeof objectivePower === "number" && Number.isFinite(objectivePower) && objectivePower > 0) {
    return `${(objectivePower * scale).toFixed(1)}x`;
  }
  return `${scale.toFixed(1)}x`;
}

export function ViewerCanvas(props: Props) {
  const { manifest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indexCacheRef = useRef(new Map<string, TileIndexLookup>());
  const tileCacheRef = useRef(new TileCache<RenderableImage>(TILE_CACHE_CAPACITY));
  const groupCacheRef = useRef(new Map<string, Promise<ArrayBuffer>>());
  const pendingTileRef = useRef(new Map<string, Promise<void>>());
  const lastViewportStatsRef = useRef<string | null>(null);
  const lastVisibleWindowRef = useRef<string | null>(null);
  const lastPresencePayloadRef = useRef<string | null>(null);
  const scaleBarDraggedRef = useRef(false);
  const rotationDragRef = useRef<{ pointerId: number; startX: number; startRotation: number } | null>(null);
  const lastPresencePointerRef = useRef<{ x: number; y: number; slideX: number; slideY: number } | null>(null);
  // Tracks the last rendered slideId so the viewport effect can distinguish a real slide
  // switch from a React StrictMode double-invoke (same slide, new object reference).
  const lastSlideIdRef = useRef<string | null>(null);
  const [viewerSize, setViewerSize] = useState<ViewerSize>(DEFAULT_VIEWER_SIZE);
  // Stable ref so the manifest-only viewState effect can read the current viewerSize
  // without depending on it (we don't want a resize to reset the viewport position).
  const viewerSizeRef = useRef(viewerSize);
  viewerSizeRef.current = viewerSize;
  const [viewState, setViewState] = useState<ViewState>(() => {
    const iv = props.initialViewport;
    if (iv && isFinite(iv.cx) && isFinite(iv.cy) && isFinite(iv.zoom)) {
      return { target: [iv.cx, iv.cy, 0] as [number, number, number], zoom: iv.zoom, rotationOrbit: 0 };
    }
    return createInitialViewState(manifest, DEFAULT_VIEWER_SIZE);
  });
  const [status, setStatus] = useState("loading");
  const [indexRevision, setIndexRevision] = useState(0);
  const [tileRevision, setTileRevision] = useState(0);
  const [scaleBarPosition, setScaleBarPosition] = useState({ x: 16, y: DEFAULT_VIEWER_SIZE.height - 64 });
  const [rotationTooltip, setRotationTooltip] = useState<string | null>(null);
  const {
    collection: annotationCollection,
    collectionRef: annotationCollectionRef,
    commitCollection: commitAnnotationCollection,
    scheduleCollectionUpdate: scheduleAnnotationCollectionUpdate
  } = useBufferedFeatureCollection({ type: "FeatureCollection", features: [] });
  const resetViewer = () => setViewState(createInitialViewState(manifest, viewerSize));
  const zoomInViewer = () => setViewState((current) => ({ ...current, zoom: Math.min(current.zoom + 0.5, 10) }));
  const zoomOutViewer = () => setViewState((current) => ({ ...current, zoom: Math.max(current.zoom - 0.5, -10) }));

  useEffect(() => {
    const nextCollection: EditableGeoJsonFeatureCollection = {
      type: "FeatureCollection" as const,
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
        })) as EditableGeoJsonFeature[]
    };
    commitAnnotationCollection(nextCollection);
  }, [manifest, props.annotations]);

  // Viewport reset: only on a genuine slide switch, never on resize or StrictMode double-invoke.
  // React StrictMode in dev remounts effects with the same manifest (different object, same slideId).
  // Comparing slideId prevents those spurious reruns from stomping the URL-restored position.
  useEffect(() => {
    const slideId = manifest.slideId;
    const isFirstLoad = lastSlideIdRef.current === null;
    const isSlideChange = !isFirstLoad && lastSlideIdRef.current !== slideId;
    lastSlideIdRef.current = slideId;

    const iv = props.initialViewport;
    if (isFirstLoad && iv && isFinite(iv.cx) && isFinite(iv.cy) && isFinite(iv.zoom)) {
      setViewState({ target: [iv.cx, iv.cy, 0] as [number, number, number], zoom: iv.zoom, rotationOrbit: 0 });
    } else if (isSlideChange) {
      setViewState(createInitialViewState(manifest, viewerSizeRef.current));
    }
  // viewerSizeRef is a stable ref — intentionally excluded so resize doesn't reset the viewport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  // Tile cache reset: on manifest change OR viewer resize (tiles need re-evaluation).
  useEffect(() => {
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
  // Derive overlay LOD thresholds from the slide's pyramid levels so the heatmap→simplified→raw
  // ladder adapts to each slide's resolution structure rather than using hardcoded scale values.
  const lodThresholds = useMemo(() => computeOverlayLodThresholds(manifest.levels), [manifest.levels]);
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
    const loadTile = async (tile: TileReference) => {
      const cached = tileCacheRef.current.get(tile.key);
      if (cached || pendingTileRef.current.has(tile.key)) return;
      const job = (async () => {
        const groupUrl = buildTileGroupUrl(tile.levelKey, tile.groupId);
        let groupPayload = groupCacheRef.current.get(groupUrl);
        if (!groupPayload) {
          groupPayload = fetchTileGroup(groupUrl);
          groupCacheRef.current.set(groupUrl, groupPayload);
        }
        const buffer = await groupPayload;
        const payload = new Uint8Array(buffer, tile.offset + 4, tile.length);
        const image = await decodeTileImage(payload);
        tileCacheRef.current.set(tile.key, image);
      })()
        .then(() => {
          setTileRevision((current) => current + 1);
        })
        .catch(() => {
          groupCacheRef.current.delete(buildTileGroupUrl(tile.levelKey, tile.groupId));
          window.setTimeout(() => {
            setTileRevision((current) => current + 1);
          }, 150);
        })
        .finally(() => {
          pendingTileRef.current.delete(tile.key);
        });
      pendingTileRef.current.set(tile.key, job);
    };
    allVisibleTiles.forEach((tile) => void loadTile(tile));
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
    return createBitmapLayers(renderLevels, (tileKey) => tileCacheRef.current.get(tileKey), layerModelMatrix);
  }, [layerModelMatrix, renderLevels, tileRevision]) as BitmapLayer[];

  // Build per-group render plans so each overlay gets its own LOD independently.
  const overlayRenderData = useMemo(
    () =>
      props.overlayGroups.map((group) => ({
        id: group.id,
        plan: buildOverlayRenderPlan(group.features, scale, {
          // Heatmap storage loads cluster-centroid points — force binning into grid squares
          // regardless of zoom, because centroid points must never fall through to raw/point rendering.
          forcedMode: group.runtimeMode === "heatmap" ? "heatmap" : null,
          // Simplified storage is precomputed polys — pass through directly.
          precomputedMode: group.runtimeMode === "simplified" ? "simplified" : null,
          // Raw storage (or unknown): use pyramid-level-aware auto LOD.
          lodThresholds
        })
      })),
    [props.overlayGroups, scale, lodThresholds]
  );

  const overlayLayers = useMemo(
    () =>
      overlayRenderData.flatMap(({ id, plan }) =>
        createOverlayLayers({
          mode: plan.mode,
          polygonOverlays: plan.features
            .filter((f) => f.kind === "polygon")
            .map((f) => ({ ...f, polygon: imageCoordinatesToWorld(manifest, f.geometry["coordinates"]) as number[][][] })),
          lineOverlays: plan.features
            .filter((f) => f.kind === "polyline")
            .map((f) => ({ ...f, path: imageCoordinatesToWorld(manifest, f.geometry["coordinates"]) as number[][] })),
          pointOverlays: plan.features
            .filter((f) => f.kind === "point")
            .map((f) => ({ ...f, position: imageCoordinatesToWorld(manifest, f.geometry["coordinates"]) as number[] })),
          modelMatrix: layerModelMatrix,
          namespace: id
        })
      ),
    [overlayRenderData, layerModelMatrix, manifest]
  );

  useEffect(() => {
    const payload = {
      level: level.level,
      visibleTiles: bitmapLayers.length,
      totalVisibleReferences: allVisibleTiles.length
    };
    const fingerprint = JSON.stringify(payload);
    if (lastViewportStatsRef.current === fingerprint) return;
    lastViewportStatsRef.current = fingerprint;
    props.onViewportStatsChange?.(payload);
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

  const editableLayer = useMemo(() => createAnnotationEditorLayer({
    annotationCollection,
    annotationCollectionRef,
    manifest,
    tool: props.tool,
    selectedFeatureIndexes,
    annotationLayerById,
    modelMatrix: layerModelMatrix,
    onSelectAnnotation: props.onSelectAnnotation,
    onTransientUpdate: scheduleAnnotationCollectionUpdate,
    onCommittedUpdate: commitAnnotationCollection,
    onPersistCommittedFeatures: props.onPersistAnnotations,
    activeLayerId: props.activeLayerId,
    visibleAnnotationLayers: props.annotationLayers,
    annotationOperation: props.annotationOperation,
    formatDistance: formatPhysicalDistanceFromPixels,
    worldCoordinatesToImage: (coordinates) => worldCoordinatesToImage(manifest, coordinates)
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

  // Always-current snapshot for the native pointer listener below (avoids stale closures).
  const presenceDepsRef = useRef({ onPresenceUpdate: props.onPresenceUpdate, visibleWindow, viewState, manifest });
  presenceDepsRef.current = { onPresenceUpdate: props.onPresenceUpdate, visibleWindow, viewState, manifest };

  // Capture-phase pointermove so DeckGL's bubble-phase stopPropagation never blocks us.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (event: PointerEvent) => {
      const { onPresenceUpdate, visibleWindow: vw, viewState: vs, manifest: m } = presenceDepsRef.current;
      if (!onPresenceUpdate) return;
      const rect = container.getBoundingClientRect();
      const size = viewerSizeRef.current;
      const normalizedX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, size.width)));
      const normalizedY = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, size.height)));
      const slideX = vw.left + normalizedX * (vw.right - vw.left);
      const slideY = vw.top + normalizedY * (vw.bottom - vw.top);
      lastPresencePointerRef.current = { x: normalizedX, y: normalizedY, slideX, slideY };
      onPresenceUpdate({
        x: normalizedX,
        y: normalizedY,
        zoom: vs.zoom,
        slideX,
        slideY,
        viewport: vw,
        centerX: vs.target[0],
        centerY: worldToTopDownY(m.height, vs.target[1])
      });
    };
    container.addEventListener("pointermove", handler, { capture: true });
    return () => container.removeEventListener("pointermove", handler, { capture: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fingerprint = JSON.stringify(visibleWindow);
    if (lastVisibleWindowRef.current === fingerprint) return;
    lastVisibleWindowRef.current = fingerprint;
    props.onVisibleWindowChange?.(visibleWindow);
  }, [props.onVisibleWindowChange, visibleWindow]);

  useEffect(() => {
    const pointer = lastPresencePointerRef.current;
    const payload = {
      x: pointer?.x ?? 0.5,
      y: pointer?.y ?? 0.5,
      zoom: viewState.zoom,
      slideX: pointer?.slideX ?? viewState.target[0],
      slideY: pointer?.slideY ?? worldToTopDownY(manifest.height, viewState.target[1]),
      viewport: visibleWindow,
      centerX: viewState.target[0],
      centerY: worldToTopDownY(manifest.height, viewState.target[1]),
    };
    const fingerprint = JSON.stringify(payload);
    if (lastPresencePayloadRef.current === fingerprint) return;
    lastPresencePayloadRef.current = fingerprint;
    props.onPresenceUpdate?.(payload);
  }, [manifest.height, props.onPresenceUpdate, viewState.target, viewState.zoom, visibleWindow]);

  const minimapHeight = useMemo(() => Math.round((MINIMAP_WIDTH * manifest.height) / manifest.width), [manifest.height, manifest.width]);
  const minimapRect = useMemo(() => {
    const left = (visibleWindow.left / manifest.width) * MINIMAP_WIDTH;
    const top = (visibleWindow.top / manifest.height) * minimapHeight;
    const width = ((visibleWindow.right - visibleWindow.left) / manifest.width) * MINIMAP_WIDTH;
    const height = ((visibleWindow.bottom - visibleWindow.top) / manifest.height) * minimapHeight;
    return { left, top, width, height };
  }, [manifest.height, manifest.width, minimapHeight, visibleWindow]);
  const remoteMinimapRects = useMemo(
    () =>
      (props.remotePresence ?? [])
        .filter((presence) => presence.viewport)
        .map((presence) => ({
          userId: presence.userId,
          left: ((presence.viewport!.left ?? 0) / manifest.width) * MINIMAP_WIDTH,
          top: ((presence.viewport!.top ?? 0) / manifest.height) * minimapHeight,
          width: (((presence.viewport!.right ?? 0) - (presence.viewport!.left ?? 0)) / manifest.width) * MINIMAP_WIDTH,
          height: (((presence.viewport!.bottom ?? 0) - (presence.viewport!.top ?? 0)) / manifest.height) * minimapHeight
        })),
    [manifest.height, manifest.width, minimapHeight, props.remotePresence]
  );

  const projectedRemotePresence = useMemo(() => {
    const width = Math.max(1, visibleWindow.right - visibleWindow.left);
    const height = Math.max(1, visibleWindow.bottom - visibleWindow.top);
    return (props.remotePresence ?? [])
      .map((presence) => {
        if (typeof presence.slideX !== "number" || typeof presence.slideY !== "number") {
          return {
            userId: presence.userId,
            zoom: presence.zoom,
            leftPercent: presence.x * 100,
            topPercent: presence.y * 100,
            isOffscreen: false
          };
        }
        const localX = ((presence.slideX - visibleWindow.left) / width) * 100;
        const localY = ((presence.slideY - visibleWindow.top) / height) * 100;
        return {
          userId: presence.userId,
          zoom: presence.zoom,
          leftPercent: Math.max(0, Math.min(100, localX)),
          topPercent: Math.max(0, Math.min(100, localY)),
          isOffscreen: localX < 0 || localX > 100 || localY < 0 || localY > 100
        };
      });
  }, [props.remotePresence, visibleWindow.bottom, visibleWindow.left, visibleWindow.right, visibleWindow.top]);

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
    <div
      ref={containerRef}
      className="workspace-canvas"
    >
      <DeckGL
        controller={drawToolActive ? false : { dragPan: true, touchRotate: false, scrollZoom: { speed: 0.01 }, doubleClickZoom: true, keyboard: true }}
        getCursor={({ isDragging }) => cursorForTool(props.tool, isDragging)}
        getTooltip={overlayTooltip}
        layers={[...bitmapLayers, ...overlayLayers, editableLayer] as any}
        views={VIEW}
        viewState={viewState}
        onViewStateChange={drawToolActive ? undefined : ({ viewState: next }) => {
          const deckViewState = next as Partial<ViewState> & { target?: unknown };
          const zoom = typeof deckViewState.zoom === "number" ? deckViewState.zoom : viewState.zoom;
          const target: [number, number, number] = Array.isArray(deckViewState.target)
            ? [Number(deckViewState.target[0] ?? viewState.target[0]), Number(deckViewState.target[1] ?? viewState.target[1]), 0]
            : viewState.target;
          setViewState({
            target,
            zoom,
            rotationOrbit: typeof deckViewState.rotationOrbit === "number" ? deckViewState.rotationOrbit : viewState.rotationOrbit
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
        remoteRects={remoteMinimapRects}
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
      {projectedRemotePresence.map((presence) => {
        const color = presenceColor(presence.userId);
        return (
          <div
            key={presence.userId}
            className={`workspace-remote-cursor${presence.isOffscreen ? " is-offscreen" : ""}`}
            style={{ left: `${presence.leftPercent}%`, top: `${presence.topPercent}%`, background: color, borderColor: color }}
            title={`${presence.userId} · ${formatPresenceMagnification(manifest, presence.zoom)}`}
          >
            <span className="workspace-remote-cursor__label" style={{ background: color }}>
              {presence.userId} · {formatPresenceMagnification(manifest, presence.zoom)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
