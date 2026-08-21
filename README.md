# Pryo MVP 1

Pryo turns a public website URL into an evidence-backed, prioritized marketing action plan.

## Current vertical slice — v0.2

`URL -> safe homepage crawl -> deterministic checks -> evidence -> findings -> ICE -> decision layer -> report UI`

The current scope deliberately analyzes the homepage only. It is the first deployable slice, not the final MVP 1 score.

### Implemented

- public URL normalization and DNS validation
- SSRF-oriented blocking for local/private targets and redirects
- bounded HTML download and crawl timeouts
- homepage SEO/CRO/lightweight performance checks
- measured/observed evidence per finding
- `DO NOW / VALIDATE / PRESERVE` decision classes
- ICE and priority scoring
- category health/confidence scores
- Railway health endpoint and config-as-code
- GitHub CI for typecheck + production build

### Next milestones

1. PostgreSQL audit persistence
2. Redis + BullMQ background jobs and progress events
3. OpenAI context + positioning module with structured outputs
4. PageSpeed / CrUX performance module
5. full-site crawl + SEO module
6. competitor and market data providers
7. root-cause, dependency and forecast layers

## Repository

- `apps/web` — Next.js UI and API
- `apps/worker` — background worker bootstrap (not deployed yet)
- `packages/domain` — shared schemas and types
- `packages/crawler` — public website crawling and extraction
- `packages/audit-engine` — deterministic checks and findings
- `packages/scoring` — ICE, health and confidence calculations

## Local development

Requires Node.js 24 and Corepack.

```bash
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:3000` and enter a public website.

## Railway

The repository contains `railway.json`. A web service deployed from the repository root will build with Railpack, run `pnpm start`, and use `/api/health` as its health check.

No environment variables are required for the v0.2 vertical slice.
