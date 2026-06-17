import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';

// Inline CanvasOverlayHd (adapted from plugin) to avoid global/UMD issues.
class CanvasOverlayHd {
  constructor(viewer, options) {
    this._viewer = viewer;
    this.backingScale = 1;
    this._containerWidth = 0;
    this._containerHeight = 0;
    this._canvasdiv = document.createElement('div');
    this._canvasdiv.style.position = 'absolute';
    this._canvasdiv.style.left = 0;
    this._canvasdiv.style.top = 0;
    this._canvasdiv.style.width = '100%';
    this._canvasdiv.style.height = '100%';
    this._canvasdiv.style.pointerEvents = 'none';
    this._canvasdiv.style.zIndex = 1;
    this._viewer.canvas.appendChild(this._canvasdiv);
    this._canvas = document.createElement('canvas');
    this._canvas.style.pointerEvents = 'none';
    this._canvas.style.zIndex = 1;
    this._canvas.style.background = 'transparent';
    this._canvasdiv.appendChild(this._canvas);
    this.onRedraw = options.onRedraw || (() => {});
    this.clearBeforeRedraw = options.clearBeforeRedraw !== undefined ? options.clearBeforeRedraw : true;

    this._viewer.addHandler('update-viewport', () => {
      this.resize();
      this._updateCanvas();
    });
    this._viewer.addHandler('open', () => {
      this.resize();
      this._updateCanvas();
    });
  }

  canvas() {
    return this._canvas;
  }

  context2d() {
    return this._canvas.getContext('2d');
  }

  clear() {
    this._canvas.getContext('2d').clearRect(0, 0, this._containerWidth * this.backingScale, this._containerHeight * this.backingScale);
  }

  resize() {
    let backingScale = 1;
    if (typeof window !== 'undefined' && 'devicePixelRatio' in window) {
      backingScale = window.devicePixelRatio;
    }
    const backingScaleUpdated = this.backingScale !== backingScale;
    this.backingScale = backingScale;

    this._canvasdiv.style.transform = this._viewer.viewport.getFlip() ? 'scaleX(-1)' : null;

    if (this._containerWidth !== this._viewer.container.clientWidth || backingScaleUpdated) {
      this._containerWidth = this._viewer.container.clientWidth;
      this._canvasdiv.setAttribute('width', backingScale * this._containerWidth);
      this._canvas.setAttribute('width', backingScale * this._containerWidth);
      this._canvas.style.width = `${this._containerWidth}px`;
    }

    if (this._containerHeight !== this._viewer.container.clientHeight || backingScaleUpdated) {
      this._containerHeight = this._viewer.container.clientHeight;
      this._canvasdiv.setAttribute('height', backingScale * this._containerHeight);
      this._canvas.setAttribute('height', backingScale * this._containerHeight);
      this._canvas.style.height = `${this._containerHeight}px`;
    }
  }

