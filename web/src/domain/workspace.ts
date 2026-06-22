export type GeometryKind = "polygon" | "polyline" | "point";

export type OverlaySource = {
  id: string;
  name: string;
  kind: string;
  featureCount: number;
  legend: Array<Record<string, unknown>>;
};

export type OverlayClassStyle = {
  color: string;
  opacity: number;
  strokeWidth: number;
  hidden?: boolean;
};

export type OverlayFeature = {
  id: string;
  name: string;
  kind: GeometryKind;
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  styleHints: Record<string, unknown>;
  bounds: [number, number, number, number];
};

export type OverlayChunkSummary = {
  id: string;
  bounds: [number, number, number, number];
  featureCount: number;
  path: string;
  representations?: Partial<
    Record<
      "raw" | "simplified" | "cluster",
      {
        path: string;
        featureCount: number;
      }
    >
  >;
};

export type OverlayManifest = {
  schema: string;
  slideId: string;
  overlayId: string;
  name: string;
  kind: string;
  versionId: string;
  sourceFormat: string;
  coordinateSpace: Record<string, unknown>;
  runtimeFormat: string;
  artifact?: Record<string, unknown>;
  featureCount: number;
  bounds: [number, number, number, number];
  legend: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  chunking: {
    strategy: string;
    chunkSize: number;
    chunks: OverlayChunkSummary[];
  };
};

export type OverlayChunk = {
  id: string;
  bounds: [number, number, number, number];
  featureCount: number;
  features: OverlayFeature[];
};

export type AnnotationFeature = {
  id: string;
  layerId: string;
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  style: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CommittedAnnotationEditType =
  | "addFeature"
  | "finishMovePosition"
  | "removePosition"
  | "addPosition"
  | "deleteFeature"
  | "split"
  | "unionGeometry";

export type AnnotationPersistenceError = {
  message: string;
  status?: number;
  detail?: string;
};

export type AnnotationLayer = {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isLocked: boolean;
};

export type AnnotationComment = {
  id: string;
  annotationId: string;
  body: string;
  author: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SlideTag = {
  value: string;
  color: string;
};

export type AnnotationReview = {
  id: string;
  annotationId: string;
  status: string;
  reviewer: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ViewerWorkspaceState = {
  showMetadata: boolean;
  showOverlays: boolean;
  showAnnotations: boolean;
  showHelp: boolean;
  isFullscreen: boolean;
  /** Ordered list of overlay IDs that are currently loaded and rendering. */
  activeOverlayIds: string[];
  /** Per-overlay visibility toggle — false hides rendering without unloading chunks. */
  overlayVisibility: Record<string, boolean>;
  /** Which overlay's style panel is currently open. */
  focusedOverlayId: string | null;
  selectedAnnotationId: string | null;
  activeLayerId: string | null;
  showComments: boolean;
  showAnnotationEditor: boolean;
  showOverlayStyle: boolean;
};
