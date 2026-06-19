/*
Purpose: bound overlay chunk residency so manifest-driven loading does not retain every visited chunk.
Owner context: Viewer.
Invariants: accessed or written chunks become most-recently-used and retained viewport chunks are never pruned in the same pass.
Failure modes: over-retention degrades to higher memory use, never to missing visible chunks.
*/

export class OverlayChunkCache<T> {
  private readonly items = new Map<string, T>();

  constructor(private readonly capacity: number) {}

  clear(): void {
    this.items.clear();
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  get(key: string): T | undefined {
    const value = this.items.get(key);
    if (value === undefined) return undefined;
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.items.has(key)) {
      this.items.delete(key);
    }
    this.items.set(key, value);
    this.prune(new Set());
  }

  prune(retainedKeys: Set<string>): void {
    if (this.items.size <= this.capacity && retainedKeys.size === 0) {
      return;
    }
    for (const key of [...this.items.keys()]) {
      if (this.items.size <= this.capacity) break;
      if (retainedKeys.has(key)) continue;
      this.items.delete(key);
    }
  }

  size(): number {
    return this.items.size;
  }
}
