"""Purpose: worker-facing entrypoints.
Owner context: Ingestion.
Invariants: translate queue payloads to application commands.
Failure modes: invalid payloads are rejected before job execution.
"""
