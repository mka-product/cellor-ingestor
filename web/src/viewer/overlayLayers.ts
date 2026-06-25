/*
Purpose: build memoizable deck.gl overlay layers from normalized overlay data.
Owner context: Viewer.
Invariants: layer construction is pure and overlay clicks resolve only overlay ids.
Failure modes: invalid geometry arrays render as empty layers rather than crashing the viewer.
*/

import { PathLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Matrix4 } from "@math.gl/core";

import type { OverlayFeature } from "../domain/workspace";
import type { OverlayRenderMode } from "./overlayLod";
import { odColorForValue, type OdColorScale } from "./overlayStyling";

function overlayStrokeWidth(feature: OverlayFeature): number {
  return typeof feature.styleHints.strokeWidth === "number" ? feature.styleHints.strokeWidth : 2;
}

function overlayRadius(feature: OverlayFeature): number {
  return typeof feature.styleHints.radius === "number" ? feature.styleHints.radius : 16;
}

function overlayColor(feature: OverlayFeature, fallback: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(feature.styleHints.color) && feature.styleHints.color.length >= 3) {
    const values = feature.styleHints.color as number[];
    return [values[0] ?? fallback[0], values[1] ?? fallback[1], values[2] ?? fallback[2], values[3] ?? fallback[3]];
  }
  return fallback;
}

