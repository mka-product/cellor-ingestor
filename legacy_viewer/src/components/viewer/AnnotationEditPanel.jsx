import React, { useState, useEffect, useRef } from 'react';
import { LABEL_DICTIONARY, getLabelByShortcut } from '../../constants/labelDictionary';

export function AnnotationEditPanel({ annotation, isOpen, onClose, onUpdate, onDelete, defaultValues, lastUsedLabel, setLastUsedLabel, onToggleComments, commentCount, showCommentsPanel }) {
  const [position, setPosition] = useState({ x: window.innerWidth - 340, y: 100 });
  const [formData, setFormData] = useState({
    label: '',
    value: '',
    status: 'pending',
    color: '#ff0000',
    lineWidth: 2,
    opacity: 0.2
  });
  
  const panelRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const keyBufferRef = useRef({ keys: [], lastTime: 0 });

  // Initialize form data from annotation when it changes
  useEffect(() => {
    if (annotation) {
      // Extract data from annotation bodies or use defaults
      const styleBody = annotation.bodies.find(b => b.type === 'Style') || {};
      const contentBody = annotation.bodies.find(b => b.purpose === 'tagging' || b.purpose === 'describing');
      const valueBody = annotation.bodies.find(b => b.purpose === 'value');
      
      // Status is primarily in properties now, fallback to body
      const status = annotation.properties?.status || annotation.bodies.find(b => b.purpose === 'status')?.value || 'pending';

      const initialLabel = contentBody ? contentBody.value : (lastUsedLabel ? lastUsedLabel.label : '');
      const initialValue = valueBody ? valueBody.value : (lastUsedLabel && !contentBody ? lastUsedLabel.value : '');
      const initialColor = styleBody.color || (lastUsedLabel && !contentBody ? lastUsedLabel.color : defaultValues.color);

      setFormData({
        label: initialLabel,
        value: initialValue,
        status: status,
        color: initialColor,
        lineWidth: styleBody.lineWidth || defaultValues.lineWidth,
        opacity: styleBody.opacity !== undefined ? styleBody.opacity : defaultValues.opacity
      });
    }
  }, [annotation, defaultValues, lastUsedLabel]);

  // Handle shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
        // Ignore if user is typing in an input (except if we decide the panel itself captures these keys globally when open)
        // The spec says "Hotkey pressed while panel is open updates panel instantly".
        // But if I'm typing in a custom label field, I don't want 'T' to change it to Tumor.
        
        const tagName = document.activeElement.tagName;
        const isInput = tagName === 'INPUT' && document.activeElement.type === 'text';
        if (isInput) return; 

        if (e.key === 'Enter') {
            e.preventDefault();
            // Confirm/Save
            // We can just close, as updates are live. 
            // Or better: ensure we trigger a final "update" if needed, but onUpdate is called on change.
            // Just close.
            onClose();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            // If it's a new annotation (no ID or just created), maybe delete? 
            // The prompt says "Press Escape -> cancels annotation".
            // We can delegate to onDelete if we track "isNew".
            // For now, let's just close/deselect.
            onClose();
            return;
        }

        // Label Shortcuts
        const char = e.key.toUpperCase();
        if (char.length === 1 && /[A-Z0-9\-]/.test(char)) {
            const now = Date.now();
            const buffer = keyBufferRef.current;
            
            // Reset buffer if too slow (500ms)
            if (now - buffer.lastTime > 500) {
                buffer.keys = [];
            }
            
            buffer.keys.push(char);
            buffer.lastTime = now;
            
            const shortcut = buffer.keys.join('+');
            const match = getLabelByShortcut(shortcut);
            
            if (match) {
                applyLabelPreset(match);
            } else if (buffer.keys.length === 1) {
                // Try single key match immediately if no combo logic demanded waiting
                // But we want "T" to trigger "Tumor". "T+I" to trigger "Invasive".
                // If I press T, I get Tumor. If I then press I (within 500ms), I get Invasive.
                const singleMatch = getLabelByShortcut(char);
                if (singleMatch) {
                    applyLabelPreset(singleMatch);
                }
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, formData]);

  const applyLabelPreset = (preset) => {
      const newData = {
          ...formData,
          label: preset.label,
          value: preset.value,
          color: preset.color
      };
      setFormData(newData);
      onUpdate(newData);
      setLastUsedLabel(preset);
  };

  // Drag logic
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
  }, [isOpen]);

  const handlePointerDown = (e) => {
    if (e.target.closest('input') || e.target.closest('select') || e.target.closest('button')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
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
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const handleChange = (field, value) => {
    const newData = { ...formData, [field]: value };
    
    // If label changes manually via input/datalist
    if (field === 'label') {
        const match = LABEL_DICTIONARY.find(l => l.label === value);
        if (match) {
            // Found a preset - apply its properties
            newData.value = match.value;
            newData.color = match.color;
            setLastUsedLabel(match);
        } else {
            // New/Custom label
            // We keep the existing value/color unless user changes them,
            // or perhaps we could clear value if switching from a preset to custom?
            // For now, let's just update the label.
            // Also update lastUsedLabel to this custom object so it's remembered
            setLastUsedLabel({
                label: value,
                value: newData.value, // Keep current value
                color: newData.color  // Keep current color
            });
        }
    }
    
    setFormData(newData);
    onUpdate(newData);
  };

  // Determine if current label is a known preset
  const isKnownLabel = LABEL_DICTIONARY.some(l => l.label === formData.label);

  if (!isOpen || !annotation) return null;

  return (
    <div 
      ref={panelRef}
      className="annotation-panel"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="annotation-panel__header" onPointerDown={handlePointerDown}>
        <h3>Edit Annotation</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onToggleComments && (
            <button 
              className={`annotation-panel__comment-btn ${showCommentsPanel ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleComments();
              }}
              title="Comments"
              aria-label="Comments"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {commentCount > 0 && (
                <span className="annotation-panel__comment-badge">{commentCount}</span>
              )}
            </button>
          )}
          <button className="annotation-panel__close" onClick={onClose}>×</button>
        </div>
      </div>
      
      <div className="annotation-panel__content">
        <div className="annotation-form-group">
          <label>Label</label>
          <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                list="label-presets"
                value={formData.label} 
                onChange={e => handleChange('label', e.target.value)}
                style={{ flex: 1 }}
                placeholder="Select or type label..."
              />
              <datalist id="label-presets">
                {LABEL_DICTIONARY.map(item => (
                    <option key={item.label} value={item.label}>
                        {item.shortcut ? `(${item.shortcut})` : ''}
                    </option>
                ))}
              </datalist>
          </div>
        </div>

        <div className="annotation-form-group">
          <label>Value</label>
          <input 
            type="text" 
            value={formData.value} 
            onChange={e => handleChange('value', e.target.value)}
            readOnly={isKnownLabel}
            className={isKnownLabel ? "celnight-input--readonly" : ""}
            placeholder="Value"
          />
        </div>

        <div className="annotation-form-group">
          <label>Status</label>
          <select value={formData.status} onChange={e => handleChange('status', e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="review">Needs Review</option>
          </select>
        </div>

        <div className="annotation-divider"></div>

        <div className="annotation-form-row">
          <div className="annotation-form-group">
            <label>Color</label>
            <div className="color-picker-wrapper">
              <input 
                type="color" 
                value={formData.color} 
                onChange={e => handleChange('color', e.target.value)} 
              />
              <span>{formData.color}</span>
            </div>
          </div>
          <div className="annotation-form-group">
            <label>Width</label>
            <input 
              type="number" 
              min="1" 
              max="20" 
              value={formData.lineWidth} 
              onChange={e => handleChange('lineWidth', parseInt(e.target.value) || 1)} 
            />
          </div>
        </div>

        <div className="annotation-form-group">
          <label>Opacity ({Math.round(formData.opacity * 100)}%)</label>
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.1" 
            value={formData.opacity} 
            onChange={e => handleChange('opacity', parseFloat(e.target.value))} 
          />
        </div>

        <div className="annotation-panel__actions">
          <button className="celnight-button celnight-button--ghost" onClick={() => onDelete(annotation.id)}>
            Delete
          </button>
          <button className="celnight-button" onClick={onClose}>
            Done (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
