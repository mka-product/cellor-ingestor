import { useCallback, useRef, useState } from "react";
import { uploadOverlayFile, uploadSlideFile } from "../infrastructure/catalogClient";

export type DropResult = {
  queued: number;
  errors: string[];
};

export type DropUploadState = {
  isDragging: boolean;
  isUploading: boolean;
  lastResult: DropResult | null;
};

const SLIDE_EXTS = new Set([
  ".svs", ".ndpi", ".tiff", ".tif", ".scn", ".mrxs",
  ".vms", ".vmu", ".bif", ".btf", ".dcm", ".isyntax",
]);
const OVERLAY_EXTS = new Set([".geojson", ".json", ".parquet", ".geoparquet"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function sourceFormatOf(name: string): string {
  const ext = extOf(name);
  if (ext === ".geojson") return "geojson";
  if (ext === ".json") return "json";
  if (ext === ".geoparquet") return "geoparquet";
  if (ext === ".parquet") return "parquet";
  return "geojson";
}

async function collectFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    }).then((f) => [f as File]);
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    return new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    }).then((entries) => Promise.all(entries.map(collectFiles)).then((all) => all.flat()));
  }
  return [];
}

export function useDropUpload(slideId: string | null | undefined) {
  const [state, setState] = useState<DropUploadState>({
    isDragging: false,
    isUploading: false,
    lastResult: null,
  });
  const dragCounter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setState((s) => ({ ...s, isDragging: true }));
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setState((s) => ({ ...s, isDragging: false }));
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setState((s) => ({ ...s, isDragging: false, isUploading: true }));

      const items = Array.from(e.dataTransfer.items ?? []);
      const files: File[] = [];

      if (items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
        const entries = await Promise.all(
          items.map((item) => {
            const entry = item.webkitGetAsEntry();
            return entry ? collectFiles(entry) : Promise.resolve([] as File[]);
          })
        );
        files.push(...entries.flat());
      } else {
        files.push(...Array.from(e.dataTransfer.files ?? []));
      }

      const errors: string[] = [];
      let queued = 0;

      await Promise.all(
        files.map(async (file) => {
          const ext = extOf(file.name);
          if (SLIDE_EXTS.has(ext)) {
            const fd = new FormData();
            fd.append("file", file);
            try {
              await uploadSlideFile(fd);
              queued++;
            } catch {
              errors.push(`Slide upload failed: ${file.name}`);
            }
          } else if (OVERLAY_EXTS.has(ext)) {
            if (!slideId) {
              errors.push(`No slide open to attach overlay: ${file.name}`);
              return;
            }
            const fd = new FormData();
            fd.append("file", file);
            fd.append("slide_id", slideId);
            fd.append("source_format", sourceFormatOf(file.name));
            fd.append("display_name", file.name.replace(/\.[^.]+$/, ""));
            try {
              await uploadOverlayFile(fd);
              queued++;
            } catch {
              errors.push(`Overlay upload failed: ${file.name}`);
            }
          } else {
            errors.push(`Unsupported file type: ${file.name}`);
          }
        })
      );

      setState({ isDragging: false, isUploading: false, lastResult: { queued, errors } });
    },
    [slideId]
  );

  const clearResult = useCallback(() => {
    setState((s) => ({ ...s, lastResult: null }));
  }, []);

  return { state, onDragEnter, onDragLeave, onDragOver, onDrop, clearResult };
}
