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
import { createOverlayLayers } from "../../viewer/overlayLayers";
import { TileCache } from "../../viewer/tileCache";
import { createBitmapLayers } from "../../viewer/tileBitmapLayers";
import { createAnnotationEditorLayer } from "./AnnotationEditorLayer";
import { useBufferedFeatureCollection } from "./useBufferedFeatureCollection";
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

export function ViewerCanvas(props: Props) {
  const { manifest } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indexCacheRef = useRef(new Map<string, TileIndexLookup>());
  const tileCacheRef = useRef(new TileCache<RenderableImage>(TILE_CACHE_CAPACITY));
  const groupCacheRef = useRef(new Map<string, Promise<ArrayBuffer>>());
  const pendingTileRef = useRef(new Map<string, Promise<void>>());
  const scaleBarDraggedRef = useRef(false);
  const rotationDragRef = useRef<{ pointerId: number; startX: number; startRotation: number } | null>(null);
  const [viewerSize, setViewerSize] = useState<ViewerSize>(DEFAULT_VIEWER_SIZE);
  const [viewState, setViewState] = useState<ViewState>(createInitialViewState(manifest, DEFAULT_VIEWER_SIZE));
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
    return createBitmapLayers(renderLevels, (tileKey) => tileCacheRef.current.get(tileKey), layerModelMatrix);
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
    () =>
      createOverlayLayers({
        polygonOverlays,
        lineOverlays,
        pointOverlays,
        modelMatrix: layerModelMatrix,
        onSelectOverlay: props.onSelectOverlay
      }),
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
