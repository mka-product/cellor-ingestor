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
import type { OverlayLodThresholds, OverlayRenderMode } from "./overlayLod";

type StorageRepresentation = "raw" | "simplified" | "cluster";

const OVERLAY_CHUNK_CACHE_CAPACITY = 256;
const OVERLAY_REAL_FEATURE_BUDGET = 12000;
const OVERLAY_CHUNK_FETCH_BUDGET = 32;

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

function chooseRepresentationMode(
  manifest: OverlayManifest | null,
  window: OverlayWindow | null,
  scale?: number,
  lodThresholds?: OverlayLodThresholds
): OverlayRenderMode {
  if (!manifest || !window) return "raw";
  // Prefer pyramid-level-aware thresholds when the caller has the slide manifest.
  // These match the same logic used in buildOverlayRenderPlan so fetch and display are in sync.
  if (scale !== undefined && lodThresholds) {
    if (scale >= lodThresholds.rawScale) return "raw";
    if (scale >= lodThresholds.simplifiedScale) return "simplified";
    return "heatmap";
  }
  // Fallback: coverage-based thresholds when scale is not yet known.
  const overlayWidth = Math.max(1, manifest.bounds[2] - manifest.bounds[0]);
  const overlayHeight = Math.max(1, manifest.bounds[3] - manifest.bounds[1]);
  const viewportWidth = Math.max(1, window.right - window.left);
  const viewportHeight = Math.max(1, window.bottom - window.top);
  const coverage = (viewportWidth * viewportHeight) / (overlayWidth * overlayHeight);
  const extentRatio = Math.max(viewportWidth / overlayWidth, viewportHeight / overlayHeight);
  if (coverage >= 0.08 || extentRatio >= 0.3) return "heatmap";
  if (coverage >= 0.02 || extentRatio >= 0.14) return "simplified";
  return "raw";
}

function chooseBudgetSafeMode(
  requestedMode: OverlayRenderMode,
  visibleFeatureEstimate: number,
  visibleChunkCount: number
): OverlayRenderMode {
  if (requestedMode !== "raw") {
    return requestedMode;
  }
  if (visibleFeatureEstimate > OVERLAY_REAL_FEATURE_BUDGET * 4 || visibleChunkCount > OVERLAY_CHUNK_FETCH_BUDGET * 2) {
    return "heatmap";
  }
  if (visibleFeatureEstimate > OVERLAY_REAL_FEATURE_BUDGET || visibleChunkCount > OVERLAY_CHUNK_FETCH_BUDGET) {
    return "simplified";
  }
  return requestedMode;
}

