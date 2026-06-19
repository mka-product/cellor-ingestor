import { useState } from "react";

import type { ViewerManifest } from "../../domain/contracts";
import type { SlideTag } from "../../domain/workspace";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  manifest: ViewerManifest;
  tags: SlideTag[];
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onSaveTags: (tags: SlideTag[]) => void;
};

export function MetadataPanel({ manifest, tags, position, zIndex, onPositionChange, onBringToFront, onClose, onSaveTags }: Props) {
  const metadata = manifest.metadata;
  const metrics = manifest.provenance.metrics;
  const mppX = typeof metadata?.micronsPerPixel?.x === "number" ? metadata.micronsPerPixel.x.toFixed(3) : "?";
  const mppY = typeof metadata?.micronsPerPixel?.y === "number" ? metadata.micronsPerPixel.y.toFixed(3) : "?";
  const [nextTag, setNextTag] = useState("");

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
            {mppX} × {mppY} μm
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
      </dl>
      <div className="workspace-form-grid">
        <label>
          Tags
          <div className="workspace-tag-list">
            {tags.map((tag) => (
              <button
                key={tag.value}
                type="button"
                className="workspace-tag"
                style={{ borderColor: tag.color }}
                onClick={() => onSaveTags(tags.filter((item) => item.value !== tag.value))}
                title="Remove tag"
              >
                {tag.value}
              </button>
            ))}
          </div>
        </label>
        <label>
          Add tag
          <div className="workspace-inline-form">
            <input value={nextTag} onChange={(event) => setNextTag(event.target.value)} />
            <button
              type="button"
              className="workspace-button"
              onClick={() => {
                const value = nextTag.trim();
                if (!value) return;
                onSaveTags([...tags, { value, color: "#38bdf8" }]);
                setNextTag("");
              }}
            >
              Add
            </button>
          </div>
        </label>
      </div>
    </FloatingPanelFrame>
  );
}
