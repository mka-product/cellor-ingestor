import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../components/auth/AuthContext";
import { LoginPage } from "../components/auth/LoginPage";
import { Viewer } from "../components/Viewer";
import { OverlaysOperationsPage } from "../components/operations/OverlaysOperationsPage";
import { SlidesOperationsPage } from "../components/operations/SlidesOperationsPage";
import type { CatalogSlide } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";
import { fetchSlides, fetchManifestContent } from "../infrastructure/catalogClient";

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
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const selectedSlide = useMemo(
    () => slides.find((slide) => `${slide.slide_id}:${slide.version_id}` === selectedKey) ?? null,
    [selectedKey, slides]
  );

  const selectedSlideLabel = selectedSlide?.display_name ?? "";
  const isViewerRoute = !route.startsWith("/operations/");
  const isSlideOpsRoute = route === "/operations/slides";
  const isOverlayOpsRoute = route === "/operations/overlays";

  useEffect(() => {
    const onPopState = () => setRoute(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
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
  }, []);

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

  if (authLoading) return null;
  if (!session) return <LoginPage />;

  if (status === "error") {
    return <div role="alert">Application failed to load</div>;
  }

  if (status === "loading") {
    return <div>Loading slides…</div>;
  }

  return (
    <main className="workspace-app">
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
          <button type="button" className={`workspace-nav${isSlideOpsRoute ? " is-active" : ""}`} onClick={() => { window.history.pushState({}, "", "/operations/slides"); setRoute("/operations/slides"); }}>
            Slides
          </button>
          <button type="button" className={`workspace-nav${isOverlayOpsRoute ? " is-active" : ""}`} onClick={() => { window.history.pushState({}, "", "/operations/overlays"); setRoute("/operations/overlays"); }}>
            Overlays
          </button>
          <span className="workspace-topbar__user">
            {session.user.user_metadata?.first_name
              ? `${session.user.user_metadata.first_name} ${session.user.user_metadata.last_name ?? ""}`.trim()
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
              userId={session.user.email ?? session.user.id}
              displayName={
                session.user.user_metadata?.first_name
                  ? `${session.user.user_metadata.first_name} ${session.user.user_metadata.last_name ?? ""}`.trim()
                  : (session.user.email ?? session.user.id)
              }
              accessToken={session.access_token}
            />
          ) : null}
        </>
      ) : null}
      {isSlideOpsRoute ? <SlidesOperationsPage /> : null}
      {isOverlayOpsRoute ? <OverlaysOperationsPage /> : null}
    </main>
  );
}
