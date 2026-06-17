import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { createOSDAnnotator } from '@annotorious/openseadragon';
import '@annotorious/openseadragon/annotorious-openseadragon.css';
import { mountPlugin } from '@annotorious/plugin-tools';
import { AnnotationEditPanel } from './AnnotationEditPanel.jsx';
import { LayerPanel } from './LayerPanel.jsx';
import { CommentsPanel } from './CommentsPanel.jsx';
import OverlayListPanel from './OverlayListPanel.jsx';
import OverlayUploadPanel from './OverlayUploadPanel.jsx';
import OverlayStylePanel from './OverlayStylePanel.jsx';
import { OverlayCanvas } from './OverlayCanvas.jsx';
import initCellorWasm, { Cellor } from 'cellor-wasm';
import { annotationsApi } from '../../api/annotations';
import { LABEL_DICTIONARY } from '../../constants/labelDictionary';

const TILE_SIZE = 256;
const SCALE_BASES = [1, 2, 5];
let wasmInitPromise = null;

export function OSDViewer({ slideId, filePath, onClose, onSearch, onMetadataLoaded, onToggleMetadata, onToggleShortcuts, onToggleFullscreen, isFullscreen, fullPage = false }) {
  const viewerContainerRef = useRef(null);
  const osdViewerRef = useRef(null);
  const annotatorRef = useRef(null);
  const navigatorContainerRef = useRef(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scaleInfo, setScaleInfo] = useState({ label: '', length: 0 });
  const [scalePosition, setScalePosition] = useState({ x: 24, y: 24 });
  const dragStateRef = useRef({ active: false, startX: 0, startY: 0, originX: 24, originY: 24 });
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const [annotationTooltip, setAnnotationTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
  const annotationTooltipRef = useRef(annotationTooltip);
  const tooltipRafRef = useRef(null);
  const lastPointerRef = useRef({ x: null, y: null });
  const measurementOverlaysRef = useRef({});

  // Ref for active layer to access in event listeners
  const activeLayerIdRef = useRef(null);

  // Annotation state
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [showOverlayPanel, setShowOverlayPanel] = useState(false);
  const [overlays, setOverlays] = useState([]);
  const [overlaysLoading, setOverlaysLoading] = useState(false);
  const [overlaysError, setOverlaysError] = useState(null);
  const [overlayUploadStatus, setOverlayUploadStatus] = useState(null);
  const [overlayUploadProgress, setOverlayUploadProgress] = useState(0);
  const [isOverlayUploading, setIsOverlayUploading] = useState(false);
  const [overlayVisibility, setOverlayVisibility] = useState({});
  const [overlayDataMap, setOverlayDataMap] = useState({}); // {overlayId: {features, classes}}
  const overlayCellsRef = useRef({}); // overlayId -> {cell, classes, index, presignedUrl, decoded: Map}
  const overlayPendingRef = useRef({}); // overlayId -> Map of featureId -> lod in flight
  const viewportUpdateRaf = useRef(null);
  const [overlayStyles, setOverlayStyles] = useState({});
  const [isOverlayLoadingData, setIsOverlayLoadingData] = useState(false);
  const [showOverlayUploadPanel, setShowOverlayUploadPanel] = useState(false);
  const [overlayPanelPosition, setOverlayPanelPosition] = useState({ x: 520, y: 80 });
  const [overlayUploadPosition, setOverlayUploadPosition] = useState({ x: 560, y: 140 });
  const [overlayStylePosition, setOverlayStylePosition] = useState({ x: 560, y: 320 });
  const [stylePanelOverlay, setStylePanelOverlay] = useState(null);
  const [overlayTooltip, setOverlayTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });

  const [commentCounts, setCommentCounts] = useState({}); // {annotationId: count}
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [defaultAnnotationStyle, setDefaultAnnotationStyle] = useState({
    color: '#ff0000',
    lineWidth: 2,
    opacity: 0.2
  });
  const [interactionMode, setInteractionMode] = useState('hand'); // 'hand' | 'select' | draw tools
  const [showInteractionPalette, setShowInteractionPalette] = useState(false);
  const applyUserSelectAction = useCallback(() => {
    const ann = annotatorRef.current;
    if (!ann || typeof ann.setUserSelectAction !== 'function') return;
    if (interactionMode === 'hand') {
      ann.setUserSelectAction('NONE');
      ann.setDrawingEnabled(false);
    } else {
      ann.setUserSelectAction('EDIT');
    }
  }, [interactionMode]);
  
  // Layer state
  const [activeLayerId, setActiveLayerId] = useState(null);
  
  // Sync state for LayerPanel
  const [lastAnnotationUpdate, setLastAnnotationUpdate] = useState(0);

  // Labeling state
  const [lastUsedLabel, setLastUsedLabel] = useState(LABEL_DICTIONARY[0]); // Default to Tumor

  // Cursor sharing state
  const [isCursorSharing, setIsCursorSharing] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState({}); // {userId: {x, y, username, zoom}}
  const [isWebSocketOpen, setIsWebSocketOpen] = useState(false); // Track WS connection state
  const wsRef = useRef(null);
  const userIdRef = useRef(null);
  const usernameRef = useRef(null);
  const connectionIdRef = useRef(null); // Unique connection ID (user + session)
  const cursorThrottleRef = useRef(null);

  // Backend selection state (null = auto-select, 'openslide' or 'bioformats' = force backend)
  const [selectedBackend, setSelectedBackend] = useState(null);

  // Microns-per-pixel derived from metadata (OpenSlide or BioFormats)
  const micronsPerPixel = useMemo(() => {
    if (!metadata?.properties) return null;
    const props = metadata.properties;

    const parseVal = (key) => {
      const v = parseFloat(props[key]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const getOpenslideMpp = () => parseVal('openslide.mpp-x') || parseVal('openslide.mpp-y');
    const getBioformatsMpp = () =>
      parseVal('ome.image[0].physical_size_x') || parseVal('ome.image[0].physical_size_y');

    let mpp = null;
    if (selectedBackend === 'openslide') {
      mpp = getOpenslideMpp();
      if (!mpp) mpp = getBioformatsMpp();
    } else if (selectedBackend === 'bioformats') {
      mpp = getBioformatsMpp();
      if (!mpp) mpp = getOpenslideMpp();
    } else {
      mpp = getOpenslideMpp() || getBioformatsMpp();
    }

    return mpp;
  }, [metadata, selectedBackend]);

  // Convert absolute path to relative path for API
  const relativePath = useMemo(() => {
    if (!filePath) return null;
    if (filePath.startsWith('/mnt/storage/')) {
      return filePath.replace('/mnt/storage/', '');
    }
    if (filePath.startsWith('/')) {
      return filePath.substring(1);
    }
    return filePath;
  }, [filePath]);

  // Fetch metadata
  useEffect(() => {
    if (!relativePath) return;

    setLoading(true);
    setError(null);

    const fetchMetadata = async () => {
      try {
        const baseURL = window.location.origin;
        let url = `${baseURL}/slides/metadata?path=${encodeURIComponent(relativePath)}`;
        if (selectedBackend) {
          url += `&backend=${selectedBackend}`;
        }
        const response = await fetch(url, {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Failed to load metadata: ${response.statusText}`);
        }
        const data = await response.json();
        setMetadata(data);
        if (onMetadataLoaded) onMetadataLoaded(data);
      } catch (err) {
        console.error('[Viewer] Error loading metadata:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMetadata();
  }, [relativePath, selectedBackend]);
  
  // Initialize Annotations & Layers
  useEffect(() => {
    if (!slideId) return;

    const initAnnotations = async () => {
      try {
        console.log('[Viewer] Initializing annotations for slide:', slideId);
        
        // 1. Fetch Layers
        let layers = [];
        try {
          layers = await annotationsApi.getLayers(slideId);
        } catch (err) {
          console.warn('[Viewer] Failed to fetch layers, might be empty or error:', err);
        }
        
        // Don't automatically create a layer - wait until user starts drawing
        // Set active layer to first existing layer, or null if none exist
        const targetLayerId = layers.length > 0 ? layers[0].id : null;
        setActiveLayerId(targetLayerId);
        console.log('[Viewer] Active layer set to:', targetLayerId || '(none - will be created when drawing starts)');

        // 2. Fetch Annotations
        try {
          const annotations = await annotationsApi.getAnnotations(slideId);
          console.log(`[Viewer] Loaded ${annotations.length} annotations`);
          if (annotatorRef.current) {
             annotatorRef.current.setAnnotations(annotations);
          }
        } catch (err) {
          console.error('[Viewer] Failed to fetch annotations:', err);
        }
      } catch (err) {
        console.error('[Viewer] Error in annotation init sequence:', err);
      }
    };

    initAnnotations();
  }, [slideId]);

  useEffect(() => {
    annotationTooltipRef.current = annotationTooltip;
  }, [annotationTooltip]);

  useEffect(() => {
    const container = viewerContainerRef.current;
    const target = container || window;

    const handlePointerMove = (evt) => {
      if (typeof evt.clientX === 'number' && typeof evt.clientY === 'number') {
        lastPointerRef.current = { x: evt.clientX, y: evt.clientY };
      }
    };

    target.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      target.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  // Toggle pointer events on annotations when in hand mode (no selection)
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    const targets = container.querySelectorAll('.a9s-annotationlayer, .a9s-annotation, .a9s-gl-canvas');
    targets.forEach((el) => {
      el.style.pointerEvents = interactionMode === 'hand' ? 'none' : '';
    });
    return () => {
      targets.forEach((el) => (el.style.pointerEvents = ''));
    };
  }, [interactionMode]);

  // Keep measurement overlay in sync while dragging a line (fallback polling via pointermove)
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    const handlePointerMove = () => {
      if (!annotatorRef.current) return;
      const selected = annotatorRef.current.getSelected ? annotatorRef.current.getSelected() : null;
      const ann = Array.isArray(selected) ? selected[0] : selected;
      if (!ann || ann?.target?.selector?.type !== 'LINE') return;
      const measured = applyLineMeasurement(ann);
      ensureMeasurementOverlay(measured);
      setAnnotationTooltip({ visible: false, text: '', x: 0, y: 0 });
    };

    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      container.removeEventListener('pointermove', handlePointerMove);
    };
  }, [selectedAnnotation, micronsPerPixel]);

  const fetchOverlays = useCallback(async () => {
    if (!slideId) return;
    setOverlaysLoading(true);
    setOverlaysError(null);
    try {
      const resp = await fetch(`${window.location.origin}/api/overlays/slides/${slideId}`, {
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`Failed to load overlays: ${resp.statusText}`);
      const data = await resp.json();
      setOverlays(data);
      setOverlayVisibility((prev) => {
        const next = { ...prev };
        data.forEach((ov) => {
          if (typeof next[ov.id] === 'undefined') next[ov.id] = true;
        });
        return next;
      });
    } catch (err) {
      setOverlaysError(err.message);
    } finally {
      setOverlaysLoading(false);
    }
  }, [slideId]);
  
  // Initialize OpenSeadragon viewer
  useEffect(() => {
    if (!metadata || !relativePath || loading || error) {
      if (osdViewerRef.current) {
        osdViewerRef.current.destroy();
        osdViewerRef.current = null;
      }
      return;
    }

    // Use requestAnimationFrame to ensure DOM is ready
    let initTimer = null;
    const initFrame = requestAnimationFrame(() => {
      initTimer = setTimeout(() => {
        const container = viewerContainerRef.current;
        let navigatorElement = navigatorContainerRef.current;
        // If minimap element got detached (e.g., during re-render), recreate it and re-attach.
        if ((!navigatorElement || !document.contains(navigatorElement)) && container?.parentNode) {
          const nav = document.createElement('div');
          nav.id = 'osd-viewer-navigator';
          nav.className = 'osd-viewer-minimap navigator';
          container.parentNode.appendChild(nav);
          navigatorElement = nav;
          navigatorContainerRef.current = nav;
        }
        
        if (!container || typeof OpenSeadragon === 'undefined') {
          console.error('[Viewer] Container or OpenSeadragon missing');
          return;
        }

        // Verify navigator element is actually in the DOM before using it
        if (navigatorElement) {
          // Check if element is actually mounted in the DOM
          if (!document.contains(navigatorElement) || !navigatorElement.parentNode) {
            console.warn('[Viewer] Navigator element not yet mounted, skipping navigator');
            navigatorElement = null;
          }
        }

        if (osdViewerRef.current) {
          osdViewerRef.current.destroy();
          osdViewerRef.current = null;
        }

      const baseWidth = metadata?.dimensions?.width || 0;
      const baseHeight = metadata?.dimensions?.height || 0;
      const levelCount = metadata?.level_count ?? 1;
      const levelDimensions = metadata?.level_dimensions || [];
      const levelDownsamples = metadata?.level_downsamples || [];

      if (baseWidth === 0 || baseHeight === 0) {
        console.error('[Viewer] Invalid slide dimensions');
        setError('Invalid slide dimensions');
        return;
      }

      // Custom TileSource for slide tiles
      const SlideTileSource = function (options) {
        OpenSeadragon.TileSource.apply(this, [options]);
        this.width = options.width;
        this.height = options.height;
        this.tileSize = options.tileSize || TILE_SIZE;
        this.openslideMaxLevel = options.maxLevel || 0;
        this.getTileUrlFn = options.getTileUrl;
        this.levelDimensions = options.levelDimensions || [];
        this.levelDownsamples = options.levelDownsamples || [];
        this.maxLevel = this.openslideMaxLevel;
        // Ensure tiles are loaded via AJAX
        this.ajaxWithCredentials = false;

        this.levelScales = [];
        this.levelTileCounts = [];
        for (let osdLevel = 0; osdLevel <= this.maxLevel; osdLevel++) {
          // Map OSD level to OpenSlide level (inverted: OSD 0 = OpenSlide maxLevel = lowest res)
          const openslideLevel = this.maxLevel - osdLevel;
          // Handle both object format {width, height} and array format [width, height]
          const levelDim = this.levelDimensions[openslideLevel];
          const levelWidth = levelDim?.width ?? (Array.isArray(levelDim) ? levelDim[0] : this.width);
          const levelHeight = levelDim?.height ?? (Array.isArray(levelDim) ? levelDim[1] : this.height);
          this.levelScales[osdLevel] = levelWidth / this.width;
          this.levelTileCounts[osdLevel] = {
            x: Math.ceil(levelWidth / this.tileSize),
            y: Math.ceil(levelHeight / this.tileSize),
          };
        }
      };

      SlideTileSource.prototype = Object.create(OpenSeadragon.TileSource.prototype);
      SlideTileSource.prototype.constructor = SlideTileSource;

      SlideTileSource.prototype.getTileUrl = function (osdLevel, x, y) {
        osdLevel = Math.max(0, Math.min(osdLevel, this.maxLevel));
        return this.getTileUrlFn(osdLevel, x, y);
      };

      SlideTileSource.prototype.getLevelScale = function (osdLevel) {
        osdLevel = Math.max(0, Math.min(osdLevel, this.maxLevel));
        return this.levelScales[osdLevel] || 1;
      };

      SlideTileSource.prototype.getNumTiles = function (osdLevel) {
        if (osdLevel < 0 || osdLevel > this.maxLevel) {
          return { x: 0, y: 0 };
        }
        return this.levelTileCounts[osdLevel] || { x: 1, y: 1 };
      };

      SlideTileSource.prototype.getLevelDimensions = function (osdLevel) {
        if (osdLevel < 0 || osdLevel > this.maxLevel) {
          return { x: 0, y: 0 };
        }
        const openslideLevel = this.maxLevel - osdLevel;
        if (this.levelDimensions[openslideLevel]) {
          return {
            x: this.levelDimensions[openslideLevel].width,
            y: this.levelDimensions[openslideLevel].height,
          };
        }
        const scale = this.levelScales[osdLevel];
        return {
          x: Math.floor(this.width * scale),
          y: Math.floor(this.height * scale),
        };
      };

      SlideTileSource.prototype.getTileWidth = function (osdLevel) {
        return this.tileSize;
      };

      SlideTileSource.prototype.getTileHeight = function (osdLevel) {
        return this.tileSize;
      };
      
      const baseURL = window.location.origin;
      const getTileUrl = (level, x, y) => {
        // Use /slides/* path to route to Rust backend (not /api/slides/* which goes to Python)
        let url = `${baseURL}/slides/tiles/${level}/${x}/${y}?path=${encodeURIComponent(relativePath)}&tile_size=${TILE_SIZE}`;
        if (selectedBackend) {
          url += `&backend=${selectedBackend}`;
        }
        return url;
      };

      const mappedLevelDimensions = levelDimensions.map((ld) => {
        if (ld && typeof ld === 'object' && 'width' in ld && 'height' in ld) {
          return {
            width: ld.width || baseWidth,
            height: ld.height || baseHeight,
          };
        }

        if (Array.isArray(ld)) {
          return {
            width: ld[0] || baseWidth,
            height: ld[1] || baseHeight,
          };
        }

        return {
          width: baseWidth,
          height: baseHeight,
        };
      });

      const tileSource = new SlideTileSource({
        width: baseWidth,
        height: baseHeight,
        tileSize: TILE_SIZE,
        maxLevel: Math.max(0, levelCount - 1),
        getTileUrl,
        levelDimensions: mappedLevelDimensions,
        levelDownsamples,
      });

      try {
        osdViewerRef.current = OpenSeadragon({
          element: container,
          prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
          showFullPageControl: false,
          showHomeControl: false,
          showRotationControl: false,
          showZoomControl: false,
          // Let OpenSeadragon manage the navigator directly using our minimap element
          showNavigator: !!navigatorElement,
          navigatorElement: navigatorElement || undefined,
          animationTime: 0.8,
          visibilityRatio: 1,
          // Use loadWithAjax for tile loading (correct parameter name in OpenSeadragon)
          loadWithAjax: true,
          // imageLoaderLimit controls concurrent image/tile requests (0 = unlimited, >0 = limit)
          imageLoaderLimit: 2,
          maxImageCacheCount: 500,
          timeout: 100000,
          tileSources: tileSource,
          immediateRender: false,
          crossOriginPolicy: 'Anonymous',
          gestureSettingsMouse: {
            clickToZoom: false,
            dblClickToZoom: true
          }
        });
        osdViewerRef.current.__celnightTileSource = tileSource;
        
        // Store original gesture settings to restore later
        osdViewerRef.current.__originalGestures = {
          mouse: { ...osdViewerRef.current.gestureSettingsMouse },
          touch: { ...osdViewerRef.current.gestureSettingsTouch },
          pen: { ...osdViewerRef.current.gestureSettingsPen }
        };

        // Initialize Annotorious
        try {
          const ann = createOSDAnnotator(osdViewerRef.current, {
             drawingEnabled: false, // Start disabled, enabled by button
             allowEmpty: true,
             style: (annotation) => {
               // Custom style formatter
               const styleBody = annotation.bodies.find(b => b.type === 'Style');
               if (styleBody) {
                 return {
                   stroke: styleBody.color,
                   strokeWidth: styleBody.lineWidth,
                   fill: styleBody.color,
                   fillOpacity: styleBody.opacity
                 };
               }
               // Use defaults if no style body
               return {
                 stroke: '#ff0000', 
                 fill: '#ff0000', 
                 fillOpacity: 0.2
               }; 
             }
          });
          
          // Initialize Plugin Tools (Circle, Line)
          mountPlugin(ann);
          
          annotatorRef.current = ann;

          const getAnnotationLabel = (annotation) => {
            if (!annotation?.bodies) return 'Annotation';
            const textBody = annotation.bodies.find(
              (b) => b.value && b.type !== 'Style'
            );
            return textBody?.value || 'Annotation';
          };
          
          const computeTooltipPosition = (element, evt) => {
            const eventObj = evt?.originalEvent || evt || {};

            if (typeof eventObj.clientX === 'number' && typeof eventObj.clientY === 'number') {
              return { x: eventObj.clientX, y: eventObj.clientY - 12 };
            }

            if (lastPointerRef.current.x != null && lastPointerRef.current.y != null) {
              return { x: lastPointerRef.current.x, y: lastPointerRef.current.y - 12 };
            }

            if (element) {
              const rect = element.getBoundingClientRect();
              return {
                x: rect.left + rect.width / 2,
                y: rect.top - 8
              };
            }

            return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          };

          const scheduleTooltipUpdate = (pos) => {
            if (tooltipRafRef.current) return;
            tooltipRafRef.current = requestAnimationFrame(() => {
              tooltipRafRef.current = null;
              setAnnotationTooltip((prev) => ({
                ...prev,
                x: pos.x,
                y: pos.y
              }));
            });
          };

          ann.on('mouseEnterAnnotation', (annotation, element, evt) => {
            const mouseEvt = evt?.originalEvent || evt || {};
            const text = getAnnotationLabel(annotation);
            const pos = computeTooltipPosition(element, mouseEvt);

            setAnnotationTooltip({
              visible: true,
              text,
              x: pos.x,
              y: pos.y,
            });
          });

          ann.on('mouseMoveAnnotation', (annotation, element, evt) => {
            const mouseEvt = evt?.originalEvent || evt || {};
            const pos = computeTooltipPosition(element, mouseEvt);
            scheduleTooltipUpdate(pos);
          });

          ann.on('mouseLeaveAnnotation', () => {
            if (tooltipRafRef.current) {
              cancelAnimationFrame(tooltipRafRef.current);
              tooltipRafRef.current = null;
            }
            setAnnotationTooltip({ visible: false, text: '', x: 0, y: 0 });
          });
          
          // Event Listeners
          ann.on('createAnnotation', async (annotation) => {
            // Inject default styles immediately
            const styleBody = {
              type: 'Style',
              purpose: 'style',
              color: defaultAnnotationStyle.color,
              lineWidth: defaultAnnotationStyle.lineWidth,
              opacity: defaultAnnotationStyle.opacity
            };
            
            // Add style body and inject measurement for line tool
            let updated = {
              ...annotation,
              bodies: [...annotation.bodies, styleBody]
            };
            updated = applyLineMeasurement(updated);
            ensureMeasurementOverlay(updated);
            
            // Sync with Server (create)
            try {
                let layerId = activeLayerIdRef.current;
                
                // If no layer exists, create one automatically
                if (!layerId) {
                    console.log('[Viewer] No layer exists, creating default layer');
                    try {
                        // Get username for layer name (try state first, then ref, then fallback)
                        const username = currentUsername || usernameRef.current || 'User';
                        // Create layer name: "{username}'s layer" (e.g., "admin's layer")
                        const layerName = `${username}'s layer`;
                        
                        const defaultLayer = await annotationsApi.createLayer(slideId, {
                           name: layerName,
                           type: "manual",
                           visible_by_default: true,
                           opacity: 1.0
                        });
                        layerId = defaultLayer.id;
                        activeLayerIdRef.current = layerId;
                        setActiveLayerId(layerId);
                        console.log('[Viewer] Created default layer:', layerName, layerId);
                        
                        // Trigger LayerPanel refresh
                        setLastAnnotationUpdate(Date.now());
                    } catch (err) {
                        console.error('[Viewer] Failed to create default layer:', err);
                        // Remove the annotation since we can't save it without a layer
                        ann.removeAnnotation(annotation.id);
                        alert('Failed to create layer. Please create a layer manually before drawing annotations.');
                        return;
                    }
                }
                
                if (layerId) {
                    console.log('[Viewer] Creating annotation in layer:', layerId);
                    let saved = await annotationsApi.createAnnotation(layerId, updated);
                    ensureMeasurementOverlay(saved);
                    // Update local with server version (has ID)
                    updated = saved;
                    // Note: setAnnotations replaces all? No, updateAnnotation updates one.
                    // Annotorious might have generated a temp ID. createAnnotation event has that temp ID.
                    // We need to replace the temp ID with server ID if they differ.
                    // Annotorious v3 doesn't have an easy "replace ID" method, but we can remove and add.
                    // Or if we return the object with same ID it's fine.
                    // If backend generates new ID:
                    if (saved.id !== annotation.id) {
                         // Remove temp, add saved
                         ann.removeAnnotation(annotation.id);
                         ann.addAnnotation(saved);
                         updated = saved;
                    }
                } else {
                    console.error('[Viewer] No active layer selected, cannot save annotation');
                }
            } catch (e) {
                console.error("Error creating annotation", e);
            }

            ann.updateAnnotation(updated);
            
            ann.setSelected(updated.id); 
            setSelectedAnnotation(updated);
            setShowEditPanel(true);
            setLastAnnotationUpdate(Date.now()); // Trigger LayerPanel update
            
            ann.setDrawingEnabled(false);
            setActiveTool(null);
          });

          ann.on('selectAnnotation', (annotation) => {
            // Check if we have style body
            const styleBody = annotation.bodies.find(b => b.type === 'Style');
            
            // If no style body (legacy or created before fix), add default
            if (!styleBody) {
               const newStyle = {
                  type: 'Style',
                  purpose: 'style',
                  color: defaultAnnotationStyle.color,
                  lineWidth: defaultAnnotationStyle.lineWidth,
                  opacity: defaultAnnotationStyle.opacity
               };
               const updated = { ...annotation, bodies: [...annotation.bodies, newStyle] };
               // Update it so it has style
               ann.updateAnnotation(updated);
               setSelectedAnnotation(updated);
            } else {
               setSelectedAnnotation(annotation);
            }
            
            setShowEditPanel(true);
          });
          
          // Live update overlay while moving/reshaping selection
          ann.on('updateAnnotation', async (annotation) => {
              try {
                  const measured = applyLineMeasurement(annotation);
                  ensureMeasurementOverlay(measured);
                  await annotationsApi.updateAnnotation(measured.id, measured);
                  setLastAnnotationUpdate(Date.now()); // Trigger LayerPanel update (e.g. geometry change)
              } catch(e) { console.error("Failed to update annotation", e); }
          });
          
          ann.on('deleteAnnotation', async (annotation) => {
              try {
                  await annotationsApi.deleteAnnotation(annotation.id);
                  setLastAnnotationUpdate(Date.now()); // Trigger LayerPanel update
                  const existing = measurementOverlaysRef.current[annotation.id];
                  if (existing && osdViewerRef.current) {
                    osdViewerRef.current.removeOverlay(existing);
                    delete measurementOverlaysRef.current[annotation.id];
                  }
              } catch(e) {
                const existing = measurementOverlaysRef.current[annotation.id];
                if (existing && osdViewerRef.current) {
                  osdViewerRef.current.removeOverlay(existing);
                  delete measurementOverlaysRef.current[annotation.id];
                }
                console.error("Failed to delete annotation", e);
              }
          });

          ann.on('clickAnnotation', (annotation) => {
             ann.setSelected(annotation.id);
          });

          ann.on('cancelSelected', () => {
            setShowEditPanel(false);
            setShowCommentsPanel(false);
            setSelectedAnnotation(null);
          });

          // Trigger data fetch now that annotator is ready
          if (slideId) {
             annotationsApi.getAnnotations(slideId).then(annotations => {
                 ann.setAnnotations(annotations);
                 annotations.forEach(ensureMeasurementOverlay);
                 loadCommentCounts(annotations);
             }).catch(e => console.error("Failed to load annotations", e));
          }

        } catch (err) {
          console.error('[Viewer] Failed to initialize Annotorious:', err);
        }

        if (osdViewerRef.current.imageLoader) {
          osdViewerRef.current.imageLoader.jobLimit = 2;
        }

        osdViewerRef.current.viewport.goHome(true);
        setViewerGeneration((prev) => prev + 1);

        osdViewerRef.current.addHandler('tile-load-failed', (event) => {
          console.error('[Viewer] Tile load failed:', event);
        });
      } catch (err) {
        console.error('[Viewer] Error creating OpenSeadragon:', err);
        setError('Failed to initialize viewer: ' + err.message);
      }
      }, 100);
    });

    return () => {
      cancelAnimationFrame(initFrame);
      if (initTimer) {
        clearTimeout(initTimer);
      }
      if (annotatorRef.current) {
        annotatorRef.current.destroy();
        annotatorRef.current = null;
      }
      if (osdViewerRef.current) {
        osdViewerRef.current.destroy();
        osdViewerRef.current = null;
      }
    };
  }, [metadata, relativePath, loading, error, slideId, selectedBackend]); 
  // Added slideId and selectedBackend dependencies to reload if slide or backend changes.

  useEffect(() => {
      activeLayerIdRef.current = activeLayerId;
  }, [activeLayerId]);

  const decodeFeatureSlice = useCallback(async (overlayId, entry, lod) => {
    const cellState = overlayCellsRef.current[overlayId];
    if (!cellState) return;
    const pending = overlayPendingRef.current[overlayId] || new Map();
    const inFlightLod = pending.get(entry.id);
    if (typeof inFlightLod === 'number' && inFlightLod <= lod) return;
    pending.set(entry.id, lod);
    overlayPendingRef.current[overlayId] = pending;
    try {
      const slice = await cellState.fetchRange(entry.offset, entry.offset + entry.length - 1);
      const decoded = cellState.cell.decode_feature_slice(slice, lod, entry.classId);
      const coordsArray = Array.from(decoded.coords || []);
      const polygon = [];
      for (let j = 0; j < coordsArray.length; j += 2) {
        polygon.push([coordsArray[j], coordsArray[j + 1]]);
      }
      const bbox = [entry.minX, entry.minY, entry.maxX, entry.maxY];
      cellState.decoded.set(entry.id, {
        id: entry.id,
        classId: decoded.classId ?? entry.classId,
        score: typeof decoded.score === 'number' ? decoded.score : null,
        polygon,
        bbox,
        overlayId,
        lod,
      });
    } catch (e) {
      console.warn('Failed to decode feature slice', e);
    } finally {
      const currentPending = overlayPendingRef.current[overlayId];
      if (currentPending && currentPending.get(entry.id) === lod) {
        currentPending.delete(entry.id);
      }
    }
  }, []);

  const updateVisibleOverlayFeatures = useCallback(() => {
    const viewer = osdViewerRef.current;
    if (!viewer || !metadata) return;
    const item = viewer.world.getItemAt(0);
    if (!item) return;
    const topLeft = viewer.viewport.viewportToImageCoordinates(new OpenSeadragon.Point(0, 0));
    const bottomRight = viewer.viewport.viewportToImageCoordinates(new OpenSeadragon.Point(1, 1));
    const minX = Math.max(0, Math.min(topLeft.x, bottomRight.x));
    const minY = Math.max(0, Math.min(topLeft.y, bottomRight.y));
    const maxX = Math.min(metadata.width || item.getContentSize().x, Math.max(topLeft.x, bottomRight.x));
    const maxY = Math.min(metadata.height || item.getContentSize().y, Math.max(topLeft.y, bottomRight.y));
    const zoom = viewer.viewport.getZoom(true);
    const lod = zoom > 2 ? 0 : zoom > 1.2 ? 1 : 2;

    const nextData = {};
    overlays.forEach((ov) => {
      if (!overlayVisibility[ov.id]) return;
      const state = overlayCellsRef.current[ov.id];
      if (!state || !state.index) return;

      const visibleEntries = state.index.filter(
        (r) => !(r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY)
      );

      const features = [];
      let fetchBudget = 50;
      for (const entry of visibleEntries) {
        const decoded = state.decoded.get(entry.id);
        const needHigherDetail = decoded ? decoded.lod > lod : true;
        const inFlightMap = overlayPendingRef.current[ov.id] || new Map();
        const inFlightLod = inFlightMap.get(entry.id);

        if (decoded) {
          features.push(decoded);
        } else {
          // Placeholder as point
          const cx = (entry.minX + entry.maxX) / 2;
          const cy = (entry.minY + entry.maxY) / 2;
          features.push({
            id: entry.id,
            classId: entry.classId,
            score: null,
            bbox: [entry.minX, entry.minY, entry.maxX, entry.maxY],
            polygon: [[cx, cy]],
            overlayId: ov.id,
            lod,
          });
        }

        const shouldFetch =
          needHigherDetail &&
          (typeof inFlightLod !== 'number' || inFlightLod > lod);

        if (shouldFetch && fetchBudget > 0) {
          fetchBudget -= 1;
          decodeFeatureSlice(ov.id, entry, lod);
        }
      }
      nextData[ov.id] = { classes: state.classes, features, featureCount: state.index.length };
    });

    if (Object.keys(nextData).length) {
      setOverlayDataMap((prev) => ({ ...prev, ...nextData }));
    }
  }, [metadata, overlays, overlayVisibility, decodeFeatureSlice]);

  const scheduleViewportUpdate = useCallback(() => {
    if (viewportUpdateRaf.current) cancelAnimationFrame(viewportUpdateRaf.current);
    viewportUpdateRaf.current = requestAnimationFrame(() => {
      viewportUpdateRaf.current = null;
      updateVisibleOverlayFeatures();
    });
  }, [updateVisibleOverlayFeatures]);

  useEffect(() => {
    const viewer = osdViewerRef.current;
    if (!viewer) return undefined;
    const handler = () => scheduleViewportUpdate();
    viewer.addHandler('animation', handler);
    viewer.addHandler('animation-finish', handler);
    return () => {
      viewer.removeHandler('animation', handler);
      viewer.removeHandler('animation-finish', handler);
      if (viewportUpdateRaf.current) cancelAnimationFrame(viewportUpdateRaf.current);
    };
  }, [scheduleViewportUpdate]);

  useEffect(() => {
    scheduleViewportUpdate();
  }, [overlayVisibility, overlays, metadata, scheduleViewportUpdate]);

  // Load comment counts for annotations (only for visible annotations)
  const loadCommentCounts = async (annotations) => {
    if (!annotations || annotations.length === 0) return;
    
    // Only load counts for first 20 annotations to avoid performance issues
    const annotationsToCheck = annotations.slice(0, 20);
    const counts = {};
    try {
      await Promise.all(
        annotationsToCheck.map(async (ann) => {
          try {
            const comments = await annotationsApi.listComments(ann.id);
            counts[ann.id] = comments?.length || 0;
          } catch (err) {
            // Annotation might not have comment permission or no comments yet
            counts[ann.id] = 0;
          }
        })
      );
      setCommentCounts(prev => ({ ...prev, ...counts }));
    } catch (err) {
      console.error('Failed to load comment counts:', err);
    }
  };

  // Update comment count when annotation is selected
  useEffect(() => {
    if (selectedAnnotation?.id) {
      annotationsApi.listComments(selectedAnnotation.id)
        .then(comments => {
          setCommentCounts(prev => ({ ...prev, [selectedAnnotation.id]: comments?.length || 0 }));
        })
        .catch(err => {
          console.error('Failed to load comment count:', err);
        });
    }
  }, [selectedAnnotation?.id]);

  const [activeTool, setActiveTool] = useState(null);

  // Block navigation when in drawing mode
  useEffect(() => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    if (activeTool !== null) {
      // Disable all navigation gestures when drawing
      viewer.gestureSettingsMouse.clickToZoom = false;
      viewer.gestureSettingsMouse.dblClickToZoom = false;
      viewer.gestureSettingsMouse.flickEnabled = false;
      viewer.gestureSettingsMouse.pinchToZoom = false;
      viewer.gestureSettingsMouse.scrollToZoom = false;
      viewer.gestureSettingsTouch.pinchToZoom = false;
      viewer.gestureSettingsTouch.flickEnabled = false;
      // Disable panning
      viewer.gestureSettingsMouse.dragToPan = false;
      viewer.gestureSettingsTouch.dragToPan = false;
    } else {
      // Restore original gestures
      if (viewer.__originalGestures) {
        viewer.gestureSettingsMouse = { ...viewer.__originalGestures.mouse };
        viewer.gestureSettingsTouch = { ...viewer.__originalGestures.touch };
        viewer.gestureSettingsPen = { ...viewer.__originalGestures.pen };
      }
    }
  }, [activeTool]);

  // Fetch user info for cursor sharing
  useEffect(() => {
    if (!slideId) return;
    
    fetch('/api/auth/me', {
      credentials: 'include',
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          const baseUserId = data.keycloak_id || data.username || `user-${Date.now()}`;
          const username = data.username || data.email || 'Unknown';
          usernameRef.current = username;
          setCurrentUserId(data.keycloak_id || baseUserId); // Set current user ID for comments
          setCurrentUsername(username); // Set current username for layer creation
          // Generate unique connection ID: user_id + session_id (unique per browser tab)
          // This allows the same user to see their own cursor from other tabs/browsers
          const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          connectionIdRef.current = `${baseUserId}-${sessionId}`;
          userIdRef.current = baseUserId; // Keep base user ID for display
        } else {
          // Fallback
          const fallbackUserId = `user-${Date.now()}`;
          usernameRef.current = 'Unknown';
          setCurrentUserId(fallbackUserId);
          setCurrentUsername('Unknown');
          const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          connectionIdRef.current = `${fallbackUserId}-${sessionId}`;
          userIdRef.current = fallbackUserId;
        }
      })
      .catch(() => {
        const fallbackUserId = `user-${Date.now()}`;
        usernameRef.current = 'Unknown';
        setCurrentUsername('Unknown');
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        connectionIdRef.current = `${fallbackUserId}-${sessionId}`;
        userIdRef.current = fallbackUserId;
      });
  }, [slideId]);

  // WebSocket connection for cursor sharing
  useEffect(() => {
    if (!isCursorSharing || !slideId || !connectionIdRef.current || !usernameRef.current) {
      // Close existing connection if sharing is disabled
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setRemoteCursors({});
      return;
    }

    // Determine WebSocket URL (use ws:// for http, wss:// for https)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // Use connectionIdRef for unique connection, but userIdRef for display name
    const wsUrl = `${protocol}//${host}/api/cursor/ws/${slideId}?user_id=${encodeURIComponent(connectionIdRef.current)}&username=${encodeURIComponent(usernameRef.current)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      setIsWebSocketOpen(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'cursor_update') {
          // Update remote cursor position
          setRemoteCursors((prev) => {
            const updated = {
              ...prev,
              [message.userId]: {
                x: message.x,
                y: message.y,
                username: message.username,
                zoom: message.zoom
              }
            };
            return updated;
          });
        } else if (message.type === 'user_left') {
          // Remove cursor when user disconnects
          setRemoteCursors((prev) => {
            const updated = { ...prev };
            delete updated[message.userId];
            return updated;
          });
        } else if (message.type === 'user_joined') {
          // Optional: Show notification
        }
      } catch (e) {
        console.error('[Viewer] Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('[Viewer] WebSocket error:', error);
    };

    ws.onclose = () => {
      wsRef.current = null;
      setIsWebSocketOpen(false);
      // Clear remote cursors on disconnect
      setRemoteCursors({});
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isCursorSharing, slideId]);

  // Force re-render of remote cursors on viewport changes (zoom/pan)
  useEffect(() => {
    if (!isCursorSharing || Object.keys(remoteCursors).length === 0) return;
    
    const viewer = osdViewerRef.current;
    if (!viewer) return;

    const updateCursors = () => {
      // Force re-render by updating state (even with same values, React will re-render)
      setRemoteCursors((prev) => ({ ...prev }));
    };

    viewer.addHandler('animation', updateCursors);
    viewer.addHandler('zoom', updateCursors);
    viewer.addHandler('pan', updateCursors);

    return () => {
      viewer.removeHandler('animation', updateCursors);
      viewer.removeHandler('zoom', updateCursors);
      viewer.removeHandler('pan', updateCursors);
    };
  }, [isCursorSharing, remoteCursors, viewerGeneration]);

  // Send cursor position on mouse move (throttled)
  useEffect(() => {
    // Only attach listener if cursor sharing is enabled AND WebSocket is confirmed open
    if (!isCursorSharing || !isWebSocketOpen || !wsRef.current) {
      return;
    }

    const viewer = osdViewerRef.current;
    if (!viewer) return;

    const canvas = viewerContainerRef.current?.querySelector('.openseadragon-canvas');
    if (!canvas) {
      console.warn('[Viewer] Canvas not found for cursor event attachment');
      return;
    }

    const handleMouseMove = (event) => {
      // Clear previous throttle
      if (cursorThrottleRef.current) {
        clearTimeout(cursorThrottleRef.current);
      }

      // Throttle cursor updates (send every 16ms approx 60fps)
      cursorThrottleRef.current = setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }
        if (!viewer) {
          return;
        }

        // Get mouse position relative to canvas
        const rect = canvas.getBoundingClientRect();
        const pixelX = event.clientX - rect.left;
        const pixelY = event.clientY - rect.top;

        // Convert pixel coordinates to viewport coordinates, then to image coordinates
        const viewportPoint = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(pixelX, pixelY));
        const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);

        // Get current zoom level
        const zoom = viewer.viewport.getZoom();

        // Send cursor position (in image coordinates for consistency across zoom levels)
        try {
          const cursorData = {
            x: imagePoint.x,
            y: imagePoint.y,
            zoom
          };
          wsRef.current.send(JSON.stringify(cursorData));
        } catch (e) {
          console.error('[Viewer] Failed to send cursor position:', e);
        }
      }, 16);
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      if (cursorThrottleRef.current) {
        clearTimeout(cursorThrottleRef.current);
      }
    };
  }, [isCursorSharing, isWebSocketOpen, viewerGeneration]);
  
  // Re-attach create listener if needed or handle it dynamically.
  // Since the setup effect runs once (mostly), the listener is bound to initial scope.
  // We need to use `activeLayerIdRef` inside the listener.
  
  // Patch the create listener logic in the huge effect:
  // We need to rewrite the effect or use a mutable ref for the annotator and attach listeners separately?
  // Better: Use `annotatorRef.current` in a separate useEffect to attach listeners?
  // Annotorious doesn't support easy "off" for all listeners, so we might duplicate.
  // Standard pattern: Use refs for mutable values accessed in callbacks.
  
  // Updated the `createAnnotation` handler in the code below to use activeLayerIdRef.

  const parseLinePoints = (annotation) => {
    const selector = annotation?.target?.selector;
    if (!selector) {
      return null;
    }

    // Geo-style geometry (LINE tool emits this)
    if (selector?.type === 'LINE' && selector.geometry) {
      const geom = selector.geometry;
      const toNum = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
      };
      try {
        // Case 1: GeoJSON-like coordinates [[x1, y1], [x2, y2]]
        if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
          const [p1, p2] = geom.coordinates;
          if (Array.isArray(p1) && Array.isArray(p2) && p1.length >= 2 && p2.length >= 2) {
            const x1 = toNum(p1[0]);
            const y1 = toNum(p1[1]);
            const x2 = toNum(p2[0]);
            const y2 = toNum(p2[1]);
            if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
              console.log('[Viewer] Measurement parse: LINE coordinates', { id: annotation?.id, coords: geom.coordinates });
              return { x1, y1, x2, y2 };
            }
          }
        }
        // Case 2: explicit x1/y1/x2/y2
        const gx1 = toNum(geom.x1), gy1 = toNum(geom.y1), gx2 = toNum(geom.x2), gy2 = toNum(geom.y2);
        if ([gx1, gy1, gx2, gy2].every((v) => Number.isFinite(v))) {
          console.log('[Viewer] Measurement parse: LINE xy props', { id: annotation?.id, geom });
          return { x1: gx1, y1: gy1, x2: gx2, y2: gy2 };
        }
        // Case 3: points array
        if (Array.isArray(geom.points) && geom.points.length >= 2) {
          const [p1, p2] = geom.points;
          // Accept either objects {x,y} or [x,y]
          const getXY = (pt) => {
            if (Array.isArray(pt) && pt.length >= 2) return [toNum(pt[0]), toNum(pt[1])];
            return [toNum(pt?.x), toNum(pt?.y)];
          };
          const [x1, y1] = getXY(p1);
          const [x2, y2] = getXY(p2);
          if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
            return { x1, y1, x2, y2 };
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    }

    const selectorValue = selector?.value;
    if (!selectorValue) {
      return null;
    }
    try {
      const doc = new DOMParser().parseFromString(selectorValue, 'image/svg+xml');
      const lineEl = doc.querySelector('line');
      if (lineEl) {
        const x1 = parseFloat(lineEl.getAttribute('x1'));
        const y1 = parseFloat(lineEl.getAttribute('y1'));
        const x2 = parseFloat(lineEl.getAttribute('x2'));
        const y2 = parseFloat(lineEl.getAttribute('y2'));
        if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
          return { x1, y1, x2, y2 };
        }
      }
      console.warn('[Viewer] Measurement parse: no <line> found', { id: annotation?.id, selectorValue });
    } catch (e) {
      console.warn('[Viewer] Failed to parse line selector for measurement', { id: annotation?.id, selectorValue, error: e });
    }
    return null;
  };

  const formatDistance = (microns) => {
    if (!Number.isFinite(microns)) return '';
    if (microns >= 1000) {
      const mm = microns / 1000;
      return `${mm.toFixed(mm >= 10 ? 0 : 1).replace(/\\.0$/, '')} mm`;
    }
    const um = Math.max(microns, 0);
    return `${um.toFixed(um >= 10 ? 0 : 1).replace(/\\.0$/, '')} µm`;
  };

  const getMeasurementText = (annotation) => {
    if (!annotation || !micronsPerPixel) return null;
    const pts = parseLinePoints(annotation);
    if (!pts) return null;
    const pixelLength = Math.hypot(pts.x2 - pts.x1, pts.y2 - pts.y1);
    if (!Number.isFinite(pixelLength)) return null;
    const microns = pixelLength * micronsPerPixel;
    return formatDistance(microns);
  };

  // Keep for compatibility: no longer mutates annotation bodies
  const applyLineMeasurement = (annotation) => annotation;

  const handleInteractionModeChange = (mode) => {
    setInteractionMode(mode);
    setShowInteractionPalette(false);
    const ann = annotatorRef.current;

    // Reset selection & drawing
    setSelectedAnnotation(null);
    setShowEditPanel(false);
    setShowCommentsPanel(false);
    setAnnotationTooltip({ visible: false, text: '', x: 0, y: 0 });
    ann?.cancelSelection?.();

    if (ann?.setUserSelectAction) {
      ann.setUserSelectAction(mode === 'hand' ? 'NONE' : 'EDIT');
    }

    if (mode === 'hand') {
      handleStopDrawing();
    } else if (['rectangle', 'polygon', 'ellipse', 'line'].includes(mode)) {
      ann?.setDrawingEnabled?.(true);
      ann?.setDrawingTool?.(mode === 'ellipse' ? 'circle' : mode);
      setActiveTool(mode);
    } else {
      handleStopDrawing();
    }
  };

  const handleToggleOverlays = () => {
    setShowOverlayPanel((prev) => {
      const next = !prev;
      if (!prev) {
        fetchOverlays();
        setShowOverlayUploadPanel(false);
      } else {
        setShowOverlayUploadPanel(false);
      }
      return next;
    });
  };

  const handleDeleteOverlay = async (overlay) => {
    try {
      const resp = await fetch(`${window.location.origin}/api/overlays/${overlay.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || resp.statusText);
      }
      fetchOverlays();
      setOverlayDataMap((prev) => {
        const next = { ...prev };
        delete next[overlay.id];
        return next;
      });
    } catch (err) {
      setOverlaysError(err.message || 'Failed to delete overlay');
    }
  };

  // DeckGL layers for overlays (always include debug layer so Canvas mounts)

  const handleUploadOverlay = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const file = formData.get('file');
    const name = formData.get('name') || (file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'overlay');
    if (!file || !file.size) {
      setOverlayUploadStatus({ type: 'error', message: 'Please choose a GeoJSON file.' });
      return;
    }
    setOverlayUploadStatus(null);
    setOverlayUploadProgress(0);
    setIsOverlayUploading(true);

    const payload = new FormData();
    payload.append('name', name);
    payload.append('file', file);

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setOverlayUploadProgress(percentComplete);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200 || xhr.status === 201) {
          setOverlayUploadProgress(100);
          setOverlayUploadStatus({ type: 'success', message: 'Overlay upload started (processing)…' });
          fetchOverlays();
          event.target.reset();
          setTimeout(() => {
            setIsOverlayUploading(false);
            setOverlayUploadProgress(0);
          }, 400);
        } else {
          setIsOverlayUploading(false);
          setOverlayUploadProgress(0);
          setOverlayUploadStatus({ type: 'error', message: xhr.responseText || xhr.statusText || 'Upload failed' });
        }
      });

      xhr.addEventListener('error', () => {
        setIsOverlayUploading(false);
        setOverlayUploadProgress(0);
        setOverlayUploadStatus({ type: 'error', message: 'Upload failed' });
      });

      xhr.open('POST', `${window.location.origin}/api/overlays/slides/${slideId}`);
      xhr.withCredentials = true;
      xhr.send(payload);
    } catch (err) {
      setIsOverlayUploading(false);
      setOverlayUploadProgress(0);
      setOverlayUploadStatus({ type: 'error', message: err.message });
    }
  };

  const ensureMeasurementOverlay = (annotation) => {
    if (!osdViewerRef.current) return;
    const viewer = osdViewerRef.current;
    const id = annotation?.id;
    const pts = parseLinePoints(annotation);
    if (!id || !pts) {
      // Remove overlay if exists
      const existing = measurementOverlaysRef.current[id];
      if (existing) {
        viewer.removeOverlay(existing);
        delete measurementOverlaysRef.current[id];
      }
      return;
    }

    const measurementText = getMeasurementText(annotation);
    const text = measurementText || `debug-${id?.slice(0, 4)}`;

    const midX = (pts.x1 + pts.x2) / 2;
    const midY = (pts.y1 + pts.y2) / 2;
    const viewportPoint = viewer.viewport.imageToViewportCoordinates(midX, midY);

    let el = measurementOverlaysRef.current[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'annotation-measure-label';
      el.style.position = 'absolute';
      el.style.transform = 'translate(-50%, -140%)';
      el.style.background = 'rgba(0, 0, 0, 0.75)';
      el.style.color = '#fff';
      el.style.padding = '4px 8px';
      el.style.borderRadius = '6px';
      el.style.pointerEvents = 'none';
      el.style.whiteSpace = 'nowrap';
      el.style.fontSize = '11px';
      el.style.zIndex = '2000';
      viewer.addOverlay({
        element: el,
        location: viewportPoint,
        placement: OpenSeadragon.Placement.CENTER
      });
      measurementOverlaysRef.current[id] = el;
    }

    el.textContent = text;
    viewer.updateOverlay(el, viewportPoint, OpenSeadragon.Placement.CENTER);
  };

  const handleZoom = (factor) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;
    viewer.viewport.zoomBy(factor);
    viewer.viewport.applyConstraints();
  };

  const handleHome = () => {
    osdViewerRef.current?.viewport.goHome();
  };

  const handleRotate = (degrees) => {
    const viewer = osdViewerRef.current;
    if (!viewer) return;
    const current = viewer.viewport.getRotation();
    viewer.viewport.setRotation(current + degrees);
  };

  const handleUpdateAnnotation = async (newData) => {
    if (!annotatorRef.current || !selectedAnnotation) return;

    // Update defaults for next drawing
    setDefaultAnnotationStyle({
      color: newData.color,
      lineWidth: newData.lineWidth,
      opacity: newData.opacity
    });

    // Construct bodies based on form data
    const newBodies = [];
    
    // Preserve existing geometry/selector bodies (usually target)
    // Annotorious v3 structure: target is separate, bodies are content/metadata
    
    // 1. Text/Label
    if (newData.label) {
      newBodies.push({
        type: 'TextualBody',
        purpose: 'tagging',
        value: newData.label
      });
    }
    
    // 2. Value
    if (newData.value) {
      newBodies.push({
        type: 'TextualBody',
        purpose: 'value',
        value: newData.value
      });
    }
    
    // 3. Status
    if (newData.status) {
         // We might store status in properties, but let's keep it in bodies if frontend expects it there for display
         // But backend expects it in properties.
         // We will map it in `updateAnnotation` call.
    }
    
    // 4. Style
    newBodies.push({
      type: 'Style',
      purpose: 'style',
      color: newData.color,
      lineWidth: newData.lineWidth,
      opacity: newData.opacity
    });

    const updatedAnnotation = {
      ...selectedAnnotation,
      bodies: newBodies,
      properties: {
          ...selectedAnnotation.properties,
          status: newData.status // Update status in properties
      }
    };

    annotatorRef.current.updateAnnotation(updatedAnnotation);
    setSelectedAnnotation(updatedAnnotation);
    setLastAnnotationUpdate(Date.now()); // Trigger LayerPanel update
    
    // Persist
    try {
        await annotationsApi.updateAnnotation(updatedAnnotation.id, updatedAnnotation);
    } catch(e) { console.error("Failed to update annotation", e); }
  };

  const handleDeleteAnnotation = async (id) => {
    if (!annotatorRef.current) return;
    annotatorRef.current.removeAnnotation(id);
    setShowEditPanel(false);
    setSelectedAnnotation(null);
    setLastAnnotationUpdate(Date.now()); // Trigger LayerPanel update
    
    // Persist
    try {
        await annotationsApi.deleteAnnotation(id);
    } catch(e) { console.error("Failed to delete annotation", e); }
    
    // Always remove measurement overlay if present
    const overlay = measurementOverlaysRef.current[id];
    if (overlay && osdViewerRef.current) {
      osdViewerRef.current.removeOverlay(overlay);
      delete measurementOverlaysRef.current[id];
    }
  };

  // ----------------------------------------------------
  // Overlay decoding via WASM + DeckGL rendering
  // ----------------------------------------------------
  const loadOverlayData = useCallback(
    async (overlay) => {
      if (!overlay || !overlay.file_path) return;
      setIsOverlayLoadingData(true);
      try {
        if (!wasmInitPromise) {
          wasmInitPromise = import('cellor-wasm/cellor_wasm_bg.wasm?url').then((mod) =>
            initCellorWasm(mod.default)
          );
        }
        await wasmInitPromise;
        // Presign for direct range requests
        const fetchRange = async (start, end) => {
          const resp = await fetch(`/api/overlays/${overlay.id}/download`, {
            method: 'GET',
            credentials: 'include',
            headers: { Range: `bytes=${start}-${end}` },
          });
          if (!resp.ok && resp.status !== 206) throw new Error(`Range fetch failed ${resp.status}`);
          return new Uint8Array(await resp.arrayBuffer());
        };

        const parseHeader = (buf) => {
          const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          let p = 7; // skip magic
          const version = dv.getUint16(p, true); p += 2;
          const featureCount = dv.getUint32(p, true); p += 4;
          const classCount = dv.getUint16(p, true); p += 2;
          const classOffset = Number(dv.getBigUint64(p, true)); p += 8;
          const classLength = Number(dv.getBigUint64(p, true)); p += 8;
          const quadtreeOffset = Number(dv.getBigUint64(p, true)); p += 8;
          const quadtreeLength = Number(dv.getBigUint64(p, true)); p += 8;
          const indexOffset = Number(dv.getBigUint64(p, true)); p += 8;
          const indexLength = Number(dv.getBigUint64(p, true));
          return { version, featureCount, classCount, classOffset, classLength, quadtreeOffset, quadtreeLength, indexOffset, indexLength };
        };

        const headerBuf = await fetchRange(0, 255);
        const header = parseHeader(headerBuf);
        const classBuf = await fetchRange(header.classOffset, header.classOffset + header.classLength - 1);
        const classNames = [];
        let acc = [];
        classBuf.forEach((b) => {
          if (b === 0) {
            if (acc.length) {
              classNames.push(new TextDecoder().decode(new Uint8Array(acc)));
              acc = [];
            }
          } else {
            acc.push(b);
          }
        });
        if (acc.length) classNames.push(new TextDecoder().decode(new Uint8Array(acc)));

        if (!header.indexLength) {
          throw new Error('Overlay missing index section');
        }
        const indexBuf = await fetchRange(header.indexOffset, header.indexOffset + header.indexLength - 1);
        const entries = [];
        const dvIdx = new DataView(indexBuf.buffer, indexBuf.byteOffset, indexBuf.byteLength);
        const stride = 34; // bytes per index entry
        for (let p = 0; p + stride <= indexBuf.length; p += stride) {
          const id = dvIdx.getUint32(p + 0, true);
          const minX = dvIdx.getInt32(p + 4, true);
          const minY = dvIdx.getInt32(p + 8, true);
          const maxX = dvIdx.getInt32(p + 12, true);
          const maxY = dvIdx.getInt32(p + 16, true);
          const classId = dvIdx.getUint16(p + 20, true);
          const offset = Number(dvIdx.getBigUint64(p + 22, true));
          const length = dvIdx.getUint32(p + 30, true);
          entries.push({ id, minX, minY, maxX, maxY, classId, offset, length });
        }

        const cell = new Cellor();
        const fetcher = (offset, length) => fetchRange(offset, offset + length - 1).then((arr) => arr);
        cell.load_cell_parts(headerBuf, classBuf, indexBuf, fetcher);

        overlayCellsRef.current[overlay.id] = {
          cell,
          classes: classNames,
          index: entries,
          decoded: new Map(),
          fetchRange,
        };
        overlayPendingRef.current[overlay.id] = new Map();

        setOverlayDataMap((prev) => ({
          ...prev,
          [overlay.id]: { classes: classNames, features: [], featureCount: entries.length },
        }));
        scheduleViewportUpdate();
      } catch (err) {
        console.error('[Viewer] Failed to load overlay', err);
        setOverlaysError(err.message || 'Failed to load overlay');
      } finally {
        setIsOverlayLoadingData(false);
      }
    },
    []
  );

  const handleToggleOverlayVisibility = useCallback(
    (overlay) => {
      if (overlay.status !== 'ready' || !overlay.file_path) {
        setOverlaysError('Overlay is not ready yet');
        return;
      }
      setOverlayVisibility((prev) => {
        const current = prev[overlay.id];
        const nextVisible = current === undefined ? true : !current;
        return { ...prev, [overlay.id]: nextVisible };
      });
      const loaded = overlayDataMap[overlay.id];
      if (!loaded) {
        // lazily load overlay data when first toggled on
        loadOverlayData(overlay);
      } else {
        // already loaded
      }
    },
    [overlayDataMap, loadOverlayData]
  );

  const handleUpdateClassStyle = useCallback((overlayId, classId, style) => {
    setOverlayStyles((prev) => {
      const prevOv = prev[overlayId] || { classStyles: {}, scoreGradient: { minColor: '#22c55e', maxColor: '#ef4444' } };
      return {
        ...prev,
        [overlayId]: {
          ...prevOv,
          classStyles: { ...prevOv.classStyles, [classId]: style },
        },
      };
    });
    if (osdViewerRef.current?.forceRedraw) {
      osdViewerRef.current.forceRedraw();
    }
  }, []);

  const handleUpdateScoreGradient = useCallback((overlayId, gradient) => {
    setOverlayStyles((prev) => {
      const prevOv = prev[overlayId] || { classStyles: {}, scoreGradient: { minColor: '#22c55e', maxColor: '#ef4444' } };
      return {
        ...prev,
        [overlayId]: { ...prevOv, scoreGradient: { ...prevOv.scoreGradient, ...gradient } },
      };
    });
    if (osdViewerRef.current?.forceRedraw) {
      osdViewerRef.current.forceRedraw();
    }
  }, []);

  // Auto-load visible overlays so they render without manual toggle
  useEffect(() => {
    overlays.forEach((overlay) => {
      const isVisible = overlayVisibility[overlay.id] === true;
      const hasData = !!overlayDataMap[overlay.id];
      if (isVisible && overlay.status === 'ready' && overlay.file_path && !hasData) {
        loadOverlayData(overlay);
      }
    });
  }, [overlays, overlayVisibility, overlayDataMap, loadOverlayData]);

  // Ensure style entries exist when data is available
  useEffect(() => {
    setOverlayStyles((prev) => {
      const next = { ...prev };
      overlays.forEach((ov) => {
        if (overlayDataMap[ov.id] && !next[ov.id]) {
          next[ov.id] = {
            classStyles: {},
            scoreGradient: { minColor: '#22c55e', maxColor: '#ef4444' },
          };
        }
      });
      return next;
    });
  }, [overlays, overlayDataMap]);

  // Default overlays to hidden when first loaded
  useEffect(() => {
    setOverlayVisibility((prev) => {
      const next = { ...prev };
      overlays.forEach((ov) => {
        if (next[ov.id] === undefined) next[ov.id] = false;
      });
      return next;
    });
  }, [overlays]);

  const handleToggleAnnotation = (tool) => {
    const annotator = annotatorRef.current;
    if (!annotator) {
      console.warn('[Viewer] Annotator not initialized');
      return;
    }
    console.log('[Viewer] Setting drawing tool:', tool);
    annotator.setDrawingEnabled(true);
    annotator.setDrawingTool(tool);
    setActiveTool(tool);
  };

  const handleStopDrawing = () => {
    const annotator = annotatorRef.current;
    if (!annotator) return;
    
    annotator.setDrawingEnabled(false);
    setActiveTool(null);
  };
  
  // Rewrite createAnnotation in the useEffect to use activeLayerIdRef
  // We need to inject the Ref check.
  
  // ... Scale Logic ...
  useEffect(() => {
    const viewer = osdViewerRef.current;
    const mpp = micronsPerPixel;
    if (!viewer || !mpp) {
      setScaleInfo({ label: '', length: 0 });
      return;
    }

    const getScreenLengthForMicrons = (micronsValue) => {
      const imagePixels = micronsValue / mpp;
      const startViewport = viewer.viewport.imageToViewportCoordinates(0, 0);
      const endViewport = viewer.viewport.imageToViewportCoordinates(imagePixels, 0);
      const startPixel = viewer.viewport.pixelFromPoint(startViewport, true);
      const endPixel = viewer.viewport.pixelFromPoint(endViewport, true);
      return Math.abs(endPixel.x - startPixel.x);
    };

    const updateScale = () => {
      const allowedMicronValues = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

      const targetLength = 150; 
      let chosenMicrons = allowedMicronValues[0];
      let chosenLength = getScreenLengthForMicrons(chosenMicrons);
      let bestDiff = Math.abs(chosenLength - targetLength);

      for (let i = 1; i < allowedMicronValues.length; i += 1) {
        const candidate = allowedMicronValues[i];
        const length = getScreenLengthForMicrons(candidate);
        const diff = Math.abs(length - targetLength);
        if (diff < bestDiff) {
          bestDiff = diff;
          chosenMicrons = candidate;
          chosenLength = length;
        }
      }

      let label = '';
      if (chosenMicrons >= 1000) {
        const mmValue = chosenMicrons / 1000;
        const formatted = mmValue.toFixed(mmValue >= 10 ? 0 : 1).replace(/\.0$/, '');
        label = `${formatted} mm`;
      } else {
        const micronsValue = Math.round(chosenMicrons);
        label = `${micronsValue} µm`;
      }

      setScaleInfo({ label, length: chosenLength });
    };

    updateScale();
    viewer.addHandler('zoom', updateScale);
    viewer.addHandler('animation', updateScale);

    return () => {
      viewer.removeHandler('zoom', updateScale);
      viewer.removeHandler('animation', updateScale);
    };
  }, [micronsPerPixel, viewerGeneration]);

  useEffect(() => {
    // Recompute measurements/overlays if scale changes
    if (!annotatorRef.current || !micronsPerPixel) return;
    const anns = annotatorRef.current.getAnnotations ? annotatorRef.current.getAnnotations() : [];
    if (!Array.isArray(anns)) return;
    anns.forEach((ann) => {
      const measured = applyLineMeasurement(ann);
      annotatorRef.current.updateAnnotation(measured);
      ensureMeasurementOverlay(measured);
    });
  }, [micronsPerPixel]);

  // Removed polling approach; rely on changeSelectionTarget and updateAnnotation events

  const handleScalePointerMove = (event) => {
    const state = dragStateRef.current;
    if (!state.active) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    setScalePosition({
      x: Math.max(4, state.originX + deltaX),
      y: Math.max(4, state.originY - deltaY),
    });
  };

  const handleScalePointerUp = () => {
    dragStateRef.current.active = false;
    window.removeEventListener('pointermove', handleScalePointerMove);
    window.removeEventListener('pointerup', handleScalePointerUp);
  };

  const handleScalePointerDown = (event) => {
    event.preventDefault();
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: scalePosition.x,
      originY: scalePosition.y,
    };
    window.addEventListener('pointermove', handleScalePointerMove);
    window.addEventListener('pointerup', handleScalePointerUp);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      
      const viewer = osdViewerRef.current;
      if (!viewer) return;

      switch(e.key) {
        case '+':
        case '=':
          viewer.viewport.zoomBy(1.2);
          viewer.viewport.applyConstraints();
          break;
        case '-':
          viewer.viewport.zoomBy(1 / 1.2);
          viewer.viewport.applyConstraints();
          break;
        case '0':
          viewer.viewport.goHome();
          break;
        case 'r':
        case 'R':
          if (e.shiftKey) {
            viewer.viewport.setRotation(viewer.viewport.getRotation() - 90);
          } else {
            viewer.viewport.setRotation(viewer.viewport.getRotation() + 90);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const viewerBody = (
    <div className="osd-viewer-body">
      {loading && <p className="osd-viewer-loading">Loading slide data…</p>}
      {error && <p className="osd-viewer-error">Error: {error}</p>}
      {!loading && !error && metadata && (
        <div className="osd-viewer-canvas-wrapper">
          <div className="osd-viewer-canvas" ref={viewerContainerRef} />
          <div
            id="osd-viewer-navigator"
            className="osd-viewer-minimap"
            ref={navigatorContainerRef}
          />
          <div className="osd-viewer-controls">
            {/* Group 0: Search */}
            {onSearch && (
              <button type="button" onClick={onSearch} aria-label="Search Slides">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              </button>
            )}

            {onSearch && <div style={{ width: '18px' }}></div>}

            {/* Group 1: Navigation */}
            <button type="button" onClick={() => handleZoom(1.2)} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => handleZoom(1 / 1.2)} aria-label="Zoom out">−</button>
            <button type="button" onClick={handleHome} aria-label="Reset view">○</button>
            <button type="button" onClick={() => handleRotate(90)} aria-label="Rotate">↻</button>
            {onToggleFullscreen && (
              <button 
                type="button" 
                onClick={onToggleFullscreen} 
                className={isFullscreen ? 'active' : ''}
                aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                )}
              </button>
            )}

            <div style={{ width: '18px' }}></div>

            {/* Group 2: Interaction picker & Layers */}
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                type="button"
                onClick={() => setShowInteractionPalette(prev => !prev)}
                className={interactionMode === 'select' ? 'active' : ''}
                title={interactionMode === 'hand' ? 'Hand (pan only)' : 'Select / Draw'}
              >
                {interactionMode === 'hand' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 13V5a2 2 0 1 1 4 0v3" /><path d="M12 8V4a2 2 0 1 1 4 0v7" /><path d="M16 11V6a2 2 0 1 1 4 0v6c0 4-2 6-6 6h-2c-4 0-6-2-6-6v-2a2 2 0 0 1 4 0v2" /></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" /></svg>
                )}
              </button>
              {showInteractionPalette && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '110%',
                    background: '#1f1f1f',
                    borderRadius: '0',
                    padding: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                    zIndex: 1200
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('hand')}
                    className={interactionMode === 'hand' ? 'active' : ''}
                    title="Hand (pan only)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 13V5a2 2 0 1 1 4 0v3" /><path d="M12 8V4a2 2 0 1 1 4 0v7" /><path d="M16 11V6a2 2 0 1 1 4 0v6c0 4-2 6-6 6h-2c-4 0-6-2-6-6v-2a2 2 0 0 1 4 0v2" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('select')}
                    className={interactionMode === 'select' ? 'active' : ''}
                    title="Select / Draw"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('rectangle')}
                    className={interactionMode === 'rectangle' ? 'active' : ''}
                    title="Draw Rectangle"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('polygon')}
                    className={interactionMode === 'polygon' ? 'active' : ''}
                    title="Draw Polygon"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 22h20L12 2z" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('ellipse')}
                    className={interactionMode === 'ellipse' ? 'active' : ''}
                    title="Draw Circle"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInteractionModeChange('line')}
                    className={interactionMode === 'line' ? 'active' : ''}
                    title="Measure"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="8" x2="2" y2="16" /><line x1="6" y1="10" x2="6" y2="14" /><line x1="10" y1="8" x2="10" y2="16" /><line x1="14" y1="10" x2="14" y2="14" /><line x1="18" y1="8" x2="18" y2="16" /><line x1="22" y1="8" x2="22" y2="16" /></svg>
                  </button>
                </div>
              )}
            </div>
            <button 
                type="button" 
                onClick={() => setShowLayerPanel(prev => !prev)} 
                className={showLayerPanel ? 'active' : ''}
                aria-label="Layers"
                title="Layers"
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
            </button>
            <button
              type="button"
              onClick={handleToggleOverlays}
              className={showOverlayPanel ? 'active' : ''}
              title="Overlays"
              aria-label="Overlays"
            >
              <i className="pi pi-clone" style={{ fontSize: '12px' }}></i>
            </button>

            <div style={{ width: '18px' }}></div>

            {/* Group 2.5: Cursor Sharing */}
            <button 
              type="button" 
              onClick={() => setIsCursorSharing(prev => !prev)} 
              className={isCursorSharing ? 'active' : ''}
              title={isCursorSharing ? "Stop Sharing Cursor" : "Share Cursor"}
              aria-label={isCursorSharing ? "Stop Sharing Cursor" : "Share Cursor"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isCursorSharing ? (
                  <path d="M3 3l18 18M9 9l6 6M15 9l-6 6" />
                ) : (
                  <>
                    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                    <path d="M13 13l6 6" />
                  </>
                )}
              </svg>
            </button>

            <div style={{ width: '18px' }}></div>

            {/* Group 2.6: Backend Selector */}
            <button 
              type="button" 
              onClick={() => {
                // Cycle through: null (auto) -> openslide -> bioformats -> null
                if (selectedBackend === null) {
                  setSelectedBackend('openslide');
                } else if (selectedBackend === 'openslide') {
                  setSelectedBackend('bioformats');
                } else {
                  setSelectedBackend(null);
                }
              }}
              className={selectedBackend ? 'active' : ''}
              title={
                selectedBackend === 'openslide' 
                  ? 'Using OpenSlide backend (click to switch)' 
                  : selectedBackend === 'bioformats'
                  ? 'Using BioFormats backend (click to switch)'
                  : 'Auto-select backend (click to force OpenSlide)'
              }
              aria-label="Switch Backend"
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {selectedBackend === 'openslide' ? (
                  // OpenSlide icon (layers)
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                ) : selectedBackend === 'bioformats' ? (
                  // BioFormats icon (cube/package)
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                ) : (
                  // Auto-select icon (switch/arrows)
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                )}
              </svg>
              <span style={{ fontSize: '9px', fontWeight: selectedBackend ? '600' : '400' }}>
                {selectedBackend === 'openslide' ? 'OS' : selectedBackend === 'bioformats' ? 'BF' : 'AUTO'}
              </span>
            </button>

            <div style={{ width: '18px' }}></div>

            {/* Group 3: Annotation Tools */}
            <div style={{ width: '18px' }}></div>

            {/* Group 4: Shortcuts, Metadata */}
            {onToggleShortcuts && (
              <button type="button" onClick={onToggleShortcuts} aria-label="Shortcuts">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </button>
            )}
            {onToggleMetadata && (
              <button type="button" onClick={onToggleMetadata} aria-label="Metadata">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              </button>
            )}
            {selectedAnnotation && (
              <button 
                type="button" 
                onClick={() => setShowCommentsPanel(prev => !prev)} 
                className={showCommentsPanel ? 'active' : ''}
                aria-label="Comments"
                title="Comments"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {commentCounts[selectedAnnotation.id] > 0 && (
                  <span className="comment-count-badge">{commentCounts[selectedAnnotation.id]}</span>
                )}
              </button>
            )}
          </div>
          {scaleInfo.label && (
            <div
              className="osd-viewer-scale"
              style={{ left: scalePosition.x, bottom: scalePosition.y }}
              onPointerDown={handleScalePointerDown}
            >
              <div className="osd-viewer-scale-line" style={{ width: `${scaleInfo.length}px` }} />
              <span>{scaleInfo.label}</span>
            </div>
          )}
          <OverlayListPanel
            isOpen={showOverlayPanel}
            overlays={overlays}
            loading={overlaysLoading}
            error={overlaysError}
            visibility={overlayVisibility}
            onToggle={handleToggleOverlayVisibility}
            onDelete={handleDeleteOverlay}
            onEdit={(overlay) => {
              setStylePanelOverlay(overlay);
              const hasData = overlayDataMap[overlay.id];
              if (!hasData && overlay.status === 'ready' && overlay.file_path) {
                loadOverlayData(overlay);
              }
            }}
            featureCounts={Object.fromEntries(
              overlays.map((ov) => [
                ov.id,
                overlayDataMap[ov.id]?.featureCount ??
                  overlayDataMap[ov.id]?.features?.length ??
                  0,
              ])
            )}
            onClose={() => {
              setShowOverlayPanel(false);
              setShowOverlayUploadPanel(false);
            }}
            onOpenUpload={() => setShowOverlayUploadPanel(true)}
            position={overlayPanelPosition}
            setPosition={setOverlayPanelPosition}
          />
          <OverlayUploadPanel
            isOpen={showOverlayUploadPanel}
            onClose={() => setShowOverlayUploadPanel(false)}
            onSubmit={handleUploadOverlay}
            status={overlayUploadStatus}
            uploading={isOverlayUploading}
            progress={overlayUploadProgress}
            position={overlayUploadPosition}
            setPosition={setOverlayUploadPosition}
          />
          <OverlayStylePanel
            isOpen={!!stylePanelOverlay}
            overlay={stylePanelOverlay}
            data={stylePanelOverlay ? overlayDataMap[stylePanelOverlay.id] : null}
            styleState={stylePanelOverlay ? overlayStyles[stylePanelOverlay.id] : null}
            onClose={() => setStylePanelOverlay(null)}
            onChangeClassStyle={(classId, style) =>
              stylePanelOverlay && handleUpdateClassStyle(stylePanelOverlay.id, classId, style)
            }
            onChangeScoreGradient={(gradient) =>
              stylePanelOverlay && handleUpdateScoreGradient(stylePanelOverlay.id, gradient)
            }
            position={overlayStylePosition}
            setPosition={setOverlayStylePosition}
          />
          <div
            className="overlay-canvas-layer"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2000 }}
          >
            <OverlayCanvas
              viewerRef={osdViewerRef}
              overlays={overlays}
              overlayDataMap={overlayDataMap}
              overlayVisibility={overlayVisibility}
              overlayStyles={overlayStyles}
              metadata={metadata}
              viewerGeneration={viewerGeneration}
              onHover={setOverlayTooltip}
            />
          </div>
          <div
            className="annotation-tooltip"
            style={{
              position: 'fixed',
              left: annotationTooltip.x,
              top: annotationTooltip.y,
              transform: 'translate(-50%, -100%)',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: '6px',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 1000,
              fontSize: '12px',
              opacity: annotationTooltip.visible ? 1 : 0,
              visibility: annotationTooltip.visible ? 'visible' : 'hidden',
              transition: 'opacity 120ms ease',
            }}
          >
            {annotationTooltip.text}
          </div>
          <div
            className="annotation-tooltip"
            style={{
              position: 'fixed',
              left: overlayTooltip.x,
              top: overlayTooltip.y,
              transform: 'translate(-50%, -100%)',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: '6px',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 1000,
              fontSize: '12px',
              opacity: overlayTooltip.visible ? 1 : 0,
              visibility: overlayTooltip.visible ? 'visible' : 'hidden',
              transition: 'opacity 120ms ease',
            }}
          >
            {overlayTooltip.text}
          </div>
          
          {/* 
            Remote cursors overlay
            Rendered inside: <div className="osd-viewer-canvas-wrapper">
            Position: absolute, relative to .osd-viewer-canvas-wrapper (which has position: relative)
            DOM structure:
              <div className="osd-viewer-canvas-wrapper">  <!-- position: relative -->
                <div className="osd-viewer-canvas" />  <!-- OpenSeadragon viewer -->
                <div className="osd-viewer-minimap" />
                <div className="osd-viewer-controls" />
                <div className="osd-viewer-remote-cursor" />  <!-- Cursors rendered here -->
              </div>
          */}
          {/* Remote cursors overlay */}
          {osdViewerRef.current && Object.entries(remoteCursors).map(([userId, cursor]) => {
            // Filter out own cursor
            if (userId === connectionIdRef.current) {
              return null;
            }
            
            // Convert image coordinates to viewport coordinates, then to pixel coordinates
            const viewer = osdViewerRef.current;
            if (!viewer) {
              return null;
            }
            
            try {
              // Cursor coordinates are in image space (level 0, full resolution)
              const imagePoint = new OpenSeadragon.Point(cursor.x, cursor.y);
              
              // Convert image coordinates to viewport coordinates
              const viewportPoint = viewer.viewport.imageToViewportCoordinates(imagePoint);
              
              // Get the canvas wrapper element (where we're positioning the cursor)
              const wrapper = viewerContainerRef.current?.closest('.osd-viewer-canvas-wrapper');
              
              // Get elements for offset calculation
              const canvasEl = viewer.element;
              
              if (!wrapper || !canvasEl) return null;
              
              // Convert viewport coordinates to pixel coordinates relative to the viewer element (canvas)
              const pixelPoint = viewer.viewport.pixelFromPoint(viewportPoint, false);
              
              // Calculate offset of canvas within wrapper
              // This handles cases where canvas might not be at 0,0 of wrapper
              const canvasRect = canvasEl.getBoundingClientRect();
              const wrapperRect = wrapper.getBoundingClientRect();
              
              const offsetX = canvasRect.left - wrapperRect.left;
              const offsetY = canvasRect.top - wrapperRect.top;
              
              const finalX = pixelPoint.x + offsetX;
              const finalY = pixelPoint.y + offsetY;
              
              // Only render if coordinates are valid and within reasonable bounds
              // Expanded bounds to allow cursors slightly off-screen
              if (!isNaN(finalX) && !isNaN(finalY) && 
                  isFinite(finalX) && isFinite(finalY) &&
                  finalX >= -500 && finalX <= (wrapperRect.width) + 500 &&
                  finalY >= -500 && finalY <= (wrapperRect.height) + 500) {
                return (
                  <div
                    key={userId}
                    className="osd-viewer-remote-cursor"
                    style={{
                      left: `${finalX}px`,
                      top: `${finalY}px`,
                    }}
                  >
                    <div className="osd-viewer-remote-cursor__pointer" />
                    <div className="osd-viewer-remote-cursor__label">
                      <span className="osd-viewer-remote-cursor__username">{cursor.username}</span>
                      <span className="osd-viewer-remote-cursor__zoom">{cursor.zoom?.toFixed(2)}x</span>
                    </div>
                  </div>
                );
              } else {
                // Out of bounds
              }
              return null;
            } catch (e) {
              console.error('[Viewer] Error rendering remote cursor:', e);
              return null;
            }
          })}
        </div>
      )}
    </div>
  );

  const handleLayerDeleted = (deletedLayerId) => {
    // If current selected annotation belongs to deleted layer, close panel
    if (selectedAnnotation && selectedAnnotation.properties?.layerId === deletedLayerId) {
        setShowEditPanel(false);
        setSelectedAnnotation(null);
    }
  };

  const viewerChrome = (
    <>
      {viewerBody}
      {showEditPanel && selectedAnnotation ? (
        <AnnotationEditPanel 
          annotation={selectedAnnotation}
          isOpen={showEditPanel}
          onClose={() => setShowEditPanel(false)}
          onUpdate={handleUpdateAnnotation}
          onDelete={handleDeleteAnnotation}
          defaultValues={defaultAnnotationStyle}
          lastUsedLabel={lastUsedLabel}
          setLastUsedLabel={setLastUsedLabel}
          onToggleComments={() => setShowCommentsPanel(prev => !prev)}
          commentCount={commentCounts[selectedAnnotation.id] || 0}
          showCommentsPanel={showCommentsPanel}
        />
      ) : null}
      {showCommentsPanel && selectedAnnotation && currentUserId ? (
        <CommentsPanel
          annotation={selectedAnnotation}
          isOpen={showCommentsPanel}
          onClose={() => setShowCommentsPanel(false)}
          currentUserId={currentUserId}
        />
      ) : null}
      <LayerPanel
        slideId={slideId}
        isOpen={showLayerPanel}
        onClose={() => setShowLayerPanel(false)}
        activeLayerId={activeLayerId}
        onSelectLayer={(id) => setActiveLayerId(id)}
        onSelectAnnotation={(ann) => {
            setSelectedAnnotation(ann);
            setShowEditPanel(true);
        }}
        annotator={annotatorRef.current}
        onDraw={(tool) => handleToggleAnnotation(tool || 'polygon')}
        selectedAnnotation={selectedAnnotation} // Force re-render on selection update
        lastAnnotationUpdate={lastAnnotationUpdate} // Force refresh on structural changes
        onDeleteLayer={handleLayerDeleted}
      />
    </>
  );

  if (fullPage) {
    return <div className="osd-viewer-container osd-viewer-container--fullpage">{viewerChrome}</div>;
  }

  return (
    <div className="osd-viewer-overlay" onClick={onClose ?? undefined}>
      <div className="osd-viewer-container" onClick={(e) => e.stopPropagation()}>
        {viewerChrome}
      </div>
    </div>
  );
}