function overlayFillColor(feature: OverlayFeature, fallback: [number, number, number, number]): [number, number, number, number] {
  const color = overlayColor(feature, fallback);
  const opacity = typeof feature.styleHints.opacity === "number" ? Math.max(0, Math.min(1, feature.styleHints.opacity)) : null;
  if (opacity == null) {
    return color;
  }
  return [color[0], color[1], color[2], Math.round(255 * opacity)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOverlayLayers(args: {
  mode: OverlayRenderMode;
  polygonOverlays: Array<OverlayFeature & { polygon: number[][][] }>;
  lineOverlays: Array<OverlayFeature & { path: number[][] }>;
  pointOverlays: Array<OverlayFeature & { position: number[] }>;
  modelMatrix: Matrix4;
  /** Unique prefix for deck.gl layer IDs — required when multiple overlays are rendered simultaneously. */
  namespace?: string;
  /** When present, heatmap bins with `properties.od` use the OD palette for color; density drives alpha. */
  odColorScale?: OdColorScale | null;
}): any[] {
  const { mode, polygonOverlays, lineOverlays, pointOverlays, modelMatrix, odColorScale } = args;
  const ns = args.namespace ? `overlay-${args.namespace}` : "overlay";
  const layers = [];

  // Render larger polygons first so smaller/inner ones are drawn on top and pickable.
  // Deck.gl picking records the last-drawn item per pixel; without this sort the outer polygon
  // wins every hover event even when the cursor is inside an inner feature.
  const sortedPolygonOverlays = [...polygonOverlays].sort((a, b) => {
    const aArea = (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]);
    const bArea = (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]);
    return bArea - aArea;
  });

  if (mode === "heatmap" && sortedPolygonOverlays.length > 0) {
    // OD density map: each bin is colored by its weighted-average OD value when available.
    // Density drives alpha — low-density bins at tissue edges fade toward transparent,
    // preventing color bleed outside the tissue boundary.
    // Falls back to class-color density when the overlay has no OD data.
    layers.push(
      new PolygonLayer({
        id: `${ns}-heatmap-grid`,
        data: sortedPolygonOverlays,
        getPolygon: (item: (typeof sortedPolygonOverlays)[number]) => item.polygon[0] ?? [],
        getFillColor: (item: (typeof sortedPolygonOverlays)[number]) => {
          const d = typeof item.properties.density === "number" ? item.properties.density : 0.5;
          const densityFactor = Math.pow(d, 0.55);
          const od = typeof item.properties.od === "number" ? item.properties.od : null;
          // classOpacity from style panel controls overall transparency ceiling
          const base = overlayColor(item, [56, 189, 248, 255]);
          const classOpacity = (base[3] ?? 255) / 255;

          if (od !== null && odColorScale) {
            // OD path: RGB from palette, alpha = palette's own alpha × density × style opacity.
            // The palette alpha already encodes staining strength (64 at background → 242 at peak),
            // so the final alpha reflects both "how strongly stained" and "how many cells are here".
            const [r, g, b, paletteA] = odColorForValue(od, odColorScale);
            const alpha = Math.round((paletteA / 255) * densityFactor * 255 * classOpacity);
            return [r, g, b, alpha];
          }

          // Fallback: class-color density map (no OD data in this overlay)
          const alpha = Math.round(densityFactor * 255 * classOpacity);
          return [base[0], base[1], base[2], alpha];
        },
        stroked: false,
        filled: true,
        modelMatrix,
        pickable: true
      })
    );
    return layers;
  }

  if (mode === "cluster" && pointOverlays.length > 0) {
    // Subtle soft halo — half the core radius, very transparent.
    layers.push(
      new ScatterplotLayer({
        id: `${ns}-cluster-glow`,
        data: pointOverlays,
        getPosition: (item: (typeof pointOverlays)[number]) => item.position as [number, number],
        getRadius: (item: (typeof pointOverlays)[number]) =>
          typeof item.styleHints.radius === "number" ? item.styleHints.radius * 1.4 : 18,
        radiusUnits: "pixels",
        radiusMinPixels: 10,
        radiusMaxPixels: 44,
        getFillColor: (item: (typeof pointOverlays)[number]) => {
          const base = overlayColor(item, [56, 189, 248, 255]);
          const opacity = typeof item.styleHints.clusterGlowOpacity === "number" ? item.styleHints.clusterGlowOpacity : 0.08;
          return [base[0], base[1], base[2], Math.round(opacity * 255)];
        },
        stroked: false,
        pickable: false,
        modelMatrix
      })
    );
    layers.push(
      new ScatterplotLayer({
        id: `${ns}-cluster-core`,
        data: pointOverlays,
        getPosition: (item: (typeof pointOverlays)[number]) => item.position as [number, number],
        getRadius: (item: (typeof pointOverlays)[number]) =>
          typeof item.styleHints.radius === "number" ? item.styleHints.radius : 12,
        radiusUnits: "pixels",
        radiusMinPixels: 7,
        radiusMaxPixels: 32,
        getFillColor: (item: (typeof pointOverlays)[number]) => {
          const base = overlayColor(item, [56, 189, 248, 255]);
          const opacity = typeof item.styleHints.clusterCoreOpacity === "number" ? item.styleHints.clusterCoreOpacity : 0.72;
          return [base[0], base[1], base[2], Math.round(opacity * 255)];
        },
        getLineColor: [255, 255, 255, 80],
        stroked: true,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        pickable: true,
        modelMatrix
      })
    );
    return layers;
  }

  if (sortedPolygonOverlays.length > 0) {
    layers.push(
      new PolygonLayer({
        id: `${ns}-polygons`,
        data: sortedPolygonOverlays,
        getPolygon: (item: (typeof sortedPolygonOverlays)[number]) => item.polygon[0] ?? [],
        getLineColor: (item: (typeof sortedPolygonOverlays)[number]) => overlayColor(item, [56, 189, 248, 255]),
        getFillColor: (item: (typeof sortedPolygonOverlays)[number]) => overlayFillColor(item, [56, 189, 248, mode === "simplified" ? 38 : 70]),
        lineWidthUnits: "pixels",
        getLineWidth: (item: (typeof sortedPolygonOverlays)[number]) => overlayStrokeWidth(item),
        modelMatrix,
        pickable: true
      })
    );
  }

  if (lineOverlays.length > 0) {
    layers.push(
      new PathLayer({
        id: `${ns}-lines`,
        data: lineOverlays,
        getPath: (item: (typeof lineOverlays)[number]) => item.path as any,
        getColor: (item: (typeof lineOverlays)[number]) => overlayColor(item, [244, 114, 182, 255]),
        widthUnits: "pixels",
        getWidth: (item: (typeof lineOverlays)[number]) => overlayStrokeWidth(item),
        modelMatrix,
        pickable: true
      })
    );
  }

  if (pointOverlays.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: mode === "cluster" ? `${ns}-clusters` : `${ns}-points`,
        data: pointOverlays,
        getPosition: (item: (typeof pointOverlays)[number]) => item.position as [number, number],
        getRadius: (item: (typeof pointOverlays)[number]) => overlayRadius(item),
        radiusUnits: "pixels",
        radiusMinPixels: mode === "cluster" ? 8 : 2,
        radiusMaxPixels: mode === "cluster" ? 48 : 12,
        getFillColor: (item: (typeof pointOverlays)[number]) => overlayFillColor(item, [251, 191, 36, 255]),
        getLineColor: mode === "cluster" ? [255, 255, 255, 180] : [0, 0, 0, 0],
        stroked: mode === "cluster",
        lineWidthUnits: "pixels",
        lineWidthMinPixels: mode === "cluster" ? 1 : 0,
        modelMatrix,
        pickable: true
      })
    );
  }

  return layers;
}
