export type AppNotification = {
  id: string;
  type: "reply" | "annotation_change" | "job_done" | "job_failed";
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  slideId?: string;
  annotationId?: string;
  jobId?: string;
};

type Listener = () => void;

const STORAGE_KEY = "cellor_notifications_v1";
const MAX_ITEMS = 50;

class NotificationStore {
  private items: AppNotification[] = [];
  private listeners: Listener[] = [];

  constructor() {
    this.load();
    // Sync across browser tabs
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY) this.load();
    });
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.items = raw ? (JSON.parse(raw) as AppNotification[]) : [];
    } catch {
      this.items = [];
    }
    this.emit();
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items.slice(0, MAX_ITEMS)));
    } catch {}
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  get all(): readonly AppNotification[] {
    return this.items;
  }

  get unreadCount(): number {
    return this.items.filter((n) => !n.read).length;
  }

  add(item: Omit<AppNotification, "id" | "createdAt" | "read">): AppNotification {
    const n: AppNotification = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      read: false,
    };
    this.items = [n, ...this.items];
    this.save();
    this.emit();
    return n;
  }

  markAllRead() {
    this.items = this.items.map((n) => ({ ...n, read: true }));
    this.save();
    this.emit();
  }

  dismiss(id: string) {
    this.items = this.items.filter((n) => n.id !== id);
    this.save();
    this.emit();
  }

  clearAll() {
    this.items = [];
    this.save();
    this.emit();
  }
}

export const notificationStore = new NotificationStore();

import { useEffect, useState } from "react";

export function useNotifications() {
  const [, forceUpdate] = useState(0);
  useEffect(() => notificationStore.subscribe(() => forceUpdate((n) => n + 1)), []);
  return {
    notifications: notificationStore.all,
    unreadCount: notificationStore.unreadCount,
    markAllRead: () => notificationStore.markAllRead(),
    dismiss: (id: string) => notificationStore.dismiss(id),
    clearAll: () => notificationStore.clearAll(),
  };
}
