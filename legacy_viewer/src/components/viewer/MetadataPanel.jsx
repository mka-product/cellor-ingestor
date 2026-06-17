import React, { useState, useEffect, useRef } from 'react';

export function MetadataPanel({ metadata, isOpen, onClose }) {
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const panelRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerMove = (e) => {
      if (!dragRef.current.active) return;
      
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      
      setPosition({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy
      });
    };

    const handlePointerUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    if (dragRef.current.active) {
      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isOpen]); // Re-bind if open state changes, though mainly dependent on drag start

  const handlePointerDown = (e) => {
    // Only allow dragging from header
    if (e.target.closest('.metadata-panel__close')) return;
    
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
    
    // Attach listeners immediately to document to catch fast movements
    const handlePointerMove = (e) => {
        if (!dragRef.current.active) return;
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPosition({
          x: dragRef.current.initialX + dx,
          y: dragRef.current.initialY + dy
        });
    };
    
    const handlePointerUp = () => {
        dragRef.current.active = false;
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  if (!isOpen || !metadata) return null;

  // Flatten properties for display
  const properties = metadata.properties || {};
  const entries = Object.entries(properties);

  return (
    <div 
      ref={panelRef}
      className="metadata-panel"
      style={{ 
        transform: `translate(${position.x}px, ${position.y}px)` 
      }}
    >
      <div 
        className="metadata-panel__header"
        onPointerDown={handlePointerDown}
      >
        <h3>Slide Metadata</h3>
        <button className="metadata-panel__close" onClick={onClose}>×</button>
      </div>
      <div className="metadata-panel__content">
        <div className="metadata-group">
            <h4>Dimensions</h4>
            <div className="metadata-row">
                <span>Width</span>
                <span>{metadata.dimensions?.width} px</span>
            </div>
            <div className="metadata-row">
                <span>Height</span>
                <span>{metadata.dimensions?.height} px</span>
            </div>
        </div>
        
        {entries.length > 0 && (
            <div className="metadata-group">
                <h4>Properties</h4>
                {entries.map(([key, value]) => (
                    <div key={key} className="metadata-row">
                        <span title={key}>{key}</span>
                        <span title={String(value)}>{String(value)}</span>
                    </div>
                ))}
            </div>
        )}
      </div>
    </div>
  );
}

