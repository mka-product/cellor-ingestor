/*
Purpose: reduce visible overlay complexity before deck.gl rendering so large chunked overlays remain interactive.
Owner context: Viewer.
Invariants: reductions are deterministic for one visible feature set and viewport scale; raw features are preserved at higher zoom.
Failure modes: unsupported or malformed geometries degrade to coarser centroid clusters rather than breaking the viewer.
*/

import type { OverlayFeature } from "../domain/workspace";

// Local OD extraction — mirrors OD_FIELD_CANDIDATES in overlayStyling without a cross-module import.
const OD_FIELDS = ["od", "OD", "optical_density", "od_nucleus", "od_cytoplasm", "od_membrane"] as const;
function featureOd(feature: OverlayFeature): number | null {
  for (const k of OD_FIELDS) {
    const v = feature.properties[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export type OverlayRenderMode = "raw" | "simplified" | "cluster" | "heatmap";

export type OverlayRenderPlan = {
  mode: OverlayRenderMode;
  features: OverlayFeature[];
  stats: {
    renderedObjectCount: number;
    inputFeatureCount: number;
    binSize?: number;
  };
};

// Default scale thresholds — used only when the manifest's pyramid levels are unavailable.
// Dynamic thresholds computed from manifest levels always take precedence.
const RAW_SCALE_THRESHOLD = 0.5;
const SIMPLIFIED_SCALE_THRESHOLD = 0.12;
const RAW_FEATURE_THRESHOLD = 48;
const SIMPLIFIED_FEATURE_THRESHOLD = 2500;
const SIMPLIFIED_MIN_POINTS = 6;
const SIMPLIFIED_MAX_POINTS = 8;

export type OverlayLodThresholds = { rawScale: number; simplifiedScale: number };

/**
 * Derives LOD scale thresholds from the slide's pyramid levels.
 * Rule: last level (L0, full res) → raw; L1–L2 → simplified; L3+ → heatmap.
 * Thresholds are the geometric-mean scale at adjacent-level boundaries.
 */
export function computeOverlayLodThresholds(
  levels: Array<{ downsample: number }>
): OverlayLodThresholds {
  const sorted = [...levels].sort((a, b) => a.downsample - b.downsample);
  // Boundary between L0 (raw) and L1 (simplified): scale at geometric mean of their downsample factors.
  const rawScale =
    sorted.length >= 2
      ? 1 / Math.sqrt(sorted[0].downsample * sorted[1].downsample)
      : RAW_SCALE_THRESHOLD;
  // Boundary between L2 (simplified) and L3 (heatmap).
  const simplifiedScale =
    sorted.length >= 3
      ? 1 / Math.sqrt(sorted[1].downsample * sorted[2].downsample)
      : sorted.length >= 2
        ? rawScale / 4
        : RAW_SCALE_THRESHOLD / 4;
  return { rawScale, simplifiedScale };
}

type OverlayRenderPlanOptions = {
  forcedMode?: OverlayRenderMode | null;
  precomputedMode?: OverlayRenderMode | null;
  /** Dynamic thresholds derived from the slide's pyramid — overrides the module-level defaults. */
  lodThresholds?: OverlayLodThresholds;
};

function featureClass(feature: OverlayFeature): string {
  return String(feature.properties.class ?? feature.properties.label ?? "default");
}

function numericScore(feature: OverlayFeature): number | null {
  const raw = feature.properties.score;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

// Checks ±2 neighbors to match the Gaussian kernel spread (was ±1, which was too narrow).
function shouldKeepClusterCell(
  cellKey: string,
  className: string,
  influence: number,
  cellX: number,
  cellY: number,
  field: Map<
    string,
    {
      influence: number;
      className: string;
      cellX: number;
      cellY: number;
    }
  >
) {
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighborKey = `${className}:${cellX + offsetX}:${cellY + offsetY}`;
      const neighbor = field.get(neighborKey);
      if (!neighbor) continue;
      if (neighbor.influence > influence) return false;
      if (neighbor.influence === influence && neighborKey < cellKey) return false;
    }
  }
  return true;
}

function ringWithoutClosure(ring: number[][]): number[][] {
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) {
      return ring.slice(0, -1);
    }
  }
  return ring;
}

function closeRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first?.[0] === last?.[0] && first?.[1] === last?.[1]) {
    return ring;
  }
  return [...ring, first];
}

function pointLineDistance(point: number[], start: number[], end: number[]): number {
  const [x0, y0] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(x0 - x1, y0 - y1);
  }
  return Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

function rdp(points: number[][], epsilon: number): number[][] {
  if (points.length <= 2) {
    return [...points];
  }
  let maxDistance = -1;
  let splitIndex = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (maxDistance > epsilon && splitIndex !== -1) {
    const left = rdp(points.slice(0, splitIndex + 1), epsilon);
    const right = rdp(points.slice(splitIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function downsampleRing(points: number[][], targetVertices: number): number[][] {
  if (points.length <= targetVertices) {
    return [...points];
  }
  const selected: number[][] = [];
  const lastIndex = points.length - 1;
  for (let position = 0; position < targetVertices; position += 1) {
    const index = Math.round((position * lastIndex) / Math.max(1, targetVertices - 1));
    const point = points[index];
    if (!selected.length || selected[selected.length - 1][0] !== point[0] || selected[selected.length - 1][1] !== point[1]) {
      selected.push(point);
    }
  }
  return selected;
}

function simplifyRing(ring: number[][], minPoints = SIMPLIFIED_MIN_POINTS, maxPoints = SIMPLIFIED_MAX_POINTS): number[][] {
  const openRing = ringWithoutClosure(ring);
  if (openRing.length <= maxPoints) {
    return closeRing(openRing);
  }
  const xs = openRing.map((point) => point[0]);
  const ys = openRing.map((point) => point[1]);
  let low = 0;
  let high = Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  let bestUnder: number[][] | null = null;
  let bestOver: number[][] | null = null;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const epsilon = (low + high) / 2;
    const candidate = ringWithoutClosure(rdp([...openRing, openRing[0]], epsilon));
    if (candidate.length >= minPoints && candidate.length <= maxPoints) {
      return closeRing(candidate);
    }
    if (candidate.length > maxPoints) {
      bestOver = candidate;
      low = epsilon;
    } else {
      bestUnder = candidate;
      high = epsilon;
    }
  }
  if (bestOver && bestOver.length >= 3) {
    return closeRing(downsampleRing(bestOver, maxPoints));
  }
  if (bestUnder && bestUnder.length >= 3) {
    if (bestUnder.length < minPoints) {
      return closeRing(downsampleRing(openRing, Math.min(maxPoints, Math.max(minPoints, openRing.length))));
    }
    return closeRing(bestUnder);
  }
  return closeRing(downsampleRing(openRing, maxPoints));
}

function simplifyPolygonGeometry(geometry: Record<string, unknown>): Record<string, unknown> {
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring, index) =>
        Array.isArray(ring)
          ? simplifyRing(
              ring.filter((point): point is number[] => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number"),
              index === 0 ? SIMPLIFIED_MIN_POINTS : 4,
              index === 0 ? SIMPLIFIED_MAX_POINTS : 6
            )
          : ring
      )
    };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring, index) =>
              Array.isArray(ring)
                ? simplifyRing(
                    ring.filter((point): point is number[] => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number"),
                    index === 0 ? SIMPLIFIED_MIN_POINTS : 4,
                    index === 0 ? SIMPLIFIED_MAX_POINTS : 6
                  )
                : ring
            )
          : polygon
      )
    };
  }
  return geometry;
}

function buildSimplifiedPolygons(features: OverlayFeature[]): OverlayFeature[] {
  return features.map((feature) => ({
    ...feature,
    id: `simplified:${feature.id}`,
    geometry: simplifyPolygonGeometry(feature.geometry),
    properties: {
      ...feature.properties,
      isSimplified: true
    },
    styleHints: {
      ...feature.styleHints,
      isSimplified: true
    }
  }));
}

