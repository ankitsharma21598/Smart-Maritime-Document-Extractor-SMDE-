# Architecture Decision Record

This document answers five implementation questions directly for the current Smart Maritime Document Extractor backend.

## Question 1 — Sync vs Async

In production, the default should be **async**. The extraction path includes file IO, OCR/text parsing, LLM calls, retries, and JSON repair. Even with healthy infrastructure, latency variance is high and can cross user-facing timeout limits. Async protects API responsiveness, allows backpressure, and gives deterministic monitoring through job state transitions. Sync should still exist for controlled internal use (for example admin/testing mode), but it should not be the default public behavior.

I would force async regardless of `mode` when **either** of these conditions is true:
- file size is above **2 MB**, or
- current queued extract jobs are above **20** (or running extract jobs above **10**).

The file-size threshold prevents long request hangs for scan-heavy PDFs/images. The queue-concurrency threshold prevents a thundering herd from tying up web workers while still giving small low-concurrency workloads a fast path when sync is explicitly requested.

## Question 2 — Queue Choice

The current queue mechanism is a **PostgreSQL-backed jobs table + polling worker** using `FOR UPDATE SKIP LOCKED`. This was chosen because it is simple, transactionally consistent with application data, and has zero new infrastructure requirements.

For **500 concurrent extractions per minute**, I would migrate to **Redis + BullMQ** (or equivalent) with multiple dedicated workers. That gives better throughput control, delayed retries, dead-letter handling, visibility tooling, and horizontal scaling characteristics that DB polling does not provide cleanly.

Failure modes of the current approach:
- queue throughput is limited by DB polling interval and transaction churn;
- worker crash can leave jobs in `running` without heartbeat/reclaim semantics;
- in-memory rate limiting is process-local (not shared across replicas);
- DB becomes both system-of-record and queue broker, increasing contention under load.

## Question 3 — LLM Provider Abstraction

I implemented against a **single provider path** (Groq OpenAI-compatible chat completions) and did **not** add a formal provider interface. This was deliberate for delivery speed and to reduce abstraction overhead while requirements were still evolving.

Given this scope, a hard abstraction layer would have been speculative. The code centralizes provider calls in one module (`services/llm.ts`), so swap cost is still manageable. If multi-provider operation becomes a requirement, I would introduce:

```ts
interface LlmProvider {
  completeJson(input: {
    system: string;
    userParts: Array<{type:"text";text:string}|{type:"image_url";image_url:{url:string;detail?:"low"|"high"|"auto"}}>;
    timeoutMs: number;
    model?: string;
  }): Promise<string>;
}
```

Then wire provider selection by config and keep extraction/validation logic provider-agnostic.

## Question 4 — Schema Design

JSONB/TEXT-heavy schemas scale poorly when overused. Risks:
- difficult indexing and slower analytical filters;
- weaker data contracts (shape drift over time);
- expensive reprocessing in API/report layers;
- harder governance for “which fields are canonical”.

Current mitigation is a hybrid model: keep raw/variable payload in JSONB, but project frequently queried fields into typed columns (document type, role, confidence, identity keys, expiry markers, summary, processing time, error code).

If we need full-text search across extracted values, I would add:
- a generated or maintained `search_text` column per extraction (flattened key fields),
- `tsvector` index (`GIN`) over that column,
- optional trigram indexes for fuzzy matching names/numbers.

For querying “all sessions where any document has an expired COC”, I would rely on typed columns and indexes:
- `document_type`,
- `is_expired`,
- `session_id`,
with a partial index like `(session_id)` where `document_type='COC' AND is_expired=true`.

That query should not require JSONB scanning in production.

## Question 5 — What I Skipped

I deliberately skipped the following production-grade items:

1. **AuthN/AuthZ and tenant isolation**  
   Deprioritized to focus on extraction/validation workflow correctness first. Production must enforce caller identity, session ownership, and scoped access.

2. **Distributed queue + worker heartbeats**  
   Current DB queue is acceptable for low-medium load, but not sufficient for high concurrency or robust stuck-job recovery.

3. **Observability stack (metrics/traces/structured logs dashboards)**  
   There is basic error handling, but no full SLO-grade instrumentation yet (queue lag, LLM latency percentiles, retry counts, parse-fail rates, etc.).

4. **Comprehensive test suite**  
   The implementation lacks broad integration and failure-path tests (timeouts, malformed JSON repair, race conditions, dedupe collisions). This is critical before production.

5. **Content malware scanning and secure file pipeline hardening**  
   Uploaded file handling exists, but production should include antivirus scanning, stricter MIME sniffing, and retention policy enforcement for stored uploads.
