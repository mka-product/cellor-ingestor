import type { ViewerManifest } from "../domain/contracts";

export async function fetchManifest(url: string, signal?: AbortSignal): Promise<ViewerManifest> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`manifest request failed: ${response.status}`);
  }
  return (await response.json()) as ViewerManifest;
}

export async function fetchTileIndex(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`tile index request failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function fetchTileGroup(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`tile group request failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

export function buildTileGroupUrl(indexPath: string, groupId: number): string {
  const base = indexPath.replace(/\/index\.bin$/, "");
  return `${base}/groups/${groupId.toString().padStart(5, "0")}.tilepack`;
}
