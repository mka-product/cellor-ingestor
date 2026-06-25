import { Eye, EyeOff, Palette } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ViewerManifest } from "../../domain/contracts";
import type {
  AnnotationComment,
  AnnotationFeature,
  AnnotationLayer,
  AnnotationPersistenceError,
  AnnotationReview,
  OverlayClassStyle,
  OverlayFeature,
  OverlayManifest,
  OverlaySource,
  SlideTag,
  ViewerWorkspaceState
} from "../../domain/workspace";
import {
  createComment,
  deleteAnnotation,
  deleteAnnotationLayer,
  deleteComment,
  fetchAnnotationLayers,
  fetchAnnotations,
  fetchComments,
  fetchOverlaySources,
  fetchReviews,
  fetchTags,
  saveAnnotation,
  saveAnnotationLayer,
  saveReview,
  saveTags,
  updateComment,
  WorkspaceRequestError
} from "../../infrastructure/workspaceClient";
import { resolveWebSocketUrl } from "../../infrastructure/apiBase";
import { notificationStore } from "../../lib/notificationStore";
import { AnnotationEditPanel } from "./AnnotationEditPanel";
import { CommentsPanel } from "./CommentsPanel";
import { FloatingPanelFrame } from "./FloatingPanelFrame";
import { LayerPanel } from "./LayerPanel";
import { MetadataPanel } from "./MetadataPanel";
import { OverlayStylePanel } from "./OverlayStylePanel";
import { ViewerCanvas, type OverlayGroup } from "./ViewerCanvas";
import { ViewerToolbar } from "./ViewerToolbar";
import { WorkspaceShortcuts } from "./WorkspaceShortcuts";
import type { AnnotationBooleanMode } from "../../viewer/annotationBoolean";
import type { OverlayWindow } from "../../viewer/overlayManifest";
import { computeOverlayLodThresholds, type OverlayLodThresholds, type OverlayRenderMode } from "../../viewer/overlayLod";
import { useOverlayRuntime } from "../../viewer/useOverlayRuntime";
import {
  alphaColor,
  colorForFeature,
  defaultOdColorScale,
  defaultOverlayStyleMap,
  extractOdValue,
  inferOverlaySemanticMode,
  odModulatedFill,
  sanitizeOverlayLabel,
  type OdColorScale,
} from "../../viewer/overlayStyling";
import { MINIMAP_WIDTH } from "./viewerMath";

type Props = {
  manifest: ViewerManifest;
  initialViewport?: { cx: number; cy: number; zoom: number } | null;
  initialAnnotationId?: string | null;
  initialOverlayIds?: string[];
  userId?: string;
  displayName?: string;
  accessToken?: string;
};

type PanelId = "metadata" | "layers" | "annotation" | "comments" | "overlays" | "overlay-style" | "shortcuts";
type PanelLayout = Record<PanelId, { x: number; y: number; zIndex: number }>;

type OverlayStats = {
  mode: "idle" | "inline" | "chunked";
  sourceMode: "real" | "over-budget";
  visibleChunkCount: number;
  cacheSize: number;
  inflightChunkCount: number;
  loadedFeatureCount: number;
  renderedInputFeatureCount: number;
  loadedChunkCount: number;
  visibleFeatureEstimate: number;
  runtimeFormat: string;
  representationMode: OverlayRenderMode;
};

type OverlayRuntimeData = {
  features: OverlayFeature[];
  runtimeMode: OverlayRenderMode;
  manifest: OverlayManifest | null;
  stats: OverlayStats;
};

// Must be defined outside ViewerWorkspace so its identity is stable across parent re-renders
// and React doesn't remount it (which would tear down the overlay runtime hook).
function OverlayRuntimeConnector(props: {
  slideId: string;
  overlayId: string;
  visibleWindow: OverlayWindow | null;
  overlayScale: number;
  lodThresholds: OverlayLodThresholds;
  onUpdate: (overlayId: string, data: OverlayRuntimeData) => void;
}) {
  const { overlayManifest, overlayFeatures, runtimeStats } = useOverlayRuntime(
    props.slideId,
    props.overlayId,
    props.visibleWindow,
    props.overlayScale,
    props.lodThresholds
  );
  const { onUpdate, overlayId } = props;

  useEffect(() => {
    onUpdate(overlayId, {
      features: overlayFeatures,
      runtimeMode: runtimeStats.representationMode,
      manifest: overlayManifest,
      stats: runtimeStats
    });
  }, [overlayId, overlayFeatures, runtimeStats, overlayManifest, onUpdate]);

  return null;
}

const INITIAL_STATE: ViewerWorkspaceState = {
  showMetadata: false,
  showOverlays: false,
  showAnnotations: false,
  showHelp: false,
  isFullscreen: false,
  activeOverlayIds: [],
  overlayVisibility: {},
  focusedOverlayId: null,
  selectedAnnotationId: null,
  activeLayerId: null,
  showComments: false,
  showAnnotationEditor: false,
  showOverlayStyle: false
};

const INITIAL_LAYOUT: PanelLayout = {
  metadata: { x: 16, y: 80, zIndex: 30 },
  layers: { x: 16, y: 300, zIndex: 31 },
  annotation: { x: 1050, y: 84, zIndex: 32 },
  comments: { x: 1050, y: 380, zIndex: 33 },
  overlays: { x: 400, y: 84, zIndex: 34 },
  "overlay-style": { x: 780, y: 84, zIndex: 35 },
  shortcuts: { x: 780, y: 380, zIndex: 36 }
};

function flattenThread(comments: AnnotationComment[]) {
  const roots = comments.filter((comment) => !comment.parentId);
  const repliesByParent = new Map<string, AnnotationComment[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const existing = repliesByParent.get(comment.parentId) ?? [];
    existing.push(comment);
    repliesByParent.set(comment.parentId, existing);
  }
  return roots.map((comment) => ({ comment, replies: repliesByParent.get(comment.id) ?? [] }));
}

