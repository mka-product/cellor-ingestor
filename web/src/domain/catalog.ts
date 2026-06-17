export type CatalogSlide = {
  slide_id: string;
  version_id: string;
  display_name: string;
  checksum: string;
  manifest_path: string;
  thumbnail_path?: string | null;
  metrics?: Record<string, number>;
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
