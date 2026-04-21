# Smart Maritime Document Extractor (SMDE)

Node.js + TypeScript backend for maritime document extraction, async job tracking, session validation, and compliance reporting.

## 5-minute setup (local)

### 1) Prerequisites
- Node.js 20+ (or 22+)
- Docker
- A Groq API key

### 2) Start PostgreSQL (Docker Compose)

```bash
docker compose up -d
```

This uses `docker-compose.yml` in repo root:
- container: `smde-pg-container`
- user/password: `root` / `root`
- database: `smde_db`
- volume: `smde`

### 3) Install dependencies

```bash
npm install
```

### 4) Create `.env`
Create a file named `.env` in the repo root:

```env
DATABASE_URL=postgres://root:root@localhost:5432/smde_db
GROQ_API_KEY=gsk_your_key_here
PORT=3000
```

Optional overrides:

```env
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=3
WORKER_POLL_MS=1000
```

### 5) Migrate DB + run server

```bash
npm run db:migrate
npm run dev
```

Server starts at:
- `http://localhost:3000`

---

## Quick API smoke test

### Health

```bash
curl http://localhost:3000/api/health
```

### Extract (sync)

```bash
curl -X POST "http://localhost:3000/api/extract?mode=sync" \
  -F "document=@/absolute/path/to/file.jpg"
```

### Extract (async)

```bash
curl -X POST "http://localhost:3000/api/extract?mode=async" \
  -F "document=@/absolute/path/to/file.jpg"
```

Use returned `jobId`:

```bash
curl "http://localhost:3000/api/jobs/<jobId>"
```

### Session endpoints

```bash
curl "http://localhost:3000/api/sessions/<sessionId>"
curl -X POST "http://localhost:3000/api/sessions/<sessionId>/validate?mode=sync"
curl "http://localhost:3000/api/sessions/<sessionId>/report"
```

---

## Useful scripts

- `npm run dev` — run API with watch mode
- `npm run build` — type-check + build to `dist/`
- `npm run start` — run built app
- `npm run db:migrate` — apply schema migrations
- `npm run db:truncate` — delete all app table rows

---

## Main endpoints

- `POST /api/extract?mode=sync|async`
- `GET /api/jobs/:id`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/validate`
- `GET /api/sessions/:id/report`
- `GET /api/health`

---

## Notes

- Upload field name must be `document` (`multipart/form-data`).
- Supported MIME types: `application/pdf`, `image/jpeg`, `image/png`.
- Max upload size: 10MB.
- Rate limit on extract endpoint: 10 requests/min/IP.
- Async extract requires `mode=async`; sync is `mode=sync` (default).
- If you see `database "smde_db" does not exist`, run `docker compose down -v && docker compose up -d`.

---

## Docker Compose commands

Start DB:

```bash
docker compose up -d
```

Stop DB:

```bash
docker compose down
```

Stop and remove DB data volume (full reset):

```bash
docker compose down -v
```

Check DB logs:

```bash
docker compose logs -f postgres
```
