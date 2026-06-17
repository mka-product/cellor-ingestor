# Glossary

- `Slide`: logical domain identity for a WSI.
- `SlideVersion`: immutable original upload and its derived artifact lineage.
- `IngestionJob`: asynchronous processing request for one slide version.
- `DerivedArtifact`: any published output such as `manifest.json`, `index.bin`, or tile groups.
- `TileGroup`: packed set of nearby tiles stored as one object.
- `TileIndexEntry`: lookup record mapping a tile to group, byte offset, byte length, and flags.
- `ManifestPublication`: final readiness step that exposes a slide version to viewers.
- `ViewerManifest`: JSON contract consumed by the web app to stream derived assets.
