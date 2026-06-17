type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleMetadata: () => void;
  onToggleOverlays: () => void;
  onToggleAnnotations: () => void;
  onToggleHelp: () => void;
  onToggleFullscreen: () => void;
  metadataOpen: boolean;
  overlaysOpen: boolean;
  annotationsOpen: boolean;
  helpOpen: boolean;
  fullscreen: boolean;
  tool: string;
  onToolChange: (tool: string) => void;
};

const TOOLS = [
  { id: "view", label: "View", title: "View" },
  { id: "modify", label: "Select", title: "Select" },
  { id: "point", label: "Point", title: "Point" },
  { id: "line", label: "Line", title: "Line" },
  { id: "rectangle", label: "Rect", title: "Rectangle" },
  { id: "polygon", label: "Poly", title: "Polygon" }
];

export function ViewerToolbar(props: Props) {
  return (
    <div className="workspace-toolbar">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={props.tool === tool.id ? "is-active" : undefined}
          onClick={() => props.onToolChange(tool.id)}
          title={tool.title}
        >
          {tool.label}
        </button>
      ))}
      <button type="button" onClick={props.onZoomOut} title="Zoom Out">
        Zoom Out
      </button>
      <button type="button" onClick={props.onZoomIn} title="Zoom In">
        Zoom In
      </button>
      <button type="button" onClick={props.onReset} title="Reset View">
        Reset
      </button>
      <button type="button" className={props.metadataOpen ? "is-active" : undefined} onClick={props.onToggleMetadata} title="Metadata">
        Metadata
      </button>
      <button type="button" className={props.overlaysOpen ? "is-active" : undefined} onClick={props.onToggleOverlays} title="Overlays">
        Overlays
      </button>
      <button
        type="button"
        className={props.annotationsOpen ? "is-active" : undefined}
        onClick={props.onToggleAnnotations}
        title="Annotations"
      >
        Annotations
      </button>
      <button type="button" className={props.helpOpen ? "is-active" : undefined} onClick={props.onToggleHelp} title="Shortcuts">
        Help
      </button>
      <button type="button" className={props.fullscreen ? "is-active" : undefined} onClick={props.onToggleFullscreen} title="Fullscreen">
        Fullscreen
      </button>
    </div>
  );
}
