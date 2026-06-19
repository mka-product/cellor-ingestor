/*
Purpose: expose the overlay runtime cache behind OVSI-oriented naming.
Owner context: Viewer.
Invariants: cache semantics remain bounded and LRU-like for chunk payloads.
Failure modes: cache misses degrade to network fetches rather than incorrect overlay state.
*/

export { OverlayChunkCache as OvsiChunkCache } from "./overlayChunkCache";
