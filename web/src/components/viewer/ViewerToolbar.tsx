import type { AnnotationBooleanMode } from "../../viewer/annotationBoolean";
import {
  BringToFront,
  CircleHelp,
  Hand,
  Info,
  Layers3,
  Maximize2,
  MessageSquarePlus,
  MinusSquare,
  MousePointer2,
  PenLine,
  Radar,
  RotateCcw,
  SquarePlus,
  SquaresUnite,
  ZoomIn,
  ZoomOut
} from "lucide-react";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleMetadata: () => void;
  onToggleOverlays: () => void;
  onToggleAnnotations: () => void;
  onToggleHelp: () => void;
  onToggleFullscreen: () => void;
  onTogglePresence: () => void;
  metadataOpen: boolean;
  overlaysOpen: boolean;
  annotationsOpen: boolean;
  helpOpen: boolean;
  fullscreen: boolean;
  presenceEnabled: boolean;
  presenceStatus: "off" | "connecting" | "connected" | "unavailable";
  tool: string;
  onToolChange: (tool: string) => void;
  annotationOperation: AnnotationBooleanMode;
  effectiveAnnotationOperation: AnnotationBooleanMode;
  onAnnotationOperationChange: (operation: AnnotationBooleanMode) => void;
};

const TOOLS = [
  { id: "view", title: "Navigate", icon: Hand },
  { id: "modify", title: "Select", icon: MousePointer2 },
  { id: "line", title: "Line", icon: PenLine },
  { id: "polygon", title: "Polygon", icon: BringToFront }
];

const BOOLEAN_OPERATIONS: Array<{
  id: AnnotationBooleanMode;
  title: string;
  icon: typeof SquarePlus;
}> = [
  { id: "create", title: "Create independent annotations", icon: SquarePlus },
  { id: "merge", title: "Merge overlapping annotations", icon: SquaresUnite },
  { id: "subtract", title: "Subtract overlapping annotations", icon: MinusSquare }
];

const VIEW_ACTIONS: Array<{
  id: "zoom-out" | "zoom-in" | "reset" | "fullscreen";
  title: string;
  icon: typeof ZoomOut;
}> = [
  { id: "zoom-out", title: "Zoom Out", icon: ZoomOut },
  { id: "zoom-in", title: "Zoom In", icon: ZoomIn },
  { id: "reset", title: "Reset View", icon: RotateCcw },
  { id: "fullscreen", title: "Fullscreen", icon: Maximize2 }
];

const PANEL_ACTIONS = [
  { id: "metadata", title: "Metadata", icon: Info },
  { id: "overlays", title: "Overlays", icon: Layers3 },
  { id: "annotations", title: "Annotations", icon: MessageSquarePlus },
  { id: "presence", title: "Share Cursor", icon: Radar },
  { id: "help", title: "Shortcuts", icon: CircleHelp }
];

export function ViewerToolbar(props: Props) {
  const presenceLabel =
    props.presenceStatus === "connecting"
      ? "Presence connecting"
      : props.presenceStatus === "connected"
        ? "Presence connected"
        : props.presenceStatus === "unavailable"
          ? "Presence unavailable"
          : "Presence off";

  const renderActionButton = (
    action: { id: string; title: string; icon: typeof ZoomOut },
    className = "workspace-toolbar__button"
  ) => {
    const Icon = action.icon;
    const isActive =
      action.id === "metadata"
        ? props.metadataOpen
        : action.id === "overlays"
          ? props.overlaysOpen
          : action.id === "annotations"
            ? props.annotationsOpen
            : action.id === "presence"
              ? props.presenceEnabled
            : action.id === "help"
              ? props.helpOpen
              : props.fullscreen;
    const onClick =
      action.id === "zoom-out"
        ? props.onZoomOut
        : action.id === "zoom-in"
          ? props.onZoomIn
          : action.id === "reset"
            ? props.onReset
            : action.id === "metadata"
              ? props.onToggleMetadata
              : action.id === "overlays"
                ? props.onToggleOverlays
                : action.id === "annotations"
                  ? props.onToggleAnnotations
                  : action.id === "presence"
                    ? props.onTogglePresence
                    : action.id === "help"
                      ? props.onToggleHelp
                      : props.onToggleFullscreen;

    return (
      <button
        key={action.id}
        type="button"
        className={`${className}${isActive ? " is-active" : ""}`}
        onClick={onClick}
        title={action.id === "presence" ? `${action.title} · ${presenceLabel}` : action.title}
        aria-label={action.id === "presence" ? `${action.title} · ${presenceLabel}` : action.title}
      >
        <Icon className="workspace-toolbar__icon" strokeWidth={1.8} />
      </button>
    );
  };

  return (
    <>
      <div className="workspace-toolbar workspace-toolbar--left">
        <div className="workspace-toolbar__section" aria-label="Tools">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                className={`workspace-toolbar__button${props.tool === tool.id ? " is-active" : ""}`}
                onClick={() => props.onToolChange(tool.id)}
                title={tool.title}
                aria-label={tool.title}
              >
                <Icon className="workspace-toolbar__icon" strokeWidth={1.8} />
              </button>
            );
          })}
        </div>
        <div className="workspace-toolbar__divider" />
        <div className="workspace-toolbar__section" aria-label="Annotation operation">
          {BOOLEAN_OPERATIONS.map((operation) => {
            const Icon = operation.icon;
            return (
              <button
                key={operation.id}
                type="button"
                className={[
                  "workspace-toolbar__button",
                  props.effectiveAnnotationOperation === operation.id ? "is-active" : "",
                  props.annotationOperation !== props.effectiveAnnotationOperation &&
                  props.annotationOperation === operation.id
                    ? "is-armed"
                    : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => props.onAnnotationOperationChange(operation.id)}
                title={operation.title}
                aria-label={operation.title}
              >
                <Icon className="workspace-toolbar__icon" strokeWidth={1.8} />
              </button>
            );
          })}
        </div>
        <div className="workspace-toolbar__divider" />
        <div className="workspace-toolbar__section" aria-label="Panels">
          {PANEL_ACTIONS.map((action) => renderActionButton(action))}
          <div className={`workspace-presence-indicator is-${props.presenceStatus}`} aria-live="polite">
            <span className="workspace-presence-indicator__dot" />
            <span>{presenceLabel}</span>
          </div>
        </div>
      </div>
      <div className="workspace-toolbar workspace-toolbar--bottom-right">
        <div className="workspace-toolbar__section" aria-label="View controls">
          {VIEW_ACTIONS.map((action) => renderActionButton(action, "workspace-toolbar__button workspace-toolbar__button--compact"))}
        </div>
      </div>
    </>
  );
}
