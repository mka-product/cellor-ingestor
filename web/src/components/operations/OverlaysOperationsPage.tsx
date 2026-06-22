import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import type { CatalogSlide, OverlayJob } from "../../domain/catalog";
import { fetchOverlayJobs, fetchSlides, uploadOverlayFile } from "../../infrastructure/catalogClient";

// --- Drop zone (same pattern as SlidesOperationsPage) ---

function OverlayDropZone(props: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) props.onFiles(files);
  };

  const handleInputChange = () => {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length > 0) props.onFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      className={`workspace-dropzone${isDragging ? " is-dragging" : ""}${props.disabled ? " is-disabled" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !props.disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop overlay files here or click to browse"
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        // No accept filter — the server validates format; restricting here blocks valid files.
        onChange={handleInputChange}
        style={{ display: "none" }}
      />
      <div className="workspace-dropzone__icon">↑</div>
      <div className="workspace-dropzone__label">
        Drop overlay files here or <strong>click to browse</strong>
      </div>
      <div className="workspace-panel__subtle">
        GeoJSON, GeoParquet, Tile-grid JSON, OVSI, and any other format supported by the server — multiple files accepted.
      </div>
    </div>
  );
}

// --- helpers ---

function formatSeconds(value?: number) {
  return typeof value === "number" ? `${value.toFixed(2)} s` : "-";
}

function guessSourceFormat(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) return "geojson";
  if (lower.endsWith(".parquet") || lower.endsWith(".geoparquet")) return "geoparquet";
  if (lower.endsWith(".ovsi") || lower.endsWith(".ovsip")) return "ovsi";
  if (lower.endsWith(".csv")) return "tile-grid-json";
  return "geojson";
}

type QueuedFile = {
  id: string;
  file: File;
  sourceFormat: string;
  displayName: string;
};

// --- main component ---

export function OverlaysOperationsPage() {
  const [slides, setSlides] = useState<CatalogSlide[]>([]);
  const [jobs, setJobs] = useState<OverlayJob[]>([]);
  const [slideId, setSlideId] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [nextSlides, nextJobs] = await Promise.all([fetchSlides(controller.signal), fetchOverlayJobs(controller.signal)]);
        setSlides(nextSlides);
        setJobs(nextJobs);
        if (!slideId && nextSlides[0]) {
          setSlideId(nextSlides[0].slide_id);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(error instanceof Error ? error.message : "Failed to load overlay upload state");
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [slideId]);

  useEffect(() => {
    if (!activeJobId) return;
    const activeJob = jobs.find((job) => job.job_id === activeJobId);
    if (!activeJob) return;
    if (activeJob.status === "succeeded") {
      setStatus(`Completed ${activeJob.name}`);
      setActiveJobId(null);
      setIsSubmitting(false);
      return;
    }
    if (activeJob.status === "failed") {
      setStatus(activeJob.message ?? `Upload failed for ${activeJob.name}`);
      setActiveJobId(null);
      setIsSubmitting(false);
      return;
    }
    setStatus(`${activeJob.name} · ${activeJob.stage}`);
  }, [activeJobId, jobs]);

  const activeJob = useMemo(
    () => (activeJobId ? jobs.find((job) => job.job_id === activeJobId) ?? null : null),
    [activeJobId, jobs]
  );

  const progressValue = activeJob?.progress_percent ?? (isSubmitting ? 5 : 0);

  const handleFiles = useCallback((files: File[]) => {
    setQueuedFiles((current) => {
      const existingNames = new Set(current.map((q) => q.id));
      const newItems: QueuedFile[] = files
        .filter((f) => !existingNames.has(f.name))
        .map((f) => ({
          id: f.name,
          file: f,
          sourceFormat: guessSourceFormat(f.name),
          displayName: f.name.replace(/\.[^.]+$/, "")
        }));
      return [...current, ...newItems];
    });
  }, []);

  const removeFile = (id: string) => setQueuedFiles((current) => current.filter((q) => q.id !== id));

  const updateFileFormat = (id: string, sourceFormat: string) =>
    setQueuedFiles((current) => current.map((q) => (q.id === id ? { ...q, sourceFormat } : q)));

  const updateDisplayName = (id: string, displayName: string) =>
    setQueuedFiles((current) => current.map((q) => (q.id === id ? { ...q, displayName } : q)));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (queuedFiles.length === 0 || !slideId || isSubmitting) return;
    setIsSubmitting(true);

    for (const queued of queuedFiles) {
      setStatus(`Uploading ${queued.file.name}…`);
      try {
        const formData = new FormData();
        formData.set("file", queued.file);
        formData.set("slide_id", slideId);
        formData.set("source_format", queued.sourceFormat);
        formData.set("display_name", queued.displayName || queued.file.name.replace(/\.[^.]+$/, ""));
        const job = await uploadOverlayFile(formData);
        setJobs((current) => [job, ...current.filter((existing) => existing.job_id !== job.job_id)]);
        setActiveJobId(job.job_id);
        setStatus(`Queued ${job.name}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : `Upload failed for ${queued.file.name}`);
        setIsSubmitting(false);
        return;
      }
    }

    setQueuedFiles([]);
    setIsFormOpen(false);
    setIsSubmitting(false);
  };

  return (
    <section className="workspace-operations">
      <div className="workspace-operations__card">
        <div className="workspace-operations__header">
          <h2>Overlay Upload</h2>
          <button type="button" className="workspace-button" onClick={() => setIsFormOpen((current) => !current)}>
            {isFormOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {isFormOpen ? (
          <form className="workspace-operations__form workspace-form-grid" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span>Target Slide</span>
              <select value={slideId} onChange={(event) => setSlideId(event.target.value)}>
                {slides.map((slide) => (
                  <option key={`${slide.slide_id}:${slide.version_id}`} value={slide.slide_id}>
                    {slide.display_name}
                  </option>
                ))}
              </select>
            </label>
            <OverlayDropZone onFiles={handleFiles} disabled={isSubmitting} />
            {queuedFiles.length > 0 ? (
              <div className="workspace-operations__upload-summary">
                {queuedFiles.map((queued) => (
                  <div key={queued.id} className="workspace-card" style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ wordBreak: "break-all" }}>{queued.file.name}</strong>
                        <div className="workspace-panel__subtle">
                          {(queued.file.size / (1024 * 1024)).toFixed(1)} MB
                        </div>
                      </div>
                      <button
                        type="button"
                        className="workspace-icon-button"
                        onClick={() => removeFile(queued.id)}
                        title="Remove"
                        style={{ flexShrink: 0 }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="workspace-operations__field-row" style={{ marginTop: 8 }}>
                      <label>
                        <span>Format</span>
                        <select
                          value={queued.sourceFormat}
                          onChange={(event) => updateFileFormat(queued.id, event.target.value)}
                        >
                          <option value="geojson">GeoJSON</option>
                          <option value="geoparquet">GeoParquet</option>
                          <option value="tile-grid-json">Tile-grid JSON</option>
                          <option value="ovsi">OVSI</option>
                        </select>
                      </label>
                      <label>
                        <span>Display name</span>
                        <input
                          type="text"
                          value={queued.displayName}
                          onChange={(event) => updateDisplayName(queued.id, event.target.value)}
                          placeholder={queued.file.name.replace(/\.[^.]+$/, "")}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="workspace-operations__progress" aria-live="polite">
              <div
                className="workspace-operations__progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressValue)}
              >
                <div
                  className="workspace-operations__progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, progressValue))}%` }}
                />
              </div>
              <div className="workspace-operations__progress-meta">
                <span>{status || "Idle"}</span>
                <span>{activeJob ? `${activeJob.progress_percent?.toFixed(0) ?? 0}%` : isSubmitting ? "starting" : "0%"}</span>
              </div>
            </div>
            <button
              type="submit"
              className="workspace-button"
              disabled={queuedFiles.length === 0 || !slideId || isSubmitting}
            >
              {isSubmitting
                ? "Uploading…"
                : `Upload ${queuedFiles.length > 1 ? `${queuedFiles.length} overlays` : "Overlay"}`}
            </button>
          </form>
        ) : (
          <div className="workspace-panel__subtle">Upload form collapsed. Expand to queue a new overlay.</div>
        )}
      </div>

      <div className="workspace-operations__card">
        <h2>Overlay Jobs</h2>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Slide</th>
                <th>Name</th>
                <th>Format</th>
                <th>Runtime</th>
                <th>Artifact</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Features</th>
                <th>Chunks</th>
                <th>Elapsed</th>
                <th>Parse</th>
                <th>Publish</th>
                <th>Kind</th>
                <th>Message</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_id}>
                  <td>{job.slide_id}</td>
                  <td>{job.name}</td>
                  <td>{job.source_format}</td>
                  <td>{job.runtime_format ?? "-"}</td>
                  <td>{typeof job.artifact?.layout === "string" ? job.artifact.layout : "-"}</td>
                  <td>{job.status}</td>
                  <td>{job.stage}</td>
                  <td>{job.feature_count}</td>
                  <td>{job.metrics?.chunk_count ?? "-"}</td>
                  <td>{formatSeconds(job.metrics?.elapsed_seconds)}</td>
                  <td>{formatSeconds(job.metrics?.parse_seconds)}</td>
                  <td>{formatSeconds(job.metrics?.publish_seconds)}</td>
                  <td>{job.kind ?? "-"}</td>
                  <td>{job.message ?? "-"}</td>
                  <td>{job.updated_at ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
