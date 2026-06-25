import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../components/auth/AuthContext";
import { LoginPage } from "../components/auth/LoginPage";
import { NotificationBell } from "../components/NotificationBell";
import { S3StatusIndicator } from "../components/S3StatusIndicator";
import { Viewer } from "../components/Viewer";
import { JobsPage } from "../components/jobs/JobsPage";
import type { CatalogSlide } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";
import { fetchSlides, fetchManifestContent, fetchJobs, fetchOverlayJobs } from "../infrastructure/catalogClient";
import { useDropUpload } from "../lib/useDropUpload";
import { notificationStore } from "../lib/notificationStore";

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function parseInitialViewerParams() {
  const p = new URLSearchParams(window.location.search);
  const cx = Number(p.get("cx"));
  const cy = Number(p.get("cy"));
  const zoom = Number(p.get("zoom"));
  return {
    viewport: isFinite(cx) && isFinite(cy) && isFinite(zoom) && p.has("cx") ? { cx, cy, zoom } : null,
    annotationId: p.get("ann") ?? null,
    overlayIds: p.get("overlays")?.split(",").filter(Boolean) ?? []
  };
}

export function App() {
  const { session, loading: authLoading, signOut } = useAuth();
  const [route, setRoute] = useState(() => window.location.pathname || "/");
  const [initialViewerParams] = useState(parseInitialViewerParams);
  const [slides, setSlides] = useState<CatalogSlide[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [status, setStatus] = useState("loading");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const prevJobStatusRef = useRef<Map<string, string>>(new Map());
  const notifiedJobsRef = useRef<Set<string>>(new Set());

  const selectedSlide = useMemo(
    () => slides.find((slide) => `${slide.slide_id}:${slide.version_id}` === selectedKey) ?? null,
    [selectedKey, slides]
  );

  const selectedSlideLabel = selectedSlide?.display_name ?? "";
  const isViewerRoute = route !== "/jobs";
  const isJobsRoute = route === "/jobs";

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!session) return;
    setStatus("loading");
    const controller = new AbortController();
    (async () => {
      const nextSlides = await fetchSlides(controller.signal);
      setSlides(nextSlides);
      if (nextSlides.length > 0) {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("slide");
        const matched =
          nextSlides.find((slide) => slide.slide_id === requested) ??
          nextSlides[0];
        setSelectedKey(`${matched.slide_id}:${matched.version_id}`);
      }
      setStatus("ready");
    })().catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!isViewerRoute) return;
    if (!selectedKey) return;
    const controller = new AbortController();
    const [slideId, versionId] = selectedKey.split(":");
    (async () => {
      setViewerError(null);
      const nextManifest = (await fetchManifestContent(slideId, versionId, controller.signal)) as ViewerManifest;
      setManifest(nextManifest);
      const params = new URLSearchParams(window.location.search);
      params.set("slide", slideId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    })().catch(() => {
      if (!controller.signal.aborted) {
        setManifest(null);
        setViewerError("Failed to load the selected slide manifest.");
      }
    });
    return () => controller.abort();
  }, [isViewerRoute, selectedKey]);

  const filteredSlides = useMemo(() => {
    const query = (pickerOpen && searchValue === selectedSlideLabel ? "" : searchValue).trim().toLowerCase();
    if (!query) return slides;
    return slides.filter((slide) =>
      [slide.display_name, slide.slide_id, slide.version_id].some((value) => value.toLowerCase().includes(query))
    );
  }, [pickerOpen, searchValue, selectedSlideLabel, slides]);

  useEffect(() => {
    if (!pickerOpen) {
      setSearchValue(selectedSlideLabel);
    }
  }, [pickerOpen, selectedSlideLabel]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
        setSearchValue(selectedSlide?.display_name ?? "");
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [selectedSlide]);

  const { state: dropState, onDragEnter, onDragLeave, onDragOver, onDrop, clearResult } =
    useDropUpload(selectedSlide?.slide_id ?? null);

  // Background job poller — generates notifications when jobs transition to a terminal state.
  // Runs every 15 s while the user is authenticated; does not depend on the jobs page being open.
  useEffect(() => {
    if (!session) return;
    let active = true;
    async function poll() {
      if (!active) return;
      try {
        const [slides, overlays] = await Promise.all([fetchJobs(), fetchOverlayJobs()]);
        const all = [
          ...slides.map((j) => ({ id: j.job_id, name: j.display_name, status: j.status })),
          ...overlays.map((j) => ({ id: j.job_id, name: j.name, status: j.status })),
        ];
        for (const job of all) {
          const prev = prevJobStatusRef.current.get(job.id);
          if (
            prev !== undefined &&
            !TERMINAL_JOB_STATUSES.has(prev) &&
            TERMINAL_JOB_STATUSES.has(job.status) &&
            !notifiedJobsRef.current.has(job.id)
          ) {
            notifiedJobsRef.current.add(job.id);
            notificationStore.add({
              type: job.status === "succeeded" ? "job_done" : "job_failed",
              title: job.status === "succeeded" ? "Ingestion complete" : "Ingestion failed",
              body: job.name,
              jobId: job.id,
            });
          }
          prevJobStatusRef.current.set(job.id, job.status);
        }
      } catch {
        // silently skip — network or auth failures are transient
      }
    }
    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [session]);

  if (authLoading) return null;
  if (!session) return <LoginPage />;

  if (status === "error") {
    return <div role="alert">Application failed to load</div>;
  }

  if (status === "loading") {
    return <div>Loading slides…</div>;
  }

  return (
    <main
      className="workspace-app"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dropState.isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay__label">
            {selectedSlide
              ? "Drop slides or overlays to upload"
              : "Drop slides to upload (open a slide to also accept overlays)"}
          </div>
        </div>
      )}
      {dropState.isUploading && (
        <div className="drop-overlay drop-overlay--uploading">
          <div className="drop-overlay__label">Uploading…</div>
        </div>
      )}
      {dropState.lastResult && (
        <div className={`drop-toast ${dropState.lastResult.errors.length ? "drop-toast--error" : "drop-toast--ok"}`}>
          <span>
            {dropState.lastResult.queued > 0 && `${dropState.lastResult.queued} file${dropState.lastResult.queued !== 1 ? "s" : ""} queued. `}
            {dropState.lastResult.errors.map((e, i) => <span key={i}>{e} </span>)}
          </span>
          <button type="button" className="drop-toast__close" onClick={clearResult}>✕</button>
        </div>
      )}
      <header className="workspace-topbar">
        <div className="workspace-topbar__brand">
          <h1 className="workspace-logo">Cellor Workspace</h1>
          <p className="workspace-panel__subtle">{selectedSlide?.display_name ?? "No slide selected"}</p>
        </div>
        {isViewerRoute ? (
          <div ref={pickerRef} className="workspace-slide-picker">
            <input
              className="workspace-search"
              type="search"
              placeholder="Search slides"
              value={searchValue}
              onFocus={() => {
                setPickerOpen(true);
                if (searchValue === selectedSlideLabel) {
                  setSearchValue("");
                }
              }}
              onClick={() => {
                setPickerOpen(true);
                if (searchValue === selectedSlideLabel) {
                  setSearchValue("");
                }
              }}
              onChange={(event) => {
                setSearchValue(event.target.value);
                setPickerOpen(true);
              }}
            />
            {pickerOpen ? (
              <div className="workspace-slide-picker__menu">
                {filteredSlides.length === 0 ? <div className="workspace-empty">No matching slides.</div> : null}
                {filteredSlides.map((slide) => {
                  const optionKey = `${slide.slide_id}:${slide.version_id}`;
                  const isActive = optionKey === selectedKey;
                  return (
                    <button
                      key={optionKey}
                      type="button"
                      className={`workspace-slide-picker__option${isActive ? " is-active" : ""}`}
                      onClick={() => {
                        setSelectedKey(optionKey);
                        setSearchValue(slide.display_name);
                        setPickerOpen(false);
                        if (!isViewerRoute) return;
                      }}
                    >
                      {slide.thumbnail_path ? (
                        <img
                          className="workspace-slide-picker__thumb"
                          src={slide.thumbnail_path}
                          alt={`${slide.display_name} thumbnail`}
                        />
                      ) : (
                        <div className="workspace-slide-picker__thumb workspace-slide-picker__thumb--empty" />
                      )}
                      <div className="workspace-slide-picker__copy">
                        <strong>{slide.display_name}</strong>
                        <span>{slide.slide_id}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : <div className="workspace-slide-picker" />}
        <nav className="workspace-launcher">
          <button type="button" className={`workspace-nav${isViewerRoute ? " is-active" : ""}`} onClick={() => { window.history.pushState({}, "", "/"); setRoute("/"); }}>
            Viewer
          </button>
          <button type="button" className={`workspace-nav${isJobsRoute ? " is-active" : ""}`} onClick={() => { window.history.pushState({}, "", "/jobs"); setRoute("/jobs"); }}>
            Jobs
          </button>
          <NotificationBell open={notifOpen} onToggle={() => setNotifOpen((o) => !o)} />
          <S3StatusIndicator />
          <span className="workspace-topbar__user">
            {session.user.first_name
              ? `${session.user.first_name} ${session.user.last_name}`.trim()
              : session.user.email}
          </span>
          <button type="button" className="workspace-nav" onClick={signOut}>Sign out</button>
        </nav>
      </header>
      {isViewerRoute ? (
        <>
          {slides.length === 0 ? <div className="workspace-empty" style={{ padding: 24 }}>No ingested slides found.</div> : null}
          {viewerError ? <div className="workspace-inline-alert" role="alert">{viewerError}</div> : null}
          {manifest ? (
            <Viewer
              manifest={manifest}
              initialViewport={initialViewerParams.viewport}
              initialAnnotationId={initialViewerParams.annotationId}
              initialOverlayIds={initialViewerParams.overlayIds}
              userId={session.user.email}
              displayName={
                session.user.first_name
                  ? `${session.user.first_name} ${session.user.last_name}`.trim()
                  : session.user.email
              }
              accessToken={session.access_token}
            />
          ) : null}
        </>
      ) : null}
      {isJobsRoute ? <JobsPage /> : null}
    </main>
  );
}
