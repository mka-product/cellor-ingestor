import { useState } from "react";

import type { AnnotationFeature, AnnotationLayer } from "../../domain/workspace";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  layers: AnnotationLayer[];
  annotations: AnnotationFeature[];
  activeLayerId: string | null;
  selectedAnnotationId: string | null;
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onCreateLayer: () => void;
  onSelectLayer: (layerId: string) => void;
  onToggleLayerVisibility: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onDeleteLayer: (layerId: string) => void;
  onSelectAnnotation: (annotationId: string) => void;
};

export function LayerPanel(props: Props) {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  return (
    <FloatingPanelFrame
      panelId="layers"
      title="Layers"
      position={props.position}
      zIndex={props.zIndex}
      subtitle={props.activeLayerId ? `Active layer ${props.activeLayerId}` : "Select the target layer for new annotations."}
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
      actions={
        <button type="button" className="workspace-icon-button" onClick={props.onCreateLayer} title="Add layer">
          +
        </button>
      }
    >
      <div className="workspace-list">
        {props.layers.map((layer) => {
          const layerAnnotations = props.annotations.filter((annotation) => annotation.layerId === layer.id);
          const isEditing = editingLayerId === layer.id;
          return (
            <div key={layer.id} className={`workspace-card ${props.activeLayerId === layer.id ? "is-active" : ""}`}>
              <div className="workspace-row">
                <button type="button" className="workspace-layer-main" onClick={() => props.onSelectLayer(layer.id)}>
                  {isEditing ? (
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => {
                        props.onRenameLayer(layer.id, draftName);
                        setEditingLayerId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          props.onRenameLayer(layer.id, draftName);
                          setEditingLayerId(null);
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <>
                      <strong>{layer.name}</strong>
                      <div className="workspace-panel__subtle">
                        {layerAnnotations.length} annotations · {layer.isVisible ? "visible" : "hidden"}
                      </div>
                    </>
                  )}
                </button>
                <div className="workspace-inline-actions">
                  <button type="button" className="workspace-icon-button" onClick={() => props.onToggleLayerVisibility(layer.id)} title="Toggle visibility">
                    {layer.isVisible ? "◉" : "○"}
                  </button>
                  <button
                    type="button"
                    className="workspace-icon-button"
                    onClick={() => {
                      setEditingLayerId(layer.id);
                      setDraftName(layer.name);
                    }}
                    title="Rename layer"
                  >
                    ✎
                  </button>
                  <button type="button" className="workspace-icon-button danger" onClick={() => props.onDeleteLayer(layer.id)} title="Delete layer">
                    ×
                  </button>
                </div>
              </div>
              {layerAnnotations.length > 0 ? (
                <div className="workspace-sublist">
                  {layerAnnotations.map((annotation) => (
                    <button
                      key={annotation.id}
                      type="button"
                      className={props.selectedAnnotationId === annotation.id ? "is-active" : undefined}
                      onClick={() => props.onSelectAnnotation(annotation.id)}
                    >
                      <strong>{String(annotation.properties.label ?? annotation.id)}</strong>
                      <div className="workspace-panel__subtle">{String(annotation.geometry.type ?? "Unknown")}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </FloatingPanelFrame>
  );
}
