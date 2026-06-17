import type { ViewerManifest } from "../../domain/contracts";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  manifest: ViewerManifest;
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
};

export function MetadataPanel({ manifest, position, zIndex, onPositionChange, onBringToFront, onClose }: Props) {
  const metadata = manifest.metadata;
  const metrics = manifest.provenance.metrics;

  return (
    <FloatingPanelFrame
      panelId="metadata"
      title="Slide Metadata"
      position={position}
      zIndex={zIndex}
      subtitle={manifest.provenance.sourceName ?? manifest.slideId}
      onPositionChange={onPositionChange}
      onBringToFront={onBringToFront}
      onClose={onClose}
    >
      <dl className="workspace-metric-grid">
        <div className="workspace-metric">
          <dt>Vendor</dt>
          <dd>{metadata?.vendor ?? "Unknown"}</dd>
        </div>
        <div className="workspace-metric">
          <dt>Objective</dt>
          <dd>{metadata?.objectivePower ? `${metadata.objectivePower}x` : "Unknown"}</dd>
        </div>
        <div className="workspace-metric">
          <dt>MPP</dt>
          <dd>
            {metadata?.micronsPerPixel?.x ?? "?"} × {metadata?.micronsPerPixel?.y ?? "?"} μm
          </dd>
        </div>
        <div className="workspace-metric">
          <dt>Dimensions</dt>
          <dd>
            {manifest.width} × {manifest.height}
          </dd>
        </div>
        <div className="workspace-metric">
          <dt>Levels</dt>
          <dd>{metrics?.levelCount ?? manifest.levels.length}</dd>
        </div>
        <div className="workspace-metric">
          <dt>Tiles</dt>
          <dd>{metrics?.tileCount ?? "Unknown"}</dd>
        </div>
        <div className="workspace-metric">
          <dt>Checksum</dt>
          <dd>{manifest.provenance.sourceChecksum.slice(0, 12)}…</dd>
        </div>
      </dl>
    </FloatingPanelFrame>
  );
}
