/*
Purpose: provide deterministic semantic overlay styling independent of current LOD stage.
Owner context: Viewer.
Invariants: class labels map to one of 40 stable colors alphabetically; score-driven overlays map into 5 fixed bins;
            OD data modulates fill saturation of class colors — low OD = pastel, high OD = deep saturated.
Failure modes: missing class and score metadata degrade to a default palette entry rather than unstable colors.
*/

import type { OverlayClassStyle, OverlayFeature, OverlaySource } from "../domain/workspace";

export type OverlaySemanticMode = "class" | "score";

export type OdPalette =
  | "dab" | "flare" | "crest" | "mako" | "rocket"
  | "magma" | "viridis" | "blues" | "greens" | "ylorrd";

export type OdColorScale = {
  min: number;
  max: number;
  breakpoint1: number;
  breakpoint2: number;
  intensity?: number;   // 0 = class color only · 1 = pure OD map · 0.65 default
  palette?: OdPalette;  // colour gradient preset; defaults to "dab"
};

export type OverlayLegendItem = {
  key: string;
  label: string;
  color: string;
};

const CLASS_COLOR_REGISTRY = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
  "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#0f766e",
  "#b91c1c", "#1d4ed8", "#15803d", "#a21caf", "#c2410c",
  "#0369a1", "#be185d", "#4d7c0f", "#6d28d9", "#0f766e",
  "#1e40af", "#9f1239", "#166534", "#7e22ce", "#9a3412",
  "#155e75", "#c026d3", "#3f6212", "#5b21b6", "#115e59",
  "#312e81", "#991b1b", "#047857", "#6b21a8", "#92400e",
  "#075985", "#9d174d", "#365314", "#4c1d95", "#134e4a"
] as const;

const SCORE_BINS = [
  { key: "score:0", label: "0.00-0.20", color: "#1d4ed8", min: 0, max: 0.2 },
  { key: "score:1", label: "0.20-0.40", color: "#0891b2", min: 0.2, max: 0.4 },
  { key: "score:2", label: "0.40-0.60", color: "#16a34a", min: 0.4, max: 0.6 },
  { key: "score:3", label: "0.60-0.80", color: "#f59e0b", min: 0.6, max: 0.8 },
  { key: "score:4", label: "0.80-1.00", color: "#dc2626", min: 0.8, max: 1.0000001 }
] as const;

// Four-stop RGBA gradients: stop 0 = min OD (unstained), stop 3 = max OD (heavily stained).
// All palettes run light → dark so low OD = pale background, high OD = saturated foreground.
export const OD_PALETTES: Record<OdPalette, readonly [number, number, number, number][]> = {
  // IHC DAB — warm brown standard for pathology immunostaining
  dab: [
    [252, 240, 232,  64],
    [249, 115,  22, 153],
    [185,  28,  28, 217],
    [ 69,  10,  10, 242],
  ],
  // Flare (seaborn) — pale cream to deep red, warm perceptual sequential
  flare: [
    [244, 234, 219,  64],
    [235, 166, 104, 153],
    [196,  70,  60, 217],
    [ 90,  15,  55, 242],
  ],
  // Crest (seaborn) — pale teal-green to dark navy, cool perceptual sequential
  crest: [
    [213, 235, 222,  64],
    [ 99, 180, 168, 153],
    [ 42, 118, 132, 217],
    [ 15,  62,  97, 242],
  ],
  // Mako (seaborn) — pale mint to deep navy blue-teal
  mako: [
    [209, 238, 234,  64],
    [ 74, 175, 168, 153],
    [ 40, 103, 150, 217],
    [ 10,  35,  69, 242],
  ],
  // Rocket (seaborn) — pale gold to dark earthy maroon
  rocket: [
    [255, 245, 215,  64],
    [225, 140,  75, 153],
    [175,  50,  50, 217],
    [ 70,   8,  38, 242],
  ],
  // Magma (matplotlib) — pale yellow to near-black, high drama
  magma: [
    [252, 253, 191,  64],
    [246, 149,  66, 153],
    [152,  42, 100, 217],
    [  0,   0,   4, 242],
  ],
  // Viridis (matplotlib) — yellow to deep purple, perceptually uniform, colour-blind safe
  viridis: [
    [253, 231,  37,  64],
    [ 94, 201,  98, 153],
    [ 33, 145, 140, 217],
    [ 68,   1,  84, 242],
  ],
  // Blues — near-white sky to dark navy, single-hue minimal
  blues: [
    [240, 248, 255,  64],
    [132, 191, 229, 153],
    [ 49, 130, 189, 217],
    [  8,  48, 107, 242],
  ],
  // Greens — pale lime to deep forest, natural tissue association
  greens: [
    [237, 248, 233,  64],
    [116, 196, 118, 153],
    [ 35, 139,  69, 217],
    [  0,  68,  27, 242],
  ],
  // YlOrRd — yellow to dark red, classic warm heatmap for dense signals
  ylorrd: [
    [255, 255, 178,  64],
    [254, 178,  76, 153],
    [240,  59,  32, 217],
    [128,   0,  38, 242],
  ],
} as const;