function overlayColor(feature: OverlayFeature, fallback: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(feature.styleHints.color) && feature.styleHints.color.length >= 3) {
    const values = feature.styleHints.color as number[];
    return [values[0] ?? fallback[0], values[1] ?? fallback[1], values[2] ?? fallback[2], values[3] ?? fallback[3]];
  }
  return fallback;
}

function buildHeatmapFeatures(features: OverlayFeature[], scale: number): OverlayFeature[] {
  const imageBinSize = Math.min(1024, Math.max(224, 40 / Math.max(scale, 0.0001)));
  const bins = new Map<
    string,
    {
      count: number;
      featureCount: number;
      scoreSum: number;
      colorSum: [number, number, number, number];
      centerX: number;
      centerY: number;
      classCounts: Record<string, number>;
      odSum: number;
      odCount: number;
    }
  >();

  for (const feature of features) {
    const [minX, minY, maxX, maxY] = feature.bounds;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const binX = Math.floor(centerX / imageBinSize);
    const binY = Math.floor(centerY / imageBinSize);
    const key = `${binX}:${binY}`;
    const score = numericScore(feature) ?? 0;
    const weight = typeof feature.properties.count === "number" && feature.properties.count > 1
      ? feature.properties.count
      : 1;
    const color = overlayColor(feature, [56, 189, 248, 255]);
    const cls = String(feature.properties.class ?? feature.properties.label ?? "default");
    const od = featureOd(feature);
    const existing = bins.get(key);
    if (existing) {
      existing.count += weight;
      existing.featureCount += 1;
      existing.scoreSum += score * weight;
      existing.colorSum = [existing.colorSum[0] + color[0] * weight, existing.colorSum[1] + color[1] * weight, existing.colorSum[2] + color[2] * weight, existing.colorSum[3] + color[3] * weight];
      existing.classCounts[cls] = (existing.classCounts[cls] ?? 0) + weight;
      if (od !== null) { existing.odSum += od * weight; existing.odCount += weight; }
      continue;
    }
    bins.set(key, {
      count: weight,
      featureCount: 1,
      scoreSum: score * weight,
      colorSum: [color[0] * weight, color[1] * weight, color[2] * weight, color[3] * weight],
      centerX: (binX + 0.5) * imageBinSize,
      centerY: (binY + 0.5) * imageBinSize,
      classCounts: { [cls]: weight },
      odSum: od !== null ? od * weight : 0,
      odCount: od !== null ? weight : 0,
    });
  }

  const maxCount = Math.max(1, ...Array.from(bins.values()).map((v) => v.count));

  return Array.from(bins.entries()).map(([key, value], index) => {
    // Log-scale normalization gives visual spread even when density varies by orders of magnitude.
    const logDensity = Math.log1p(value.count) / Math.log1p(maxCount);
    const dominantClass = Object.entries(value.classCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "default";
    // Expand each square by a half-pixel in image-space to prevent sub-pixel cracks
    // between adjacent WebGL polygons at varying zoom levels.
    const half = imageBinSize / 2 + 0.5 / Math.max(scale, 0.001);
    const cx = value.centerX;
    const cy = value.centerY;
    const ring: number[][] = [
      [cx - half, cy - half],
      [cx + half, cy - half],
      [cx + half, cy + half],
      [cx - half, cy + half],
      [cx - half, cy - half]
    ];
    return {
      id: `heatmap:${key}:${index}`,
      name: "density",
      kind: "polygon" as const,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: {
        class: dominantClass,
        count: Math.round(value.count),
        score: value.scoreSum / value.count,
        isHeatmap: true,
        density: logDensity,
        ...(value.odCount > 0 ? { od: value.odSum / value.odCount } : {}),
      },
      styleHints: {
        color: [
          Math.round(value.colorSum[0] / value.count),
          Math.round(value.colorSum[1] / value.count),
          Math.round(value.colorSum[2] / value.count),
          Math.round(value.colorSum[3] / value.count)
        ],
        isHeatmap: true
      },
      bounds: [cx - half, cy - half, cx + half, cy + half] as [number, number, number, number]
    };
  });
}

function buildClusterFeatures(features: OverlayFeature[], scale: number): OverlayFeature[] {
  const imageBinSize = Math.min(640, Math.max(120, 18 / Math.max(scale, 0.0001)));
  const sigma = 1.15;
  const field = new Map<
    string,
    {
      influence: number;
      count: number;         // influence-weighted contributions (for centroid/opacity)
      featureCount: number;  // actual features represented (for label)
      scoreSum: number;
      cellX: number;
      cellY: number;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      colorSum: [number, number, number];
      className: string;
      maxScore: number | null;
      centerXSum: number;
      centerYSum: number;
      centerWeight: number;
      odSum: number;
      odCount: number;
    }
  >();

  for (const feature of features) {
    const [minX, minY, maxX, maxY] = feature.bounds;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const className = featureClass(feature);
    const score = numericScore(feature);
    const color = overlayColor(feature, [56, 189, 248, 180]);
    const baseX = Math.floor(centerX / imageBinSize);
    const baseY = Math.floor(centerY / imageBinSize);
    const od = featureOd(feature);

    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        const influence = Math.exp(-distanceSquared / (2 * sigma * sigma));
        if (influence < 0.08) continue;
        const cellX = baseX + offsetX;
        const cellY = baseY + offsetY;
        const key = `${className}:${cellX}:${cellY}`;
        const existing = field.get(key);
        const isBase = offsetX === 0 && offsetY === 0;
        if (existing) {
          existing.influence += influence;
          existing.count += 1;
          if (isBase) existing.featureCount += 1;
          existing.scoreSum += score ?? 0;
          existing.minX = Math.min(existing.minX, minX);
          existing.minY = Math.min(existing.minY, minY);
          existing.maxX = Math.max(existing.maxX, maxX);
          existing.maxY = Math.max(existing.maxY, maxY);
          existing.maxScore =
            score == null
              ? existing.maxScore
              : existing.maxScore == null
                ? score
                : Math.max(existing.maxScore, score);
          existing.centerXSum += centerX * influence;
          existing.centerYSum += centerY * influence;
          existing.centerWeight += influence;
          existing.colorSum = [existing.colorSum[0] + color[0], existing.colorSum[1] + color[1], existing.colorSum[2] + color[2]];
          // OD: only accumulate from the base cell so we reflect the actual feature location
          if (isBase && od !== null) { existing.odSum += od; existing.odCount += 1; }
          continue;
        }
        field.set(key, {
          influence,
          count: 1,
          featureCount: isBase ? 1 : 0,
          scoreSum: score ?? 0,
          cellX,
          cellY,
          minX,
          minY,
          maxX,
          maxY,
          colorSum: [color[0], color[1], color[2]],
          className,
          maxScore: score,
          centerXSum: centerX * influence,
          centerYSum: centerY * influence,
          centerWeight: influence,
          odSum: isBase && od !== null ? od : 0,
          odCount: isBase && od !== null ? 1 : 0,
        });
      }
    }
  }

  // Use reduce instead of spread to avoid call-stack limit on large field maps.
  const maxInfluence = Array.from(field.values()).reduce((max, entry) => Math.max(max, entry.influence), 1);
  // Cap the threshold so sparse isolated cells remain visible near dense hotspots.
  const threshold = Math.max(0.22, Math.min(maxInfluence * 0.18, 1.8));

  return Array.from(field.entries())
    .filter(([, value]) => value.influence >= threshold)
    .filter(([key, value]) => shouldKeepClusterCell(key, value.className, value.influence, value.cellX, value.cellY, field))
    .map(([, value], index) => {
      const normalized = Math.max(0, Math.min(1, value.influence / maxInfluence));
      const opacity = Math.max(0.24, Math.min(0.88, 0.24 + normalized * 0.48));
      const centroidX = value.centerWeight > 0 ? value.centerXSum / value.centerWeight : (value.minX + value.maxX) / 2;
      const centroidY = value.centerWeight > 0 ? value.centerYSum / value.centerWeight : (value.minY + value.maxY) / 2;
      const radius = Math.max(10, Math.min(46, 10 + Math.log2(value.featureCount + 1) * 5 + normalized * 10));
      const displayCount = value.featureCount;
      return {
        id: `cluster:${value.className}:${value.cellX}:${value.cellY}:${index}`,
        name: displayCount <= 1 ? value.className : `${value.className} (${displayCount})`,
        kind: "point" as const,
        geometry: {
          type: "Point",
          coordinates: [centroidX, centroidY]
        },
        properties: {
          class: value.className,
          count: displayCount,
          score: value.maxScore ?? value.scoreSum / Math.max(1, value.count),
          isCluster: true,
          ...(value.odCount > 0 ? { od: value.odSum / value.odCount } : {}),
        },
        styleHints: {
          color: [
            Math.round(value.colorSum[0] / value.count),
            Math.round(value.colorSum[1] / value.count),
            Math.round(value.colorSum[2] / value.count),
            Math.round(opacity * 255)
          ],
          strokeWidth: 0,
          opacity,
          clusterGlowOpacity: Math.max(0.08, opacity * 0.28),
          clusterCoreOpacity: Math.max(0.3, Math.min(0.92, opacity * 0.92)),
          radius,
          isCluster: true
        },
        bounds: [
          centroidX - radius,
          centroidY - radius,
          centroidX + radius,
          centroidY + radius
        ] as [number, number, number, number]
      };
    });
}

