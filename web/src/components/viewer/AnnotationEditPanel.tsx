import type { AnnotationFeature, AnnotationLayer } from "../../domain/workspace";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  annotation: AnnotationFeature;
  layer: AnnotationLayer | null;
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onToggleComments: () => void;
  onDelete: () => void;
  onChange: (payload: { label: string; color: string; opacity: number; lineWidth: number }) => void;
  commentCount: number;
};

export function AnnotationEditPanel(props: Props) {
  const style = props.annotation.style ?? {};
  return (
    <FloatingPanelFrame
      panelId="annotation"
      title="Annotation"
      position={props.position}
      zIndex={props.zIndex}
      subtitle={props.layer ? `${props.layer.name} · ${String(props.annotation.geometry.type ?? "Unknown")}` : String(props.annotation.geometry.type ?? "Unknown")}
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
      actions={
        <>
          <button type="button" className="workspace-icon-button" onClick={props.onToggleComments} title="Comments">
            💬 {props.commentCount}
          </button>
          <button type="button" className="workspace-icon-button danger" onClick={props.onDelete} title="Delete annotation">
            ⌫
          </button>
        </>
      }
    >
      <div className="workspace-form-grid">
        <label>
          Label
          <input
            defaultValue={String(props.annotation.properties.label ?? "")}
            onBlur={(event) =>
              props.onChange({
                label: event.target.value,
                color: String(style.color ?? "#f97316"),
                opacity: Number(style.opacity ?? 0.25),
                lineWidth: Number(style.lineWidth ?? 2)
              })
            }
          />
        </label>
        <label>
          Color
          <input
            type="color"
            defaultValue={String(style.color ?? "#f97316")}
            onChange={(event) =>
              props.onChange({
                label: String(props.annotation.properties.label ?? ""),
                color: event.target.value,
                opacity: Number(style.opacity ?? 0.25),
                lineWidth: Number(style.lineWidth ?? 2)
              })
            }
          />
        </label>
        <label>
          Opacity
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            defaultValue={String(Number(style.opacity ?? 0.25))}
            onChange={(event) =>
              props.onChange({
                label: String(props.annotation.properties.label ?? ""),
                color: String(style.color ?? "#f97316"),
                opacity: Number(event.target.value),
                lineWidth: Number(style.lineWidth ?? 2)
              })
            }
          />
        </label>
        <label>
          Stroke
          <input
            type="range"
            min="1"
            max="8"
            step="1"
            defaultValue={String(Number(style.lineWidth ?? 2))}
            onChange={(event) =>
              props.onChange({
                label: String(props.annotation.properties.label ?? ""),
                color: String(style.color ?? "#f97316"),
                opacity: Number(style.opacity ?? 0.25),
                lineWidth: Number(event.target.value)
              })
            }
          />
        </label>
      </div>
    </FloatingPanelFrame>
  );
}
