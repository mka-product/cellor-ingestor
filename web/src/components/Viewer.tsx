import type { ViewerManifest } from "../domain/contracts";
import { ViewerWorkspace } from "./viewer/ViewerWorkspace";
export { tileBounds, visibleSlideWindow } from "./viewer/viewerMath";

type Props = {
  manifest: ViewerManifest;
};

export function Viewer({ manifest }: Props) {
  return <ViewerWorkspace manifest={manifest} />;
}
