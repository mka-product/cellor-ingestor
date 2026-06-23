import type { ViewerManifest } from "../domain/contracts";
import { ViewerWorkspace } from "./viewer/ViewerWorkspace";
export { tileBounds, visibleSlideWindow } from "./viewer/viewerMath";

type Props = {
  manifest: ViewerManifest;
  initialViewport?: { cx: number; cy: number; zoom: number } | null;
  initialAnnotationId?: string | null;
  initialOverlayIds?: string[];
  userId?: string;
  displayName?: string;
  accessToken?: string;
};

export function Viewer({ manifest, initialViewport, initialAnnotationId, initialOverlayIds, userId, displayName, accessToken }: Props) {
  return (
    <ViewerWorkspace
      manifest={manifest}
      initialViewport={initialViewport}
      initialAnnotationId={initialAnnotationId}
      initialOverlayIds={initialOverlayIds}
      userId={userId}
      displayName={displayName}
      accessToken={accessToken}
    />
  );
}
