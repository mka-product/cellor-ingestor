import type { AnnotationComment, AnnotationFeature, AnnotationLayer, OverlayFeature, OverlaySource } from "../domain/workspace";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function parseJson<T>(input: Promise<Response>): Promise<T> {
  const response = await input;
  if (!response.ok) {
    throw new Error(`workspace request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchOverlaySources(slideId: string, signal?: AbortSignal): Promise<OverlaySource[]> {
  return parseJson(fetch(`${API_BASE}/slides/${slideId}/overlays`, { signal }));
}

export async function fetchOverlayDetail(
  slideId: string,
  overlayId: string,
  signal?: AbortSignal
): Promise<{ id: string; name: string; kind: string; features: OverlayFeature[]; legend: Array<Record<string, unknown>> }> {
  return parseJson(fetch(`${API_BASE}/slides/${slideId}/overlays/${overlayId}`, { signal }));
}

export async function fetchAnnotationLayers(slideId: string, signal?: AbortSignal): Promise<AnnotationLayer[]> {
  return parseJson(fetch(`${API_BASE}/slides/${slideId}/annotation-layers`, { signal }));
}

export async function saveAnnotationLayer(
  slideId: string,
  payload: Partial<AnnotationLayer> & Pick<AnnotationLayer, "name" | "color" | "isVisible" | "isLocked">
): Promise<AnnotationLayer> {
  return parseJson(
    fetch(`${API_BASE}/slides/${slideId}/annotation-layers`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteAnnotationLayer(slideId: string, layerId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/slides/${slideId}/annotation-layers/${layerId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`delete annotation layer failed: ${response.status}`);
  }
}

export async function fetchAnnotations(slideId: string, signal?: AbortSignal): Promise<AnnotationFeature[]> {
  return parseJson(fetch(`${API_BASE}/slides/${slideId}/annotations`, { signal }));
}

export async function saveAnnotation(
  slideId: string,
  payload: Partial<AnnotationFeature> & Pick<AnnotationFeature, "layerId" | "geometry" | "properties" | "style">
): Promise<AnnotationFeature> {
  return parseJson(
    fetch(`${API_BASE}/slides/${slideId}/annotations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteAnnotation(slideId: string, annotationId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/slides/${slideId}/annotations/${annotationId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`delete annotation failed: ${response.status}`);
  }
}

export async function fetchComments(
  slideId: string,
  annotationId: string,
  signal?: AbortSignal
): Promise<AnnotationComment[]> {
  return parseJson(fetch(`${API_BASE}/slides/${slideId}/annotations/${annotationId}/comments`, { signal }));
}

export async function createComment(
  slideId: string,
  annotationId: string,
  body: string,
  author = "local-user",
  parentId: string | null = null
): Promise<AnnotationComment> {
  return parseJson(
    fetch(`${API_BASE}/slides/${slideId}/annotations/${annotationId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author, parentId })
    })
  );
}

export async function updateComment(
  slideId: string,
  annotationId: string,
  commentId: string,
  body: string,
  author = "local-user"
): Promise<AnnotationComment> {
  return parseJson(
    fetch(`${API_BASE}/slides/${slideId}/annotations/${annotationId}/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author })
    })
  );
}

export async function deleteComment(slideId: string, annotationId: string, commentId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/slides/${slideId}/annotations/${annotationId}/comments/${commentId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(`delete comment failed: ${response.status}`);
  }
}
