# Pilot Runbook

## Upload To Ready

1. Client initiates multipart upload through API.
2. Client completes upload callback with checksum and original path.
3. API records slide version, emits events, and enqueues ingestion.
4. Worker writes artifacts to staging paths and publishes manifest last.
5. API serves manifest pointer after registry or persistent catalog update.

## Failure Triage

- `OriginalUploaded` missing: inspect API completion logs and payload validation.
- `IngestionFailed`: inspect worker event stream and artifact root for partial output.
- Manifest 404: verify manifest registry state and published artifact path.
- Viewer load failure: verify manifest schema, index payload size multiple of 28, and CDN cache headers.
