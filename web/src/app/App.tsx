import { useEffect, useMemo, useState } from "react";

import { Viewer } from "../components/Viewer";
import type { CatalogSlide } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";
import { fetchSlides, fetchManifestContent } from "../infrastructure/catalogClient";

export function App() {
  const [slides, setSlides] = useState<CatalogSlide[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [status, setStatus] = useState("loading");

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
    if (!selectedKey) return;
    const controller = new AbortController();
    const [slideId, versionId] = selectedKey.split(":");
    (async () => {
      const nextManifest = (await fetchManifestContent(slideId, versionId, controller.signal)) as ViewerManifest;
      setManifest(nextManifest);
      const params = new URLSearchParams(window.location.search);
      params.set("slide", slideId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    })().catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => controller.abort();
  }, [selectedKey]);

  const selectedSlide = useMemo(
    () => slides.find((slide) => `${slide.slide_id}:${slide.version_id}` === selectedKey) ?? null,
    [selectedKey, slides]
  );

  if (status === "error") {
    return <div role="alert">Application failed to load</div>;
  }

  if (status === "loading") {
    return <div>Loading slides…</div>;
  }

  return (
    <main className="workspace-app">
      <header className="workspace-topbar">
        <div>
          <h1 className="workspace-logo">Cellor Workspace</h1>
          <p className="workspace-panel__subtle">deck.gl viewer with native overlay adapter</p>
        </div>
        <div className="workspace-launcher">
          {selectedSlide?.metrics ? (
            <div className="workspace-panel__subtle">
              Ingestion {selectedSlide.metrics.elapsed_seconds}s · {selectedSlide.metrics.level_count} levels ·{" "}
              {selectedSlide.metrics.tile_count} tiles
            </div>
          ) : null}
          <div className="workspace-form">
            <label>
              Slide
              <select className="workspace-select" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
                {slides.map((slide) => (
                  <option key={`${slide.slide_id}:${slide.version_id}`} value={`${slide.slide_id}:${slide.version_id}`}>
                    {slide.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>
      <div className="workspace-breadcrumb">Workspace / Slides / {selectedSlide?.display_name ?? "Empty"}</div>
      {slides.length === 0 ? <div className="workspace-empty" style={{ padding: 24 }}>No ingested slides found.</div> : null}
      {manifest ? (
        <>
          <header className="workspace-header">
            <div>
              <h2 className="workspace-slide-title">{manifest.slideId}</h2>
              <p className="workspace-slide-meta">
                {manifest.width} × {manifest.height} px · {manifest.metadata?.vendor ?? "Unknown vendor"} ·{" "}
                {manifest.metadata?.objectivePower ? `${manifest.metadata.objectivePower}x objective` : "objective unknown"}
              </p>
            </div>
          </header>
          <Viewer manifest={manifest} />
        </>
      ) : null}
    </main>
  );
}
