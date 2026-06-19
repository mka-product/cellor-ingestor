/*
Purpose: classify editable-layer edit events into transient, cancel, and persistable flows.
Owner context: Viewer.
Invariants: transient events never trigger persistence and boolean ops only run for committed polygon creation.
Failure modes: unknown edit types default to committed so edits are not silently dropped.
*/

import type { CommittedAnnotationEditType } from "../domain/workspace";
import { isPolygonGeometryType } from "./annotationGeometry";

const TRANSIENT_EDIT_TYPES = new Set([
  "addTentativePosition",
  "updateTentativeFeature",
  "invalidPolygon",
  "invalidHole",
  "movePosition"
]);

const COMMITTED_EDIT_TYPES = new Set<CommittedAnnotationEditType>([
  "addFeature",
  "finishMovePosition",
  "removePosition",
  "addPosition",
  "deleteFeature",
  "split",
  "unionGeometry"
]);

export function isTransientAnnotationEdit(editType: string): boolean {
  return TRANSIENT_EDIT_TYPES.has(editType);
}

export function isCancelAnnotationEdit(editType: string): boolean {
  return editType === "cancelFeature";
}

export function isCommittedAnnotationEdit(editType: string): editType is CommittedAnnotationEditType {
  return COMMITTED_EDIT_TYPES.has(editType as CommittedAnnotationEditType);
}

export function shouldApplyBooleanOperation(editType: string, geometryType: unknown): boolean {
  return editType === "addFeature" && isPolygonGeometryType(geometryType);
}

