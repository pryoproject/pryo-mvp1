# Pryo MVP 1

Pryo turns a public website URL into an evidence-backed, prioritized marketing decision map.

## Current vertical slice — v0.4 Deep Snapshot

`URL -> safe multi-page crawl -> structural checks -> PageSpeed lab -> AI positioning -> verified evidence -> findings -> root causes -> priorities -> persisted report`

### What changed in v0.4

- crawls up to 6 high-value marketing pages instead of homepage only
- automatically prioritizes pricing, product/features, solutions, customer, integration and about pages
- keeps SSRF/DNS/redirect protections on every crawled URL
- adds Google PageSpeed mobile Lighthouse signals when available
- makes `PRESERVE` evidence-gated instead of accepting a single AI-positive assessment
- verifies every AI quote against the actual crawled page before treating it as observed evidence
- groups related findings into root causes before ranking actions
- exposes the exact evidence scope and source pages in the report
- calculates coverage dynamically; market/competitor/AEO/first-party layers remain intentionally outside the score

## Architecture

- `apps/web` — Next.js UI + audit APIs
- `apps/worker` — BullMQ audit worker
- `packages/domain` — report/evidence/root-cause schemas
- `packages/crawler` — SSRF-safe multi-page crawler
- `packages/audit-engine` — deterministic multi-page SEO/CRO checks
- `packages/performance` — optional PageSpeed/Lighthouse adapter
- `packages/ai` — evidence-first context + positioning analysis
- `packages/pipeline` — orchestration + root-cause grouping
- `packages/db` — PostgreSQL persistence
- `packages/queue` — Redis/BullMQ queue
- `packages/scoring` — health, confidence, ICE and priority scoring

## Railway services

The current production topology remains unchanged:

1. Web service — `railway.json`
2. Worker service — `railway.worker.json`
3. PostgreSQL
4. Redis

Required variables on Web and Worker:

- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL` (defaults to `gpt-5.6-luna`)
- `PAGESPEED_API_KEY` for more reliable Google PageSpeed quota
- `WORKER_CONCURRENCY` on the worker

## v0.5 target

Next: market demand + competitor discovery/benchmarking + gap engine using external market/SERP data providers.
