import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AvailableReader, IngestionJob, JobMetrics } from "../../domain/catalog";
import { cancelJob, fetchJobs, fetchReaders, uploadSlideFile } from "../../infrastructure/catalogClient";

function formatSeconds(value?: number) {
  return typeof value === "number" ? `${value.toFixed(2)} s` : "-";
}

function elapsedSecondsForJob(job: IngestionJob): number | undefined {
  if (typeof job.metrics?.elapsed_seconds === "number") {
    return job.metrics.elapsed_seconds;
  }
  if (!job.started_at || (job.status !== "running" && job.stage !== "cancelling")) {
    return undefined;
  }
  const startedAt = Date.parse(job.started_at);
  if (Number.isNaN(startedAt)) {
    return undefined;
  }
  return Math.max(0, (Date.now() - startedAt) / 1000);
}

function formatMegabytesFromBytes(value?: number) {
  return typeof value === "number" ? `${(value / (1024 * 1024)).toFixed(1)} MB` : "-";
}

function peakRss(metrics?: JobMetrics) {
  const timings = metrics?.timings;
  if (!timings) return undefined;
  return timings.self_max_rss_mb ?? timings.child_worker_peak_rss_mb_max ?? timings.children_max_rss_mb;
}

export function SlidesOperationsPage() {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [readers, setReaders] = useState<AvailableReader[]>([]);
  const [readerBackend, setReaderBackend] = useState("fastslide");
  const [metadataBackend, setMetadataBackend] = useState("openslide");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(true);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [nextJobs, nextReaders] = await Promise.all([fetchJobs(controller.signal), fetchReaders(controller.signal)]);
        setJobs(
          [...nextJobs].sort((left, right) =>
            String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
          )
        );
        setReaders(nextReaders);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setStatus(error instanceof Error ? error.message : "Failed to load upload state");
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    const activeJob = jobs.find((job) => job.job_id === activeJobId);
    if (!activeJob) return;
    if (activeJob.status === "succeeded") {
      setStatus(`Completed ${activeJob.display_name}`);
      setActiveJobId(null);
      setIsSubmitting(false);
      return;
    }
    if (activeJob.stage === "cancelled") {
      setStatus(activeJob.message ?? `Cancelled ${activeJob.display_name}`);
      setActiveJobId(null);
      setIsSubmitting(false);
      return;
    }
    if (activeJob.status === "failed") {
      setStatus(activeJob.message ?? `Upload failed for ${activeJob.display_name}`);
      setActiveJobId(null);
      setIsSubmitting(false);
      return;
    }
    setStatus(`${activeJob.display_name} · ${activeJob.stage} · ${activeJob.progress_percent.toFixed(0)}%`);
  }, [activeJobId, jobs]);

  useEffect(() => {
    if (!readers.length) return;
    const defaultReader = readers.find((reader) => reader.is_default)?.backend ?? readers[0]?.backend;
    const defaultMetadataReader =
      readers.find((reader) => reader.is_default_metadata)?.backend ??
      readers.find((reader) => reader.supports_metadata)?.backend;
    setReaderBackend((current) =>
      readers.some((reader) => reader.backend === current && reader.supports_render) ? current : (defaultReader ?? current)
    );
    setMetadataBackend((current) =>
      readers.some((reader) => reader.backend === current && reader.supports_metadata)
        ? current
        : (defaultMetadataReader ?? current)
    );
  }, [readers]);

  const activeJob = useMemo(
    () => (activeJobId ? jobs.find((job) => job.job_id === activeJobId) ?? null : null),
    [activeJobId, jobs]
  );

  const progressValue = activeJob?.progress_percent ?? (isSubmitting ? 5 : 0);
  const renderReaders = readers.filter((reader) => reader.supports_render);
  const metadataReaders = readers.filter((reader) => reader.supports_metadata);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || isSubmitting) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("reader_backend", readerBackend);
    formData.set("metadata_backend", metadataBackend);
    setIsSubmitting(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const job = await uploadSlideFile(formData);
      setJobs((current) =>
        [job, ...current.filter((existing) => existing.job_id !== job.job_id)].sort((left, right) =>
          String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
        )
      );
      setActiveJobId(job.job_id);
      setStatus(`Queued ${job.display_name}`);
      setIsFormOpen(false);
      setFile(null);
      formRef.current?.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Slide upload failed");
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await cancelJob(jobId);
      setStatus(`Cancelled ${jobId}`);
      if (activeJobId === jobId) {
        setActiveJobId(null);
        setIsSubmitting(false);
      }
      const nextJobs = await fetchJobs();
      setJobs(
        [...nextJobs].sort((left, right) =>
          String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
        )
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to cancel job");
    }
  };

  return (
    <section className="workspace-operations">
      <div className="workspace-operations__card">
        <div className="workspace-operations__header">
          <h2>Slide Upload</h2>
          <button type="button" className="workspace-button" onClick={() => setIsFormOpen((current) => !current)}>
            {isFormOpen ? "Collapse" : "Expand"}
          </button>
        </div>
        {isFormOpen ? (
        <form ref={formRef} className="workspace-operations__form workspace-form-grid" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>WSI File</span>
            <input
              type="file"
              accept=".svs,.ndpi,.tif,.tiff,.mrxs"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="workspace-panel__subtle">
              Pilot upload input for Aperio, Hamamatsu, TIFF, and MRXS whole-slide images.
            </span>
          </label>
          <div className="workspace-operations__field-row">
            <label>
              <span>Render Reader</span>
              <select value={readerBackend} onChange={(event) => setReaderBackend(event.target.value)}>
                {renderReaders.map((reader) => (
                  <option key={reader.backend} value={reader.backend}>
                    {reader.label}
                    {reader.is_recommended ? " · recommended" : ""}
                  </option>
                ))}
              </select>
              <span className="workspace-panel__subtle">Controls slide pixel extraction during ingestion.</span>
            </label>
            <label>
              <span>Metadata Reader</span>
              <select value={metadataBackend} onChange={(event) => setMetadataBackend(event.target.value)}>
                {metadataReaders.map((reader) => (
                  <option key={reader.backend} value={reader.backend}>
                    {reader.label}
                    {reader.is_default_metadata ? " · default" : ""}
                  </option>
                ))}
              </select>
              <span className="workspace-panel__subtle">Used for vendor fields, objective power, and MPP extraction.</span>
            </label>
          </div>
          <div className="workspace-operations__upload-summary">
            <div>
              <strong>{file?.name ?? "No file selected"}</strong>
              <div className="workspace-panel__subtle">
                {file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : "Choose one slide to queue a new ingestion job."}
              </div>
            </div>
          </div>
          <div className="workspace-operations__progress" aria-live="polite">
            <div className="workspace-operations__progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressValue)}>
              <div className="workspace-operations__progress-fill" style={{ width: `${Math.max(0, Math.min(100, progressValue))}%` }} />
            </div>
            <div className="workspace-operations__progress-meta">
              <span>{status || "Idle"}</span>
              <span>{activeJob ? `${activeJob.progress_percent.toFixed(0)}%` : isSubmitting ? "starting" : "0%"}</span>
            </div>
          </div>
          <button type="submit" className="workspace-button" disabled={!file || isSubmitting}>
            {isSubmitting ? "Uploading…" : "Upload Slide"}
          </button>
        </form>
        ) : (
          <div className="workspace-panel__subtle">Upload form collapsed. Expand to queue a new slide.</div>
        )}
      </div>

      <div className="workspace-operations__card">
        <h2>Ingestion Jobs</h2>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slide Id</th>
                <th>Version</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Progress</th>
                <th>Elapsed</th>
                <th>Peak RSS</th>
                <th>Artifacts</th>
                <th>Reader</th>
                <th>Metadata</th>
                <th>Message</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_id}>
                  <td>{job.display_name}</td>
                  <td>{job.slide_id}</td>
                  <td>{job.version_id}</td>
                  <td>{job.status}</td>
                  <td>{job.stage}</td>
                  <td>{job.progress_percent?.toFixed(0)}%</td>
                  <td>{formatSeconds(elapsedSecondsForJob(job))}</td>
                  <td>{typeof peakRss(job.metrics) === "number" ? `${peakRss(job.metrics)?.toFixed(1)} MB` : "-"}</td>
                  <td>{formatMegabytesFromBytes(job.metrics?.artifact_bytes)}</td>
                  <td>{job.reader_backend}</td>
                  <td>{job.metadata_backend}</td>
                  <td>{job.message ?? "-"}</td>
                  <td>{job.updated_at ?? "-"}</td>
                  <td>
                    {job.status === "pending" || job.status === "running" ? (
                      <button
                        type="button"
                        className="workspace-button"
                        disabled={job.stage === "cancelling"}
                        onClick={() => void handleCancel(job.job_id)}
                      >
                        {job.stage === "cancelling" ? "Cancelling…" : "Cancel"}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
