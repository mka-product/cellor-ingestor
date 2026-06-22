import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import type { AvailableReader, IngestionJob, JobMetrics } from "../../domain/catalog";
import { cancelJob, fetchJobs, fetchReaders, uploadSlideFile } from "../../infrastructure/catalogClient";

// --- WSI file grouping ---

type WsiKind = "single" | "mrxs" | "dicom";

type FileGroup = {
  id: string;
  kind: WsiKind;
  label: string;
  files: File[];
  /** DICOM: shared series UID (detected from filename patterns); MRXS: the .mrxs manifest file name */
  groupKey: string;
};

function detectWsiKind(file: File): WsiKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".mrxs")) return "mrxs";
  if (name.endsWith(".dcm") || name.endsWith(".dicom")) return "dicom";
  return "single";
}

function groupDroppedFiles(files: File[]): FileGroup[] {
  const mrxsFiles: File[] = [];
  const dicomFiles: File[] = [];
  const singleFiles: File[] = [];

  for (const file of files) {
    const kind = detectWsiKind(file);
    if (kind === "mrxs") mrxsFiles.push(file);
    else if (kind === "dicom") dicomFiles.push(file);
    else singleFiles.push(file);
  }

  const groups: FileGroup[] = [];

  // MRXS: each .mrxs manifest is its own slide (companion folder handled server-side)
  for (const file of mrxsFiles) {
    groups.push({ id: `mrxs-${file.name}`, kind: "mrxs", label: file.name, files: [file], groupKey: file.name });
  }

  // DICOM: group all .dcm files as one series upload (server assigns series UID from metadata)
  if (dicomFiles.length > 0) {
    // Heuristic: files sharing a common name prefix likely belong to the same series.
    // Without reading binary headers in the browser, we group all at once and let the backend parse.
    const seriesGroups = new Map<string, File[]>();
    for (const file of dicomFiles) {
      // Strip trailing digit suffix to group e.g. "slide_001.dcm" + "slide_002.dcm" together
      const prefix = file.name.replace(/[-_.]?\d+\.dcm$/i, "").replace(/\.dicom$/i, "") || file.name;
      const existing = seriesGroups.get(prefix) ?? [];
      existing.push(file);
      seriesGroups.set(prefix, existing);
    }
    for (const [prefix, seriesFiles] of seriesGroups.entries()) {
      const label = seriesFiles.length === 1
        ? seriesFiles[0].name
        : `${prefix} (${seriesFiles.length} DICOM frames)`;
      groups.push({ id: `dicom-${prefix}`, kind: "dicom", label, files: seriesFiles, groupKey: prefix });
    }
  }

  // Single-file WSI formats
  for (const file of singleFiles) {
    groups.push({ id: `single-${file.name}`, kind: "single", label: file.name, files: [file], groupKey: file.name });
  }

  return groups;
}

// --- helpers ---

function formatSeconds(value?: number) {
  return typeof value === "number" ? `${value.toFixed(2)} s` : "-";
}

