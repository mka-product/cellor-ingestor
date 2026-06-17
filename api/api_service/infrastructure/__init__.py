"""Purpose: infrastructure adapters for persistence, storage, and queue.
Owner context: Identity & Catalog and Delivery.
Invariants: all external IO is isolated here.
Failure modes: raises adapter-specific exceptions wrapped by application services.
"""
