import { useEffect, useRef, useState } from "react";
import { resolveApiUrl } from "../infrastructure/apiBase";
import { authedFetch } from "../lib/authedFetch";

interface StorageStatus {
  endpoint: string;
  bucket: string;
  secure: boolean;
  reachable: boolean;
  bucket_ok: boolean;
  error: string | null;
}

interface StorageForm {
  endpoint: string;
  access_key: string;
  secret_key: string;
  bucket: string;
  secure: boolean;
}

export function S3StatusIndicator() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StorageForm>({ endpoint: "", access_key: "", secret_key: "", bucket: "", secure: true });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  function loadStatus() {
    setChecking(true);
    authedFetch(resolveApiUrl("/system/storage"))
      .then((r) => r.json() as Promise<StorageStatus>)
      .then((data) => {
        setStatus(data);
        setForm((f) => ({ ...f, endpoint: data.endpoint, bucket: data.bucket, secure: data.secure }));
      })
      .catch(() => setStatus(null))
      .finally(() => setChecking(false));
  }

  useEffect(() => { loadStatus(); }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  async function handleApply() {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await authedFetch(resolveApiUrl("/system/storage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json() as StorageStatus & { detail?: string };
      if (!res.ok) {
        setFeedback({ ok: false, message: data.detail ?? "Failed" });
      } else {
        setStatus(data);
        setForm((f) => ({ ...f, secret_key: "" }));
        setFeedback({ ok: true, message: "Connection updated" });
      }
    } catch {
      setFeedback({ ok: false, message: "Network error" });
    }
    setSaving(false);
  }

  const isConnected = !checking && !!status?.reachable && !!status?.bucket_ok;
  const stateClass = checking ? "is-connecting" : isConnected ? "is-connected" : "is-unavailable";
  const statusText = checking
    ? "Checking…"
    : isConnected
    ? `${status!.endpoint}`
    : (status?.error ?? "Unreachable");

  return (
    <div ref={wrapRef} className="s3-indicator-wrap">
      <div className={`s3-indicator ${stateClass}`}>
        <span className="s3-indicator__dot" />
        <span className="s3-indicator__label">Storage</span>
        <button
          type="button"
          className="s3-indicator__menu-btn"
          onClick={() => { setOpen((o) => !o); setFeedback(null); }}
          aria-label="Configure storage connection"
        >
          ···
        </button>
      </div>

      {open && (
        <div className="s3-config-popover">
          <div className="s3-config-popover__header">
            <span>Storage Connection</span>
            <button type="button" className="s3-config-popover__close" onClick={() => setOpen(false)}>×</button>
          </div>

          <div className="s3-config-popover__body">
            <label className="s3-config-popover__field">
              <span>Endpoint</span>
              <input
                type="text"
                value={form.endpoint}
                onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
                placeholder="s3.example.com or host:port"
                autoComplete="off"
              />
            </label>
            <label className="s3-config-popover__field">
              <span>Access Key</span>
              <input
                type="text"
                value={form.access_key}
                onChange={(e) => setForm((f) => ({ ...f, access_key: e.target.value }))}
                placeholder="Access key ID"
                autoComplete="off"
              />
            </label>
            <label className="s3-config-popover__field">
              <span>Secret Key</span>
              <input
                type="password"
                value={form.secret_key}
                onChange={(e) => setForm((f) => ({ ...f, secret_key: e.target.value }))}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
              />
            </label>
            <label className="s3-config-popover__field">
              <span>Bucket</span>
              <input
                type="text"
                value={form.bucket}
                onChange={(e) => setForm((f) => ({ ...f, bucket: e.target.value }))}
                placeholder="my-bucket"
                autoComplete="off"
              />
            </label>
            <label className="s3-config-popover__checkbox">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(e) => setForm((f) => ({ ...f, secure: e.target.checked }))}
              />
              HTTPS (secure)
            </label>
          </div>

          <div className="s3-config-popover__footer">
            <div className={`s3-config-popover__probe ${stateClass}`}>
              <span className="s3-indicator__dot" />
              <span>{statusText}</span>
            </div>
            {feedback && (
              <p className={`s3-config-popover__feedback ${feedback.ok ? "is-ok" : "is-error"}`}>
                {feedback.message}
              </p>
            )}
            <div className="s3-config-popover__actions">
              <button type="button" className="workspace-nav" onClick={loadStatus} disabled={checking}>
                {checking ? "…" : "Re-check"}
              </button>
              <button type="button" className="workspace-nav" onClick={handleApply} disabled={saving || checking}>
                {saving ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
