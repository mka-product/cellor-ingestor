import { describe, expect, it } from "vitest";

import { applyAnnotationBooleanOperation, type AnnotationCanvasFeature } from "./annotationBoolean";

function rectangleFeature(id: string, minX: number, minY: number, maxX: number, maxY: number): AnnotationCanvasFeature {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Polygon",
      coordinates: [[
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY]
      ]]
    },
    properties: {
      layerId: "layer-1"
    }
  };
}

describe("applyAnnotationBooleanOperation", () => {
  it("merges overlapping polygon features", () => {
    const previous = [rectangleFeature("a", 0, 0, 10, 10)];
    const created = rectangleFeature("b", 8, 0, 18, 10);
    const result = applyAnnotationBooleanOperation({
      previousFeatures: previous,
      updatedFeatures: [...previous, created],
      operation: "merge",
      activeLayerId: "layer-1"
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].geometry.type).toBe("Polygon");
  });

  it("subtracts overlap from existing polygon features", () => {
    const previous = [rectangleFeature("a", 0, 0, 10, 10)];
    const created = rectangleFeature("b", 5, 0, 10, 10);
    const result = applyAnnotationBooleanOperation({
      previousFeatures: previous,
      updatedFeatures: [...previous, created],
      operation: "subtract",
      activeLayerId: "layer-1"
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].geometry.type).toBe("Polygon");
    expect(JSON.stringify(result[0].geometry.coordinates)).toContain("5");
  });

  it("ignores boolean operations for non-polygon created features", () => {
    const previous = [rectangleFeature("a", 0, 0, 10, 10)];
    const created: AnnotationCanvasFeature = {
      type: "Feature",
      id: "line-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [5, 5]
        ]
      },
      properties: { layerId: "layer-1" }
    };

    const result = applyAnnotationBooleanOperation({
      previousFeatures: previous,
      updatedFeatures: [...previous, created],
      operation: "merge",
      activeLayerId: "layer-1"
    });

    expect(result).toHaveLength(2);
    expect(result[1].geometry.type).toBe("LineString");
  });
});
