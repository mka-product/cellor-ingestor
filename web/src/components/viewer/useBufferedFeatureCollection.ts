/*
Purpose: buffer transient editable-layer feature collection updates behind requestAnimationFrame.
Owner context: Viewer.
Invariants: only the latest transient frame is committed and committed updates bypass buffering.
Failure modes: pending transient frames are dropped during unmount to avoid stale setState work.
*/

import { useCallback, useEffect, useRef, useState } from "react";

type FeatureCollection = { type: "FeatureCollection"; features: Array<Record<string, unknown>> };

export function useBufferedFeatureCollection(initialValue: FeatureCollection) {
  const collectionRef = useRef<FeatureCollection>(initialValue);
  const pendingCollectionRef = useRef<FeatureCollection | null>(null);
  const frameRef = useRef<number | null>(null);
  const [collection, setCollection] = useState<FeatureCollection>(initialValue);

  const commitCollection = useCallback((nextCollection: FeatureCollection) => {
    collectionRef.current = nextCollection;
    setCollection(nextCollection);
  }, []);

  const scheduleCollectionUpdate = useCallback(
    (nextCollection: FeatureCollection) => {
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
