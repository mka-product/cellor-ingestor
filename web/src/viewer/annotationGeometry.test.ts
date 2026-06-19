import { describe, expect, it } from "vitest";

import { sanitizeAnnotationGeometry } from "./annotationGeometry";

describe("sanitizeAnnotationGeometry", () => {
  it("keeps valid polygons", () => {
    expect(
      sanitizeAnnotationGeometry({
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]]
      })
    ).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]]
    });
  });

  it("rejects malformed polygon rings", () => {
    expect(
      sanitizeAnnotationGeometry({
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [0, 0]]]
      })
    ).toBeNull();
  });

  it("repairs unclosed polygon rings when possible", () => {
    expect(
      sanitizeAnnotationGeometry({
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 10]]]
      })
    ).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]]
    });
  });
});

