/*
Purpose: buffer transient editable-layer feature collection updates behind requestAnimationFrame.
Owner context: Viewer.
Invariants: only the latest transient frame is committed and committed updates bypass buffering.
Failure modes: pending transient frames are dropped during unmount to avoid stale setState work.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection as GeoJsonFeatureCollection, Geometry, GeoJsonProperties } from "geojson";

export type EditableGeoJsonFeature = Feature<Geometry, GeoJsonProperties>;
export type EditableGeoJsonFeatureCollection = GeoJsonFeatureCollection<Geometry, GeoJsonProperties>;

export function useBufferedFeatureCollection(initialValue: EditableGeoJsonFeatureCollection) {
  const collectionRef = useRef<EditableGeoJsonFeatureCollection>(initialValue);
  const pendingCollectionRef = useRef<EditableGeoJsonFeatureCollection | null>(null);
  const frameRef = useRef<number | null>(null);
  const [collection, setCollection] = useState<EditableGeoJsonFeatureCollection>(initialValue);

  const commitCollection = useCallback((nextCollection: EditableGeoJsonFeatureCollection) => {
    collectionRef.current = nextCollection;
    setCollection(nextCollection);
  }, []);

  const scheduleCollectionUpdate = useCallback(
    (nextCollection: EditableGeoJsonFeatureCollection) => {
      pendingCollectionRef.current = nextCollection;
      if (frameRef.current != null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingCollectionRef.current;
        pendingCollectionRef.current = null;
        if (pending) {
          commitCollection(pending);
        }
      });
    },
    [commitCollection]
  );

  useEffect(
    () => () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    },
    []
  );

  return {
    collection,
    collectionRef,
    commitCollection,
    scheduleCollectionUpdate
  };
}
