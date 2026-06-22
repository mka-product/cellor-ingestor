/*
Purpose: provide deterministic semantic overlay styling independent of current LOD stage.
Owner context: Viewer.
Invariants: class labels map to one of 40 stable colors alphabetically; score-driven overlays map into 5 fixed bins.
Failure modes: missing class and score metadata degrade to a default palette entry rather than unstable colors.
*/

import type { OverlayClassStyle, OverlayFeature, OverlaySource } from "../domain/workspace";

export type OverlaySemanticMode = "class" | "score";

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
