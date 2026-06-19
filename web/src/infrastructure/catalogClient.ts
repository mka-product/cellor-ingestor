import type { AvailableReader, CatalogSlide, IngestionJob, OverlayJob } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";
import { resolveApiOrigin, resolveApiUrl } from "./apiBase";

function resolveAssetUrl(path: string | null | undefined): string | null | undefined {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) {
    const origin = resolveApiOrigin();
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
  const response = await fetch(resolveApiUrl("/slides"), { signal });
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
  const response = await fetch(resolveApiUrl(`/slides/${slideId}/versions/${versionId}/manifest/content`), { signal });
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status}`);
  }
  return normalizeManifest((await response.json()) as ViewerManifest);
}

export async function fetchReaders(signal?: AbortSignal): Promise<AvailableReader[]> {
  const response = await fetch(resolveApiUrl("/readers"), { signal });
  if (!response.ok) {
    throw new Error(`readers request failed: ${response.status}`);
  }
  return (await response.json()) as AvailableReader[];
}

export async function fetchJobs(signal?: AbortSignal): Promise<IngestionJob[]> {
  const response = await fetch(resolveApiUrl("/jobs"), { signal });
  if (!response.ok) {
    throw new Error(`jobs request failed: ${response.status}`);
  }
  return (await response.json()) as IngestionJob[];
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(resolveApiUrl(`/jobs/${jobId}`), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`job cancel failed: ${response.status}`);
  }
}

export async function uploadSlideFile(formData: FormData): Promise<IngestionJob> {
  const response = await fetch(resolveApiUrl("/uploads/file"), { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(`slide upload failed: ${response.status}`);
  }
  return (await response.json()) as IngestionJob;
}

export async function fetchOverlayJobs(signal?: AbortSignal): Promise<OverlayJob[]> {
  const response = await fetch(resolveApiUrl("/overlay-jobs"), { signal });
  if (!response.ok) {
    throw new Error(`overlay jobs request failed: ${response.status}`);
  }
  return (await response.json()) as OverlayJob[];
}

export async function uploadOverlayFile(formData: FormData): Promise<OverlayJob> {
  const response = await fetch(resolveApiUrl("/overlay-uploads/file"), { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(`overlay upload failed: ${response.status}`);
  }
  return (await response.json()) as OverlayJob;
}
