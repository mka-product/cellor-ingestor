import type { TileIndexRecord, TileReference } from "../domain/contracts";

const ENTRY_SIZE = 28;

export function decodeTileIndex(buffer: ArrayBuffer): TileIndexRecord[] {
  if (buffer.byteLength % ENTRY_SIZE !== 0) {
    throw new Error("invalid tile index payload");
  }
  const view = new DataView(buffer);
  const entries: TileIndexRecord[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += ENTRY_SIZE) {
    entries.push({
      tileX: view.getUint32(offset, true),
      tileY: view.getUint32(offset + 4, true),
      groupId: view.getUint32(offset + 8, true),
      offset: Number(view.getBigUint64(offset + 12, true)),
      length: view.getUint32(offset + 20, true),
      flags: view.getUint16(offset + 24, true),
      codec: view.getUint16(offset + 26, true)
    });
  }
  return entries;
}

export class TileIndexLookup {
  private readonly records = new Map<string, TileIndexRecord>();

  constructor(entries: TileIndexRecord[]) {
    entries.forEach((entry) => {
      this.records.set(`${entry.tileX}:${entry.tileY}`, entry);
    });
  }

  lookup(tileX: number, tileY: number): TileReference | null {
    const record = this.records.get(`${tileX}:${tileY}`);
    if (!record) return null;
    return { ...record, empty: (record.flags & 1) === 1 };
  }
}
