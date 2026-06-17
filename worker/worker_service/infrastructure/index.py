"""Purpose: binary encoder and decoder for tile index entries.
Owner context: Ingestion.
Invariants: layout matches the documented v1 little-endian contract.
Failure modes: malformed byte streams raise ValueError on decode.
"""

from __future__ import annotations

import struct

from worker.worker_service.domain.models import TileIndexEntry


ENTRY_STRUCT = struct.Struct("<IIIQIHh")


class BinaryIndexCodec:
    def encode(self, entries: list[TileIndexEntry]) -> bytes:
        return b"".join(
            ENTRY_STRUCT.pack(entry.tile_x, entry.tile_y, entry.group_id, entry.offset, entry.length, entry.flags, entry.codec)
            for entry in entries
        )

    def decode(self, payload: bytes) -> list[TileIndexEntry]:
        if len(payload) % ENTRY_STRUCT.size != 0:
            raise ValueError("invalid tile index payload length")
        entries: list[TileIndexEntry] = []
        for start in range(0, len(payload), ENTRY_STRUCT.size):
            tile_x, tile_y, group_id, offset, length, flags, codec = ENTRY_STRUCT.unpack(
                payload[start : start + ENTRY_STRUCT.size]
            )
            entries.append(
                TileIndexEntry(
                    tile_x=tile_x,
                    tile_y=tile_y,
                    group_id=group_id,
                    offset=offset,
                    length=length,
                    flags=flags,
                    codec=codec,
                )
            )
        return entries
