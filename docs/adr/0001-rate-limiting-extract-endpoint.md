# ADR 0001: Rate Limiting Strategy for `/api/extract`

## Status
Accepted

## Context
The API must enforce a limit of 10 requests per minute per IP on `POST /api/extract` only.
Other endpoints should remain unaffected by this specific quota.
When the quota is exceeded, the API must return:
- HTTP `429`
- error code `RATE_LIMITED`
- `Retry-After` response header
- `retryAfterMs` value in the JSON body

## Decision
Use `express-rate-limit` middleware attached only to `POST /api/extract`.

Configuration:
- `windowMs`: `60_000`
- `max`: `10`
- scope: per-IP (default key generator)
- custom handler that:
  - calculates remaining wait time
  - sets `Retry-After` header in seconds
  - returns standardized API error body with `retryAfterMs`

## Consequences
### Positive
- Simple and low-maintenance implementation.
- No additional infrastructure (e.g., Redis) required.
- Fast to reason about and test locally.

### Negative
- In-memory counters are per-process; limits are not shared across multiple app instances.
- Counter resets on process restart.

### Future evolution
If the service becomes horizontally scaled, replace in-memory storage with a centralized backend (e.g., Redis store) while keeping the same external API behavior.
