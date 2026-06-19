/*
Purpose: normalize and validate annotation geometry before rendering or persistence.
Owner context: Viewer.
Invariants: only valid Point, LineString, Polygon, and MultiPolygon geometries are emitted.
Failure modes: malformed coordinates return null so callers can reject or skip invalid features.
*/

import type { AnnotationFeature } from "../domain/workspace";

type Position = [number, number];
type LineStringCoordinates = Position[];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];

function isFinitePosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function positionsEqual(left: number[], right: number[]) {
  return left[0] === right[0] && left[1] === right[1];
}

function normalizePoint(value: unknown): Position | null {
  if (!isFinitePosition(value)) return null;
  return [Number(value[0]), Number(value[1])];
}

function normalizeLineString(value: unknown): LineStringCoordinates | null {
  if (!Array.isArray(value)) return null;
  const positions = value.map(normalizePoint).filter((entry): entry is Position => entry !== null);
  return positions.length >= 2 ? positions : null;
}

function normalizeRing(value: unknown): Position[] | null {
  if (!Array.isArray(value)) return null;
  const positions = value.map(normalizePoint).filter((entry): entry is Position => entry !== null);
  if (positions.length < 3) return null;

  const deduped = positions.filter((point, index) => index === 0 || !positionsEqual(point, positions[index - 1] as Position));
  if (deduped.length < 3) return null;

  const closed = positionsEqual(deduped[0] as Position, deduped[deduped.length - 1] as Position)
    ? deduped
    : [...deduped, deduped[0] as Position];
  return closed.length >= 4 ? closed : null;
}

function normalizePolygon(value: unknown): PolygonCoordinates | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings = value.map(normalizeRing).filter((entry): entry is Position[] => entry !== null);
  return rings.length > 0 ? rings : null;
}

function normalizeMultiPolygon(value: unknown): MultiPolygonCoordinates | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const polygons = value.map(normalizePolygon).filter((entry): entry is PolygonCoordinates => entry !== null);
  return polygons.length > 0 ? polygons : null;
}

export function isPolygonGeometryType(value: unknown): boolean {
  return value === "Polygon" || value === "MultiPolygon";
}

export function sanitizeAnnotationGeometry(geometry: Record<string, unknown>): Record<string, unknown> | null {
  const type = String(geometry.type ?? "");
  if (type === "Point") {
    const coordinates = normalizePoint(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "LineString") {
    const coordinates = normalizeLineString(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "Polygon") {
    const coordinates = normalizePolygon(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "MultiPolygon") {
    const coordinates = normalizeMultiPolygon(geometry.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  return null;
}

export function sanitizeAnnotationFeature(feature: AnnotationFeature): AnnotationFeature | null {
  const geometry = sanitizeAnnotationGeometry(feature.geometry);
  return geometry ? { ...feature, geometry } : null;
}

export function sanitizeDraftFeature(feature: { geometry?: Record<string, unknown> } & Record<string, unknown>) {
  const geometry = sanitizeAnnotationGeometry(feature.geometry ?? {});
  return geometry ? { ...feature, geometry } : null;
}

