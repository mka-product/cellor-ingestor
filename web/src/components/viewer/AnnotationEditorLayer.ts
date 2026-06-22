/*
Purpose: construct the editable annotation layer and keep edit-flow concerns out of ViewerCanvas.
Owner context: Viewer.
Invariants: transient edits stay local, committed edits are sanitized before persistence, and boolean ops run only for polygon creation.
Failure modes: invalid geometry is dropped before persistence and malformed edit payloads resolve to no-op sanitization.
*/

import {
  DrawLineStringMode,
  DrawPolygonMode,
  EditableGeoJsonLayer,
  ModifyMode,
  ViewMode
} from "@deck.gl-community/editable-layers";
import type { EditAction } from "@deck.gl-community/editable-layers";
import type { Feature, Geometry, GeoJsonProperties } from "geojson";
import type { Matrix4 } from "@math.gl/core";
import type { MutableRefObject } from "react";

import type { AnnotationFeature, AnnotationLayer } from "../../domain/workspace";
import type { AnnotationBooleanMode, AnnotationCanvasFeature } from "../../viewer/annotationBoolean";
import { applyAnnotationBooleanOperation } from "../../viewer/annotationBoolean";
import {
  isCancelAnnotationEdit,
  isCommittedAnnotationEdit,
  isTransientAnnotationEdit,
  shouldApplyBooleanOperation
} from "../../viewer/annotationEditFlow";
import { sanitizeAnnotationGeometry, sanitizeDraftFeature } from "../../viewer/annotationGeometry";
import type { EditableGeoJsonFeatureCollection } from "./useBufferedFeatureCollection";

type EditableFeature = Feature<Geometry, GeoJsonProperties>;
type FeatureCollection = EditableGeoJsonFeatureCollection;

class PixelAccurateDrawLineStringMode extends DrawLineStringMode {
  calculateInfoDraw(clickSequence: number[][]) {
    if (clickSequence.length > 1) {
      this.position = clickSequence[clickSequence.length - 1] as any;
      const previous = clickSequence[clickSequence.length - 2] ?? [0, 0];
      const current = clickSequence[clickSequence.length - 1] ?? [0, 0];
      const dx = (current[0] ?? 0) - (previous[0] ?? 0);
      const dy = (current[1] ?? 0) - (previous[1] ?? 0);
      this.dist += Math.sqrt(dx * dx + dy * dy);
    }
  }
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

function sanitizeFeatureCollection(collection: FeatureCollection): FeatureCollection {
  const sanitized = collection.features
    .map((feature) => sanitizeDraftFeature(feature as unknown as Record<string, unknown>))
    .filter(Boolean);
  return {
    ...collection,
    features: sanitized as unknown as EditableFeature[]
  };
}

export function createAnnotationEditorLayer(args: {
  annotationCollection: FeatureCollection;
  annotationCollectionRef: MutableRefObject<FeatureCollection>;
  manifest: { metadata?: { micronsPerPixel?: { x?: number | null; y?: number | null } } };
  tool: string;
  selectedFeatureIndexes: number[];
  annotationLayerById: Map<string, AnnotationLayer>;
  modelMatrix: Matrix4;
  onSelectAnnotation: (annotationId: string | null) => void;
  onTransientUpdate: (collection: FeatureCollection) => void;
  onCommittedUpdate: (collection: FeatureCollection) => void;
  onPersistCommittedFeatures: (features: AnnotationFeature[]) => void;
  activeLayerId: string | null;
  visibleAnnotationLayers: AnnotationLayer[];
  annotationOperation: AnnotationBooleanMode;
  formatDistance: (distance: number, micronsPerPixel: number | null) => string;
  worldCoordinatesToImage: (coordinates: unknown) => unknown;
}) {
  const {
    annotationCollection,
    annotationCollectionRef,
    manifest,
    tool,
    selectedFeatureIndexes,
    annotationLayerById,
    modelMatrix,
    onSelectAnnotation,
    onTransientUpdate,
    onCommittedUpdate,
    onPersistCommittedFeatures,
    activeLayerId,
    visibleAnnotationLayers,
    annotationOperation,
    formatDistance,
    worldCoordinatesToImage
  } = args;

  return new EditableGeoJsonLayer({
    id: "annotations",
    data: annotationCollection,
    coordinateSystem: "cartesian",
    modeConfig: {
      formatTooltip: (distance: number) =>
        formatDistance(distance, manifest.metadata?.micronsPerPixel?.x ?? manifest.metadata?.micronsPerPixel?.y ?? null)
    },
    mode:
      tool === "modify"
        ? ModifyMode
        : tool === "line"
          ? PixelAccurateDrawLineStringMode
          : tool === "polygon"
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
    modelMatrix,
    pickable: true,
    onClick: (info: { object?: { id?: string } }) => onSelectAnnotation((info.object?.id as string | null) ?? null),
    onEdit: ({ updatedData, editType }: EditAction<FeatureCollection>) => {
      if (isTransientAnnotationEdit(editType)) {
        onTransientUpdate(updatedData);
        return;
      }

      if (isCancelAnnotationEdit(editType)) {
        onCommittedUpdate(updatedData);
        return;
      }

      const nextData =
        shouldApplyBooleanOperation(
          editType,
          updatedData.features.length > 0 ? (updatedData.features[updatedData.features.length - 1] as EditableFeature | undefined)?.geometry?.type ?? null : null
        )
          ? {
              ...updatedData,
              features: applyAnnotationBooleanOperation({
                previousFeatures: annotationCollectionRef.current.features as unknown as AnnotationCanvasFeature[],
                updatedFeatures: updatedData.features as unknown as AnnotationCanvasFeature[],
                operation: annotationOperation,
                activeLayerId
              }) as unknown as EditableFeature[]
            }
          : updatedData;

      const sanitizedData = sanitizeFeatureCollection(nextData);
      onCommittedUpdate(sanitizedData);

      if (!isCommittedAnnotationEdit(editType)) {
        return;
      }

      const targetLayerId = activeLayerId ?? visibleAnnotationLayers[0]?.id ?? "default-layer";
      const persistedFeatures = sanitizedData.features
        .map((feature) => {
            const geometry = sanitizeAnnotationGeometry((feature.geometry ?? {}) as unknown as Record<string, unknown>);
            if (!geometry) return null;
            const properties = (feature.properties ?? {}) as Record<string, unknown>;
            return {
              id: String(feature.id ?? crypto.randomUUID()),
              layerId: String((properties["layerId"] as string | undefined) ?? targetLayerId),
              geometry: {
                type: geometry.type,
                coordinates: worldCoordinatesToImage(geometry.coordinates)
              },
              properties,
              style: (properties.style as Record<string, unknown> | undefined) ?? {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            } as AnnotationFeature;
          })
        .filter(Boolean) as AnnotationFeature[];
      onPersistCommittedFeatures(persistedFeatures);
    }
  });
}
