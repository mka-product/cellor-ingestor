import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { OSDViewer } from '../components/viewer/OSDViewer.jsx';
import { SlideViewerSearch } from '../components/viewer/SlideViewerSearch.jsx';
import { ShortcutsHelp } from '../components/viewer/ShortcutsHelp.jsx';
import { MetadataPanel } from '../components/viewer/MetadataPanel.jsx';

export function SlideViewerPage() {
  const { projectId, datasetId, slideId } = useParams();
  const navigate = useNavigate();
  const { selectedDataset, slides, fetchSlides } = useOutletContext();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [slideMetadata, setSlideMetadata] = useState(null);
  
  // Placeholder states for panels
  const [showMetadata, setShowMetadata] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pageContainerRef = useRef(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      if (pageContainerRef.current) {
        pageContainerRef.current.requestFullscreen().catch((err) => {
          console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
      }
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    if (!datasetId || !slideId || !fetchSlides) return;
    const exists = slides.some((slide) => String(slide.id) === String(slideId));
    if (!exists) {
      setIsLoading(true);
      setErrorMessage(null);
      fetchSlides(datasetId)
        .catch((err) => {
          console.error('Failed to fetch slides for viewer', err);
          setErrorMessage('Unable to load slides for this dataset.');
        })
        .finally(() => setIsLoading(false));
    }
  }, [datasetId, slideId, slides, fetchSlides]);

  const currentSlide = useMemo(
    () => slides.find((slide) => String(slide.id) === String(slideId)) || null,
    [slides, slideId],
  );

  const handleBack = () => {
    navigate(`/projects/${projectId}/datasets/${datasetId}`);
  };

  const navigateSlide = useCallback((direction) => {
    if (!slides.length) return;
    const currentIndex = slides.findIndex(s => String(s.id) === String(slideId));
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    // Clamp index
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= slides.length) nextIndex = slides.length - 1;

    if (nextIndex !== currentIndex) {
      navigate(`/projects/${projectId}/datasets/${datasetId}/slides/${slides[nextIndex].id}/viewer`);
    }
  }, [slides, slideId, projectId, datasetId, navigate]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if input is focused
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      switch(e.key) {
        case '[':
          navigateSlide(-1);
          break;
        case ']':
          navigateSlide(1);
          break;
        case '/':
          e.preventDefault();
          setIsSearchOpen(prev => !prev);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          setIsSearchOpen(true);
          break;
        case '?':
          setShowShortcutsHelp(prev => !prev);
          break;
        case 'm':
        case 'M':
          setShowMetadata(prev => !prev);
          console.log('Toggle Metadata');
          break;
        case 'o':
        case 'O':
          setShowOverlay(prev => !prev);
          console.log('Toggle Overlay');
          break;
        case 'a':
        case 'A':
          setShowAnnotations(prev => !prev);
          console.log('Toggle Annotations');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateSlide]);

  useEffect(() => {
    const contentEl = document.querySelector('.celnight-content');
    contentEl?.classList.add('celnight-content--immersive');
    return () => {
      contentEl?.classList.remove('celnight-content--immersive');
    };
  }, []);

  const renderPlaceholder = () => {
    if (isLoading) {
      return <div className="slide-viewer-placeholder">Loading slide…</div>;
    }
    if (errorMessage) {
      return <div className="slide-viewer-placeholder">{errorMessage}</div>;
    }
    if (slides.length === 0) {
      return <div className="slide-viewer-placeholder">No slides available for this dataset yet.</div>;
    }
    return (
      <div className="slide-viewer-placeholder">
        Select a slide with a valid file to open the viewer.
      </div>
    );
  };

  return (
    <section className="celnight-section slide-viewer-page">
      <div className="celnight-breadcrumb">
        <button type="button" className="celnight-breadcrumb__link" onClick={() => navigate('/projects')}>
          Projects
        </button>
        <span> / </span>
        <button
          type="button"
          className="celnight-breadcrumb__link"
          onClick={() => navigate(`/projects/${projectId}/datasets/${datasetId}`)}
        >
          {selectedDataset?.name || 'Dataset'}
        </button>
        <span> / Viewer</span>
      </div>

      <div className="slide-viewer-view" style={{ position: 'relative' }} ref={pageContainerRef}>
        <SlideViewerSearch 
          slides={slides} 
          isOpen={isSearchOpen} 
          onClose={() => setIsSearchOpen(false)} 
        />
        <ShortcutsHelp 
          isOpen={showShortcutsHelp} 
          onClose={() => setShowShortcutsHelp(false)} 
        />
        <MetadataPanel
          metadata={slideMetadata}
          isOpen={showMetadata}
          onClose={() => setShowMetadata(false)}
        />
        
        {currentSlide?.file_path ? (
          <OSDViewer 
            slideId={currentSlide.id}
            filePath={currentSlide.file_path} 
            fullPage 
            onSearch={() => setIsSearchOpen(prev => !prev)}
            onMetadataLoaded={setSlideMetadata}
            onToggleMetadata={() => setShowMetadata(prev => !prev)}
            onToggleShortcuts={() => setShowShortcutsHelp(prev => !prev)}
            onToggleFullscreen={handleToggleFullscreen}
            isFullscreen={isFullscreen}
          />
        ) : (
          renderPlaceholder()
        )}
      </div>
    </section>
  );
}