export const OD_PALETTE_META: Record<OdPalette, { label: string; description: string }> = {
  dab:    { label: "DAB",     description: "IHC brown staining — warm standard for pathology" },
  flare:  { label: "Flare",   description: "Cream to deep red — warm seaborn sequential" },
  crest:  { label: "Crest",   description: "Pale teal to dark navy — cool seaborn sequential" },
  mako:   { label: "Mako",    description: "Mint to deep navy — blue-teal seaborn sequential" },
  rocket: { label: "Rocket",  description: "Pale gold to maroon — warm earthy seaborn sequential" },
  magma:  { label: "Magma",   description: "Yellow to near-black — high contrast, matplotlib" },
  viridis:{ label: "Viridis", description: "Yellow to deep purple — perceptual, colour-blind safe" },
  blues:  { label: "Blues",   description: "Sky to dark navy — single-hue, minimal distraction" },
  greens: { label: "Greens",  description: "Pale lime to forest — natural tissue colour association" },
  ylorrd: { label: "YlOrRd",  description: "Yellow to dark red — classic warm heatmap" },
};

/** @deprecated use OD_PALETTE_META */
export const OD_PALETTE_LABELS = Object.fromEntries(
  Object.entries(OD_PALETTE_META).map(([k, v]) => [k, v.label])
) as Record<OdPalette, string>;

function odGradient(scale: OdColorScale): readonly [number, number, number, number][] {
  return OD_PALETTES[scale.palette ?? "dab"];
}

export function sanitizeOverlayLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function semanticKey(feature: OverlayFeature): string {
  const classValue = feature.properties.class ?? feature.properties.label;
  if (typeof classValue === "string" && classValue.trim().length > 0) {
    return classValue.trim();
  }
  const score = typeof feature.properties.score === "number" ? feature.properties.score : null;
  if (score != null && Number.isFinite(score)) {
    return scoreBin(score).key;
  }
  return "default";
}

// ─── OD helpers ────────────────────────────────────────────────────────────

const OD_FIELD_CANDIDATES = [
  "od", "OD", "optical_density",
  "od_nucleus", "od_cytoplasm", "od_membrane",
] as const;

