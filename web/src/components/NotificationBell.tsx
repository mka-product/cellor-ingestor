import { useEffect, useRef } from "react";
import { Bell, BriefcaseBusiness, CheckCheck, MessageSquareReply, PencilLine, Trash2, X } from "lucide-react";
import { useNotifications, type AppNotification } from "../lib/notificationStore";

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NotificationIcon({ type }: { type: AppNotification["type"] }) {
  if (type === "reply") return <MessageSquareReply size={13} strokeWidth={1.8} />;
  if (type === "annotation_change") return <PencilLine size={13} strokeWidth={1.8} />;
  return <BriefcaseBusiness size={13} strokeWidth={1.8} />;
}

type Props = {
  open: boolean;
  onToggle: () => void;
};

export function NotificationBell({ open, onToggle }: Props) {
  const { notifications, unreadCount, markAllRead, dismiss, clearAll } = useNotifications();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onToggle();
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onToggle]);

  useEffect(() => {
    if (open && unreadCount > 0) markAllRead();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className="notif-wrap">
      <button
        type="button"
        className={`notif-btn${open ? " is-active" : ""}`}
        onClick={onToggle}
        aria-label="Notifications"
      >
        <Bell size={15} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-popover">
          <div className="notif-popover__header">
            <span>Notifications</span>
            <div className="notif-popover__header-actions">
              {notifications.length > 0 && (
                <button
                  type="button"
                  className="workspace-toolbar__button"
                  title="Clear all"
                  onClick={clearAll}
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="workspace-toolbar__button"
                  title="Mark all read"
                  onClick={markAllRead}
                >
                  <CheckCheck size={12} strokeWidth={1.8} />
                </button>
              )}
            </div>
          </div>

          <div className="notif-popover__list">
            {notifications.length === 0 ? (
              <div className="notif-empty">No notifications</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item${n.read ? "" : " is-unread"}${n.type === "job_failed" ? " notif-item--failed" : ""}`}
                >
                  <span className="notif-item__icon">
                    <NotificationIcon type={n.type} />
                  </span>
                  <div className="notif-item__body">
                    <div className="notif-item__title">{n.title}</div>
                    <div className="notif-item__desc">{n.body}</div>
                    <div className="notif-item__time">{relativeTime(n.createdAt)}</div>
                  </div>
                  <button
                    type="button"
                    className="notif-item__dismiss"
                    onClick={() => dismiss(n.id)}
                    title="Dismiss"
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
