# ADR 0002: Database Schema Shape

## Status
Accepted

## Context
The service needs to support:
- session-level grouping
- asynchronous extraction/validation jobs
- fast status polling and queue reads
- deduplication by hash within a session
- durable storage of successful and failed LLM runs
- product-facing reports without repeatedly parsing large JSON blobs

## Decision
Use normalized tables with selective JSONB for high-variance payloads:

- `sessions`: lifecycle root for grouped documents.
- `documents`: one uploaded file per row (`session_id`, `file_hash`, filename, MIME, size, created_at).
- `extraction_cache`: one row per file hash containing:
  - status/error metadata
  - `raw_llm_response` for forensics
  - extracted full payload JSONB (`extraction`) for long-tail fields
  - denormalized/query columns for common report/filter dimensions:
    - `document_type`, `document_name`, `applicable_role`, `confidence`
    - `holder_name`, `date_of_birth`, `sirb_number`, `passport_number`
    - `is_expired`, `summary`, `processing_time_ms`
- `jobs`: queue state machine (`queued|running|completed|failed`) plus error code/message and timestamps.
- `session_validations`: stores latest cross-document assessment snapshots.

This keeps JSONB for heterogeneous details while promoting high-value fields into typed columns.

## Indexing Strategy
- `documents(session_id)` for session listing.
- `documents(file_hash)` for hash lookups.
- `UNIQUE documents(session_id, file_hash)` to enforce same-session dedupe key.
- `jobs(created_at) WHERE status='queued'` for worker dequeue scans.
- `jobs(session_id, status)` for pending jobs per session.
- partial unique on active extract jobs by hash to avoid duplicate in-flight extraction.
- `extraction_cache(document_type, applicable_role)` for report/filter use.
- `extraction_cache(holder_name, sirb_number, passport_number)` for identity correlation checks.

## Consequences
### Positive
- Polling endpoints and reports are fast without heavy JSON post-processing.
- Failure analysis is preserved (`raw_llm_response`, `error_code`, `error_message`).
- Deduplication and queue invariants are enforced at DB level.

### Tradeoff
- Some extraction attributes are duplicated (typed columns + JSONB).
- Requires careful write-path updates to keep projected columns consistent.

## Guardrail Against JSONB Dumping
JSONB is retained only for variable schemas (`extraction`, `compliance_issues`, validation result).
Frequently queried business fields must be projected into dedicated typed columns.
