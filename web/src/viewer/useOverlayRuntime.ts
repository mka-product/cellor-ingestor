/*
Purpose: own frontend overlay runtime orchestration for manifest loading, chunk planning, cache reuse, and inline fallback.
Owner context: Viewer.
Invariants: selected overlay changes reset runtime state; chunked overlays only retain viewport-relevant features in render state.
Failure modes: manifest or chunk failures degrade to empty overlay render state instead of breaking the viewer shell.
*/

import { useEffect, useMemo, useRef, useState } from "react";

import type { OverlayChunk, OverlayFeature, OverlayManifest } from "../domain/workspace";
import { fetchOverlayDetail } from "../infrastructure/workspaceClient";
import { OvsiChunkCache } from "./ovsiCache";
import { openOverlayRuntime } from "./ovsiClient";
import { loadOverlayChunk } from "./ovsiLoader";
import { planOverlayRuntime } from "./ovsiPlanner";
import type { OverlayWindow } from "./overlayManifest";

const OVERLAY_CHUNK_CACHE_CAPACITY = 24;

function deriveKind(type: unknown): OverlayFeature["kind"] {
  if (type === "Point" || type === "MultiPoint") return "point";
  if (type === "LineString" || type === "MultiLineString") return "polyline";
  return "polygon";
}

function normalizeOverlayFeatures(features: OverlayFeature[]): OverlayFeature[] {
  return features.map((feature) => ({
    ...feature,
    kind: deriveKind(feature.geometry.type)
  }));
}

export function useOverlayRuntime(slideId: string, overlayId: string | null, visibleWindow: OverlayWindow | null) {
  const [overlayManifest, setOverlayManifest] = useState<OverlayManifest | null>(null);
  const [overlayFeatures, setOverlayFeatures] = useState<OverlayFeature[]>([]);
  const [runtimeStats, setRuntimeStats] = useState({
    mode: "idle" as "idle" | "inline" | "chunked",
    visibleChunkCount: 0,
    cacheSize: 0,
    inflightChunkCount: 0,
    loadedFeatureCount: 0,
    runtimeFormat: "",
  });
  const chunkCacheRef = useRef(new OvsiChunkCache<OverlayFeature[]>(OVERLAY_CHUNK_CACHE_CAPACITY));
  const chunkInflightRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    if (!overlayId) {
      setOverlayManifest(null);
      setOverlayFeatures([]);
      setRuntimeStats({ mode: "idle", visibleChunkCount: 0, cacheSize: 0, inflightChunkCount: 0, loadedFeatureCount: 0, runtimeFormat: "" });
      chunkCacheRef.current.clear();
      chunkInflightRef.current.clear();
      return;
    }
    const controller = new AbortController();
    setOverlayManifest(null);
    setOverlayFeatures([]);
    setRuntimeStats({ mode: "idle", visibleChunkCount: 0, cacheSize: 0, inflightChunkCount: 0, loadedFeatureCount: 0, runtimeFormat: "" });
    chunkCacheRef.current.clear();
    chunkInflightRef.current.clear();
    openOverlayRuntime(slideId, overlayId, controller.signal)
      .then(async (manifest) => {
        setOverlayManifest(manifest);
        const plan = planOverlayRuntime(manifest, null);
        setRuntimeStats((current) => ({
          ...current,
          mode: plan.mode,
          runtimeFormat: manifest.runtimeFormat,
          visibleChunkCount: plan.chunks.length,
          cacheSize: chunkCacheRef.current.size(),
          inflightChunkCount: chunkInflightRef.current.size,
        }));
        if (plan.mode === "inline") {
          const payload = await fetchOverlayDetail(slideId, overlayId, controller.signal);
          const features = normalizeOverlayFeatures(payload.features);
          setOverlayFeatures(features);
          setRuntimeStats((current) => ({ ...current, loadedFeatureCount: features.length }));
        }
      })
      .catch(async () => {
        try {
          const payload = await fetchOverlayDetail(slideId, overlayId, controller.signal);
          const features = normalizeOverlayFeatures(payload.features);
          setOverlayFeatures(features);
          setRuntimeStats({
            mode: "inline",
            visibleChunkCount: 0,
            cacheSize: 0,
            inflightChunkCount: 0,
            loadedFeatureCount: features.length,
            runtimeFormat: "inline",
          });
        } catch {
          setOverlayManifest(null);
          setOverlayFeatures([]);
        }
      });
    return () => controller.abort();
  }, [overlayId, slideId]);

  const chunkPlan = useMemo(
    () => (overlayManifest ? planOverlayRuntime(overlayManifest, visibleWindow) : null),
    [overlayManifest, visibleWindow]
  );

  useEffect(() => {
    if (!overlayId || !overlayManifest || !chunkPlan || chunkPlan.mode !== "chunked") {
      return;
    }
    let cancelled = false;
    const chunkIds = chunkPlan.chunks.map((chunk) => chunk.id);

    const updateVisibleFeatures = () => {
      if (cancelled) return;
      const features = chunkIds.flatMap((chunkId) => chunkCacheRef.current.get(chunkId) ?? []);
      setOverlayFeatures(features);
      setRuntimeStats((current) => ({
        ...current,
        mode: "chunked",
        runtimeFormat: overlayManifest.runtimeFormat,
        visibleChunkCount: chunkIds.length,
        cacheSize: chunkCacheRef.current.size(),
        inflightChunkCount: chunkInflightRef.current.size,
        loadedFeatureCount: features.length,
      }));
    };

    chunkCacheRef.current.prune(chunkPlan.retainedChunkIds);
    updateVisibleFeatures();

    for (const chunk of chunkPlan.chunks) {
      if (chunkCacheRef.current.has(chunk.id) || chunkInflightRef.current.has(chunk.id)) {
        continue;
      }
      const job = loadOverlayChunk(slideId, overlayId, chunk)
        .then((payload: OverlayChunk) => {
          chunkCacheRef.current.set(chunk.id, normalizeOverlayFeatures(payload.features));
          chunkCacheRef.current.prune(chunkPlan.retainedChunkIds);
          updateVisibleFeatures();
        })
        .catch(() => undefined)
        .finally(() => {
          chunkInflightRef.current.delete(chunk.id);
          setRuntimeStats((current) => ({ ...current, inflightChunkCount: chunkInflightRef.current.size, cacheSize: chunkCacheRef.current.size() }));
        });
      chunkInflightRef.current.set(chunk.id, job);
      setRuntimeStats((current) => ({ ...current, inflightChunkCount: chunkInflightRef.current.size }));
    }

    return () => {
      cancelled = true;
    };
  }, [chunkPlan, overlayId, overlayManifest, slideId]);

  return { overlayManifest, overlayFeatures, runtimeStats };
}
