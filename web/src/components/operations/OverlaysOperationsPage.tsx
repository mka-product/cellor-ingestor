import { useEffect, useState, type FormEvent } from "react";

import type { CatalogSlide, OverlayJob } from "../../domain/catalog";
import { fetchOverlayJobs, fetchSlides, uploadOverlayFile } from "../../infrastructure/catalogClient";

function formatSeconds(value?: number) {
  return typeof value === "number" ? `${value.toFixed(2)} s` : "-";
}

export function OverlaysOperationsPage() {
  const [slides, setSlides] = useState<CatalogSlide[]>([]);
  const [jobs, setJobs] = useState<OverlayJob[]>([]);
  const [slideId, setSlideId] = useState("");
  const [sourceFormat, setSourceFormat] = useState("geojson");
  const [displayName, setDisplayName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const [nextSlides, nextJobs] = await Promise.all([fetchSlides(controller.signal), fetchOverlayJobs(controller.signal)]);
      setSlides(nextSlides);
      setJobs(nextJobs);
      if (!slideId && nextSlides[0]) {
        setSlideId(nextSlides[0].slide_id);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [slideId]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !slideId) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("slide_id", slideId);
    formData.set("source_format", sourceFormat);
    formData.set("display_name", displayName || file.name.replace(/\.[^.]+$/, ""));
    setStatus("Uploading overlay…");
    try {
      const job = await uploadOverlayFile(formData);
      setJobs((current) => [job, ...current.filter((existing) => existing.job_id !== job.job_id)]);
      setStatus(`Published ${job.name}`);
      setFile(null);
      (event.currentTarget as HTMLFormElement).reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Overlay upload failed");
    }
  };

  return (
    <section className="workspace-operations">
      <div className="workspace-operations__card">
        <h2>Overlay Upload</h2>
        <form className="workspace-operations__form" onSubmit={(event) => void handleSubmit(event)}>
          <select value={slideId} onChange={(event) => setSlideId(event.target.value)}>
            {slides.map((slide) => (
              <option key={`${slide.slide_id}:${slide.version_id}`} value={slide.slide_id}>
                {slide.display_name}
              </option>
            ))}
          </select>
          <select value={sourceFormat} onChange={(event) => setSourceFormat(event.target.value)}>
            <option value="geojson">GeoJSON</option>
            <option value="geoparquet">GeoParquet</option>
            <option value="tile-grid-json">Tile-grid JSON</option>
            <option value="ovsi">OVSI</option>
          </select>
          <input type="text" placeholder="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <input type="file" accept=".json,.geojson,.parquet,.ovsi" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button type="submit" className="workspace-button" disabled={!file || !slideId}>
            Upload overlay
          </button>
        </form>
        <div className="workspace-panel__subtle">Supported today: GeoJSON, GeoParquet, tile-grid JSON, and OVSI registration.</div>
        {status ? <div className="workspace-panel__subtle">{status}</div> : null}
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
