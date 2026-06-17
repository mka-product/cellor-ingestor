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

export type AnnotationFeature = {
  id: string;
  layerId: string;
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  style: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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

export type ViewerWorkspaceState = {
  showMetadata: boolean;
  showOverlays: boolean;
  showAnnotations: boolean;
  showHelp: boolean;
  isFullscreen: boolean;
  selectedOverlayId: string | null;
  selectedAnnotationId: string | null;
  activeLayerId: string | null;
  showComments: boolean;
  showAnnotationEditor: boolean;
  showOverlayStyle: boolean;
};
