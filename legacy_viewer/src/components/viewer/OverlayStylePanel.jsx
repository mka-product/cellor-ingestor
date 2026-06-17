import React, { useEffect, useRef } from 'react';
import { Button } from 'primereact/button';
export default function OverlayStylePanel({
  isOpen,
  overlay,
  data,
  styleState,
  onClose,
  onChangeClassStyle,
  onChangeScoreGradient,
  position,
  setPosition,
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
    if (e.target.closest('input') || e.target.closest('button') || e.target.closest('.p-colorpicker')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
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

  if (!isOpen || !overlay) return null;

  const classes = (data?.classes || []).map((label, idx) => ({ id: idx, label: label || `Class ${idx}` }));
  if (classes.length === 0 && data?.features?.length) {
    const uniq = Array.from(new Set(data.features.map((f) => f.classId ?? 0)));
    uniq.sort((a, b) => a - b);
    uniq.forEach((cid) => classes.push({ id: cid, label: `Class ${cid}` }));
  }

  const classStyles = styleState?.classStyles || {};
  const scoreGradient = styleState?.scoreGradient || { minColor: '#22c55e', maxColor: '#ef4444' };
  const hasScores = data?.features?.some((f) => typeof f.score === 'number');
  const hasClasses = classes.length > 0;
  const swatchStyle = {
    width: 36,
    height: 24,
    padding: 0,
    borderRadius: 6,
    border: '1px solid var(--celnight-border-subtle)',
    background: 'transparent',
    cursor: 'pointer',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    appearance: 'none',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
  };

  const hslToHex = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  };

  const defaultColor = (id) => {
    const hue = (id * 57) % 360;
    return hslToHex(hue, 70, 55);
  };

  return (
    <div
      ref={panelRef}
      className="annotation-panel overlay-panel"
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: 360,
      }}
    >
      <div className="annotation-panel__header" onPointerDown={handlePointerDown}>
        <h3>Overlay style</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="annotation-panel__close"
            type="button"
            aria-label="Close style panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="annotation-panel__content"
        style={{ maxHeight: '60vh', overflowY: 'auto', padding: 12 }}
      >
        <div style={{ marginBottom: 12, fontWeight: 600 }}>{overlay.name}</div>

        {hasScores && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Score gradient</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 11, width: 60 }}>Score 0</div>
              <div className="color-picker-wrapper" style={{ alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={scoreGradient.minColor}
                  onChange={(e) =>
                    onChangeScoreGradient?.({
                      minColor: e.target.value,
                      maxColor: scoreGradient.maxColor,
                    })
                  }
                  style={swatchStyle}
                />
                <span style={{ fontSize: 11 }}>{scoreGradient.minColor}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 11, width: 60 }}>Score 1</div>
              <div className="color-picker-wrapper" style={{ alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={scoreGradient.maxColor}
                  onChange={(e) =>
                    onChangeScoreGradient?.({
                      minColor: scoreGradient.minColor,
                      maxColor: e.target.value,
                    })
                  }
                  style={swatchStyle}
                />
                <span style={{ fontSize: 11 }}>{scoreGradient.maxColor}</span>
              </div>
            </div>
          </div>
        )}

        {hasClasses && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Classes</div>}
        {!hasClasses && <div style={{ fontSize: 12, color: 'var(--celnight-text-secondary)' }}>No classes found.</div>}
        {hasClasses && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {classes.map((c) => {
              const style = classStyles[c.id] || {};
              const color = style.color || defaultColor(c.id);
              const opacity = typeof style.opacity === 'number' ? style.opacity : 0.3;
              return (
                <div
                  key={c.id}
                  style={{
                    border: '1px solid var(--celnight-border-subtle)',
                    borderRadius: 6,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{c.label}</div>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        border: '1px solid #ccc',
                        background: color,
                        opacity,
                      }}
                    />
                  </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 11, width: 50 }}>Color</div>
                  <div className="color-picker-wrapper" style={{ alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) =>
                        onChangeClassStyle?.(c.id, {
                          color: e.target.value,
                          opacity,
                        })
                      }
                      style={swatchStyle}
                    />
                    <span style={{ fontSize: 11, color: 'var(--celnight-text-secondary)' }}>{color}</span>
                  </div>
                </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 11, width: 50 }}>Opacity</div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={opacity}
                      onChange={(e) =>
                        onChangeClassStyle?.(c.id, {
                          color,
                          opacity: parseFloat(e.target.value),
                        })
                      }
                      style={{ flex: 1 }}
                    />
                    <div style={{ fontSize: 11, width: 40 }}>{Math.round(opacity * 100)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
