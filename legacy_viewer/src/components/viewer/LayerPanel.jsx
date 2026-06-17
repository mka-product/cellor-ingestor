import React, { useState, useEffect, useRef } from 'react';
import { annotationsApi } from '../../api/annotations';

export function LayerPanel({ slideId, isOpen, onClose, activeLayerId, onSelectLayer, onSelectAnnotation, annotator, onDraw, selectedAnnotation, onDeleteLayer, lastAnnotationUpdate }) {
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [layers, setLayers] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [expandedLayers, setExpandedLayers] = useState({});
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editName, setEditName] = useState("");
  
  // New state for creating layer
  const [isCreatingLayer, setIsCreatingLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState("");
  
  // New state for delete confirmation
  const [deleteConfirmation, setDeleteConfirmation] = useState(null); // { id: string, name: string }

  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const panelRef = useRef(null);
  
  const fetchAnnotations = async () => {
    try {
        const fetchedAnnotations = await annotationsApi.getAnnotations(slideId);
        setAnnotations(fetchedAnnotations);
    } catch (err) {
        console.error("Failed to refresh annotations", err);
    }
  };

  // Fetch data
  useEffect(() => {
    if (!slideId || !isOpen) return;
    
    const fetchData = async () => {
        try {
            const [fetchedLayers, fetchedAnnotations] = await Promise.all([
                annotationsApi.getLayers(slideId),
                annotationsApi.getAnnotations(slideId)
            ]);
            setLayers(fetchedLayers);
            setAnnotations(fetchedAnnotations);
            
            // Expand all by default if first load
            if (Object.keys(expandedLayers).length === 0) {
                const initialExpanded = {};
                fetchedLayers.forEach(l => initialExpanded[l.id] = true);
                setExpandedLayers(initialExpanded);
            }
        } catch (err) {
            console.error("Failed to load layers/annotations for panel", err);
        }
    };
    
    fetchData();
  }, [slideId, isOpen, lastAnnotationUpdate]);

  // React to selectedAnnotation updates (e.g. label change)
  useEffect(() => {
      if (selectedAnnotation) {
          setAnnotations(prev => {
              const index = prev.findIndex(a => a.id === selectedAnnotation.id);
              if (index >= 0) {
                  // Update existing
                  const newAnns = [...prev];
                  newAnns[index] = selectedAnnotation;
                  return newAnns;
              } else {
                  // Add new annotation if not found (e.g. newly created)
                  return [...prev, selectedAnnotation];
              }
          });
      }
  }, [selectedAnnotation]);

  // Drag logic
  useEffect(() => {
      return () => {
          dragRef.current.active = false;
      };
  }, [isOpen]);

  const handlePointerDown = (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      
      dragRef.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          initialX: position.x,
          initialY: position.y
      };
      
      const handleMove = (ev) => {
          if (!dragRef.current.active) return;
          const dx = ev.clientX - dragRef.current.startX;
          const dy = ev.clientY - dragRef.current.startY;
          setPosition({ 
              x: dragRef.current.initialX + dx, 
              y: dragRef.current.initialY + dy 
          });
      };
      
      const handleUp = () => {
          dragRef.current.active = false;
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
      };
      
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
  };

  const handleCreateLayerStart = () => {
      setIsCreatingLayer(true);
      setNewLayerName("");
  };

  const submitCreateLayer = async () => {
      if (!newLayerName.trim()) {
          setIsCreatingLayer(false);
          return;
      }
      try {
          const newLayer = await annotationsApi.createLayer(slideId, {
              name: newLayerName,
              type: "manual",
              visible_by_default: true,
              opacity: 1.0
          });
          setLayers([...layers, newLayer]);
          setExpandedLayers({...expandedLayers, [newLayer.id]: true});
          onSelectLayer(newLayer.id);
      } catch (err) {
          console.error("Failed to create layer", err);
      } finally {
          setIsCreatingLayer(false);
          setNewLayerName("");
      }
  };

  const handleRenameLayer = async (layerId) => {
      if (!editName.trim()) {
        setEditingLayerId(null);
        return;
      }
      try {
          const updated = await annotationsApi.updateLayer(layerId, { name: editName });
          setLayers(layers.map(l => l.id === layerId ? updated : l));
      } catch (err) {
          console.error("Failed to rename layer", err);
      } finally {
          setEditingLayerId(null);
      }
  };

  const handleDeleteClick = (layer) => {
      setDeleteConfirmation({ id: layer.id, name: layer.name });
  };

  const cancelDelete = () => {
      setDeleteConfirmation(null);
  };

  const confirmDelete = async () => {
      if (!deleteConfirmation) return;
      const layerId = deleteConfirmation.id;
      
      try {
          await annotationsApi.deleteLayer(layerId);
          setLayers(layers.filter(l => l.id !== layerId));
          if (activeLayerId === layerId) {
              const remaining = layers.filter(l => l.id !== layerId);
              if (remaining.length > 0) onSelectLayer(remaining[0].id);
              else onSelectLayer(null);
          }
          setAnnotations(annotations.filter(a => a.properties?.layerId !== layerId));
          if (annotator) {
              const toRemove = annotations.filter(a => a.properties?.layerId === layerId);
              toRemove.forEach(a => annotator.removeAnnotation(a.id));
          }
          if (onDeleteLayer) {
             onDeleteLayer(layerId);
          }
      } catch (err) {
          console.error("Failed to delete layer", err);
      } finally {
          setDeleteConfirmation(null);
      }
  };

  const toggleExpand = (layerId) => {
      setExpandedLayers(prev => ({...prev, [layerId]: !prev[layerId]}));
  };

  const annotationsByLayer = annotations.reduce((acc, ann) => {
      const lid = ann.properties?.layerId;
      if (lid) {
          if (!acc[lid]) acc[lid] = [];
          acc[lid].push(ann);
      }
      return acc;
  }, {});
  
  if (!isOpen) return null;

  return (
    <div 
        ref={panelRef}
        className="layer-panel"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div 
        className="layer-panel__header"
        onPointerDown={handlePointerDown}
      >
        <h3>Layers</h3>
        <div className="layer-panel__actions">
            <button 
                onClick={handleCreateLayerStart}
                title="Add Layer"
            >
                +
            </button>
            <button 
                onClick={onClose}
                className="layer-panel__close"
            >
                ×
            </button>
        </div>
      </div>

      <div className="layer-panel__content">
          {layers.map(layer => {
              const layerAnns = annotationsByLayer[layer.id] || [];
              const isExpanded = expandedLayers[layer.id];
              const isActive = activeLayerId === layer.id;
              const isEditing = editingLayerId === layer.id;

              return (
                  <div key={layer.id}>
                      <div 
                          className={`layer-item ${isActive ? 'layer-item--active' : ''}`}
                          onClick={() => onSelectLayer(layer.id)}
                      >
                          <button 
                              className="layer-item__toggle"
                              onClick={(e) => { e.stopPropagation(); toggleExpand(layer.id); }}
                          >
                              {isExpanded ? '▼' : '▶'}
                          </button>
                          
                          {isEditing ? (
                              <input 
                                  className="layer-item__input"
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  onBlur={() => handleRenameLayer(layer.id)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleRenameLayer(layer.id)}
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                              />
                          ) : (
                              <span 
                                  className="layer-item__name"
                                  onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setEditingLayerId(layer.id);
                                      setEditName(layer.name);
                                  }}
                              >
                                  {layer.name} <span className="layer-item__count">({layerAnns.length})</span>
                              </span>
                          )}

                          {onDraw && (
                              <button
                                  className="layer-item__action"
                                  onClick={(e) => { 
                                      e.stopPropagation(); 
                                      onSelectLayer(layer.id);
                                      onDraw(); // Call passed handler
                                  }}
                                  title="Add Annotation (Draw Polygon)"
                                  style={{
                                      opacity: isActive ? 1 : 0.4
                                  }}
                              >
                                  ✎
                              </button>
                          )}
                          
                          <button
                              className="layer-item__delete"
                              onClick={(e) => { e.stopPropagation(); handleDeleteClick(layer); }}
                              title="Delete Layer"
                          >
                              ×
                          </button>
                      </div>

                      {isExpanded && (
                          <div className="layer-annotations">
                              {layerAnns.length === 0 ? (
                                  <div className="layer-empty-msg">
                                      No annotations
                                  </div>
                              ) : (
                                  layerAnns.map(ann => {
                                      const labelBody = ann.bodies.find(b => b.purpose === 'tagging' || b.purpose === 'describing');
                                      const label = labelBody ? labelBody.value : 'Untitled';
                                      const type = ann.target.selector.type;
                                      
                                      // Check value body for tooltip
                                      const valueBody = ann.bodies.find(b => b.purpose === 'value');
                                      const valueText = valueBody ? valueBody.value : '';
                                      
                                      // Construct tooltip
                                      const tooltipText = valueText ? `${label}: ${valueText}` : label;
                                      
                                      return (
                                          <div 
                                              key={ann.id}
                                              className="layer-annotation-item"
                                              onClick={() => {
                                                  onSelectAnnotation(ann);
                                                  if (annotator) {
                                                      annotator.setSelected(ann.id);
                                                      annotator.fitBounds(ann.id);
                                                  }
                                              }}
                                              title={tooltipText} // Tooltip on hover in list
                                          >
                                              <span className="layer-annotation-icon">
                                                  {type === 'RECTANGLE' ? '⬜' : type === 'POLYGON' ? '⬠' : '•'}
                                              </span>
                                              {label}
                                          </div>
                                      );
                                  })
                              )}
                          </div>
                      )}
                  </div>
              );
          })}

          {/* New Layer Input */}
          {isCreatingLayer && (
            <div className="layer-item">
                <button className="layer-item__toggle">▶</button>
                <input 
                    className="layer-item__input"
                    type="text"
                    value={newLayerName}
                    placeholder="New Layer Name"
                    onChange={(e) => setNewLayerName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submitCreateLayer();
                        if (e.key === 'Escape') setIsCreatingLayer(false);
                    }}
                    onBlur={submitCreateLayer}
                    autoFocus
                />
            </div>
          )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
          <div className="layer-modal-overlay" onPointerDown={(e) => e.stopPropagation()}>
              <div className="layer-modal">
                  <h4>Delete Layer?</h4>
                  <p>
                      Are you sure you want to delete <strong>{deleteConfirmation.name}</strong>?<br/>
                      This will remove all annotations in this layer.
                  </p>
                  <div className="layer-modal-actions">
                      <button 
                          className="layer-modal-btn layer-modal-btn--cancel"
                          onClick={cancelDelete}
                      >
                          Cancel
                      </button>
                      <button 
                          className="layer-modal-btn layer-modal-btn--danger"
                          onClick={confirmDelete}
                      >
                          Delete
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
