# Pryo MVP 1

Pryo turns a public website URL into an evidence-backed, prioritized marketing action plan.

## Current vertical slice — v0.3

`URL -> queued audit -> safe crawl -> deterministic evidence -> AI business context + positioning -> decisions -> persisted report`

### What changed in v0.3

- PostgreSQL persistence for audit state, reports, evidence and findings
- Redis + BullMQ audit queue
- separate worker process
- asynchronous progress flow instead of a long browser request
- OpenAI Responses API with strict JSON Schema output
- homepage content is explicitly treated as untrusted data
- AI evidence quotes are checked against the crawled page before they can receive high confidence
- business context detection: company, business model, category, product, audience, market and conversion goal
- positioning analysis: audience clarity, offer clarity, outcome clarity, differentiation and proof
- `PRESERVE` findings have no ICE priority
- the previous global-looking Health score is now an `Observed score`
- Growth Potential remains intentionally `Not scored yet` until market/competitor coverage exists

## Repository

- `apps/web` — Next.js UI and API
- `apps/worker` — BullMQ audit worker
- `packages/domain` — shared schemas
- `packages/crawler` — SSRF-oriented public homepage crawler
- `packages/audit-engine` — deterministic checks
- `packages/scoring` — score calculations
- `packages/db` — PostgreSQL persistence
- `packages/queue` — Redis/BullMQ queue
- `packages/ai` — OpenAI structured intelligence
- `packages/pipeline` — end-to-end audit orchestration

## Required environment variables

```bash
DATABASE_URL=
REDIS_URL=
OPENAI_API_KEY=
```

Optional:

```bash
OPENAI_MODEL=gpt-5.6-luna
WORKER_CONCURRENCY=2
```

## Railway deployment

Pryo v0.3 requires **two application services** using the same GitHub repository plus PostgreSQL and Redis.

### Web service

Keep the existing service and root `railway.json`:

- build: `pnpm build`
- start: `pnpm start`
- health: `/api/health`

It needs `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY`.

### Worker service

Create another Railway service from the same repository. Keep the repository root as its root directory and set:

- build command: `pnpm build`
- start command: `pnpm worker:start`
- no public domain is needed

Give the worker the same `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY`. `railway.worker.json` documents the intended worker configuration, but Railway service settings may be used directly.

## Local development

Requires Node.js 24 and Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

Run the worker in a second terminal:

```bash
pnpm worker:start
```