export function ViewerWorkspace({ manifest, initialViewport, initialAnnotationId, initialOverlayIds, userId, displayName, accessToken }: Props) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const annotationsRef = useRef<AnnotationFeature[]>([]);
  const queuedPersistRef = useRef<{ next: AnnotationFeature[]; previous: AnnotationFeature[] } | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const [workspace, setWorkspace] = useState<ViewerWorkspaceState>(() => ({
    ...INITIAL_STATE,
    selectedAnnotationId: initialAnnotationId ?? null,
    showAnnotationEditor: initialAnnotationId != null,
    showComments: initialAnnotationId != null
  }));
  const [panelLayout, setPanelLayout] = useState(INITIAL_LAYOUT);
  const [tool, setTool] = useState("view");
  const [overlaySources, setOverlaySources] = useState<OverlaySource[]>([]);
  // Per-overlay styles: overlayId → classKey → style
  const [overlayStylesMap, setOverlayStylesMap] = useState<Record<string, Record<string, OverlayClassStyle>>>({});
  const [overlayOdScales, setOverlayOdScales] = useState<Record<string, OdColorScale>>({});
  // Tracks which overlays have had their OD scale initialized so subsequent chunk loads don't shift the scale.
  const odInitializedRef = useRef<Set<string>>(new Set());
  // Per-overlay runtime data reported by OverlayRuntimeConnector children
  const [overlayRuntimesByKey, setOverlayRuntimesByKey] = useState<Record<string, OverlayRuntimeData>>({});
  const [annotationLayers, setAnnotationLayers] = useState<AnnotationLayer[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationFeature[]>([]);
  const [comments, setComments] = useState<AnnotationComment[]>([]);
  const [reviews, setReviews] = useState<AnnotationReview[]>([]);
  const [tags, setTags] = useState<SlideTag[]>([]);
  const [viewportStats, setViewportStats] = useState({ level: 0, visibleTiles: 0, totalVisibleReferences: 0 });
  const [annotationOperation, setAnnotationOperation] = useState<AnnotationBooleanMode>("create");
  const [operationModifier, setOperationModifier] = useState<AnnotationBooleanMode | null>(null);
  const [annotationSaveError, setAnnotationSaveError] = useState<AnnotationPersistenceError | null>(null);
  const [presenceEnabled, setPresenceEnabled] = useState(false);
  const [presenceStatus, setPresenceStatus] = useState<"off" | "connecting" | "connected" | "unavailable">("off");
  const [remotePresence, setRemotePresence] = useState<
    Array<{
      userId: string;
      displayName?: string;
      x: number;
      y: number;
      zoom: number;
      slideX?: number;
      slideY?: number;
      viewport?: OverlayWindow;
      centerX?: number;
      centerY?: number;
    }>
  >([]);
  const [overlayVisibleWindow, setOverlayVisibleWindow] = useState<OverlayWindow | null>(null);
  // Viewport scale (2^zoom) forwarded from ViewerCanvas for pyramid-level-aware overlay LOD.
  const [overlayViewportScale, setOverlayViewportScale] = useState<number>(1);
  const lodThresholds = useMemo(() => computeOverlayLodThresholds(manifest.levels), [manifest.levels]);
  const minimapHeight = Math.round((MINIMAP_WIDTH * manifest.height) / manifest.width);
  const localPresenceId = useMemo(() => userId ?? `user-${Math.random().toString(36).slice(2, 8)}`, [userId]);
  const presenceSocketRef = useRef<WebSocket | null>(null);
  const lastPresencePayloadRef = useRef<Record<string, unknown> | null>(null);
  const urlViewportRef = useRef<{ cx: number; cy: number; zoom: number } | null>(null);
  const urlSyncTimerRef = useRef<number | null>(null);
  // Refs for values needed inside the stable WebSocket onmessage closure
  const selectedAnnotationIdRef = useRef<string | null>(null);
  const commentsRef = useRef<AnnotationComment[]>([]);
  const annotationLayersRef = useRef<AnnotationLayer[]>([]);
  // Tracks layer IDs created by this user in this session (for notification relevance)
  const myLayerIdsRef = useRef<Set<string>>(new Set());

  // Stable callback so OverlayRuntimeConnector's useEffect doesn't re-fire due to reference changes.
  const handleRuntimeUpdate = useCallback((overlayId: string, data: OverlayRuntimeData) => {
    setOverlayRuntimesByKey((current) => {
      const prev = current[overlayId];
      // Skip update if nothing meaningful changed to avoid render cascades
      if (
        prev &&
        prev.features === data.features &&
        prev.runtimeMode === data.runtimeMode &&
        prev.manifest === data.manifest &&
        prev.stats === data.stats
      ) {
        return current;
      }
      return { ...current, [overlayId]: data };
    });
  }, []);

  // Clean up runtime data for overlays that were deactivated.
  useEffect(() => {
    const activeSet = new Set(workspace.activeOverlayIds);
    odInitializedRef.current = new Set([...odInitializedRef.current].filter((id) => activeSet.has(id)));
    setOverlayRuntimesByKey((current) => {
      const staleKeys = Object.keys(current).filter((id) => !activeSet.has(id));
      if (staleKeys.length === 0) return current;
      const next = { ...current };
      staleKeys.forEach((id) => delete next[id]);
      return next;
    });
    setOverlayOdScales((current) => {
      const staleKeys = Object.keys(current).filter((id) => !activeSet.has(id));
      if (staleKeys.length === 0) return current;
      const next = { ...current };
      staleKeys.forEach((id) => delete next[id]);
      return next;
    });
  }, [workspace.activeOverlayIds]);

  // Initialize the OD color scale the first time features arrive for each overlay.
  // Uses a ref to ensure the scale is locked after first computation — subsequent chunk
  // loads do not shift breakpoints, keeping the color encoding stable during pan/zoom.
  useEffect(() => {
    for (const [overlayId, runtime] of Object.entries(overlayRuntimesByKey)) {
      if (odInitializedRef.current.has(overlayId)) continue;
      if (runtime.features.length === 0) continue;
      // Use "any polygon has OD" rather than the 50%-majority check — at heatmap zoom only a
      // sparse sample of chunks is loaded, so the majority threshold may never fire even when
      // the overlay has per-cell OD data throughout.
      const hasAnyOd = runtime.features.some(
        (f) => f.kind === "polygon" && extractOdValue(f) !== null,
      );
      if (!hasAnyOd) continue;
      odInitializedRef.current.add(overlayId);
      const scale = defaultOdColorScale(runtime.features);
      setOverlayOdScales((current) => (current[overlayId] ? current : { ...current, [overlayId]: scale }));
    }
  }, [overlayRuntimesByKey, overlaySources]);

  // Build styled overlay groups for the canvas — one per visible active overlay.
  const overlayGroups = useMemo((): OverlayGroup[] => {
    return workspace.activeOverlayIds
      .filter((id) => workspace.overlayVisibility[id] !== false)
      .flatMap((id) => {
        const runtime = overlayRuntimesByKey[id];
        if (!runtime || runtime.features.length === 0) return [];
        const source = overlaySources.find((s) => s.id === id) ?? null;
        const semanticMode = inferOverlaySemanticMode(runtime.features, source);
        const odScale = overlayOdScales[id] ?? null;
        const styles = overlayStylesMap[id] ?? {};
        const defaultStyles = defaultOverlayStyleMap(source, runtime.features, semanticMode);
        const styledFeatures = runtime.features.flatMap((feature) => {
          const style = colorForFeature(feature, semanticMode, styles, defaultStyles);
          if (style.hidden) return [];
          const count = typeof feature.properties.count === "number" ? feature.properties.count : 1;
          // Skip densityBoost for heatmap-mode overlays: cluster centroid features are binned by
          // buildHeatmapFeatures which handles density→opacity itself. Applying the boost here would
          // double-count density and cap the alpha below the user's class-opacity setting.
          const densityBoost =
            runtime.runtimeMode === "heatmap"
              ? 1
              : feature.properties.isCluster || feature.properties.isHeatmap
                ? Math.min(1, 0.45 + Math.log2(count + 1) / 8)
                : 1;

          // When an OD scale is active, modulate the fill saturation by OD value.
          // Stroke stays at full class color; features without OD fall back to normal class fill.
          const od = odScale ? extractOdValue(feature) : null;
          const fillColor = od !== null && odScale
            ? odModulatedFill(style.color, style.opacity * densityBoost, od, odScale)
            : alphaColor(style.color, style.opacity * densityBoost);

          return [{
            ...feature,
            name: sanitizeOverlayLabel(feature.name),
            properties: {
              ...feature.properties,
              class:
                typeof feature.properties.class === "string"
                  ? sanitizeOverlayLabel(feature.properties.class)
                  : feature.properties.class
            },
            styleHints: {
              ...feature.styleHints,
              color: fillColor,
              strokeWidth: style.strokeWidth
            }
          }];
        });
        return [{ id, features: styledFeatures, runtimeMode: runtime.runtimeMode }];
      });
  }, [workspace.activeOverlayIds, workspace.overlayVisibility, overlayRuntimesByKey, overlayStylesMap, overlayOdScales, overlaySources]);

  const focusedRuntimeData = useMemo(
    () => (workspace.focusedOverlayId ? overlayRuntimesByKey[workspace.focusedOverlayId] ?? null : null),
    [workspace.focusedOverlayId, overlayRuntimesByKey]
  );

  const focusedOverlaySource = useMemo(
    () => overlaySources.find((s) => s.id === workspace.focusedOverlayId) ?? null,
    [overlaySources, workspace.focusedOverlayId]
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const [nextSources, nextLayers, nextAnnotations, nextTags] = await Promise.all([
        fetchOverlaySources(manifest.slideId, controller.signal).catch(() => []),
        fetchAnnotationLayers(manifest.slideId, controller.signal).catch(() => []),
        fetchAnnotations(manifest.slideId, controller.signal).catch(() => []),
        fetchTags(manifest.slideId, controller.signal).catch(() => [])
      ]);
      setOverlaySources(nextSources);
      setTags(nextTags);
      if (nextLayers.length === 0) {
        const layer = await saveAnnotationLayer(manifest.slideId, {
          name: "Review Layer",
          color: "#f97316",
          isVisible: true,
          isLocked: false
        });
        myLayerIdsRef.current.add(layer.id);
        // Re-fetch in case another user created a layer in the same race window
        const afterCreate = await fetchAnnotationLayers(manifest.slideId, controller.signal).catch(() => [layer]);
        setAnnotationLayers(afterCreate.length > 0 ? afterCreate : [layer]);
        setWorkspace((current) => ({ ...current, activeLayerId: current.activeLayerId ?? afterCreate[0]?.id ?? layer.id }));
        // Let presence peers know about the new layer (if WS is already open)
        const socket = presenceSocketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "layer.created", layer, userId: localPresenceId }));
        }
      } else {
        setAnnotationLayers(nextLayers);
        setWorkspace((current) => ({ ...current, activeLayerId: current.activeLayerId ?? nextLayers[0]?.id ?? null }));
      }
      setAnnotations(nextAnnotations);
    })().catch(() => undefined);
    return () => controller.abort();
  }, [manifest.slideId]);

  useEffect(() => {
    if (!workspace.selectedAnnotationId) {
      setComments([]);
      setReviews([]);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      fetchComments(manifest.slideId, workspace.selectedAnnotationId, controller.signal),
      fetchReviews(manifest.slideId, workspace.selectedAnnotationId, controller.signal)
    ])
      .then(([nextComments, nextReviews]) => {
        setComments(nextComments);
        setReviews(nextReviews);
      })
      .catch(() => {
        setComments([]);
        setReviews([]);
      });
    return () => controller.abort();
  }, [manifest.slideId, workspace.selectedAnnotationId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "?") setWorkspace((current) => ({ ...current, showHelp: !current.showHelp }));
      if (key === "m") setWorkspace((current) => ({ ...current, showMetadata: !current.showMetadata }));
      if (key === "o") setWorkspace((current) => ({ ...current, showOverlays: !current.showOverlays }));
      if (key === "a") setWorkspace((current) => ({ ...current, showAnnotations: !current.showAnnotations }));
      if (key === "f") {
        setWorkspace((current) => ({ ...current, isFullscreen: !current.isFullscreen }));
        void toggleFullscreen(workspaceRef.current);
      }
      if (key === "+" || key === "=") window.dispatchEvent(new CustomEvent("viewer-zoom-in"));
      if (key === "-") window.dispatchEvent(new CustomEvent("viewer-zoom-out"));
      if (key === "0") window.dispatchEvent(new CustomEvent("viewer-reset"));
      if (key === "escape") {
        setWorkspace((current) => ({
          ...current,
          selectedAnnotationId: null,
          showComments: false,
          showAnnotationEditor: false,
          focusedOverlayId: null,
          showOverlayStyle: false
        }));
      }
      if (key === "1") setTool("view");
      if (key === "2") setTool("modify");
      if (key === "3") setTool("line");
      if (key === "4") setTool("polygon");
    };
    const updateModifier = (event: KeyboardEvent) => {
      if (event.altKey) { setOperationModifier("subtract"); return; }
      if (event.shiftKey) { setOperationModifier("merge"); return; }
      setOperationModifier(null);
    };
    const clearModifier = (event: KeyboardEvent) => {
      if (event.altKey) { setOperationModifier("subtract"); return; }
      if (event.shiftKey) { setOperationModifier("merge"); return; }
      setOperationModifier(null);
    };
    const resetModifier = () => setOperationModifier(null);
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", clearModifier);
    window.addEventListener("blur", resetModifier);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", clearModifier);
      window.removeEventListener("blur", resetModifier);
    };
  }, []);

  useEffect(() => {
    if (!presenceEnabled) {
      presenceSocketRef.current?.close();
      presenceSocketRef.current = null;
      setRemotePresence([]);
      setPresenceStatus("off");
      return;
    }
    setPresenceStatus("connecting");
    const wsUrl = resolveWebSocketUrl(`/slides/${manifest.slideId}/presence`) + (accessToken ? `?token=${accessToken}` : "");
    const socket = new WebSocket(wsUrl);
    presenceSocketRef.current = socket;
    socket.onopen = () => {
      if (presenceSocketRef.current !== socket) return;
      setPresenceStatus("connected");
      const pending = lastPresencePayloadRef.current;
      if (pending) {
        socket.send(JSON.stringify({ type: "presence.cursor", userId: localPresenceId, displayName: displayName ?? localPresenceId, ...pending }));
      }
    };
    socket.onerror = () => {
      if (presenceSocketRef.current === socket) setPresenceStatus("unavailable");
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        const msgType = payload.type as string | undefined;
        const senderId = payload.userId as string | undefined;
        const isRemote = senderId !== localPresenceId;

        // ── presence cursor ──────────────────────────────────────────────────
        if (msgType === "presence.cursor" && senderId && isRemote) {
          setRemotePresence((current) => {
            const next = current.filter((e) => e.userId !== senderId);
            next.push({
              userId: senderId,
              displayName: payload.displayName as string | undefined,
              x: (payload.x as number) ?? 0.5,
              y: (payload.y as number) ?? 0.5,
              zoom: (payload.zoom as number) ?? 0,
              slideX: payload.slideX as number | undefined,
              slideY: payload.slideY as number | undefined,
              viewport: payload.viewport as OverlayWindow | undefined,
              centerX: payload.centerX as number | undefined,
              centerY: payload.centerY as number | undefined,
            });
            return next;
          });
          return;
        }

        // ── annotation mutations from peers ──────────────────────────────────
        if (!isRemote) return; // ignore echo of own messages

        if (msgType === "annotation.saved") {
          const annotation = payload.annotation as AnnotationFeature | undefined;
          if (!annotation) return;
          setAnnotations((current) => {
            const idx = current.findIndex((a) => a.id === annotation.id);
            return idx >= 0
              ? current.map((a, i) => (i === idx ? annotation : a))
              : [...current, annotation];
          });
          // If this annotation belongs to a layer we don't know yet, sync layers from API
          if (!annotationLayersRef.current.some((l) => l.id === annotation.layerId)) {
            fetchAnnotationLayers(manifest.slideId).then((layers) => {
              setAnnotationLayers((current) => {
                const knownIds = new Set(current.map((l) => l.id));
                const fresh = layers.filter((l) => !knownIds.has(l.id));
                return fresh.length > 0 ? [...current, ...fresh] : current;
              });
            }).catch(() => {});
          }
          // Notify if it's on a layer I created
          if (myLayerIdsRef.current.has(annotation.layerId)) {
            const layerName =
              annotationLayersRef.current.find((l) => l.id === annotation.layerId)?.name ?? "your layer";
            notificationStore.add({
              type: "annotation_change",
              title: `Annotation added to "${layerName}"`,
              body: senderId ?? "A collaborator",
              annotationId: annotation.id,
            });
          }
          return;
        }

        if (msgType === "annotation.deleted") {
          const annotationId = payload.annotationId as string | undefined;
          if (!annotationId) return;
          setAnnotations((current) => current.filter((a) => a.id !== annotationId));
          return;
        }

        if (msgType === "layer.created") {
          const layer = payload.layer as AnnotationLayer | undefined;
          if (!layer) return;
          setAnnotationLayers((current) =>
            current.some((l) => l.id === layer.id) ? current : [...current, layer]
          );
          return;
        }

        if (msgType === "layer.updated") {
          const layer = payload.layer as AnnotationLayer | undefined;
          if (!layer) return;
          setAnnotationLayers((current) =>
            current.map((l) => (l.id === layer.id ? layer : l))
          );
          return;
        }

        if (msgType === "layer.deleted") {
          const layerId = payload.layerId as string | undefined;
          if (!layerId) return;
          setAnnotationLayers((current) => current.filter((l) => l.id !== layerId));
          setAnnotations((current) => current.filter((a) => a.layerId !== layerId));
          return;
        }

        if (msgType === "comment.created") {
          const comment = payload.comment as AnnotationComment | undefined;
          const annotationId = payload.annotationId as string | undefined;
          if (!comment || !annotationId) return;
          // Apply to UI if this annotation is currently selected
          if (selectedAnnotationIdRef.current === annotationId) {
            setComments((current) =>
              current.some((c) => c.id === comment.id) ? current : [...current, comment]
            );
          }
          // Notify if this is a reply to one of my comments
          if (comment.parentId) {
            const parent = commentsRef.current.find((c) => c.id === comment.parentId);
            const myIdentity = displayName ?? userId ?? "";
            if (parent && myIdentity && parent.author === myIdentity) {
              notificationStore.add({
                type: "reply",
                title: "New reply to your comment",
                body: `${comment.author}: ${comment.body.slice(0, 80)}`,
                annotationId,
              });
            }
          }
          return;
        }

        if (msgType === "comment.updated") {
          const comment = payload.comment as AnnotationComment | undefined;
          const annotationId = payload.annotationId as string | undefined;
          if (!comment || !annotationId) return;
          if (selectedAnnotationIdRef.current === annotationId) {
            setComments((current) =>
              current.map((c) => (c.id === comment.id ? comment : c))
            );
          }
          return;
        }

        if (msgType === "comment.deleted") {
          const commentId = payload.commentId as string | undefined;
          const annotationId = payload.annotationId as string | undefined;
          if (!commentId || !annotationId) return;
          if (selectedAnnotationIdRef.current === annotationId) {
            setComments((current) =>
              current.filter((c) => c.id !== commentId && c.parentId !== commentId)
            );
          }
          return;
        }
      } catch {
        return;
      }
    };
    socket.onclose = () => {
      if (presenceSocketRef.current === socket) {
        presenceSocketRef.current = null;
        setPresenceStatus((current) => (current === "connected" || current === "connecting" ? "unavailable" : current));
      }
    };
    return () => {
      socket.close();
      if (presenceSocketRef.current === socket) presenceSocketRef.current = null;
      setRemotePresence([]);
    };
  }, [accessToken, localPresenceId, manifest.slideId, presenceEnabled]);

  // Sync annotation selection and active overlays to URL immediately when they change.
  // Viewport is written separately via the debounced handler in handlePresenceUpdate.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (workspace.selectedAnnotationId) {
      params.set("ann", workspace.selectedAnnotationId);
    } else {
      params.delete("ann");
    }
    if (workspace.activeOverlayIds.length > 0) {
      params.set("overlays", workspace.activeOverlayIds.join(","));
    } else {
      params.delete("overlays");
    }
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [workspace.selectedAnnotationId, workspace.activeOverlayIds]);

  // Restore initial overlay activations once sources are available.
  const initialOverlayIdsRef = useRef(initialOverlayIds ?? []);
  const initialOverlaysAppliedRef = useRef(false);
  useEffect(() => {
    if (initialOverlaysAppliedRef.current) return;
    if (overlaySources.length === 0 || initialOverlayIdsRef.current.length === 0) return;
    initialOverlaysAppliedRef.current = true;
    const validIds = initialOverlayIdsRef.current.filter((id) => overlaySources.some((s) => s.id === id));
    if (validIds.length === 0) return;
    setWorkspace((current) => {
      const alreadyActive = new Set(current.activeOverlayIds);
      const toAdd = validIds.filter((id) => !alreadyActive.has(id));
      if (toAdd.length === 0) return current;
      const nextVisibility = Object.fromEntries(toAdd.map((id) => [id, true]));
      return {
        ...current,
        activeOverlayIds: [...current.activeOverlayIds, ...toAdd],
        overlayVisibility: { ...current.overlayVisibility, ...nextVisibility }
      };
    });
  }, [overlaySources]);

  const effectiveAnnotationOperation = operationModifier ?? annotationOperation;

  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === workspace.selectedAnnotationId) ?? null,
    [annotations, workspace.selectedAnnotationId]
  );

  const threadedComments = useMemo(() => flattenThread(comments), [comments]);

  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { selectedAnnotationIdRef.current = workspace.selectedAnnotationId; }, [workspace.selectedAnnotationId]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  useEffect(() => { annotationLayersRef.current = annotationLayers; }, [annotationLayers]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
      if (urlSyncTimerRef.current != null) window.clearTimeout(urlSyncTimerRef.current);
    };
  }, []);

  const bumpPanel = (panelId: PanelId) => {
    setPanelLayout((current) => ({
      ...current,
      [panelId]: { ...current[panelId], zIndex: Math.max(...Object.values(current).map((panel) => panel.zIndex)) + 1 }
    }));
  };

  const updatePanelPosition = (panelId: PanelId, position: { x: number; y: number }) => {
    setPanelLayout((current) => ({ ...current, [panelId]: { ...current[panelId], x: position.x, y: position.y } }));
  };

  const rollbackAffectedAnnotations = useCallback((previous: AnnotationFeature[], failedIds: Set<string>) => {
    setAnnotations((current) => {
      const next = current.filter((feature) => !failedIds.has(feature.id));
      const restored = previous.filter((feature) => failedIds.has(feature.id));
      const merged = [...next, ...restored];
      annotationsRef.current = merged;
      return merged;
    });
  }, []);

  const flushPersistQueue = useCallback(async () => {
    if (flushInFlightRef.current) await flushInFlightRef.current;
    const queued = queuedPersistRef.current;
    if (!queued) return;
    queuedPersistRef.current = null;
    const job = (async () => {
      const { next: features, previous } = queued;
      const previousById = new Map(previous.map((feature) => [feature.id, feature]));
      const nextIds = new Set(features.map((feature) => feature.id));
      const removed = previous.filter((feature) => !nextIds.has(feature.id));
      const changed = features.filter((feature) => {
        const current = previousById.get(feature.id);
        if (!current) return true;
        return JSON.stringify(current) !== JSON.stringify(feature);
      });
      const affectedIds = new Set([...removed.map((feature) => feature.id), ...changed.map((feature) => feature.id)]);
      try {
        await Promise.all([
          ...removed.map((feature) => deleteAnnotation(manifest.slideId, feature.id)),
          ...changed.map((feature) => saveAnnotation(manifest.slideId, feature))
        ]);
        setAnnotationSaveError(null);
        // Broadcast mutations to peers on the same slide
        const socket = presenceSocketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          for (const f of removed) {
            socket.send(JSON.stringify({ type: "annotation.deleted", annotationId: f.id, layerId: f.layerId, userId: localPresenceId }));
          }
          for (const f of changed) {
            socket.send(JSON.stringify({ type: "annotation.saved", annotation: f, userId: localPresenceId }));
          }
        }
      } catch (error) {
        rollbackAffectedAnnotations(previous, affectedIds);
        setAnnotationSaveError(
          error instanceof WorkspaceRequestError
            ? { message: error.detail ?? error.message, status: error.status, detail: error.detail }
            : { message: error instanceof Error ? error.message : "Failed to persist annotations" }
        );
      } finally {
        flushInFlightRef.current = null;
      }
    })();
    flushInFlightRef.current = job;
    await job;
    if (queuedPersistRef.current) await flushPersistQueue();
  }, [manifest.slideId, rollbackAffectedAnnotations]);

  const persistAnnotations = useCallback((features: AnnotationFeature[]) => {
    const previous = annotationsRef.current;
    setAnnotations(features);
    annotationsRef.current = features;
    setAnnotationSaveError(null);
    queuedPersistRef.current = { next: features, previous };
    if (persistTimerRef.current != null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void flushPersistQueue();
    }, 120);
  }, [flushPersistQueue]);

  const selectedLayer = annotationLayers.find((layer) => layer.id === workspace.activeLayerId) ?? annotationLayers[0] ?? null;
  const selectedReview = reviews[reviews.length - 1] ?? null;

  const createLayer = async () => {
    const layer = await saveAnnotationLayer(manifest.slideId, {
      name: `Layer ${annotationLayers.length + 1}`,
      color: "#f97316",
      isVisible: true,
      isLocked: false
    });
    myLayerIdsRef.current.add(layer.id);
    setAnnotationLayers((current) => [...current, layer]);
    setWorkspace((current) => ({ ...current, activeLayerId: layer.id }));
    const socket = presenceSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "layer.created", layer, userId: localPresenceId }));
    }
  };

  const handleSelectAnnotation = useCallback(
    (annotationId: string | null) =>
      setWorkspace((current) => ({
        ...current,
        selectedAnnotationId: annotationId,
        showComments: annotationId != null,
        showAnnotationEditor: annotationId != null
      })),
    []
  );

  const handlePresenceUpdate = useCallback(
    (payload: {
      x: number;
      y: number;
      zoom: number;
      slideX: number;
      slideY: number;
      viewport: OverlayWindow;
      centerX: number;
      centerY: number;
    }) => {
      // Track viewport scale so OverlayRuntimeConnector can use pyramid-level-aware LOD thresholds.
      setOverlayViewportScale(2 ** payload.zoom);
      lastPresencePayloadRef.current = payload;
      if (presenceEnabled) {
        const socket = presenceSocketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "presence.cursor", userId: localPresenceId, displayName: displayName ?? localPresenceId, ...payload }));
        }
      }
      // Debounce viewport URL update — fires 800ms after the last pan/zoom.
      urlViewportRef.current = { cx: payload.centerX, cy: payload.centerY, zoom: payload.zoom };
      if (urlSyncTimerRef.current != null) window.clearTimeout(urlSyncTimerRef.current);
      urlSyncTimerRef.current = window.setTimeout(() => {
        urlSyncTimerRef.current = null;
        const vp = urlViewportRef.current;
        if (!vp) return;
        const params = new URLSearchParams(window.location.search);
        params.set("cx", String(Math.round(vp.cx)));
        params.set("cy", String(Math.round(vp.cy)));
        params.set("zoom", vp.zoom.toFixed(3));
        window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      }, 800);
    },
    [localPresenceId, presenceEnabled]
  );


  const toggleOverlayActive = (overlayId: string) => {
    setWorkspace((current) => {
      const isActive = current.activeOverlayIds.includes(overlayId);
      if (isActive) {
        const nextIds = current.activeOverlayIds.filter((id) => id !== overlayId);
        const nextFocused = current.focusedOverlayId === overlayId ? null : current.focusedOverlayId;
        return {
          ...current,
          activeOverlayIds: nextIds,
          focusedOverlayId: nextFocused,
          showOverlayStyle: nextFocused != null ? current.showOverlayStyle : false
        };
      }
      return {
        ...current,
        activeOverlayIds: [...current.activeOverlayIds, overlayId],
        overlayVisibility: { ...current.overlayVisibility, [overlayId]: true }
      };
    });
  };

  const toggleOverlayVisibility = (overlayId: string) => {
    setWorkspace((current) => ({
      ...current,
      overlayVisibility: {
        ...current.overlayVisibility,
        [overlayId]: current.overlayVisibility[overlayId] === false ? true : false
      }
    }));
  };

  const focusOverlayStyle = (overlayId: string) => {
    setWorkspace((current) => ({
      ...current,
      focusedOverlayId: overlayId,
      showOverlayStyle: current.focusedOverlayId === overlayId ? !current.showOverlayStyle : true
    }));
  };

  const activeCount = workspace.activeOverlayIds.length;

  return (
    <section ref={workspaceRef} className={`workspace-body ${workspace.isFullscreen ? "is-fullscreen" : ""}`}>
      {/* One connector per active overlay — each runs its own useOverlayRuntime hook instance */}
      {workspace.activeOverlayIds.map((overlayId) => (
        <OverlayRuntimeConnector
          key={overlayId}
          slideId={manifest.slideId}
          overlayId={overlayId}
          visibleWindow={overlayVisibleWindow}
          overlayScale={overlayViewportScale}
          lodThresholds={lodThresholds}
          onUpdate={handleRuntimeUpdate}
        />
      ))}
      <ViewerToolbar
        onZoomIn={() => window.dispatchEvent(new CustomEvent("viewer-zoom-in"))}
        onZoomOut={() => window.dispatchEvent(new CustomEvent("viewer-zoom-out"))}
        onReset={() => window.dispatchEvent(new CustomEvent("viewer-reset"))}
        onToggleMetadata={() => setWorkspace((current) => ({ ...current, showMetadata: !current.showMetadata }))}
        onToggleOverlays={() => setWorkspace((current) => ({ ...current, showOverlays: !current.showOverlays }))}
        onToggleAnnotations={() => setWorkspace((current) => ({ ...current, showAnnotations: !current.showAnnotations }))}
        onToggleHelp={() => setWorkspace((current) => ({ ...current, showHelp: !current.showHelp }))}
        onTogglePresence={() => setPresenceEnabled((current) => !current)}
        onToggleFullscreen={() => {
          setWorkspace((current) => ({ ...current, isFullscreen: !current.isFullscreen }));
          void toggleFullscreen(workspaceRef.current);
        }}
        metadataOpen={workspace.showMetadata}
        overlaysOpen={workspace.showOverlays}
        annotationsOpen={workspace.showAnnotations}
        helpOpen={workspace.showHelp}
        fullscreen={workspace.isFullscreen}
        presenceEnabled={presenceEnabled}
        presenceStatus={presenceStatus}
        tool={tool}
        onToolChange={setTool}
        annotationOperation={annotationOperation}
        effectiveAnnotationOperation={effectiveAnnotationOperation}
        onAnnotationOperationChange={setAnnotationOperation}
        minimapBottom={16 + minimapHeight}
      />
      {annotationSaveError ? (
        <div className="workspace-inline-alert" role="alert">
          Annotation save failed: {annotationSaveError.detail ?? annotationSaveError.message}
        </div>
      ) : null}
      <ViewerCanvas
        manifest={manifest}
        initialViewport={initialViewport}
        overlayGroups={overlayGroups}
        annotationLayers={annotationLayers.filter((layer) => layer.isVisible)}
        annotations={annotations}
        tool={tool}
        annotationOperation={effectiveAnnotationOperation}
        activeLayerId={workspace.activeLayerId}
        selectedAnnotationId={workspace.selectedAnnotationId}
        onSelectAnnotation={handleSelectAnnotation}
        onPersistAnnotations={persistAnnotations}
        remotePresence={remotePresence}
        onPresenceUpdate={handlePresenceUpdate}
        onViewportStatsChange={setViewportStats}
        onVisibleWindowChange={setOverlayVisibleWindow}
      />
      {workspace.showMetadata ? (
        <MetadataPanel
          manifest={manifest}
          tags={tags}
          position={panelLayout.metadata}
          zIndex={panelLayout.metadata.zIndex}
          onPositionChange={(position) => updatePanelPosition("metadata", position)}
          onBringToFront={() => bumpPanel("metadata")}
          onClose={() => setWorkspace((current) => ({ ...current, showMetadata: false }))}
          onSaveTags={(nextTags) => void saveTags(manifest.slideId, nextTags).then(setTags)}
        />
      ) : null}
      {workspace.showAnnotations ? (
        <LayerPanel
          layers={annotationLayers}
          annotations={annotations}
          activeLayerId={workspace.activeLayerId}
          selectedAnnotationId={workspace.selectedAnnotationId}
          position={panelLayout.layers}
          zIndex={panelLayout.layers.zIndex}
          onPositionChange={(position) => updatePanelPosition("layers", position)}
          onBringToFront={() => bumpPanel("layers")}
          onClose={() => setWorkspace((current) => ({ ...current, showAnnotations: false }))}
          onCreateLayer={() => void createLayer()}
          onSelectLayer={(layerId) => setWorkspace((current) => ({ ...current, activeLayerId: layerId }))}
          onToggleLayerVisibility={(layerId) =>
            setAnnotationLayers((current) =>
              current.map((layer) => (layer.id === layerId ? { ...layer, isVisible: !layer.isVisible } : layer))
            )
          }
          onRenameLayer={(layerId, name) =>
            void (async () => {
              const layer = annotationLayers.find((item) => item.id === layerId);
              if (!layer) return;
              const updated = await saveAnnotationLayer(manifest.slideId, { ...layer, id: layerId, name });
              setAnnotationLayers((current) => current.map((item) => (item.id === layerId ? updated : item)));
              const socket = presenceSocketRef.current;
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "layer.updated", layer: updated, userId: localPresenceId }));
              }
            })()
          }
          onDeleteLayer={(layerId) =>
            void (async () => {
              await deleteAnnotationLayer(manifest.slideId, layerId);
              setAnnotationLayers((current) => current.filter((layer) => layer.id !== layerId));
              setAnnotations((current) => current.filter((annotation) => annotation.layerId !== layerId));
              if (workspace.activeLayerId === layerId) {
                const remaining = annotationLayers.filter((layer) => layer.id !== layerId);
                setWorkspace((current) => ({ ...current, activeLayerId: remaining[0]?.id ?? null }));
              }
              const socket = presenceSocketRef.current;
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "layer.deleted", layerId, userId: localPresenceId }));
              }
            })()
          }
          onSelectAnnotation={(annotationId) =>
            setWorkspace((current) => ({
              ...current,
              selectedAnnotationId: annotationId,
              showAnnotationEditor: true,
              showComments: true
            }))
          }
        />
      ) : null}
      {workspace.showOverlays ? (
        <FloatingPanelFrame
          panelId="overlays"
          title="Overlays"
          position={panelLayout.overlays}
          zIndex={panelLayout.overlays.zIndex}
          subtitle={
            activeCount > 0
              ? `${activeCount} active · ${overlayGroups.reduce((sum, g) => sum + g.features.length, 0)} features rendered`
              : "Click an overlay to activate it."
          }
          onPositionChange={(position) => updatePanelPosition("overlays", position)}
          onBringToFront={() => bumpPanel("overlays")}
          onClose={() => setWorkspace((current) => ({ ...current, showOverlays: false, showOverlayStyle: false }))}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overlaySources.length === 0 ? <div className="workspace-empty">No overlay exposures registered.</div> : null}
            {overlaySources.map((overlay) => {
              const isActive = workspace.activeOverlayIds.includes(overlay.id);
              const isVisible = workspace.overlayVisibility[overlay.id] !== false;
              const isFocused = workspace.focusedOverlayId === overlay.id;
              const runtime = overlayRuntimesByKey[overlay.id];
              return (
                <div
                  key={overlay.id}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    border: `1px solid ${isActive ? "var(--celnight-accent)" : "rgba(255,255,255,0.85)"}`,
                    background: isActive ? "var(--celnight-accent-soft)" : "rgba(255,255,255,0.02)"
                  }}
                >
                  {/* Main clickable area — uses workspace-layer-main to avoid width:100% from workspace-list rule */}
                  <button
                    type="button"
                    className="workspace-layer-main"
                    style={{ flex: 1, padding: "10px 12px" }}
                    onClick={() => toggleOverlayActive(overlay.id)}
                  >
                    <strong>{sanitizeOverlayLabel(overlay.name)}</strong>
                    <div className="workspace-panel__subtle">
                      {overlay.kind} · {overlay.featureCount} features
                    </div>
                    {runtime && isActive ? (
                      <div className="workspace-panel__subtle">
                        {runtime.stats.mode} · {runtime.stats.loadedChunkCount}/{runtime.stats.visibleChunkCount} chunks
                        {runtime.stats.inflightChunkCount > 0 ? ` · ${runtime.stats.inflightChunkCount} loading` : ""}
                      </div>
                    ) : null}
                  </button>
                  {/* Per-overlay actions — vertical stack so they don't interfere with main text */}
                  {isActive ? (
                    <div style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid rgba(255,255,255,0.12)" }}>
                      <button
                        type="button"
                        title={isVisible ? "Hide overlay" : "Show overlay"}
                        onClick={() => toggleOverlayVisibility(overlay.id)}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 10px",
                          background: "transparent",
                          border: "none",
                          borderBottom: "1px solid rgba(255,255,255,0.12)",
                          color: isVisible ? "inherit" : "rgba(255,255,255,0.35)",
                          cursor: "pointer"
                        }}
                      >
                        {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button
                        type="button"
                        title="Overlay style"
                        onClick={() => focusOverlayStyle(overlay.id)}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 10px",
                          background: isFocused && workspace.showOverlayStyle ? "rgba(255,255,255,0.08)" : "transparent",
                          border: "none",
                          color: "inherit",
                          cursor: "pointer"
                        }}
                      >
                        <Palette size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </FloatingPanelFrame>
      ) : null}
      {workspace.showOverlayStyle && focusedOverlaySource && focusedRuntimeData ? (
        <OverlayStylePanel
          overlay={focusedOverlaySource}
          features={focusedRuntimeData.features}
          styles={overlayStylesMap[workspace.focusedOverlayId!] ?? {}}
          position={panelLayout["overlay-style"]}
          zIndex={panelLayout["overlay-style"].zIndex}
          onPositionChange={(position) => updatePanelPosition("overlay-style", position)}
          onBringToFront={() => bumpPanel("overlay-style")}
          onClose={() => setWorkspace((current) => ({ ...current, showOverlayStyle: false }))}
          onStyleChange={(key, style) =>
            setOverlayStylesMap((current) => ({
              ...current,
              [workspace.focusedOverlayId!]: {
                ...(current[workspace.focusedOverlayId!] ?? {}),
                [key]: style
              }
            }))
          }
          odScale={overlayOdScales[workspace.focusedOverlayId!] ?? null}
          onOdScaleChange={(scale) =>
            setOverlayOdScales((current) => ({ ...current, [workspace.focusedOverlayId!]: scale }))
          }
        />
      ) : null}
      {workspace.showAnnotationEditor && selectedAnnotation ? (
        <AnnotationEditPanel
          annotation={selectedAnnotation}
          layer={selectedLayer}
          currentUser={displayName ?? userId ?? "unknown"}
          position={panelLayout.annotation}
          zIndex={panelLayout.annotation.zIndex}
          onPositionChange={(position) => updatePanelPosition("annotation", position)}
          onBringToFront={() => bumpPanel("annotation")}
          onClose={() => setWorkspace((current) => ({ ...current, showAnnotationEditor: false }))}
          onToggleComments={() => setWorkspace((current) => ({ ...current, showComments: !current.showComments }))}
          onDelete={() =>
            void (async () => {
              await deleteAnnotation(manifest.slideId, selectedAnnotation.id);
              setAnnotations((current) => current.filter((annotation) => annotation.id !== selectedAnnotation.id));
              setWorkspace((current) => ({
                ...current,
                selectedAnnotationId: null,
                showComments: false,
                showAnnotationEditor: false
              }));
            })()
          }
          onChange={(updates) => {
            const next = annotations.map((annotation) =>
              annotation.id === selectedAnnotation.id
                ? {
                    ...annotation,
                    properties: { ...annotation.properties, ...(updates.label ? { label: updates.label } : {}) },
                    style: {
                      ...annotation.style,
                      color: updates.color,
                      opacity: updates.opacity,
                      lineWidth: updates.lineWidth
                    },
                    updatedAt: new Date().toISOString()
                  }
                : annotation
            );
            void persistAnnotations(next);
          }}
          review={selectedReview}
          onSaveReview={(payload) =>
            saveReview(manifest.slideId, selectedAnnotation.id, payload).then((review) =>
              setReviews((current) => {
                const next = current.filter((item) => item.id !== review.id);
                next.push(review);
                return next;
              })
            )
          }
          commentCount={comments.length}
        />
      ) : null}
      {workspace.showComments && selectedAnnotation ? (
        <CommentsPanel
          comments={threadedComments}
          position={panelLayout.comments}
          zIndex={panelLayout.comments.zIndex}
          onPositionChange={(position) => updatePanelPosition("comments", position)}
          onBringToFront={() => bumpPanel("comments")}
          onClose={() => setWorkspace((current) => ({ ...current, showComments: false }))}
          onAddComment={(body, parentId) =>
            createComment(manifest.slideId, selectedAnnotation.id, body, displayName ?? userId ?? "unknown", parentId).then((comment) => {
              setComments((current) => [...current, comment]);
              const socket = presenceSocketRef.current;
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "comment.created", annotationId: selectedAnnotation.id, comment, userId: localPresenceId }));
              }
            })
          }
          onUpdateComment={(commentId, body, author) =>
            updateComment(manifest.slideId, selectedAnnotation.id, commentId, body, author).then((comment) => {
              setComments((current) => current.map((item) => (item.id === comment.id ? comment : item)));
              const socket = presenceSocketRef.current;
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "comment.updated", annotationId: selectedAnnotation.id, comment, userId: localPresenceId }));
              }
            })
          }
          onDeleteComment={(commentId) =>
            deleteComment(manifest.slideId, selectedAnnotation.id, commentId).then(() => {
              setComments((current) => current.filter((item) => item.id !== commentId && item.parentId !== commentId));
              const socket = presenceSocketRef.current;
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "comment.deleted", annotationId: selectedAnnotation.id, commentId, userId: localPresenceId }));
              }
            })
          }
        />
      ) : null}
      {workspace.showHelp ? (
        <WorkspaceShortcuts
          position={panelLayout.shortcuts}
          zIndex={panelLayout.shortcuts.zIndex}
          onPositionChange={(position) => updatePanelPosition("shortcuts", position)}
          onBringToFront={() => bumpPanel("shortcuts")}
          onClose={() => setWorkspace((current) => ({ ...current, showHelp: false }))}
        />
      ) : null}
    </section>
  );
}

async function toggleFullscreen(target: HTMLElement | null) {
  if (!target || typeof document === "undefined") return;
  if (document.fullscreenElement === target) {
    await document.exitFullscreen();
    return;
  }
  await target.requestFullscreen?.();
}
