import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IngestionJob, OverlayJob } from "../../domain/catalog";
import {
  cancelJob,
  cancelOverlayJob,
  fetchJobs,
  fetchOverlayJobs,
  retryOverlayJob,
  setJobPriority,
  setOverlayJobPriority,
} from "../../infrastructure/catalogClient";

type UnifiedJob =
  | ({ _type: "slide" } & IngestionJob)
  | ({ _type: "overlay" } & OverlayJob);

type SortField = "name" | "started_at" | "status" | "progress" | "priority";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 20;
const POLL_MS = 4000;

function jobName(job: UnifiedJob): string {
  return job._type === "slide" ? (job.display_name ?? job.slide_id) : job.name;
}

function jobPriority(job: UnifiedJob): number {
  return job.priority ?? 0;
}

function etaLabel(job: UnifiedJob): string {
  if (job.status !== "running") return "—";
  const progress = job.progress_percent ?? 0;
  if (progress <= 0) return "calculating…";
  const startedAt = job.started_at ? new Date(job.started_at).getTime() : null;
  if (!startedAt) return "—";
  const elapsed = (Date.now() - startedAt) / 1000;
  const remaining = elapsed * (100 / progress - 1);
  if (remaining < 60) return `~${Math.round(remaining)}s`;
  if (remaining < 3600) return `~${Math.round(remaining / 60)}m`;
  return `~${(remaining / 3600).toFixed(1)}h`;
}

