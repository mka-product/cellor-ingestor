import { useState, useRef, useEffect } from 'react';

/**
 * Multi-select dropdown component
 * @param {Object} props
 * @param {Array} props.options - Array of {id, label} objects
 * @param {Array} props.value - Array of selected option IDs
 * @param {Function} props.onChange - Callback with (selectedIds) when selection changes
 * @param {string} props.placeholder - Placeholder text
 * @param {string} props.className - Additional CSS classes
 */
export function MultiSelect({ options = [], value = [], onChange, placeholder = 'Select...', className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const toggleOption = (optionId) => {
    const newValue = value.includes(optionId)
      ? value.filter((id) => id !== optionId)
      : [...value, optionId];
    onChange(newValue);
  };

  const selectedLabels = options
    .filter((opt) => value.includes(opt.id))
    .map((opt) => opt.label);

  const displayText = selectedLabels.length > 0
    ? selectedLabels.join(', ')
    : placeholder;

  return (
    <div className={`multi-select ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className="multi-select-trigger celnight-input"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className={selectedLabels.length === 0 ? 'multi-select-placeholder' : ''}>
          {displayText}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`multi-select-arrow ${isOpen ? 'multi-select-arrow--open' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {isOpen && (
        <div className="multi-select-dropdown">
          {options.map((option) => {
            const isSelected = value.includes(option.id);
            return (
              <label key={option.id} className="multi-select-option">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOption(option.id)}
                />
                <span className={isSelected ? 'multi-select-option-selected' : ''}>
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

