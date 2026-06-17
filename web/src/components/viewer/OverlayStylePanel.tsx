import type { OverlayClassStyle, OverlayFeature, OverlaySource } from "../../domain/workspace";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  overlay: OverlaySource;
  features: OverlayFeature[];
  styles: Record<string, OverlayClassStyle>;
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onStyleChange: (key: string, style: OverlayClassStyle) => void;
};

function classKey(feature: OverlayFeature) {
  return String(feature.properties.class ?? feature.properties.label ?? "default");
}

export function OverlayStylePanel(props: Props) {
  const keys = Array.from(new Set(props.features.map(classKey)));
  return (
    <FloatingPanelFrame
      panelId="overlay-style"
      title="Overlay Style"
      position={props.position}
      zIndex={props.zIndex}
      subtitle={props.overlay.name}
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
    >
      <div className="workspace-stack">
        {keys.length === 0 ? <div className="workspace-empty">No styleable classes found.</div> : null}
        {keys.map((key) => {
          const style = props.styles[key] ?? { color: "#38bdf8", opacity: 0.35, strokeWidth: 2 };
          return (
            <div key={key} className="workspace-card">
              <strong>{key}</strong>
              <label>
                Color
                <input type="color" value={style.color} onChange={(event) => props.onStyleChange(key, { ...style, color: event.target.value })} />
              </label>
              <label>
                Opacity
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={style.opacity}
                  onChange={(event) => props.onStyleChange(key, { ...style, opacity: Number(event.target.value) })}
                />
              </label>
              <label>
                Stroke
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={style.strokeWidth}
                  onChange={(event) => props.onStyleChange(key, { ...style, strokeWidth: Number(event.target.value) })}
                />
              </label>
            </div>
          );
        })}
      </div>
    </FloatingPanelFrame>
  );
}
