import React, { useEffect } from 'react';

export function ShortcutsHelp({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcuts = [
    { category: 'View Controls', items: [
      { keys: ['+', '='], desc: 'Zoom in' },
      { keys: ['-'], desc: 'Zoom out' },
      { keys: ['0'], desc: 'Reset view' },
      { keys: ['R'], desc: 'Rotate 90° clockwise' },
      { keys: ['Shift', 'R'], desc: 'Rotate 90° counter-clockwise' },
    ]},
    { category: 'Navigation', items: [
      { keys: ['['], desc: 'Previous slide' },
      { keys: [']'], desc: 'Next slide' },
    ]},
    { category: 'Panels & Search', items: [
      { keys: ['/'], desc: 'Open search UI' },
      { keys: ['M'], desc: 'Toggle metadata panel' },
      { keys: ['O'], desc: 'Toggle overlay panel' },
      { keys: ['A'], desc: 'Toggle annotations panel' },
      { keys: ['?'], desc: 'Show/hide this help' },
    ]}
  ];

  return (
    <div className="shortcuts-help-overlay" onClick={onClose}>
      <div className="shortcuts-help-modal" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-help-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="shortcuts-help-close" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-help-content">
          {shortcuts.map((section) => (
            <div key={section.category} className="shortcuts-section">
              <h4 className="shortcuts-category-title">{section.category}</h4>
              <div className="shortcuts-list">
                {section.items.map((item, idx) => (
                  <div key={idx} className="shortcut-item">
                    <span className="shortcut-desc">{item.desc}</span>
                    <div className="shortcut-keys">
                      {item.keys.map((key, kIdx) => (
                        <React.Fragment key={key}>
                          <kbd className="shortcut-key">{key}</kbd>
                          {kIdx < item.keys.length - 1 && <span className="shortcut-separator">+</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

