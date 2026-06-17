import { type PointerEvent, type PropsWithChildren, type ReactNode } from "react";

type Props = PropsWithChildren<{
  panelId: string;
  title: string;
  position: { x: number; y: number };
  zIndex: number;
  subtitle?: ReactNode;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose?: () => void;
  actions?: ReactNode;
}>;

export function FloatingPanelFrame({
  panelId,
  title,
  position,
  zIndex,
  subtitle,
  onPositionChange,
  onBringToFront,
  onClose,
  actions,
  children
}: Props) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const headerElement = event.currentTarget;
    const panelElement = headerElement.parentElement;
    const workspaceElement =
      panelElement?.closest(".workspace-body") ?? panelElement?.offsetParent ?? document.documentElement;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...position };
    onBringToFront();
    if ((event.target as HTMLElement | null)?.closest("button,input,textarea,select,label")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      const width = workspaceElement instanceof HTMLElement ? workspaceElement.clientWidth : window.innerWidth;
      const height = workspaceElement instanceof HTMLElement ? workspaceElement.clientHeight : window.innerHeight;
      const panelWidth = panelElement?.offsetWidth ?? 360;
      const panelHeight = panelElement?.offsetHeight ?? 320;
      const nextX = Math.max(8, Math.min(width - panelWidth - 8, origin.x + moveEvent.clientX - startX));
      const nextY = Math.max(8, Math.min(height - panelHeight - 8, origin.y + moveEvent.clientY - startY));
      onPositionChange({ x: nextX, y: nextY });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      headerElement.releasePointerCapture(pointerId);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside
      className="workspace-panel workspace-stack"
      data-panel-id={panelId}
      style={{ left: position.x, top: position.y, zIndex }}
      onPointerDown={onBringToFront}
    >
      <header className="workspace-panel__header" onPointerDown={onPointerDown}>
        <div className="workspace-panel__header-row">
          <h3 className="workspace-panel__title">{title}</h3>
          <div className="workspace-panel__actions">
            {actions}
            {onClose ? (
              <button type="button" className="workspace-panel__close" aria-label={`Close ${title}`} onClick={onClose}>
                ×
              </button>
            ) : null}
          </div>
        </div>
        {subtitle ? <p className="workspace-panel__subtle">{subtitle}</p> : null}
      </header>
      {children}
    </aside>
  );
}
