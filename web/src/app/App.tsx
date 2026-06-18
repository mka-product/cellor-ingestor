import { useEffect, useMemo, useRef, useState } from "react";

import { Viewer } from "../components/Viewer";
import type { CatalogSlide } from "../domain/catalog";
import type { ViewerManifest } from "../domain/contracts";
import { fetchSlides, fetchManifestContent } from "../infrastructure/catalogClient";

export function App() {
  const [slides, setSlides] = useState<CatalogSlide[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [status, setStatus] = useState("loading");
  const [searchValue, setSearchValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const selectedSlide = useMemo(
    () => slides.find((slide) => `${slide.slide_id}:${slide.version_id}` === selectedKey) ?? null,
    [selectedKey, slides]
  );

  const selectedSlideLabel = selectedSlide?.display_name ?? "";

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
        <div className="workspace-launcher" />
      </header>
      {slides.length === 0 ? <div className="workspace-empty" style={{ padding: 24 }}>No ingested slides found.</div> : null}
      {manifest ? <Viewer manifest={manifest} /> : null}
    </main>
  );
}
