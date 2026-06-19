export type CatalogSlide = {
  slide_id: string;
  version_id: string;
  display_name: string;
  checksum: string;
  manifest_path: string;
  thumbnail_path?: string | null;
  metrics?: JobMetrics;
};

export type JobMetrics = {
  elapsed_seconds?: number;
  parse_seconds?: number;
  publish_seconds?: number;
  level_count?: number;
  tile_count?: number;
  non_empty_tile_count?: number;
  group_count?: number;
  artifact_bytes?: number;
  feature_count?: number;
  chunk_count?: number;
  timings?: Record<string, number>;
};

export type AvailableReader = {
  backend: string;
  is_default: boolean;
  is_recommended: boolean;
  label: string;
  supports_render: boolean;
  supports_metadata: boolean;
  is_default_metadata: boolean;
};

export type IngestionJob = {
  job_id: string;
  slide_id: string;
  version_id: string;
  status: string;
  display_name: string;
  reader_backend: string;
  metadata_backend: string;
  progress_percent: number;
  stage: string;
  message?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  metrics?: JobMetrics;
};

export type OverlayJob = {
  job_id: string;
  slide_id: string;
  overlay_id: string;
  version_id: string;
  filename: string;
  name: string;
  source_format: string;
  status: string;
  stage: string;
  progress_percent: number;
  message?: string | null;
  feature_count: number;
  kind?: string | null;
  checksum?: string | null;
  runtime_format?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  metrics?: JobMetrics;
  artifact?: Record<string, unknown>;
};