  _updateCanvas() {
    const viewportZoom = this._viewer.viewport.getZoom(true);
    if (this.clearBeforeRedraw) {
      this.clear();
    }
    const context = this._canvas.getContext('2d');
    for (let i = 0, count = this._viewer.world.getItemCount(); i < count; i += 1) {
      const image = this._viewer.world.getItemAt(i);
      if (image) {
        const zoom = image.viewportToImageZoom(viewportZoom);
        const vp = image.imageToViewportCoordinates(0, 0, true);
        const p = this._viewer.viewport.pixelFromPoint(vp, true);
        context.scale(this.backingScale, this.backingScale);
        context.translate(p.x, p.y);
        context.scale(zoom, zoom);
        this.onRedraw({ index: i, context, x: p.x, y: p.y, zoom });
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }
}

// Canvas overlay using CanvasOverlayHd; draw in image coordinates.
export function OverlayCanvas({
  viewerRef,
  overlays,
  overlayDataMap,
  overlayVisibility,
  overlayStyles,
  metadata,
  viewerGeneration,
  onHover,
}) {
  const overlayRef = useRef(null);
  const tileCacheRef = useRef({});
  const TILE_SIZE = 1024;
  const overlaysRef = useRef(overlays);
  const overlayDataMapRef = useRef(overlayDataMap);
  const overlayVisibilityRef = useRef(overlayVisibility);
  const overlayStylesRef = useRef(overlayStyles);
  const metadataRef = useRef(metadata);

  useEffect(() => {
    overlaysRef.current = overlays;
    overlayDataMapRef.current = overlayDataMap;
    overlayVisibilityRef.current = overlayVisibility;
    overlayStylesRef.current = overlayStyles;
    metadataRef.current = metadata;
  }, [overlays, overlayDataMap, overlayVisibility, overlayStyles, metadata]);

  const pointInPolygon = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Build tile cache (per overlay -> tiles -> class -> Path2D)
  useEffect(() => {
    const nextCache = {};
    overlays.forEach((ov) => {
      const data = overlayDataMap[ov.id];
      if (!data?.features) return;
      const tiles = new Map();
      data.features.forEach((f) => {
        const coords = f.polygon;
        if (!Array.isArray(coords) || coords.length === 0) return;
        const cls = f.classId || 0;
        let bbox = f.bbox;
        if (!bbox || bbox.length !== 4) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach(([x, y]) => {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          });
          bbox = [minX, minY, maxX, maxY];
        }
        const [minX, minY, maxX, maxY] = bbox;
        const tx0 = Math.floor(minX / TILE_SIZE);
        const tx1 = Math.floor(maxX / TILE_SIZE);
        const ty0 = Math.floor(minY / TILE_SIZE);
        const ty1 = Math.floor(maxY / TILE_SIZE);
        for (let tx = tx0; tx <= tx1; tx += 1) {
          for (let ty = ty0; ty <= ty1; ty += 1) {
            const key = `${tx},${ty}`;
            let tile = tiles.get(key);
            if (!tile) {
              tile = {
                bbox: [tx * TILE_SIZE, ty * TILE_SIZE, (tx + 1) * TILE_SIZE, (ty + 1) * TILE_SIZE],
                classes: new Map(),
                features: [],
              };
              tiles.set(key, tile);
            }
            // If feature has a numeric score, draw individually for gradient coloring
            if (typeof f.score === 'number') {
              const path = new Path2D();
              if (coords.length === 1) {
                const [px, py] = coords[0];
                path.moveTo(px, py);
                path.arc(px, py, 6, 0, Math.PI * 2);
              } else {
                path.moveTo(coords[0][0], coords[0][1]);
                for (let j = 1; j < coords.length; j += 1) {
                  path.lineTo(coords[j][0], coords[j][1]);
                }
                path.closePath();
              }
              tile.scores = tile.scores || [];
              tile.scores.push({ path, score: f.score });
            } else {
              let path = tile.classes.get(cls);
              if (!path) {
                path = new Path2D();
                tile.classes.set(cls, path);
              }
              if (coords.length === 1) {
                const [px, py] = coords[0];
                path.moveTo(px, py);
                path.arc(px, py, 6, 0, Math.PI * 2);
              } else {
                path.moveTo(coords[0][0], coords[0][1]);
                for (let j = 1; j < coords.length; j += 1) {
                  path.lineTo(coords[j][0], coords[j][1]);
                }
                path.closePath();
              }
            }
            tile.features.push({
              polygon: coords,
              bbox,
              classId: cls,
              score: f.score,
              overlayId: ov.id,
            });
          }
        }
      });
      nextCache[ov.id] = { tiles };
    });
    tileCacheRef.current = nextCache;
  }, [overlays, overlayDataMap, viewerGeneration]);

  // Hover hit test on tiles
  useEffect(() => {
    const viewer = viewerRef?.current;
    if (!viewer) return undefined;
    const targetEl = viewer?.container;
    if (!targetEl) return undefined;

    const handleMove = (evt) => {
      const currentOverlays = overlaysRef.current || [];
      const currentVisibility = overlayVisibilityRef.current || {};
      const tilesCache = tileCacheRef.current || {};
      const currentDataMap = overlayDataMapRef.current || {};
      const rect = targetEl.getBoundingClientRect();
      const pixel = new OpenSeadragon.Point(evt.clientX - rect.left, evt.clientY - rect.top);
      const viewportPoint = viewer.viewport.pointFromPixel(pixel, true);
      const imagePoint = viewer.viewport.viewportToImageCoordinates(viewportPoint);

      const tx = Math.floor(imagePoint.x / TILE_SIZE);
      const ty = Math.floor(imagePoint.y / TILE_SIZE);
      const key = `${tx},${ty}`;

      let found = null;
      for (const ov of currentOverlays) {
        if (currentVisibility[ov.id] === false) continue;
        const tiles = tilesCache[ov.id]?.tiles;
        if (!tiles) continue;
        const tile = tiles.get(key);
        if (!tile?.features) continue;
        for (const f of tile.features) {
          const [bx0, by0, bx1, by1] = f.bbox || [];
          if (bx0 > imagePoint.x || bx1 < imagePoint.x || by0 > imagePoint.y || by1 < imagePoint.y) continue;
          if (f.polygon.length === 1 || pointInPolygon(imagePoint.x, imagePoint.y, f.polygon)) {
            found = f;
            break;
          }
        }
        if (found) break;
      }

      if (found && onHover) {
        const classes = currentDataMap[found.overlayId]?.classes || [];
        const classLabel =
          typeof found.classId === 'number' && classes[found.classId] ? classes[found.classId] : null;
        const pieces = [];
        if (typeof found.score === 'number') {
          pieces.push(`Score: ${found.score}`);
        }
        if (classLabel || typeof found.classId === 'number') {
          pieces.push(`Class: ${classLabel || found.classId}`);
        }
        if (pieces.length === 0) {
          onHover({ visible: false });
          return;
        }
        onHover({
          x: evt.clientX,
          y: evt.clientY - 12,
          text: pieces.join(' | '),
          visible: true,
        });
      } else if (onHover) {
        onHover({ visible: false });
      }
    };

    const handleLeave = () => {
      if (onHover) onHover({ visible: false });
    };

    targetEl.addEventListener('pointermove', handleMove, { passive: true });
    targetEl.addEventListener('pointerleave', handleLeave, { passive: true });
    return () => {
      targetEl.removeEventListener('pointermove', handleMove);
      targetEl.removeEventListener('pointerleave', handleLeave);
    };
  }, [viewerRef, onHover, viewerGeneration]);

  const drawAll = (opts) => {
    const ctx = opts.context;
    const viewer = viewerRef?.current;
    if (!ctx || !viewer) return;

    const currentOverlays = overlaysRef.current || [];
    const currentDataMap = overlayDataMapRef.current || {};
    const currentVisibility = overlayVisibilityRef.current || {};
    const currentMeta = metadataRef.current;
    const currentStyles = overlayStylesRef.current || {};

    const hexToRgba = (hex, alpha = 1) => {
      if (!hex) return `rgba(0,0,0,${alpha})`;
      let h = hex.replace('#', '');
      if (h.length === 3) {
        h = h.split('').map((c) => c + c).join('');
      }
      const intVal = parseInt(h, 16);
      const r = (intVal >> 16) & 255;
      const g = (intVal >> 8) & 255;
      const b = intVal & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    };

    const lerpColor = (a, b, t) => {
      const parse = (hex) => {
        let h = hex.replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const intVal = parseInt(h, 16);
        return [(intVal >> 16) & 255, (intVal >> 8) & 255, intVal & 255];
      };
      const [ar, ag, ab] = parse(a);
      const [br, bg, bb] = parse(b);
      const r = Math.round(ar + (br - ar) * t);
      const g = Math.round(ag + (bg - ag) * t);
      const bcol = Math.round(ab + (bb - ab) * t);
      return `rgba(${r},${g},${bcol},0.5)`;
    };

    const visibleOverlays = currentOverlays.filter(
      (ov) => currentVisibility[ov.id] !== false && tileCacheRef.current[ov.id]?.tiles
    );

    // Compute view bounds in image space from viewport
    const width = viewer.container.clientWidth || 1;
    const height = viewer.container.clientHeight || 1;
    const tl = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(0, 0));
    const br = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(width, height));
    const tlImg = viewer.viewport.viewportToImageCoordinates(tl);
    const brImg = viewer.viewport.viewportToImageCoordinates(br);
    const minX = Math.min(tlImg.x, brImg.x);
    const maxX = Math.max(tlImg.x, brImg.x);
    const minY = Math.min(tlImg.y, brImg.y);
    const maxY = Math.max(tlImg.y, brImg.y);

