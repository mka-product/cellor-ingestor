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
import { AnnotationEditPanel } from "./AnnotationEditPanel";
import { CommentsPanel } from "./CommentsPanel";
import { FloatingPanelFrame } from "./FloatingPanelFrame";
import { LayerPanel } from "./LayerPanel";
import { MetadataPanel } from "./MetadataPanel";
import { OverlayStylePanel } from "./OverlayStylePanel";
import { ViewerCanvas } from "./ViewerCanvas";
import { ViewerToolbar } from "./ViewerToolbar";
import { WorkspaceShortcuts } from "./WorkspaceShortcuts";
import type { AnnotationBooleanMode } from "../../viewer/annotationBoolean";
import type { OverlayWindow } from "../../viewer/overlayManifest";
import { useOverlayRuntime } from "../../viewer/useOverlayRuntime";

type Props = {
  manifest: ViewerManifest;
};

type PanelId = "metadata" | "layers" | "annotation" | "comments" | "overlays" | "overlay-style" | "shortcuts";
type PanelLayout = Record<PanelId, { x: number; y: number; zIndex: number }>;

const INITIAL_STATE: ViewerWorkspaceState = {
  showMetadata: false,
  showOverlays: false,
  showAnnotations: false,
  showHelp: false,
  isFullscreen: false,
  selectedOverlayId: null,
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

function styleKey(feature: OverlayFeature) {
  return String(feature.properties.class ?? feature.properties.label ?? "default");
}

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

export function ViewerWorkspace({ manifest }: Props) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const annotationsRef = useRef<AnnotationFeature[]>([]);
  const queuedPersistRef = useRef<{ next: AnnotationFeature[]; previous: AnnotationFeature[] } | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const [workspace, setWorkspace] = useState(INITIAL_STATE);
  const [panelLayout, setPanelLayout] = useState(INITIAL_LAYOUT);
  const [tool, setTool] = useState("view");
  const [overlaySources, setOverlaySources] = useState<OverlaySource[]>([]);
  const [overlayStyles, setOverlayStyles] = useState<Record<string, OverlayClassStyle>>({});
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
  const localPresenceId = useMemo(() => `user-${Math.random().toString(36).slice(2, 8)}`, []);
  const presenceSocketRef = useRef<WebSocket | null>(null);
  const { overlayManifest, overlayFeatures: rawOverlayFeatures, runtimeStats } = useOverlayRuntime(
    manifest.slideId,
    workspace.selectedOverlayId,
    overlayVisibleWindow
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
        setAnnotationLayers([layer]);
        setWorkspace((current) => ({ ...current, activeLayerId: layer.id }));
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
          selectedOverlayId: null,
          showOverlayStyle: false
        }));
      }
      if (key === "1") setTool("view");
      if (key === "2") setTool("modify");
      if (key === "3") setTool("line");
      if (key === "4") setTool("polygon");
    };
    const updateModifier = (event: KeyboardEvent) => {
      if (event.altKey) {
        setOperationModifier("subtract");
        return;
      }
      if (event.shiftKey) {
        setOperationModifier("merge");
        return;
      }
      setOperationModifier(null);
    };
    const clearModifier = (event: KeyboardEvent) => {
      if (event.altKey) {
        setOperationModifier("subtract");
        return;
      }
      if (event.shiftKey) {
        setOperationModifier("merge");
        return;
      }
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
    const socket = new WebSocket(resolveWebSocketUrl(`/slides/${manifest.slideId}/presence`));
    presenceSocketRef.current = socket;
    socket.onopen = () => {
      if (presenceSocketRef.current === socket) {
        setPresenceStatus("connected");
      }
    };
    socket.onerror = () => {
      if (presenceSocketRef.current === socket) {
        setPresenceStatus("unavailable");
      }
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          type: string;
          userId?: string;
          x?: number;
          y?: number;
          zoom?: number;
          slideX?: number;
          slideY?: number;
          viewport?: OverlayWindow;
          centerX?: number;
          centerY?: number;
        };
        if (payload.type !== "presence.cursor" || !payload.userId || payload.userId === localPresenceId) return;
        setRemotePresence((current) => {
          const next = current.filter((entry) => entry.userId !== payload.userId);
          next.push({
            userId: payload.userId,
            x: payload.x ?? 0.5,
            y: payload.y ?? 0.5,
            zoom: payload.zoom ?? 0,
            slideX: payload.slideX,
            slideY: payload.slideY,
            viewport: payload.viewport,
            centerX: payload.centerX,
            centerY: payload.centerY
          });
          return next;
        });
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
      if (presenceSocketRef.current === socket) {
        presenceSocketRef.current = null;
      }
      setRemotePresence([]);
    };
  }, [localPresenceId, manifest.slideId, presenceEnabled]);

  const effectiveAnnotationOperation = operationModifier ?? annotationOperation;

  const selectedAnnotation = useMemo(
    () => annotations.find((annotation) => annotation.id === workspace.selectedAnnotationId) ?? null,
    [annotations, workspace.selectedAnnotationId]
  );

  const selectedOverlay = useMemo(
    () => overlaySources.find((overlay) => overlay.id === workspace.selectedOverlayId) ?? null,
    [overlaySources, workspace.selectedOverlayId]
  );

  const styledOverlayFeatures = useMemo(
    () =>
      rawOverlayFeatures.map((feature) => {
        const style = overlayStyles[styleKey(feature)];
        if (!style) return feature;
        const alpha = Math.max(0, Math.min(255, Math.round(style.opacity * 255)));
        const hex = style.color.replace("#", "");
        const parsed = Number.parseInt(hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex, 16);
        return {
          ...feature,
          styleHints: {
            ...feature.styleHints,
            color: [parsed >> 16, (parsed >> 8) & 255, parsed & 255, alpha],
            strokeWidth: style.strokeWidth
          }
        };
      }),
    [overlayStyles, rawOverlayFeatures]
  );

  const threadedComments = useMemo(() => flattenThread(comments), [comments]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
      }
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
    if (flushInFlightRef.current) {
      await flushInFlightRef.current;
    }
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
    if (queuedPersistRef.current) {
      await flushPersistQueue();
    }
  }, [manifest.slideId, rollbackAffectedAnnotations]);

  const persistAnnotations = useCallback((features: AnnotationFeature[]) => {
    const previous = annotationsRef.current;
    setAnnotations(features);
    annotationsRef.current = features;
    setAnnotationSaveError(null);
    queuedPersistRef.current = { next: features, previous };
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
    }
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
    setAnnotationLayers((current) => [...current, layer]);
    setWorkspace((current) => ({ ...current, activeLayerId: layer.id }));
  };

  const handleSelectOverlay = useCallback(
    (overlayId: string | null) =>
      setWorkspace((current) => ({
        ...current,
        selectedOverlayId: overlayId,
        showOverlayStyle: overlayId != null
      })),
    []
  );

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

  return (
    <section ref={workspaceRef} className={`workspace-body ${workspace.isFullscreen ? "is-fullscreen" : ""}`}>
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
      />
      {annotationSaveError ? (
        <div className="workspace-inline-alert" role="alert">
          Annotation save failed: {annotationSaveError.detail ?? annotationSaveError.message}
        </div>
      ) : null}
      <ViewerCanvas
        manifest={manifest}
        overlayFeatures={styledOverlayFeatures}
        annotationLayers={annotationLayers.filter((layer) => layer.isVisible)}
        annotations={annotations}
        tool={tool}
        annotationOperation={effectiveAnnotationOperation}
        activeLayerId={workspace.activeLayerId}
        selectedAnnotationId={workspace.selectedAnnotationId}
        onSelectOverlay={handleSelectOverlay}
        onSelectAnnotation={handleSelectAnnotation}
        onPersistAnnotations={persistAnnotations}
        remotePresence={remotePresence}
        onPresenceUpdate={(payload) => {
          if (!presenceEnabled) return;
          const socket = presenceSocketRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ type: "presence.cursor", userId: localPresenceId, ...payload }));
        }}
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
            selectedOverlay
              ? `${selectedOverlay.featureCount} features · ${runtimeStats.mode} · ${runtimeStats.runtimeFormat || "unknown"}`
              : "Select an overlay to render."
          }
          onPositionChange={(position) => updatePanelPosition("overlays", position)}
          onBringToFront={() => bumpPanel("overlays")}
          onClose={() => setWorkspace((current) => ({ ...current, showOverlays: false, selectedOverlayId: null }))}
          actions={
            selectedOverlay ? (
              <button
                type="button"
                className="workspace-icon-button"
                onClick={() => setWorkspace((current) => ({ ...current, showOverlayStyle: !current.showOverlayStyle }))}
                title="Overlay style"
              >
                ◌
              </button>
            ) : null
          }
        >
          <div className="workspace-list">
            {selectedOverlay ? (
              <div className="workspace-panel__subtle" style={{ padding: "0 0 12px" }}>
                Visible chunks {runtimeStats.visibleChunkCount} · Cache {runtimeStats.cacheSize} · In flight {runtimeStats.inflightChunkCount} · Loaded features {runtimeStats.loadedFeatureCount}
                {overlayManifest?.artifact && Object.keys(overlayManifest.artifact).length > 0 ? ` · ${String(overlayManifest.artifact.layout ?? "artifact")}` : ""}
              </div>
            ) : null}
            {overlaySources.length === 0 ? <div className="workspace-empty">No overlay exposures registered.</div> : null}
            {overlaySources.map((overlay) => (
              <button
                key={overlay.id}
                type="button"
                className={workspace.selectedOverlayId === overlay.id ? "is-active" : undefined}
                onClick={() =>
                  setWorkspace((current) => ({
                    ...current,
                    selectedOverlayId: current.selectedOverlayId === overlay.id ? null : overlay.id,
                    showOverlayStyle: current.selectedOverlayId === overlay.id ? false : true
                  }))
                }
              >
                <strong>{overlay.name}</strong>
                <div className="workspace-panel__subtle">
                  {overlay.kind} · {overlay.featureCount} features
                </div>
              </button>
            ))}
          </div>
        </FloatingPanelFrame>
      ) : null}
      {workspace.showOverlayStyle && selectedOverlay ? (
        <OverlayStylePanel
          overlay={selectedOverlay}
          features={rawOverlayFeatures}
          styles={overlayStyles}
          position={panelLayout["overlay-style"]}
          zIndex={panelLayout["overlay-style"].zIndex}
          onPositionChange={(position) => updatePanelPosition("overlay-style", position)}
          onBringToFront={() => bumpPanel("overlay-style")}
          onClose={() => setWorkspace((current) => ({ ...current, showOverlayStyle: false }))}
          onStyleChange={(key, style) => setOverlayStyles((current) => ({ ...current, [key]: style }))}
        />
      ) : null}
      {workspace.showAnnotationEditor && selectedAnnotation ? (
        <AnnotationEditPanel
          annotation={selectedAnnotation}
          layer={selectedLayer}
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
            createComment(manifest.slideId, selectedAnnotation.id, body, "local-user", parentId).then((comment) =>
              setComments((current) => [...current, comment])
            )
          }
          onUpdateComment={(commentId, body, author) =>
            updateComment(manifest.slideId, selectedAnnotation.id, commentId, body, author).then((comment) =>
              setComments((current) => current.map((item) => (item.id === comment.id ? comment : item)))
            )
          }
          onDeleteComment={(commentId) =>
            deleteComment(manifest.slideId, selectedAnnotation.id, commentId).then(() =>
              setComments((current) => current.filter((item) => item.id !== commentId && item.parentId !== commentId))
            )
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
