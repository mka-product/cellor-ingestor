import { Fragment } from "react";

import { FloatingPanelFrame } from "./FloatingPanelFrame";

const SHORTCUTS: Array<[string, string]> = [
  ["?", "Toggle shortcut help"],
  ["M", "Toggle metadata panel"],
  ["O", "Toggle overlays panel"],
  ["A", "Toggle annotations panel"],
  ["F", "Toggle fullscreen"],
  ["+", "Zoom in"],
  ["-", "Zoom out"],
  ["0", "Reset view"],
  ["Esc", "Clear selection and close secondary panels"],
  ["1-6", "Switch annotation tool"]
];

type Props = {
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
};

export function WorkspaceShortcuts(props: Props) {
  return (
    <FloatingPanelFrame
      panelId="shortcuts"
      title="Shortcuts"
      position={props.position}
      zIndex={props.zIndex}
      subtitle="Ignored while typing in inputs or textareas."
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
    >
      <div className="workspace-help-grid">
        {SHORTCUTS.map(([key, label]) => (
          <Fragment key={key}>
            <span className="workspace-kbd">{key}</span>
            <span>{label}</span>
          </Fragment>
        ))}
      </div>
    </FloatingPanelFrame>
  );
}
