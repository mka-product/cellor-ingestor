import { describe, expect, it } from "vitest";

import {
  isCancelAnnotationEdit,
  isCommittedAnnotationEdit,
  isTransientAnnotationEdit,
  shouldApplyBooleanOperation
} from "./annotationEditFlow";

describe("annotationEditFlow", () => {
  it("classifies transient edit types", () => {
    expect(isTransientAnnotationEdit("movePosition")).toBe(true);
    expect(isTransientAnnotationEdit("addTentativePosition")).toBe(true);
    expect(isTransientAnnotationEdit("finishMovePosition")).toBe(false);
  });

  it("classifies committed edit types", () => {
    expect(isCommittedAnnotationEdit("finishMovePosition")).toBe(true);
    expect(isCommittedAnnotationEdit("addFeature")).toBe(true);
    expect(isCommittedAnnotationEdit("updateTentativeFeature")).toBe(false);
  });

  it("classifies cancel flow", () => {
    expect(isCancelAnnotationEdit("cancelFeature")).toBe(true);
  });

  it("only applies boolean operations for committed polygon creation", () => {
    expect(shouldApplyBooleanOperation("addFeature", "Polygon")).toBe(true);
    expect(shouldApplyBooleanOperation("addFeature", "LineString")).toBe(false);
    expect(shouldApplyBooleanOperation("finishMovePosition", "Polygon")).toBe(false);
  });
});