export function buildOverlayRenderPlan(
  features: OverlayFeature[],
  scale: number,
  options: OverlayRenderPlanOptions = {}
): OverlayRenderPlan {
  if (features.length === 0) {
    return { mode: "raw", features: [], stats: { renderedObjectCount: 0, inputFeatureCount: 0 } };
  }
  if (options.precomputedMode) {
    return {
      mode: options.precomputedMode,
      features,
      stats: { renderedObjectCount: features.length, inputFeatureCount: features.length }
    };
  }
  if (options.forcedMode === "raw") {
    return { mode: "raw", features, stats: { renderedObjectCount: features.length, inputFeatureCount: features.length } };
  }
  if (options.forcedMode === "simplified") {
    const simplified = buildSimplifiedPolygons(features);
    return { mode: "simplified", features: simplified, stats: { renderedObjectCount: simplified.length, inputFeatureCount: features.length, binSize: 320 } };
  }
  if (options.forcedMode === "cluster") {
    const cluster = buildClusterFeatures(features, scale);
    return { mode: "cluster", features: cluster, stats: { renderedObjectCount: cluster.length, inputFeatureCount: features.length, binSize: Math.min(640, Math.max(120, 18 / Math.max(scale, 0.0001))) } };
  }
  if (options.forcedMode === "heatmap") {
    const heatmap = buildHeatmapFeatures(features, scale);
    return { mode: "heatmap", features: heatmap, stats: { renderedObjectCount: heatmap.length, inputFeatureCount: features.length, binSize: Math.min(1024, Math.max(224, 40 / Math.max(scale, 0.0001))) } };
  }
  const rawT = options.lodThresholds?.rawScale ?? RAW_SCALE_THRESHOLD;
  const simT = options.lodThresholds?.simplifiedScale ?? SIMPLIFIED_SCALE_THRESHOLD;
  if (features.length <= RAW_FEATURE_THRESHOLD || scale >= rawT) {
    return { mode: "raw", features, stats: { renderedObjectCount: features.length, inputFeatureCount: features.length } };
  }
  if (features.length <= SIMPLIFIED_FEATURE_THRESHOLD || scale >= simT) {
    const simplified = buildSimplifiedPolygons(features);
    return { mode: "simplified", features: simplified, stats: { renderedObjectCount: simplified.length, inputFeatureCount: features.length, binSize: 320 } };
  }
  const heatmap = buildHeatmapFeatures(features, scale);
  return { mode: "heatmap", features: heatmap, stats: { renderedObjectCount: heatmap.length, inputFeatureCount: features.length, binSize: Math.min(1024, Math.max(224, 40 / Math.max(scale, 0.0001))) } };
}
