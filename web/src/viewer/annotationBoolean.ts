import polygonClipping from "polygon-clipping";

export type AnnotationBooleanMode = "create" | "merge" | "subtract";

type Position = [number, number];
type Ring = Position[];
type PolygonCoordinates = Ring[];
type MultiPolygonCoordinates = PolygonCoordinates[];

export type AnnotationCanvasFeature = {
  type: "Feature";
  id?: string;
  geometry: {
    type: string;
    coordinates: unknown;
  };
  properties?: Record<string, unknown>;
};

function cloneFeature(feature: AnnotationCanvasFeature): AnnotationCanvasFeature {
  return JSON.parse(JSON.stringify(feature)) as AnnotationCanvasFeature;
}

function isPolygonGeometry(feature: AnnotationCanvasFeature): boolean {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

function normalizePosition(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function normalizeRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring: Ring = [];
  for (const entry of value) {
    const position = normalizePosition(entry);
    if (!position) return null;
    ring.push(position);
  }
  if (ring.length < 4) return null;
  return ring;
}

function normalizePolygon(value: unknown): PolygonCoordinates | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const polygon: PolygonCoordinates = [];
  for (const entry of value) {
    const ring = normalizeRing(entry);
    if (!ring) return null;
    polygon.push(ring);
  }
  return polygon;
}

function toMultiPolygon(feature: AnnotationCanvasFeature): MultiPolygonCoordinates | null {
  if (feature.geometry.type === "Polygon") {
    const polygon = normalizePolygon(feature.geometry.coordinates);
    return polygon ? [polygon] : null;
  }
  if (feature.geometry.type === "MultiPolygon") {
    if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length === 0) return null;
    const polygons: MultiPolygonCoordinates = [];
    for (const entry of feature.geometry.coordinates) {
      const polygon = normalizePolygon(entry);
      if (!polygon) return null;
      polygons.push(polygon);
    }
    return polygons;
  }
  return null;
}

function fromMultiPolygonCoordinates(coordinates: MultiPolygonCoordinates): AnnotationCanvasFeature["geometry"] | null {
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) {
    return { type: "Polygon", coordinates: coordinates[0] };
  }
  return { type: "MultiPolygon", coordinates };
}

function geometriesOverlap(left: AnnotationCanvasFeature, right: AnnotationCanvasFeature): boolean {
  const leftPolygons = toMultiPolygon(left);
  const rightPolygons = toMultiPolygon(right);
  if (!leftPolygons || !rightPolygons) return false;
  const intersection = polygonClipping.intersection(leftPolygons, rightPolygons) as MultiPolygonCoordinates;
  return Array.isArray(intersection) && intersection.length > 0;
}

function unionFeatures(features: AnnotationCanvasFeature[]): AnnotationCanvasFeature["geometry"] | null {
  const polygons = features
    .map((feature) => toMultiPolygon(feature))
    .filter((value): value is MultiPolygonCoordinates => value != null);
  if (polygons.length === 0) return null;
  let merged = polygons[0];
  for (let index = 1; index < polygons.length; index += 1) {
    merged = polygonClipping.union(merged, polygons[index]) as MultiPolygonCoordinates;
  }
  return fromMultiPolygonCoordinates(merged);
}

function subtractFeature(subject: AnnotationCanvasFeature, cutter: AnnotationCanvasFeature): AnnotationCanvasFeature["geometry"] | null {
  const subjectPolygons = toMultiPolygon(subject);
  const cutterPolygons = toMultiPolygon(cutter);
  if (!subjectPolygons || !cutterPolygons) return null;
  const difference = polygonClipping.difference(subjectPolygons, cutterPolygons) as MultiPolygonCoordinates;
  return fromMultiPolygonCoordinates(difference);
}

function shapeTypeForFeature(feature: AnnotationCanvasFeature): string {
  return String(feature.properties?.shapeType ?? feature.geometry.type ?? "annotation");
}

function buildFeature(
  base: AnnotationCanvasFeature,
  geometry: AnnotationCanvasFeature["geometry"],
  overrides?: Partial<AnnotationCanvasFeature>
): AnnotationCanvasFeature {
  return {
    ...cloneFeature(base),
    ...overrides,
    geometry,
    properties: {
      ...base.properties,
      ...overrides?.properties
    }
  };
}

function annotationLayerId(feature: AnnotationCanvasFeature): string | null {
  const raw = feature.properties?.layerId;
  return typeof raw === "string" ? raw : null;
}

export function applyAnnotationBooleanOperation(args: {
  previousFeatures: AnnotationCanvasFeature[];
  updatedFeatures: AnnotationCanvasFeature[];
  operation: AnnotationBooleanMode;
  activeLayerId: string | null;
}): AnnotationCanvasFeature[] {
  const { previousFeatures, updatedFeatures, operation, activeLayerId } = args;
  if (operation === "create") {
    return updatedFeatures.map(cloneFeature);
  }

  const previousIds = new Set(previousFeatures.map((feature) => feature.id).filter((value): value is string => Boolean(value)));
  const created = updatedFeatures.filter((feature) => !feature.id || !previousIds.has(String(feature.id)));
  const latestCreated = [...created].reverse().find((feature) => isPolygonGeometry(feature));
  if (!latestCreated) {
    return updatedFeatures.map(cloneFeature);
  }

  const targetLayerId = activeLayerId ?? annotationLayerId(latestCreated);
  const baseFeatures = updatedFeatures.filter((feature) => feature.id && previousIds.has(String(feature.id))).map(cloneFeature);
  const sameLayerExisting = baseFeatures.filter((feature) => annotationLayerId(feature) === targetLayerId && isPolygonGeometry(feature));
  const overlapping = sameLayerExisting.filter((feature) => geometriesOverlap(feature, latestCreated));

  if (operation === "merge") {
    if (overlapping.length === 0) {
      return updatedFeatures.map(cloneFeature);
    }
    const mergedGeometry = unionFeatures([...overlapping, latestCreated]);
    if (!mergedGeometry) {
      return updatedFeatures.map(cloneFeature);
    }
    const retainedIds = new Set(overlapping.map((feature) => String(feature.id)));
    const survivors = baseFeatures.filter((feature) => !retainedIds.has(String(feature.id)));
    const primary = overlapping[0];
    survivors.push(
      buildFeature(primary, mergedGeometry, {
        id: primary.id,
        properties: {
          ...primary.properties,
          layerId: targetLayerId ?? primary.properties?.layerId,
          shapeType: shapeTypeForFeature(latestCreated)
        }
      })
    );
    return survivors;
  }

  if (operation === "subtract") {
    if (overlapping.length === 0) {
      return baseFeatures;
    }
    const retainedIds = new Set(overlapping.map((feature) => String(feature.id)));
    const survivors = baseFeatures.filter((feature) => !retainedIds.has(String(feature.id)));
    for (const feature of overlapping) {
      const nextGeometry = subtractFeature(feature, latestCreated);
      if (!nextGeometry) {
        continue;
      }
      if (nextGeometry.type === "Polygon") {
        survivors.push(buildFeature(feature, nextGeometry));
        continue;
      }
      const polygons = nextGeometry.coordinates as MultiPolygonCoordinates;
      polygons.forEach((polygon, index) => {
        survivors.push(
          buildFeature(
            feature,
            { type: "Polygon", coordinates: polygon },
            { id: index === 0 ? feature.id : crypto.randomUUID() }
          )
        );
      });
    }
    return survivors;
  }

  return updatedFeatures.map(cloneFeature);
}
