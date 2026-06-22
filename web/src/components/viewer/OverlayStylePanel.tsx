import { Eye, EyeOff } from "lucide-react";
import type { OverlayClassStyle, OverlayFeature, OverlaySource } from "../../domain/workspace";
import { defaultOverlayLegend, inferOverlaySemanticMode } from "../../viewer/overlayStyling";
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

export function OverlayStylePanel(props: Props) {
  const mode = inferOverlaySemanticMode(props.features, props.overlay);
  const items = defaultOverlayLegend(props.overlay, props.features, mode);
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
        {items.length === 0 ? <div className="workspace-empty">No styleable classes found.</div> : null}
        {items.map((item) => {
          const style = props.styles[item.key] ?? { color: item.color, opacity: 0.35, strokeWidth: 2 };
          const hidden = style.hidden ?? false;
          return (
            <div key={item.key} className="workspace-card" style={{ opacity: hidden ? 0.45 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong>{item.label}</strong>
                <button
                  type="button"
                  className="workspace-toolbar__button"
                  style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                  title={hidden ? "Show class" : "Hide class"}
                  onClick={() => props.onStyleChange(item.key, { ...style, hidden: !hidden })}
                >
                  {hidden
                    ? <EyeOff size={14} strokeWidth={1.8} />
                    : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Color
                <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: style.color,
                      border: "1px solid rgba(0,0,0,0.25)",
                      cursor: "pointer"
                    }}
                  />
                  <input
                    type="color"
                    value={style.color}
                    onChange={(event) => props.onStyleChange(item.key, { ...style, color: event.target.value })}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%", padding: 0, border: "none" }}
                  />
                </span>
                <code style={{ fontSize: 11, opacity: 0.7 }}>{style.color}</code>
              </label>
              <label>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Opacity</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{Math.round(style.opacity * 100)}%</span>
                </span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={style.opacity}
                  onChange={(event) => props.onStyleChange(item.key, { ...style, opacity: Number(event.target.value) })}
                />
              </label>
            </div>
          );
        })}
      </div>
    </FloatingPanelFrame>
  );
}
