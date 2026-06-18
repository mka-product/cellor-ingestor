import type { AvailableReader, CatalogSlide } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

function apiOrigin(): string | null {
  try {
    return new URL(API_BASE, window.location.origin).origin;
  } catch {
    return null;
  }
}

function resolveAssetUrl(path: string | null | undefined): string | null | undefined {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) {
    const origin = apiOrigin();
    return origin ? new URL(path, origin).toString() : path;
  }
  return path;
}

function resolveOptionalAssetUrl(path: string | null | undefined): string | undefined {
  return resolveAssetUrl(path) ?? undefined;
}

function normalizeManifest(manifest: ViewerManifest): ViewerManifest {
  return {
    ...manifest,
    levels: manifest.levels.map((level) => ({
      ...level,
      indexPath: resolveAssetUrl(level.indexPath) ?? level.indexPath
    })),
    artifacts: {
      ...manifest.artifacts,
      manifestPath: resolveAssetUrl(manifest.artifacts.manifestPath) ?? manifest.artifacts.manifestPath,
      thumbnailPath: resolveAssetUrl(manifest.artifacts.thumbnailPath) ?? manifest.artifacts.thumbnailPath,
      tissueMaskPath: resolveOptionalAssetUrl(manifest.artifacts.tissueMaskPath)
    }
  };
}

export async function fetchSlides(signal?: AbortSignal): Promise<CatalogSlide[]> {
  const response = await fetch(`${API_BASE}/slides`, { signal });
  if (!response.ok) {
    throw new Error(`slides request failed: ${response.status}`);
  }
  const slides = (await response.json()) as CatalogSlide[];
  return slides.map((slide) => ({
    ...slide,
    manifest_path: resolveAssetUrl(slide.manifest_path) ?? slide.manifest_path,
    thumbnail_path: resolveAssetUrl(slide.thumbnail_path) ?? slide.thumbnail_path
  }));
}

export async function fetchManifestContent(slideId: string, versionId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/slides/${slideId}/versions/${versionId}/manifest/content`, { signal });
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status}`);
  }
  return normalizeManifest((await response.json()) as ViewerManifest);
}

export async function fetchReaders(signal?: AbortSignal): Promise<AvailableReader[]> {
  const response = await fetch(`${API_BASE}/readers`, { signal });
  if (!response.ok) {
    throw new Error(`readers request failed: ${response.status}`);
  }
  return (await response.json()) as AvailableReader[];
}