export function useOverlayRuntime(
  slideId: string,
  overlayId: string | null,
  visibleWindow: OverlayWindow | null,
  overlayScale?: number,
  lodThresholds?: OverlayLodThresholds
) {
  const [overlayManifest, setOverlayManifest] = useState<OverlayManifest | null>(null);
  const [overlayFeatures, setOverlayFeatures] = useState<OverlayFeature[]>([]);
  const [runtimeStats, setRuntimeStats] = useState({
    mode: "idle" as "idle" | "inline" | "chunked",
    sourceMode: "real" as "real" | "over-budget",
    visibleChunkCount: 0,
    cacheSize: 0,
    inflightChunkCount: 0,
    loadedFeatureCount: 0,
    renderedInputFeatureCount: 0,
    loadedChunkCount: 0,
    visibleFeatureEstimate: 0,
    runtimeFormat: "",
    representationMode: "raw" as OverlayRenderMode,
  });
  const chunkCacheRef = useRef(new OvsiChunkCache<OverlayFeature[]>(OVERLAY_CHUNK_CACHE_CAPACITY));
  const chunkInflightRef = useRef<Map<string, Promise<void>>>(new Map());
  // Always holds the most-recent cacheKeys so stale promise callbacks read current viewport chunks.
  const currentCacheKeysRef = useRef<string[]>([]);

  useEffect(() => {
    if (!overlayId) {
      setOverlayManifest(null);
      setOverlayFeatures([]);
      setRuntimeStats({
        mode: "idle",
        sourceMode: "real",
        visibleChunkCount: 0,
        cacheSize: 0,
        inflightChunkCount: 0,
        loadedFeatureCount: 0,
        renderedInputFeatureCount: 0,
        loadedChunkCount: 0,
        visibleFeatureEstimate: 0,
        runtimeFormat: "",
        representationMode: "raw"
      });
      chunkCacheRef.current.clear();
      chunkInflightRef.current.clear();
      currentCacheKeysRef.current = [];
      return;
    }
    const controller = new AbortController();
    setOverlayManifest(null);
    setOverlayFeatures([]);
    setRuntimeStats({
      mode: "idle",
      sourceMode: "real",
      visibleChunkCount: 0,
      cacheSize: 0,
      inflightChunkCount: 0,
      loadedFeatureCount: 0,
      renderedInputFeatureCount: 0,
      loadedChunkCount: 0,
      visibleFeatureEstimate: 0,
      runtimeFormat: "",
      representationMode: "raw"
    });
    chunkCacheRef.current.clear();
    chunkInflightRef.current.clear();
    currentCacheKeysRef.current = [];
    openOverlayRuntime(slideId, overlayId, controller.signal)
      .then(async (manifest) => {
        setOverlayManifest(manifest);
        const plan = planOverlayRuntime(manifest, null);
        setRuntimeStats((current) => ({
          ...current,
          mode: plan.mode,
          sourceMode: "real",
          runtimeFormat: manifest.runtimeFormat,
          visibleChunkCount: plan.chunks.length,
          cacheSize: chunkCacheRef.current.size(),
          inflightChunkCount: chunkInflightRef.current.size,
          representationMode: chooseRepresentationMode(manifest, null, overlayScale, lodThresholds),
        }));
        if (plan.mode === "inline") {
          const payload = await fetchOverlayDetail(slideId, overlayId, controller.signal);
          const features = normalizeOverlayFeatures(payload.features);
          setOverlayFeatures(features);
          setRuntimeStats((current) => ({
            ...current,
            loadedFeatureCount: features.length,
            renderedInputFeatureCount: features.length,
            visibleFeatureEstimate: features.length,
            loadedChunkCount: 0,
            representationMode: "raw"
          }));
        }
      })
      .catch(async () => {
        try {
          const payload = await fetchOverlayDetail(slideId, overlayId, controller.signal);
          const features = normalizeOverlayFeatures(payload.features);
          setOverlayFeatures(features);
          setRuntimeStats({
            mode: "inline",
            sourceMode: "real",
            visibleChunkCount: 0,
            cacheSize: 0,
            inflightChunkCount: 0,
            loadedFeatureCount: features.length,
            renderedInputFeatureCount: features.length,
            loadedChunkCount: 0,
            visibleFeatureEstimate: features.length,
            runtimeFormat: "inline",
            representationMode: "raw",
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

  // Derive representation mode as a stable value that only changes when a threshold is crossed —
  // not on every sub-pixel viewport movement — so the chunk-loading effect stays calm during panning.
  const representationMode = useMemo(() => {
    if (!overlayManifest || !chunkPlan || chunkPlan.mode !== "chunked") return "raw" as OverlayRenderMode;
    const visibleFeatureEstimate = chunkPlan.chunks.reduce((sum, chunk) => sum + Number(chunk.featureCount ?? 0), 0);
    const requested = chooseRepresentationMode(overlayManifest, visibleWindow, overlayScale, lodThresholds);
    return chooseBudgetSafeMode(requested, visibleFeatureEstimate, chunkPlan.chunks.length);
  }, [chunkPlan, overlayManifest, visibleWindow, overlayScale, lodThresholds]);

  useEffect(() => {
    if (!overlayId || !overlayManifest || !chunkPlan || chunkPlan.mode !== "chunked") {
      return;
    }
    // Heatmap and cluster representations are already aggregated (60–100 features/chunk vs 785 raw),
    // so loading all visible chunks is safe. Only cap raw/simplified where polygon density is high.
    const chunksToLoad =
      representationMode === "raw" || representationMode === "simplified"
        ? chunkPlan.chunks.slice(0, OVERLAY_CHUNK_FETCH_BUDGET * 2)
        : chunkPlan.chunks;

    // For heatmap mode: load cluster chunks instead of precomputed heatmap chunks.
    // The frontend recomputes the hex grid at the current scale from cluster centroids (weighted by count),
    // giving an adaptive bin size that matches the actual viewport zoom rather than the fixed ingestion grid.
    // Cluster chunks are ~5× smaller than raw (37 vs 785 features) so this is efficient.
    const fetchRepresentation: StorageRepresentation =
      representationMode === "heatmap" ? "cluster" : representationMode;

    const chunkIds = chunksToLoad.map((chunk) => chunk.id);
    const visibleFeatureEstimate = chunksToLoad.reduce((sum, chunk) => sum + Number(chunk.featureCount ?? 0), 0);
    // Cache key uses fetchRepresentation so cluster-for-heatmap is cached independently.
    const cacheKeys = chunkIds.map((chunkId) => `${fetchRepresentation}:${chunkId}`);
    // Update the shared ref so that any in-flight promise completing after a plan change
    // still assembles features from the current viewport's chunk set.
    currentCacheKeysRef.current = cacheKeys;

    const isOverBudget =
      representationMode !== chooseRepresentationMode(overlayManifest, visibleWindow, overlayScale, lodThresholds);

    const updateVisibleFeatures = () => {
      // Read from the ref so stale closures (from old effect instances) still use current keys.
      const activeKeys = currentCacheKeysRef.current;
      const features = activeKeys.flatMap((cacheKey) => chunkCacheRef.current.get(cacheKey) ?? []);
      const loadedChunkCount = activeKeys.reduce((count, cacheKey) => count + (chunkCacheRef.current.has(cacheKey) ? 1 : 0), 0);
      setOverlayFeatures(features);
      setRuntimeStats((current) => ({
        ...current,
        mode: "chunked",
        sourceMode: isOverBudget ? "over-budget" : "real",
        runtimeFormat: overlayManifest.runtimeFormat,
        visibleChunkCount: chunkIds.length,
        cacheSize: chunkCacheRef.current.size(),
        inflightChunkCount: chunkInflightRef.current.size,
        loadedFeatureCount: features.length,
        renderedInputFeatureCount: features.length,
        loadedChunkCount,
        visibleFeatureEstimate,
        representationMode,
      }));
    };

    chunkCacheRef.current.prune(new Set(cacheKeys));
    updateVisibleFeatures();

    for (const chunk of chunksToLoad) {
      const cacheKey = `${fetchRepresentation}:${chunk.id}`;
      if (chunkCacheRef.current.has(cacheKey) || chunkInflightRef.current.has(cacheKey)) {
        continue;
      }
      const job = loadOverlayChunk(slideId, overlayId, chunk, fetchRepresentation)
        .then((payload: OverlayChunk) => {
          chunkCacheRef.current.set(cacheKey, normalizeOverlayFeatures(payload.features));
          chunkCacheRef.current.prune(new Set(currentCacheKeysRef.current));
          // Always update features when a chunk arrives — the ref ensures we assemble
          // the current viewport's set even if this promise outlived the effect that launched it.
          updateVisibleFeatures();
        })
        .catch(() => undefined)
        .finally(() => {
          chunkInflightRef.current.delete(cacheKey);
          setRuntimeStats((current) => ({ ...current, inflightChunkCount: chunkInflightRef.current.size, cacheSize: chunkCacheRef.current.size() }));
        });
      chunkInflightRef.current.set(cacheKey, job);
      setRuntimeStats((current) => ({ ...current, inflightChunkCount: chunkInflightRef.current.size }));
    }
    // Note: no cleanup cancellation here — in-flight chunks always complete and update the display.
    // The representationMode dep ensures re-runs when crossing mode thresholds, not on every pan frame.
  }, [chunkPlan, representationMode, overlayId, overlayManifest, slideId, overlayScale, lodThresholds]);

  return { overlayManifest, overlayFeatures, runtimeStats };
}
