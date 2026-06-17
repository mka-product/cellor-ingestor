import React, { useEffect, useRef, useState } from 'react';

/**
 * Draggable overlays list panel using the shared annotation panel styles.
 */
export default function OverlayListPanel({
  isOpen,
  overlays,
  loading,
  error,
  visibility = {},
  onToggle,
  onDelete,
  onEdit,
  featureCounts = {},
  onClose,
  onOpenUpload,
  position,
  setPosition
}) {
  const panelRef = useRef(null);
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
      ref={panelRef}
      className="annotation-panel overlay-panel"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: 320
      }}
    >
      <div className="annotation-panel__header" onPointerDown={handlePointerDown}>
        <h3>Overlays</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="annotation-panel__comment-btn"
            type="button"
            aria-label="Upload overlay"
            title="Upload overlay"
            onClick={(e) => {
              e.stopPropagation();
              onOpenUpload?.();
            }}
          >
            <span className="pi pi-upload" style={{ fontSize: '0.8rem' }} />
          </button>
          <button
            className="annotation-panel__close"
            type="button"
            aria-label="Close overlays panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="annotation-panel__content"
        style={{ maxHeight: '60vh', overflowY: 'auto', padding: '12px' }}
      >
        {loading && <div style={{ fontSize: 12 }}>Loading overlays…</div>}
        {error && <div style={{ fontSize: 12, color: 'var(--celnight-danger, #f87171)' }}>{error}</div>}
        {!loading && !error && overlays.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--celnight-text-secondary)' }}>No overlays yet.</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 8 }}>
          {overlays.map((ov) => (
            <div key={ov.id} style={{ padding: '8px', border: '1px solid var(--celnight-border-subtle)', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{ov.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--celnight-text-secondary)' }}>{ov.status || 'ready'}</div>
                  {typeof featureCounts[ov.id] === 'number' && (
                    <div style={{ fontSize: 11, color: 'var(--celnight-text-secondary)' }}>
                      Features: {featureCounts[ov.id]}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="annotation-panel__comment-btn"
                    aria-label={visibility[ov.id] ? 'Hide overlay' : 'Show overlay'}
                    title={visibility[ov.id] ? 'Hide overlay' : 'Show overlay'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle?.(ov);
                    }}
                    style={{ width: 26, height: 26, padding: 0 }}
                  >
                    <span className={visibility[ov.id] ? 'pi pi-eye' : 'pi pi-eye-slash'} style={{ fontSize: '0.8rem' }} />
                  </button>
                  <button
                    type="button"
                    className="annotation-panel__comment-btn"
                    aria-label="Edit overlay style"
                    title="Edit overlay style"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit?.(ov);
                    }}
                    style={{ width: 26, height: 26, padding: 0 }}
                  >
                    <span className="pi pi-cog" style={{ fontSize: '0.8rem' }} />
                  </button>
                  <button
                    type="button"
                    className="annotation-panel__comment-btn"
                    aria-label="Delete overlay"
                    title="Delete overlay"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(ov);
                    }}
                    style={{ width: 26, height: 26, padding: 0, color: 'var(--celnight-danger, #f87171)' }}
                  >
                    <span className="pi pi-trash" style={{ fontSize: '0.8rem' }} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
