import type { AvailableReader, CatalogSlide } from "../domain/catalog";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export async function fetchSlides(signal?: AbortSignal): Promise<CatalogSlide[]> {
  const response = await fetch(`${API_BASE}/slides`, { signal });
  if (!response.ok) {
    throw new Error(`slides request failed: ${response.status}`);
  }
  return (await response.json()) as CatalogSlide[];
}

export async function fetchManifestContent(slideId: string, versionId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}/slides/${slideId}/versions/${versionId}/manifest/content`, { signal });
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchReaders(signal?: AbortSignal): Promise<AvailableReader[]> {
  const response = await fetch(`${API_BASE}/readers`, { signal });
  if (!response.ok) {
    throw new Error(`readers request failed: ${response.status}`);
  }
  return (await response.json()) as AvailableReader[];
}
