export class TileCache<T> {
  private readonly items = new Map<string, T>();

  constructor(private readonly capacity: number) {}

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
    if (this.items.size > this.capacity) {
      const oldest = this.items.keys().next().value;
      if (oldest) this.items.delete(oldest);
    }
  }

  size(): number {
    return this.items.size;
  }
}
