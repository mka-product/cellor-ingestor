type Props = {
  label: string;
  pixels: number;
  position: { x: number; y: number };
  onPositionChange: (position: { x: number; y: number }) => void;
};

export function ScaleBar({ label, pixels, position, onPositionChange }: Props) {
  if (!label || pixels <= 0) return null;
  return (
    <div
      onPointerDown={(event) => {
        const startX = event.clientX;
        const startY = event.clientY;
        const origin = { ...position };
        const onMove = (moveEvent: PointerEvent) => {
          onPositionChange({
            x: Math.max(8, origin.x + moveEvent.clientX - startX),
            y: Math.max(8, origin.y + moveEvent.clientY - startY)
          });
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        zIndex: 4,
        padding: "10px 12px",
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(10,11,17,0.92)",
        cursor: "grab"
      }}
    >
      <div style={{ marginBottom: 6, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ width: pixels, borderTop: "3px solid white" }} />
    </div>
  );
}
