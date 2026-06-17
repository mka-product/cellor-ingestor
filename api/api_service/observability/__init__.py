"""Purpose: shared observability helpers for the API.
Owner context: cross-cutting runtime concerns.
Invariants: structured log fields include correlation ids when present.
Failure modes: logging setup must degrade safely.
"""
