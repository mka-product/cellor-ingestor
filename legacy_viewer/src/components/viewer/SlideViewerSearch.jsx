import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const ITEMS_PER_PAGE = 5;

export function SlideViewerSearch({ slides, isOpen, onClose }) {
  const { projectId, datasetId } = useParams();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const filteredSlides = useMemo(() => {
    // If no search term, return all slides so ribbon shows available slides
    if (!searchTerm.trim()) {
      return slides;
    }
    return slides.filter((slide) =>
      slide.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [slides, searchTerm]);

  // Reset pagination when filter changes
  useEffect(() => {
    setStartIndex(0);
  }, [searchTerm]);

  const visibleSlides = filteredSlides.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const canGoLeft = startIndex > 0;
  const canGoRight = startIndex + ITEMS_PER_PAGE < filteredSlides.length;

  const handlePrev = () => {
    if (canGoLeft) {
      setStartIndex((prev) => Math.max(0, prev - 1));
    }
  };

  const handleNext = () => {
    if (canGoRight) {
      setStartIndex((prev) => Math.min(filteredSlides.length - ITEMS_PER_PAGE, prev + 1));
    }
  };

  const handleSelectSlide = (slideId) => {
    navigate(`/projects/${projectId}/datasets/${datasetId}/slides/${slideId}/viewer`);
    setSearchTerm('');
    setIsFocused(false);
    if (onClose) onClose();
  };

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Don't close if clicking inside the search component
      if (containerRef.current && containerRef.current.contains(event.target)) {
        return;
      }
      
      // If open and clicked outside, close it
      if (isOpen && onClose) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const getThumbnailUrl = (slide) => {
     if (slide.thumbnail_url) return slide.thumbnail_url;
     return null; 
  };

  if (!isOpen) return null;

  return (
    <div className="slide-viewer-search" ref={containerRef}>
      <div className="slide-viewer-search__input-wrapper">
        <svg
          className="slide-viewer-search__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="slide-viewer-search__input"
          placeholder="Search slides..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => setIsFocused(true)}
        />
        <button 
          className="slide-viewer-search__close-btn"
          onClick={onClose}
          aria-label="Close search"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="slide-viewer-search__ribbon">
        <button 
          className="slide-viewer-search__nav-btn slide-viewer-search__nav-btn--prev"
          onClick={handlePrev}
          disabled={!canGoLeft}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="slide-viewer-search__results-container">
          {visibleSlides.length > 0 ? (
            visibleSlides.map((slide) => (
              <div
                key={slide.id}
                className="slide-viewer-search__item"
                onClick={() => handleSelectSlide(slide.id)}
              >
                <div className="slide-viewer-search__item-thumb">
                    <ThumbnailImage slide={slide} />
                </div>
                <span className="slide-viewer-search__item-name" title={slide.name}>
                  {slide.name}
                </span>
              </div>
            ))
          ) : (
            <div className="slide-viewer-search__empty">No slides found</div>
          )}
        </div>

        <button 
          className="slide-viewer-search__nav-btn slide-viewer-search__nav-btn--next"
          onClick={handleNext}
          disabled={!canGoRight}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ThumbnailImage({ slide }) {
  const [error, setError] = useState(false);
  
  const relativePath = useMemo(() => {
    if (!slide.file_path) return null;
    if (slide.file_path.startsWith('/mnt/storage/')) {
      return slide.file_path.replace('/mnt/storage/', '');
    }
    if (slide.file_path.startsWith('/')) {
      return slide.file_path.substring(1);
    }
    return slide.file_path;
  }, [slide.file_path]);

  const thumbnailUrl = useMemo(() => {
    if (!relativePath) return null;
    const baseURL = window.location.origin;
    // Request a small tile from the lowest resolution level
    return `${baseURL}/slides/tiles/0/0/0?path=${encodeURIComponent(relativePath)}&tile_size=256`;
  }, [relativePath]);

  if (!thumbnailUrl || error) {
    return (
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
    );
  }

  return (
    <img 
      src={thumbnailUrl} 
      alt={slide.name} 
      className="slide-viewer-search__thumb-img"
      onError={() => setError(true)}
    />
  );
}
