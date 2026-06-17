import React, { useEffect, useRef } from 'react';
import { ProgressBar } from 'primereact/progressbar';

/**
 * Draggable upload panel for new overlays.
 */
export default function OverlayUploadPanel({
  isOpen,
  onClose,
  onSubmit,
  status,
  uploading = false,
  progress = 0,
  position,
  setPosition
}) {
  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({ x: dragRef.current.initialX + dx, y: dragRef.current.initialY + dy });
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
  }, [setPosition]);

  const handlePointerDown = (e) => {
    if (e.target.closest('input') || e.target.closest('select') || e.target.closest('button')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
    const handlePointerMove = (evt) => {
      if (!dragRef.current.active) return;
      const dx = evt.clientX - dragRef.current.startX;
      const dy = evt.clientY - dragRef.current.startY;
      setPosition({ x: dragRef.current.initialX + dx, y: dragRef.current.initialY + dy });
    };
    const handlePointerUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  if (!isOpen) return null;

  return (
    <div
      className="annotation-panel"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: 320
      }}
    >
      <div className="annotation-panel__header" onPointerDown={handlePointerDown}>
        <h3>Upload Overlay</h3>
        <button className="annotation-panel__close" onClick={onClose} aria-label="Close upload panel">
          ×
        </button>
      </div>
      <div className="annotation-panel__content">
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="annotation-form-group">
            <label>Name (optional)</label>
            <input type="text" name="name" placeholder="Overlay name" disabled={uploading} />
          </div>
          <div className="annotation-form-group">
            <label>GeoJSON file</label>
            <input type="file" name="file" accept=".geojson,.json" disabled={uploading} />
          </div>
          {uploading && (
            <div className="upload-progress-container">
              <ProgressBar value={progress} showValue={false} />
              <span className="upload-progress-text">Uploading... {Math.round(progress)}%</span>
            </div>
          )}
          <div className="annotation-panel__actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="celnight-button celnight-button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="celnight-button" disabled={uploading}>
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
