import { describe, expect, test } from "vitest";

import type { OverlayFeature } from "../domain/workspace";
import { buildOverlayRenderPlan } from "./overlayLod";

function makeFeature(index: number): OverlayFeature {
  const left = (index % 100) * 64;
  const top = Math.floor(index / 100) * 64;
  return {
    id: `feature-${index}`,
    name: `Feature ${index}`,
    kind: "polygon",
    geometry: {
      type: "Polygon",
      coordinates: [[[left, top], [left + 32, top], [left + 32, top + 32], [left, top + 32], [left, top]]]
    },
    properties: {
      class: index % 2 === 0 ? "tumor" : "stroma",
      score: 0.25 + (index % 10) / 10
    },
    styleHints: {},
    bounds: [left, top, left + 32, top + 32]
  };
}

function makeDensePolygonFeature(): OverlayFeature {
  const coordinates = Array.from({ length: 24 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 24;
    const radius = index % 2 === 0 ? 90 : 54;
    return [1000 + Math.cos(angle) * radius, 1200 + Math.sin(angle) * radius];
  });
  return {
    id: "dense-feature",
    name: "Dense Feature",
    kind: "polygon",
    geometry: {
      type: "Polygon",
      coordinates: [[...coordinates, coordinates[0]]]
    },
    properties: {
      class: "tumor",
      score: 0.9
    },
    styleHints: {},
    bounds: [910, 1110, 1090, 1290]
  };
}

describe("overlayLod", () => {
  test("uses heatmap for very dense low-zoom overlays", () => {
    const features = Array.from({ length: 12000 }, (_, index) => makeFeature(index));
    const plan = buildOverlayRenderPlan(features, 0.01);

    expect(plan.mode).toBe("heatmap");
    expect(plan.features.length).toBeLessThan(features.length);
    expect(plan.features[0]?.properties.isHeatmap).toBe(true);
    expect(plan.stats.renderedObjectCount).toBe(plan.features.length);
  });

  test("uses cluster mode for intermediate zoom density", () => {
    const features = Array.from({ length: 5000 }, (_, index) => makeFeature(index));
    const plan = buildOverlayRenderPlan(features, 0.04);

    expect(plan.mode).toBe("cluster");
    expect(plan.features[0]?.kind).toBe("point");
    expect(plan.features[0]?.properties.isCluster).toBe(true);
  });

  test("cluster polygons are centered on contributing feature density rather than raw grid cells", () => {
    const features = [
      {
        id: "a",
        name: "A",
        kind: "polygon" as const,
        geometry: {
          type: "Polygon",
          coordinates: [[[1000, 2000], [1020, 2000], [1020, 2020], [1000, 2020], [1000, 2000]]]
        },
        properties: { class: "tumor", score: 0.8 },
        styleHints: {},
        bounds: [1000, 2000, 1020, 2020] as [number, number, number, number]
      },
      {
        id: "b",
        name: "B",
        kind: "polygon" as const,
        geometry: {
          type: "Polygon",
          coordinates: [[[1060, 2060], [1080, 2060], [1080, 2080], [1060, 2080], [1060, 2060]]]
        },
        properties: { class: "tumor", score: 0.7 },
        styleHints: {},
        bounds: [1060, 2060, 1080, 2080] as [number, number, number, number]
      }
    ];

    const plan = buildOverlayRenderPlan(features, 0.04, { forcedMode: "cluster" });
    const coordinates = plan.features[0]?.geometry.coordinates as number[] | undefined;
    const bounds = plan.features[0]?.bounds;

    expect(plan.mode).toBe("cluster");
    expect(Array.isArray(coordinates)).toBe(true);
    expect(typeof coordinates?.[0]).toBe("number");
    expect(bounds?.[0]).toBeLessThan(1040);
    expect(bounds?.[2]).toBeGreaterThan(1040);
    expect(bounds?.[1]).toBeLessThan(2040);
    expect(bounds?.[3]).toBeGreaterThan(2040);
  });

  test("cluster mode suppresses overlapping neighboring cells into fewer rendered regions", () => {
    const features = Array.from({ length: 2500 }, (_, index) => makeFeature(index));
    const plan = buildOverlayRenderPlan(features, 0.03, { forcedMode: "cluster" });

    expect(plan.mode).toBe("cluster");
    expect(plan.features.length).toBeLessThan(500);
  });

  test("switches to raw polygons once zoom is clinically close", () => {
    const features = Array.from({ length: 5000 }, (_, index) => makeFeature(index));
    const plan = buildOverlayRenderPlan(features, 0.24);

    expect(plan.mode).toBe("raw");
    expect(plan.features).toHaveLength(features.length);
  });

  test("simplified mode preserves features while reducing polygon vertex count", () => {
    const features = [makeDensePolygonFeature()];
    const plan = buildOverlayRenderPlan(features, 0.06, { forcedMode: "simplified" });
    const ring = (plan.features[0]?.geometry as { coordinates?: number[][][] } | undefined)?.coordinates?.[0];

    expect(plan.mode).toBe("simplified");
    expect(plan.features).toHaveLength(features.length);
    expect(ring).toBeDefined();
    expect(ring?.length).toBeGreaterThanOrEqual(7);
    expect(ring?.length).toBeLessThanOrEqual(9);
    expect(plan.features[0]?.properties.isSimplified).toBe(true);
  });
});
