export type ViewerBenchmarkResult = {
  manifestFetchMs: number;
  indexDecodeMs: number;
  visibleTileCount: number;
};

export function summarizeViewerBenchmark(result: ViewerBenchmarkResult): string {
  return [
    `manifestFetchMs=${result.manifestFetchMs}`,
    `indexDecodeMs=${result.indexDecodeMs}`,
    `visibleTileCount=${result.visibleTileCount}`
  ].join(" ");
}
