/*
Purpose: resolve HTTP and WebSocket API endpoints consistently for relative and absolute API base URLs.
Owner context: Viewer and Operations frontend infrastructure.
Invariants: returned URLs are absolute when required by browser APIs such as WebSocket and preserve same-origin behavior for relative paths.
Failure modes: malformed environment URLs fall back to safe same-origin defaults instead of crashing component render.
*/

function defaultApiBase(): string {
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://localhost:8000";
  }
  return "";
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? defaultApiBase();

export function apiBasePath(): string {
  return API_BASE.replace(/\/$/, "");
}

export function resolveApiUrl(path: string): string {
  const base = apiBasePath();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  try {
    return new URL(`${base}${suffix}`, window.location.origin).toString();
  } catch {
    return `${base}${suffix}`;
  }
}

export function resolveApiOrigin(): string | null {
  try {
    return new URL(apiBasePath(), window.location.origin).origin;
  } catch {
    return null;
  }
}

export function resolveApiAssetUrl(path: string): string {
  try {
    return new URL(path, resolveApiOrigin() ?? window.location.origin).toString();
  } catch {
    return path;
  }
}

export function resolveWebSocketUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  try {
    const apiUrl = new URL(`${apiBasePath()}${suffix}`, window.location.origin);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    return apiUrl.toString();
  } catch {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${apiBasePath()}${suffix}`;
  }
}
