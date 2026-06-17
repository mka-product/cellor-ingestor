# Web Viewer

The viewer consumes `manifest.json` and `index.bin` contracts and keeps rendering concerns separated from network and binary decoding adapters.

## Current MVP Scope

- Manifest fetch and typed parsing
- Binary tile index decoding
- LOD selection helpers
- LRU CPU tile cache
- deck.gl tile layer factory seam