function statusDot(status: string): string {
  if (status === "succeeded") return "job-dot job-dot--ok";
  if (status === "running") return "job-dot job-dot--running";
  if (status === "failed") return "job-dot job-dot--error";
  if (status === "pending") return "job-dot job-dot--pending";
  return "job-dot";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function JobsPage() {
  const [slideJobs, setSlideJobs] = useState<IngestionJob[]>([]);
  const [overlayJobs, setOverlayJobs] = useState<OverlayJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("started_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [slides, overlays] = await Promise.all([
        fetchJobs(signal),
        fetchOverlayJobs(signal),
      ]);
      setSlideJobs(slides);
      setOverlayJobs(overlays);
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("Failed to load jobs");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    pollRef.current = setInterval(() => load(), POLL_MS);
    return () => {
      controller.abort();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const unified = useMemo<UnifiedJob[]>(() => {
    const slides: UnifiedJob[] = slideJobs.map((j) => ({ _type: "slide" as const, ...j }));
    const overlays: UnifiedJob[] = overlayJobs.map((j) => ({ _type: "overlay" as const, ...j }));
    return [...slides, ...overlays];
  }, [slideJobs, overlayJobs]);

  const filtered = useMemo(() => {
    let list = unified;
    if (filterStatus !== "all") list = list.filter((j) => j.status === filterStatus);
    if (filterType !== "all") list = list.filter((j) => j._type === filterType);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((j) => jobName(j).toLowerCase().includes(q) || j.job_id.toLowerCase().includes(q));
    }
    return list.slice().sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = jobName(a).localeCompare(jobName(b));
      else if (sortField === "started_at") cmp = (a.started_at ?? "").localeCompare(b.started_at ?? "");
      else if (sortField === "status") cmp = a.status.localeCompare(b.status);
      else if (sortField === "progress") cmp = (a.progress_percent ?? 0) - (b.progress_percent ?? 0);
      else if (sortField === "priority") cmp = jobPriority(a) - jobPriority(b);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [unified, filterStatus, filterType, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  async function handleCancel(job: UnifiedJob) {
    setBusy((b) => ({ ...b, [job.job_id]: true }));
    try {
      if (job._type === "slide") await cancelJob(job.job_id);
      else await cancelOverlayJob(job.job_id);
      await load();
    } finally {
      setBusy((b) => ({ ...b, [job.job_id]: false }));
    }
  }

  async function handleRetry(job: UnifiedJob) {
    if (job._type !== "overlay") return;
    setBusy((b) => ({ ...b, [job.job_id]: true }));
    try {
      await retryOverlayJob(job.job_id);
      await load();
    } finally {
      setBusy((b) => ({ ...b, [job.job_id]: false }));
    }
  }

  async function handlePrioritize(job: UnifiedJob) {
    setBusy((b) => ({ ...b, [job.job_id]: true }));
    try {
      const newPriority = jobPriority(job) + 1;
      if (job._type === "slide") await setJobPriority(job.job_id, newPriority);
      else await setOverlayJobPriority(job.job_id, newPriority);
      await load();
    } finally {
      setBusy((b) => ({ ...b, [job.job_id]: false }));
    }
  }

  const runningCount = unified.filter((j) => j.status === "running").length;
  const pendingCount = unified.filter((j) => j.status === "pending").length;

  return (
    <div className="jobs-page">
      <div className="jobs-page__header">
        <h2 className="jobs-page__title">
          Jobs
          {runningCount > 0 && <span className="jobs-badge jobs-badge--running">{runningCount} running</span>}
          {pendingCount > 0 && <span className="jobs-badge jobs-badge--pending">{pendingCount} queued</span>}
        </h2>
        <div className="jobs-page__controls">
          <input
            className="workspace-search"
            type="search"
            placeholder="Search by name or ID"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select
            className="jobs-select"
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          >
            <option value="all">All types</option>
            <option value="slide">Slides</option>
            <option value="overlay">Overlays</option>
          </select>
          <select
            className="jobs-select"
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {loading && <div className="jobs-page__loading">Loading jobs…</div>}
      {error && <div className="workspace-inline-alert" role="alert">{error}</div>}

      {!loading && filtered.length === 0 && (
        <div className="workspace-empty" style={{ padding: 32 }}>No jobs match the current filters.</div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          <div className="jobs-table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort("name")} className="jobs-th--sortable">Name{sortIndicator("name")}</th>
                  <th>Type</th>
                  <th onClick={() => toggleSort("status")} className="jobs-th--sortable">Status{sortIndicator("status")}</th>
                  <th>Stage</th>
                  <th onClick={() => toggleSort("progress")} className="jobs-th--sortable">Progress{sortIndicator("progress")}</th>
                  <th>ETA</th>
                  <th onClick={() => toggleSort("priority")} className="jobs-th--sortable">Priority{sortIndicator("priority")}</th>
                  <th onClick={() => toggleSort("started_at")} className="jobs-th--sortable">Started{sortIndicator("started_at")}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((job) => {
                  const isBusy = !!busy[job.job_id];
                  const canCancel = job.status === "pending" || job.status === "running";
                  const canRetry = job._type === "overlay" && job.status === "failed";
                  const canPrioritize = job.status === "pending";
                  return (
                    <tr key={`${job._type}-${job.job_id}`} className={`jobs-row jobs-row--${job.status}`}>
                      <td className="jobs-td--name" title={job.job_id}>
                        {jobName(job)}
                      </td>
                      <td>
                        <span className={`jobs-type-badge jobs-type-badge--${job._type}`}>{job._type}</span>
                      </td>
                      <td>
                        <span className={statusDot(job.status)} />
                        {job.status}
                      </td>
                      <td className="jobs-td--stage">{job.stage ?? "—"}</td>
                      <td>
                        <div className="jobs-progress">
                          <div className="jobs-progress__bar">
                            <div
                              className="jobs-progress__fill"
                              style={{ width: `${job.progress_percent ?? 0}%` }}
                            />
                          </div>
                          <span className="jobs-progress__label">{(job.progress_percent ?? 0).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="jobs-td--eta">{etaLabel(job)}</td>
                      <td className="jobs-td--priority">{jobPriority(job)}</td>
                      <td className="jobs-td--date">{formatDate(job.started_at)}</td>
                      <td className="jobs-td--actions">
                        {canPrioritize && (
                          <button
                            type="button"
                            className="jobs-action-btn"
                            disabled={isBusy}
                            title="Increase priority"
                            onClick={() => handlePrioritize(job)}
                          >
                            ↑
                          </button>
                        )}
                        {canRetry && (
                          <button
                            type="button"
                            className="jobs-action-btn"
                            disabled={isBusy}
                            title="Retry"
                            onClick={() => handleRetry(job)}
                          >
                            ↩
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="jobs-action-btn jobs-action-btn--danger"
                            disabled={isBusy}
                            title="Cancel"
                            onClick={() => handleCancel(job)}
                          >
                            ✕
                          </button>
                        )}
                        {!canCancel && !canRetry && !canPrioritize && <span className="jobs-td--empty">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="jobs-pagination">
              <button type="button" className="workspace-nav" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
                ‹ Prev
              </button>
              <span className="jobs-pagination__label">
                {safePage} / {pageCount} &nbsp;({filtered.length} jobs)
              </span>
              <button type="button" className="workspace-nav" disabled={safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
