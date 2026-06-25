import type {
  AnnotationComment,
  AnnotationFeature,
  AnnotationLayer,
  AnnotationReview,
  OverlayChunk,
  OverlayFeature,
  OverlayManifest,
  OverlaySource,
  SlideTag
} from "../domain/workspace";
import { authedFetch } from "../lib/authedFetch";
import { resolveApiAssetUrl, resolveApiUrl } from "./apiBase";

export class WorkspaceRequestError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, detail?: string) {
    super(detail ? `workspace request failed: ${status} (${detail})` : `workspace request failed: ${status}`);
    this.name = "WorkspaceRequestError";
    this.status = status;
    this.detail = detail;
  }
}

async function extractErrorDetail(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { detail?: string };
      return typeof payload.detail === "string" ? payload.detail : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const text = await response.text();
    return text || undefined;
  } catch {
    return undefined;
  }
}

async function parseJson<T>(input: Promise<Response>): Promise<T> {
  const response = await input;
  if (!response.ok) {
    throw new WorkspaceRequestError(response.status, await extractErrorDetail(response));
  }
  return (await response.json()) as T;
}

export async function fetchOverlaySources(slideId: string, signal?: AbortSignal): Promise<OverlaySource[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/overlays`), { signal }));
}

export async function deleteOverlay(slideId: string, overlayId: string): Promise<void> {
  const res = await authedFetch(resolveApiUrl(`/slides/${slideId}/overlays/${overlayId}`), { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE overlay failed: ${res.status}`);
}

export async function fetchOverlayDetail(
  slideId: string,
  overlayId: string,
  signal?: AbortSignal
): Promise<{
  id: string;
  name: string;
  kind: string;
  sourceFormat?: string;
  versionId?: string;
  metadata?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
  features: OverlayFeature[];
  legend: Array<Record<string, unknown>>;
}> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/overlays/${overlayId}`), { signal }));
}

export async function fetchOverlayManifest(slideId: string, overlayId: string, signal?: AbortSignal): Promise<OverlayManifest> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/overlays/${overlayId}/manifest`), { signal }));
}

export async function fetchOverlayChunk(
  slideId: string,
  overlayId: string,
  chunkId: string,
  representation?: "raw" | "simplified" | "cluster",
  signal?: AbortSignal
): Promise<OverlayChunk> {
  const query = representation ? `?representation=${representation}` : "";
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/overlays/${overlayId}/chunks/${chunkId}${query}`), { signal }));
}

export async function fetchOverlayChunkAtPath(chunkPath: string, signal?: AbortSignal): Promise<OverlayChunk> {
  return parseJson(authedFetch(resolveApiAssetUrl(chunkPath), { signal }));
}

export async function fetchAnnotationLayers(slideId: string, signal?: AbortSignal): Promise<AnnotationLayer[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/annotation-layers`), { signal }));
}

export async function saveAnnotationLayer(
  slideId: string,
  payload: Partial<AnnotationLayer> & Pick<AnnotationLayer, "name" | "color" | "isVisible" | "isLocked">
): Promise<AnnotationLayer> {
  return parseJson(
    authedFetch(resolveApiUrl(`/slides/${slideId}/annotation-layers`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteAnnotationLayer(slideId: string, layerId: string): Promise<void> {
  const response = await authedFetch(resolveApiUrl(`/slides/${slideId}/annotation-layers/${layerId}`), { method: "DELETE" });
  if (!response.ok) {
    throw new WorkspaceRequestError(response.status, await extractErrorDetail(response));
  }
}

export async function fetchAnnotations(slideId: string, signal?: AbortSignal): Promise<AnnotationFeature[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/annotations`), { signal }));
}

export async function saveAnnotation(
  slideId: string,
  payload: Partial<AnnotationFeature> & Pick<AnnotationFeature, "layerId" | "geometry" | "properties" | "style">
): Promise<AnnotationFeature> {
  return parseJson(
    authedFetch(resolveApiUrl(`/slides/${slideId}/annotations`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteAnnotation(slideId: string, annotationId: string): Promise<void> {
  const response = await authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}`), { method: "DELETE" });
  if (!response.ok) {
    throw new WorkspaceRequestError(response.status, await extractErrorDetail(response));
  }
}

export async function fetchComments(
  slideId: string,
  annotationId: string,
  signal?: AbortSignal
): Promise<AnnotationComment[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/comments`), { signal }));
}

export async function createComment(
  slideId: string,
  annotationId: string,
  body: string,
  author = "local-user",
  parentId: string | null = null
): Promise<AnnotationComment> {
  return parseJson(
    authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/comments`), {
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
    authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/comments/${commentId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author })
    })
  );
}

export async function deleteComment(slideId: string, annotationId: string, commentId: string): Promise<void> {
  const response = await authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/comments/${commentId}`), {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new WorkspaceRequestError(response.status, await extractErrorDetail(response));
  }
}

export async function fetchTags(slideId: string, signal?: AbortSignal): Promise<SlideTag[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/tags`), { signal }));
}

export async function saveTags(slideId: string, payload: SlideTag[]): Promise<SlideTag[]> {
  return parseJson(
    authedFetch(resolveApiUrl(`/slides/${slideId}/tags`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function fetchReviews(slideId: string, annotationId: string, signal?: AbortSignal): Promise<AnnotationReview[]> {
  return parseJson(authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/reviews`), { signal }));
}

export async function saveReview(
  slideId: string,
  annotationId: string,
  payload: Partial<AnnotationReview> & Pick<AnnotationReview, "status" | "reviewer" | "note">
): Promise<AnnotationReview> {
  const reviewId = payload.id ?? "new";
  return parseJson(
    authedFetch(resolveApiUrl(`/slides/${slideId}/annotations/${annotationId}/reviews/${reviewId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}