    visibleOverlays.forEach((ov) => {
      const tiles = tileCacheRef.current[ov.id]?.tiles;
      const styles = currentStyles[ov.id] || {};
      const classStyles = styles.classStyles || {};
      const scoreGradient = styles.scoreGradient || { minColor: '#22c55e', maxColor: '#ef4444' };
      if (!tiles) return;
      tiles.forEach((tile) => {
        const [bx0, by0, bx1, by1] = tile.bbox;
        if (bx1 < minX || bx0 > maxX || by1 < minY || by0 > maxY) return;
        tile.classes.forEach((path, cls) => {
          const style = classStyles[cls] || {};
          const fillColor = style.color || null;
          const opacity = typeof style.opacity === 'number' ? style.opacity : 0.3;
          if (fillColor) {
            ctx.fillStyle = hexToRgba(fillColor, opacity);
            ctx.strokeStyle = hexToRgba(fillColor, Math.min(opacity + 0.2, 1));
          } else {
            const hue = (cls * 57) % 360;
            ctx.fillStyle = `rgba(${hue % 255}, ${(hue * 3) % 255}, ${(hue * 7) % 255}, ${opacity})`;
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          }
          ctx.lineWidth = 1 / opts.zoom;
          ctx.fill(path);
          ctx.stroke(path);
        });
        if (tile.scores?.length) {
          tile.scores.forEach((s) => {
            const t = Math.max(0, Math.min(1, s.score));
            ctx.fillStyle = lerpColor(scoreGradient.minColor || '#22c55e', scoreGradient.maxColor || '#ef4444', t);
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 1 / opts.zoom;
            ctx.fill(s.path);
            ctx.stroke(s.path);
          });
        }
      });
    });
  };

  useEffect(() => {
    const viewer = viewerRef?.current;
    if (!viewer) return undefined;

    // Clear old overlay if any
    if (overlayRef.current) {
      overlayRef.current.clear?.();
      overlayRef.current = null;
    }

    const overlay = new CanvasOverlayHd(viewer, {
      clearBeforeRedraw: true,
      onRedraw: drawAll,
    });
    overlayRef.current = overlay;
    if (typeof viewer.forceRedraw === 'function') {
      viewer.forceRedraw();
    } else {
      overlayRef.current?._updateCanvas?.();
    }

    return () => {
      overlayRef.current?.clear?.();
      overlayRef.current = null;
    };
  }, [viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef?.current;
    if (viewer?.forceRedraw) {
      viewer.forceRedraw();
    } else {
      overlayRef.current?._updateCanvas?.();
    }
  }, [overlays, overlayDataMap, overlayVisibility, overlayStyles, metadata, viewerGeneration]);

  return null;
}