function elapsedSecondsForJob(job: IngestionJob): number | undefined {
  if (typeof job.metrics?.elapsed_seconds === "number") return job.metrics.elapsed_seconds;
  if (!job.started_at || (job.status !== "running" && job.stage !== "cancelling")) return undefined;
  const startedAt = Date.parse(job.started_at);
  if (Number.isNaN(startedAt)) return undefined;
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

function kindBadge(kind: WsiKind): string {
  if (kind === "mrxs") return "MRXS";
  if (kind === "dicom") return "DICOM";
  return "";
}

// --- Drop zone ---

function DropZone(props: {
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
      aria-label="Drop WSI files here or click to browse"
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".svs,.ndpi,.tif,.tiff,.mrxs,.dcm,.dicom,.scn,.czi,.lif,.qptiff,.btf,.vms,.vmu"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
      <div className="workspace-dropzone__icon">↑</div>
      <div className="workspace-dropzone__label">
        Drop WSI files here or <strong>click to browse</strong>
      </div>
      <div className="workspace-panel__subtle">
        SVS, NDPI, TIFF, MRXS, DICOM, SCN, CZI, LIF — multiple files accepted. MRXS and DICOM series are grouped automatically.
      </div>
    </div>
  );
}

// --- main component ---

export function SlidesOperationsPage() {
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [readers, setReaders] = useState<AvailableReader[]>([]);
  const [readerBackend, setReaderBackend] = useState("fastslide");
  const [metadataBackend, setMetadataBackend] = useState("openslide");
  const [fileGroups, setFileGroups] = useState<FileGroup[]>([]);
  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(true);

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
        if (error instanceof DOMException && error.name === "AbortError") return;
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

  const handleFiles = useCallback((files: File[]) => {
    setFileGroups((current) => {
      const newGroups = groupDroppedFiles(files);
      // Merge: replace groups with same key, append new ones
      const existingKeys = new Set(current.map((g) => g.id));
      const merged = [...current, ...newGroups.filter((g) => !existingKeys.has(g.id))];
      return merged;
    });
  }, []);

  const removeGroup = (groupId: string) => setFileGroups((current) => current.filter((g) => g.id !== groupId));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (fileGroups.length === 0 || isSubmitting) return;
    setIsSubmitting(true);

    for (const group of fileGroups) {
      const label = group.label;
      setStatus(`Uploading ${label}…`);
      try {
        // For DICOM series: upload each frame file separately (backend groups by series UID).
        // For MRXS and single-file: upload the single manifest/file.
        const filesToUpload = group.kind === "dicom" ? group.files : [group.files[0]];
        for (const file of filesToUpload) {
          const formData = new FormData();
          formData.set("file", file);
          formData.set("reader_backend", readerBackend);
          formData.set("metadata_backend", metadataBackend);
          const job = await uploadSlideFile(formData);
          setJobs((current) =>
            [job, ...current.filter((existing) => existing.job_id !== job.job_id)].sort((left, right) =>
              String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
            )
          );
          setActiveJobId(job.job_id);
          setStatus(`Queued ${job.display_name}`);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : `Upload failed for ${label}`);
        setIsSubmitting(false);
        return;
      }
    }

    setIsFormOpen(false);
    setFileGroups([]);
    setIsSubmitting(false);
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
          <form className="workspace-operations__form workspace-form-grid" onSubmit={(event) => void handleSubmit(event)}>
            <DropZone onFiles={handleFiles} disabled={isSubmitting} />
            {fileGroups.length > 0 ? (
              <div className="workspace-operations__upload-summary">
                {fileGroups.map((group) => (
                  <div key={group.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <strong>{group.label}</strong>
                      {kindBadge(group.kind) ? (
                        <span className="workspace-panel__subtle" style={{ marginLeft: 6 }}>· {kindBadge(group.kind)}</span>
                      ) : null}
                      <div className="workspace-panel__subtle">
                        {group.files.length === 1
                          ? `${(group.files[0].size / (1024 * 1024)).toFixed(1)} MB`
                          : `${group.files.length} files · ${(group.files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(1)} MB total`}
                        {group.kind === "dicom"
                          ? " — DICOM frames will be uploaded individually; the backend groups by series UID."
                          : group.kind === "mrxs"
                          ? " — MRXS manifest only; companion folder must be accessible to the ingestion server."
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="workspace-icon-button"
                      onClick={() => removeGroup(group.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="workspace-operations__field-row">
              <label>
                <span>Render Reader</span>
                <select value={readerBackend} onChange={(event) => setReaderBackend(event.target.value)}>
                  {renderReaders.map((reader) => (
                    <option key={reader.backend} value={reader.backend}>
                      {reader.label}{reader.is_recommended ? " · recommended" : ""}
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
                      {reader.label}{reader.is_default_metadata ? " · default" : ""}
                    </option>
                  ))}
                </select>
                <span className="workspace-panel__subtle">Used for vendor fields, objective power, and MPP extraction.</span>
              </label>
            </div>
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
                <span>{activeJob ? `${activeJob.progress_percent.toFixed(0)}%` : isSubmitting ? "starting" : "0%"}</span>
              </div>
            </div>
            <button
              type="submit"
              className="workspace-button"
              disabled={fileGroups.length === 0 || isSubmitting}
            >
              {isSubmitting ? "Uploading…" : `Upload ${fileGroups.length > 1 ? `${fileGroups.length} slides` : "Slide"}`}
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
