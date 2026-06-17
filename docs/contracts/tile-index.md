# Binary Tile Index v1

Each entry is packed little-endian:

```text
tile_x   uint32
tile_y   uint32
group_id uint32
offset   uint64
length   uint32
flags    uint16
codec    uint16
```

Flags:

- `1` empty tile
- `2` background tile
- `4` tissue tile

Codec values:

- `1` jpeg
- `2` webp
