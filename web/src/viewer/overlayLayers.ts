/*
Purpose: build memoizable deck.gl overlay layers from normalized overlay data.
Owner context: Viewer.
Invariants: layer construction is pure and overlay clicks resolve only overlay ids.
Failure modes: invalid geometry arrays render as empty layers rather than crashing the viewer.
*/

import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Matrix4 } from "@math.gl/core";

import type { OverlayFeature } from "../domain/workspace";

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

export function createOverlayLayers(args: {
  polygonOverlays: Array<OverlayFeature & { polygon: number[][][] }>;
  lineOverlays: Array<OverlayFeature & { path: number[][] }>;
  pointOverlays: Array<OverlayFeature & { position: number[] }>;
  modelMatrix: Matrix4;
  onSelectOverlay: (overlayId: string | null) => void;
}) {
  const { polygonOverlays, lineOverlays, pointOverlays, modelMatrix, onSelectOverlay } = args;
  return [
    new PolygonLayer({
      id: "overlay-polygons",
      data: polygonOverlays,
      getPolygon: (item: (typeof polygonOverlays)[number]) => item.polygon[0] ?? [],
      getLineColor: (item: (typeof polygonOverlays)[number]) => overlayColor(item, [56, 189, 248, 255]),
      getFillColor: (item: (typeof polygonOverlays)[number]) => overlayColor(item, [56, 189, 248, 70]),
      lineWidthUnits: "pixels",
      getLineWidth: (item: (typeof polygonOverlays)[number]) => overlayStrokeWidth(item),
      modelMatrix,
      pickable: true,
      onClick: (info: { object?: { id: string } }) => onSelectOverlay(info.object?.id ?? null)
    }),
    new PathLayer({
      id: "overlay-lines",
      data: lineOverlays,
      getPath: (item: (typeof lineOverlays)[number]) => item.path as any,
      getColor: (item: (typeof lineOverlays)[number]) => overlayColor(item, [244, 114, 182, 255]),
      widthUnits: "pixels",
      getWidth: (item: (typeof lineOverlays)[number]) => overlayStrokeWidth(item),
      modelMatrix,
      pickable: true,
      onClick: (info: { object?: { id: string } }) => onSelectOverlay(info.object?.id ?? null)
    }),
    new ScatterplotLayer({
      id: "overlay-points",
      data: pointOverlays,
      getPosition: (item: (typeof pointOverlays)[number]) => item.position as [number, number],
      getRadius: () => 16,
      radiusUnits: "pixels",
      getFillColor: (item: (typeof pointOverlays)[number]) => overlayColor(item, [251, 191, 36, 255]),
      modelMatrix,
      pickable: true,
      onClick: (info: { object?: { id: string } }) => onSelectOverlay(info.object?.id ?? null)
    })
  ];
}

