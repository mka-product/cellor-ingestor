import { useRef } from "react";

type Props = {
  slideId: string;
  thumbnailPath: string;
  width: number;
  height: number;
  rect: { left: number; top: number; width: number; height: number };
  remoteRects?: Array<{ left: number; top: number; width: number; height: number; userId: string }>;
  onMoveToPoint: (normalizedX: number, normalizedY: number) => void;
  onDragDelta: (deltaX: number, deltaY: number) => void;
};

export function MiniMap({ slideId, thumbnailPath, width, height, rect, remoteRects = [], onMoveToPoint, onDragDelta }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const normalizedPoint = (clientX: number, clientY: number) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return calculateNormalizedMinimapPoint(clientX, clientY, bounds, width, height);
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={(event) => {
        dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
        (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        const deltaX = event.clientX - dragRef.current.x;
        const deltaY = event.clientY - dragRef.current.y;
        const moved = dragRef.current.moved || Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
        dragRef.current = { x: event.clientX, y: event.clientY, moved };
        if (moved) {
          const normalizedDelta = calculateNormalizedMinimapDelta(deltaX, deltaY, width, height);
          onDragDelta(normalizedDelta.x, normalizedDelta.y);
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current && !dragRef.current.moved) {
          const point = normalizedPoint(event.clientX, event.clientY);
          if (point) {
            onMoveToPoint(point.x, point.y);
          }
        }
        dragRef.current = null;
        (event.currentTarget as HTMLDivElement).releasePointerCapture?.(event.pointerId);
      }}
      style={{
        position: "absolute",
        left: 16,
        top: 16,
        width,
        height,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.35)",
        boxShadow: "0 12px 28px rgba(15,23,42,0.35)",
        cursor: "pointer",
        background: "rgba(15,23,42,0.92)",
        zIndex: 4
      }}
    >
      <img alt={`${slideId} minimap`} src={thumbnailPath} style={{ display: "block", width: "100%", height: "100%" }} />
      {remoteRects.map((remote) => (
        <div
          key={remote.userId}
          title={`${remote.userId} viewport`}
          style={{
            position: "absolute",
            left: remote.left,
            top: remote.top,
            width: Math.max(6, remote.width),
            height: Math.max(6, remote.height),
            border: "1px solid rgba(248, 113, 113, 0.95)",
            background: "rgba(248,113,113,0.08)",
            boxSizing: "border-box",
            pointerEvents: "none"
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: rect.left,
          top: rect.top,
          width: Math.max(8, rect.width),
          height: Math.max(8, rect.height),
          border: "2px solid #38bdf8",
          background: "rgba(56,189,248,0.12)",
          boxSizing: "border-box"
        }}
      />
    </div>
  );
}

export function calculateNormalizedMinimapPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  fallbackWidth: number,
  fallbackHeight: number
) {
  const safeWidth = bounds.width || fallbackWidth;
  const safeHeight = bounds.height || fallbackHeight;
  return {
    x: Math.max(0, Math.min(1, (clientX - bounds.left) / safeWidth)),
    y: Math.max(0, Math.min(1, (clientY - bounds.top) / safeHeight))
  };
}

export function calculateNormalizedMinimapDelta(deltaX: number, deltaY: number, width: number, height: number) {
  return {
    x: deltaX / width,
    y: deltaY / height
  };
}
