import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import type { OverlayClassStyle, OverlayFeature, OverlaySource } from "../../domain/workspace";
import {
  defaultOdColorScale,
  defaultOverlayLegend,
  inferOverlaySemanticMode,
  odGradientCss,
  odPaletteCss,
  OD_PALETTES,
  OD_PALETTE_META,
  type OdColorScale,
  type OdPalette,
} from "../../viewer/overlayStyling";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Props = {
  overlay: OverlaySource;
  features: OverlayFeature[];
  styles: Record<string, OverlayClassStyle>;
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onStyleChange: (key: string, style: OverlayClassStyle) => void;
  odScale?: OdColorScale | null;
  onOdScaleChange?: (scale: OdColorScale) => void;
};

// ─── Snap helper ─────────────────────────────────────────────────────────────

function snapVal(raw: number, scale: OdColorScale): number {
  const range = scale.max - scale.min;
  if (range <= 0) return scale.min;
  const step = Math.pow(10, Math.floor(Math.log10(range)) - 1);
  return Math.round(raw / step) * step;
}

// ─── Palette picker popover ───────────────────────────────────────────────────

const PALETTE_KEYS = Object.keys(OD_PALETTES) as OdPalette[];

function PalettePicker({
  current,
  onChange,
}: {
  current: OdPalette;
  onChange: (p: OdPalette) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const meta = OD_PALETTE_META[current];

  return (
    <div ref={wrapRef} style={{ position: "relative", marginBottom: 10 }}>
      {/* Trigger button — shows current palette gradient strip + name */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 5,
          padding: "5px 8px",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <div
          style={{
            flex: 1,
            height: 16,
            borderRadius: 3,
            background: `linear-gradient(to right, ${odPaletteCss(current)})`,
          }}
        />
        <span style={{ fontSize: 11, opacity: 0.8, whiteSpace: "nowrap" }}>{meta.label}</span>
        <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? "▲" : "▼"}</span>
      </button>

      {/* Dropdown list */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 200,
            background: "rgba(20,22,32,0.97)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            maxHeight: 340,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {PALETTE_KEYS.map((p) => {
            const m = OD_PALETTE_META[p];
            const isActive = p === current;
            return (
              <button
                key={p}
                type="button"
                onClick={() => { onChange(p); setOpen(false); }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  width: "100%",
                  padding: "7px 8px",
                  border: "none",
                  borderRadius: 4,
                  background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                  cursor: "pointer",
                  color: "inherit",
                  textAlign: "left",
                  marginBottom: 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 14,
                      borderRadius: 3,
                      background: `linear-gradient(to right, ${odPaletteCss(p)})`,
                    }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: isActive ? 1 : 0.8, whiteSpace: "nowrap" }}>
                    {m.label}
                  </span>
                  {isActive && <span style={{ fontSize: 10, opacity: 0.6 }}>✓</span>}
                </div>
                <span style={{ fontSize: 10, opacity: 0.5, lineHeight: 1.3, paddingLeft: 0 }}>
                  {m.description}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Interactive breakpoint bar ───────────────────────────────────────────────

function OdBreakpointBar({
  scale,
  onChange,
}: {
  scale: OdColorScale;
  onChange: (scale: OdColorScale) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<null | 1 | 2>(null);

  const pctOf = (val: number) =>
    scale.max > scale.min ? ((val - scale.min) / (scale.max - scale.min)) * 100 : 50;

  const valFromClientX = useCallback(
    (clientX: number): number => {
      if (!barRef.current) return scale.min;
      const rect = barRef.current.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return snapVal(scale.min + frac * (scale.max - scale.min), scale);
    },
    [scale],
  );

  const applyHandle = useCallback(
    (handle: 1 | 2, val: number) => {
      const minGap = (scale.max - scale.min) / 20;
      if (handle === 1) {
        onChange({
          ...scale,
          breakpoint1: Math.min(Math.max(scale.min, val), scale.breakpoint2 - minGap),
        });
      } else {
        onChange({
          ...scale,
          breakpoint2: Math.max(Math.min(scale.max, val), scale.breakpoint1 + minGap),
        });
      }
    },
    [scale, onChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const val = valFromClientX(e.clientX);
      const d1 = Math.abs(val - scale.breakpoint1);
      const d2 = Math.abs(val - scale.breakpoint2);
      const handle: 1 | 2 = d1 <= d2 ? 1 : 2;
      dragging.current = handle;
      e.currentTarget.setPointerCapture(e.pointerId);
      applyHandle(handle, val);
    },
    [valFromClientX, scale, applyHandle],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      applyHandle(dragging.current, valFromClientX(e.clientX));
    },
    [valFromClientX, applyHandle],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const bp1pct = pctOf(scale.breakpoint1);
  const bp2pct = pctOf(scale.breakpoint2);

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Value bubbles — above tick handles */}
      <div style={{ position: "relative", height: 20, marginBottom: 8 }}>
        {([1, 2] as const).map((h) => {
          const pct = Math.max(8, Math.min(92, h === 1 ? bp1pct : bp2pct));
          const val = h === 1 ? scale.breakpoint1 : scale.breakpoint2;
          return (
            <div
              key={h}
              style={{
                position: "absolute",
                left: `${pct.toFixed(1)}%`,
                transform: "translateX(-50%)",
                background: "rgba(18,18,28,0.9)",
                color: "rgba(255,255,255,0.85)",
                fontSize: 10,
                padding: "2px 6px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.18)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                fontVariantNumeric: "tabular-nums",
                lineHeight: "16px",
              }}
            >
              {val.toFixed(4)}
            </div>
          );
        })}
      </div>

      {/* Interactive gradient bar */}
      <div
        ref={barRef}
        style={{
          position: "relative",
          height: 22,
          borderRadius: 4,
          background: `linear-gradient(to right, ${odGradientCss(scale)})`,
          border: "1px solid rgba(255,255,255,0.12)",
          cursor: "crosshair",
          userSelect: "none",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {([1, 2] as const).map((h) => {
          const pct = h === 1 ? bp1pct : bp2pct;
          return (
            <div
              key={h}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${pct.toFixed(1)}%`,
                width: 12,
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  width: 3,
                  height: "100%",
                  background: "rgba(255,255,255,0.95)",
                  boxShadow: "0 0 5px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.5)",
                  borderRadius: 2,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Min / max labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontSize: 10,
          opacity: 0.45,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{scale.min.toFixed(4)}</span>
        <span>{scale.max.toFixed(4)}</span>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function OverlayStylePanel(props: Props) {
  const mode = inferOverlaySemanticMode(props.features, props.overlay);
  // Show OD section whenever a scale is initialized — inferOverlayHasOd on a sparse feature
  // sample at heatmap zoom can return false even when the overlay has OD data.
  const hasOd = !!props.odScale;
  const items = defaultOverlayLegend(props.overlay, props.features, mode);
  const { odScale, onOdScaleChange } = props;

  return (
    <FloatingPanelFrame
      panelId="overlay-style"
      title="Overlay Style"
      position={props.position}
      zIndex={props.zIndex}
      subtitle={props.overlay.name}
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
    >
      <div className="workspace-stack">

        {/* ── OD intensity scale ────────────────────────────────────────── */}
        {hasOd && odScale && onOdScaleChange ? (
          <div className="workspace-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <strong>OD Intensity Scale</strong>
              <button
                type="button"
                className="workspace-toolbar__button"
                style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                title="Reset to default"
                onClick={() => onOdScaleChange(defaultOdColorScale(props.features))}
              >
                <RotateCcw size={13} strokeWidth={1.8} />
              </button>
            </div>

            <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 10 }}>
              Drag handles or click bar · 0% = class only · 100% = pure OD map
            </div>

            <PalettePicker
              current={odScale.palette ?? "dab"}
              onChange={(p) => onOdScaleChange({ ...odScale, palette: p })}
            />

            <OdBreakpointBar scale={odScale} onChange={onOdScaleChange} />

            {/* Intensity slider */}
            <label>
              <span style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span>Intensity</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {Math.round((odScale.intensity ?? 0.65) * 100)}%
                </span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={odScale.intensity ?? 0.65}
                onChange={(e) =>
                  onOdScaleChange({ ...odScale, intensity: Number(e.target.value) })
                }
              />
            </label>
          </div>
        ) : null}

        {/* ── Class / score controls ────────────────────────────────────── */}
        {items.length === 0 ? (
          <div className="workspace-empty">No styleable classes found.</div>
        ) : null}
        {items.map((item) => {
          const style = props.styles[item.key] ?? { color: item.color, opacity: 0.35, strokeWidth: 2 };
          const hidden = style.hidden ?? false;
          return (
            <div key={item.key} className="workspace-card" style={{ opacity: hidden ? 0.45 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong>{item.label}</strong>
                <button
                  type="button"
                  className="workspace-toolbar__button"
                  style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                  title={hidden ? "Show class" : "Hide class"}
                  onClick={() => props.onStyleChange(item.key, { ...style, hidden: !hidden })}
                >
                  {hidden
                    ? <EyeOff size={14} strokeWidth={1.8} />
                    : <Eye size={14} strokeWidth={1.8} />}
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Color
                <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 28,
                      height: 28,
                      borderRadius: 4,
                      background: style.color,
                      border: "1px solid rgba(0,0,0,0.25)",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="color"
                    value={style.color}
                    onChange={(event) =>
                      props.onStyleChange(item.key, { ...style, color: event.target.value })
                    }
                    style={{
                      position: "absolute",
                      inset: 0,
                      opacity: 0,
                      cursor: "pointer",
                      width: "100%",
                      height: "100%",
                      padding: 0,
                      border: "none",
                    }}
                  />
                </span>
                <code style={{ fontSize: 11, opacity: 0.7 }}>{style.color}</code>
              </label>
              <label>
                <span style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Opacity</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(style.opacity * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={style.opacity}
                  onChange={(event) =>
                    props.onStyleChange(item.key, { ...style, opacity: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          );
        })}
      </div>
    </FloatingPanelFrame>
  );
}
