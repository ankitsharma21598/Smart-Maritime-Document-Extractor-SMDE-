# PR Review — `feat: add document extraction endpoint`

Hi — thanks for taking this on. You got the happy path working end-to-end, which is a solid first step.  
That said, I would **not approve this PR yet** for production use because there are several high-severity issues around security, reliability, and runtime behavior.

## Overall assessment

You proved the core flow (upload -> model call -> JSON response), which is great. The next step is making it safe and operable in a real backend. Right now the code has:

- a credential management/security blocker,
- event-loop blocking file operations,
- brittle parsing/error handling for LLM output,
- unsafe storage/path handling,
- and no durable persistence strategy.

Please address the blocking issues below before merge.

---

## Inline comments

### 1) Hardcoded secret in source (blocker)
**`src/routes/extract.ts` (around `new Anthropic({ apiKey: 'sk-ant-REDACTED' })`)**

Hardcoded API keys in source are a security incident waiting to happen (repo leaks, logs, screenshots, accidental pushes).  
Use environment variables (`process.env...`) and fail fast on missing config. Also rotate this key if this was ever a real token.

---

### 2) Synchronous filesystem calls inside request handler (blocker)
**`fs.readFileSync`, `fs.copyFileSync` usage in request path**

`readFileSync`/`copyFileSync` block the Node event loop. Under concurrent traffic, this will degrade latency for all requests, not just this one.

Use async `fs/promises` or stream-based handling. This endpoint is already LLM-latency-bound, so avoid adding blocking work on top.

---

### 3) Unsafe filename handling / path traversal risk
**`path.join('./uploads', file.originalname)`**

`file.originalname` is user-controlled input. If not sanitized, you can get path traversal or collisions (`../../...`, duplicate names, weird unicode names).  
Use generated names (UUID/hash), never trust original filename for storage path, and keep original name only as metadata.

---

### 4) Permanent disk writes without lifecycle policy
**`fs.copyFileSync(file.path, savedPath)`**

This stores every upload forever with no retention policy, no cleanup, no encryption-at-rest strategy, and no capacity guardrails.  
At minimum, define retention + cleanup and ensure temporary files are deleted.

---

### 5) Missing upload validation and middleware assumptions
**`const file = req.file; if (!file) ...`**

This code assumes multer (or equivalent) is configured upstream, but this file doesn’t show it. Also missing:

- MIME allowlist,
- max file size limit,
- supported modality validation (PDF vs image),
- clear 4xx error codes.

Without those, malformed/large uploads can crash or DoS the endpoint.

---

### 6) LLM response parsing is brittle
**`const result = JSON.parse(response.content[0].text);`**

LLM output is often not strict JSON (fences, preamble, trailing text). This will fail often in production.  
You need:

- boundary extraction of outermost `{...}`,
- parse retry/repair pass,
- timeout + retry policy,
- structured failure classification (e.g., parse failure vs provider timeout).

---

### 7) No request timeout / provider resilience strategy
**`await client.messages.create(...)`**

No timeout, no retries, no backoff, no circuit-breaking behavior. If provider stalls, requests can hang and tie up workers.

Set explicit timeouts and map failures to deterministic API errors.

---

### 8) Global in-memory storage is not a persistence layer
**`global.extractions = global.extractions || []; ... push(result);`**

This disappears on restart, doesn’t scale across instances, and is unsafe for memory growth.  
Use DB-backed persistence with status and metadata.

---

### 9) Logging and error hygiene
**`console.log('Error:', error); res.status(500).json({ error: 'Something went wrong' });`**

Two improvements needed:

- use structured logging (request/session/job IDs),
- return standardized error codes/messages for client behavior.

Also avoid leaking provider/raw internals to logs without scrub rules.

---

### 10) Model and cost/latency choice should be configurable
**`model: 'claude-opus-4-6'`**

Using Opus by default may be too expensive/high latency for extraction workflows.  
Make model selection config-driven and justify default via benchmark (cost, latency, extraction quality).

---

## Teaching moment (important)

You solved the “works on one file” path, which is exactly how most of us start.  
The growth step for backend engineering is: **design for failure modes first, not just successful execution**.

For LLM/file-processing endpoints, always ask:

1. What if input is malformed/huge?
2. What if provider times out/returns non-JSON?
3. What if traffic spikes?
4. What if process restarts mid-request?
5. What data/audit trail must be retained on failure?

If you structure code around those questions, production readiness improves dramatically.

---

## Suggested next actions

1. Move API key + model to config/env.
2. Replace sync FS calls with async and sanitize storage naming.
3. Add strict upload validation (size/type) and middleware in route wiring.
4. Implement robust LLM JSON handling + timeout/retry strategy.
5. Replace `global.extractions` with DB persistence and explicit status model.
6. Add integration tests for: invalid file, provider timeout, malformed JSON, successful extraction.

Happy to re-review after those are in — good foundation, just needs production hardening.