export function extractOdValue(feature: OverlayFeature): number | null {
  for (const key of OD_FIELD_CANDIDATES) {
    const v = feature.properties[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function extractOdEntry(feature: OverlayFeature): { label: string; value: number } | null {
  const LABELS: Record<string, string> = {
    od: "OD", OD: "OD", optical_density: "OD",
    od_nucleus: "OD (nucleus)", od_cytoplasm: "OD (cytoplasm)", od_membrane: "OD (membrane)",
  };
  for (const key of OD_FIELD_CANDIDATES) {
    const v = feature.properties[key];
    if (typeof v === "number" && Number.isFinite(v)) return { label: LABELS[key], value: v };
  }
  return null;
}

export function inferOverlayHasOd(features: OverlayFeature[]): boolean {
  const polys = features.filter((f) => f.kind === "polygon");
  if (polys.length === 0) return false;
  const odCount = polys.filter((f) => extractOdValue(f) !== null).length;
  return odCount / polys.length >= 0.5;
}

export function computeOdRange(features: OverlayFeature[]): { min: number; max: number } {
  const vals = features
    .map((f) => extractOdValue(f))
    .filter((v): v is number => v !== null);
  if (vals.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return { min: lo, max: hi > lo ? hi : lo + 1 };
}

export function defaultOdColorScale(features: OverlayFeature[]): OdColorScale {
  const { min, max } = computeOdRange(features);
  const span = max - min;
  return {
    min,
    max,
    breakpoint1: min + span * 0.33,
    breakpoint2: min + span * 0.67,
    intensity: 0.65,
  };
}

function lerpRgba(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number
): [number, number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
    Math.round(a[3] + (b[3] - a[3]) * c),
  ];
}

export function odColorForValue(od: number, scale: OdColorScale): [number, number, number, number] {
  const { min, max, breakpoint1, breakpoint2 } = scale;
  const g = odGradient(scale);
  const clamped = Math.max(min, Math.min(max, od));
  if (clamped <= breakpoint1) {
    const t = breakpoint1 > min ? (clamped - min) / (breakpoint1 - min) : 0;
    return lerpRgba(g[0], g[1], t);
  }
  if (clamped <= breakpoint2) {
    const t = breakpoint2 > breakpoint1 ? (clamped - breakpoint1) / (breakpoint2 - breakpoint1) : 0;
    return lerpRgba(g[1], g[2], t);
  }
  const t = max > breakpoint2 ? (clamped - breakpoint2) / (max - breakpoint2) : 1;
  return lerpRgba(g[2], g[3], t);
}

// Returns a CSS linear-gradient for the current scale and palette, anchoring stops at breakpoints.
export function odGradientCss(scale: OdColorScale): string {
  const g = odGradient(scale);
  const span = scale.max - scale.min || 1;
  const bp1 = ((scale.breakpoint1 - scale.min) / span * 100).toFixed(1);
  const bp2 = ((scale.breakpoint2 - scale.min) / span * 100).toFixed(1);
  const toRgba = (stop: readonly [number, number, number, number]) =>
    `rgba(${stop[0]},${stop[1]},${stop[2]},${(stop[3] / 255).toFixed(2)})`;
  return [
    `${toRgba(g[0])} 0%`,
    `${toRgba(g[1])} ${bp1}%`,
    `${toRgba(g[2])} ${bp2}%`,
    `${toRgba(g[3])} 100%`,
  ].join(", ");
}

// Returns the full gradient CSS for a given palette (all 4 stops evenly spaced).
export function odPaletteCss(palette: OdPalette): string {
  const g = OD_PALETTES[palette];
  const pcts = ["0%", "33%", "66%", "100%"];
  const toRgba = (stop: readonly [number, number, number, number]) =>
    `rgba(${stop[0]},${stop[1]},${stop[2]},${(stop[3] / 255).toFixed(2)})`;
  return [0, 1, 2, 3].map((i) => `${toRgba(g[i])} ${pcts[i]}`).join(", ");
}

// ─── OD overlay blend: lerp from class color → OD gradient based on intensity ─
//
// intensity=0   → pure class color fill (OD not visible)
// intensity=0.5 → 50/50 blend of class fill and OD gradient
// intensity=1   → pure OD gradient (full OD map, same as the old standalone "od" mode)
//
// Both fill color and alpha lerp together, so the OD gradient's own alpha
// (high at strong staining, low at background) carries through naturally.
export function odModulatedFill(
  classHex: string,
  classOpacity: number,
  od: number,
  scale: OdColorScale,
): [number, number, number, number] {
  const [cr, cg, cb] = parseHexColor(classHex);
  const ca = Math.round(Math.max(0, Math.min(1, classOpacity)) * 255);
  const intensity = Math.max(0, Math.min(1, scale.intensity ?? 0.65));

  if (intensity <= 0) return [cr, cg, cb, ca];

  const [or_, og, ob, oa] = odColorForValue(od, scale);

  if (intensity >= 1) return [or_, og, ob, oa];

  return [
    Math.round(cr + (or_ - cr) * intensity),
    Math.round(cg + (og - cg) * intensity),
    Math.round(cb + (ob - cb) * intensity),
    Math.round(ca + (oa - ca) * intensity),
  ];
}

// ─── Class/score helpers ────────────────────────────────────────────────────

export function inferOverlaySemanticMode(features: OverlayFeature[], overlay?: OverlaySource | null): OverlaySemanticMode {
  if (overlay?.legend && overlay.legend.length > 0) {
    return "class";
  }
  const classCount = features.filter((feature) => typeof (feature.properties.class ?? feature.properties.label) === "string").length;
  const scoreCount = features.filter((feature) => typeof feature.properties.score === "number" && Number.isFinite(feature.properties.score)).length;
  return classCount >= scoreCount ? "class" : "score";
}

function scoreBin(score: number) {
  return SCORE_BINS.find((bin) => score >= bin.min && score < bin.max) ?? SCORE_BINS[SCORE_BINS.length - 1];
}

function parseHexColor(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  const value = Number.parseInt(expanded, 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

export function alphaColor(hex: string, alpha: number): [number, number, number, number] {
  const [red, green, blue] = parseHexColor(hex);
  return [red, green, blue, Math.max(0, Math.min(255, Math.round(alpha * 255)))];
}

export function defaultOverlayLegend(
  overlay: OverlaySource | null,
  features: OverlayFeature[],
  mode: OverlaySemanticMode
): OverlayLegendItem[] {
  if (mode === "score") {
    return SCORE_BINS.map((bin) => ({ key: bin.key, label: bin.label, color: bin.color }));
  }
  const legendLabels = (overlay?.legend ?? [])
    .map((item) => (typeof item.label === "string" ? item.label : null))
    .filter((label): label is string => Boolean(label));
  const featureLabels = features
    .map((feature) => {
      const value = feature.properties.class ?? feature.properties.label;
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    })
    .filter((label): label is string => Boolean(label));
  const labels = Array.from(new Set([...legendLabels, ...featureLabels])).sort((left, right) => left.localeCompare(right));
  return labels.map((label, index) => ({
    key: label,
    label: sanitizeOverlayLabel(label),
    color: CLASS_COLOR_REGISTRY[index % CLASS_COLOR_REGISTRY.length]
  }));
}

export function defaultOverlayStyleMap(
  overlay: OverlaySource | null,
  features: OverlayFeature[],
  mode: OverlaySemanticMode
): Record<string, OverlayClassStyle> {
  const items = defaultOverlayLegend(overlay, features, mode);
  return Object.fromEntries(items.map((item) => [item.key, { color: item.color, opacity: 0.4, strokeWidth: 2 }]));
}

export function colorForFeature(
  feature: OverlayFeature,
  mode: OverlaySemanticMode,
  styleOverrides: Record<string, OverlayClassStyle>,
  defaultStyles: Record<string, OverlayClassStyle>
): OverlayClassStyle {
  const key = mode === "score"
    ? scoreBin(typeof feature.properties.score === "number" ? feature.properties.score : 0).key
    : semanticKey(feature);
  return styleOverrides[key] ?? defaultStyles[key] ?? { color: "#38bdf8", opacity: 0.4, strokeWidth: 2 };
}
