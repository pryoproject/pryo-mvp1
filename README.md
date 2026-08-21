# Pryo MVP 1

Pryo turns a website URL into an evidence-backed, prioritized marketing action plan.

## MVP 1 vertical slice

URL -> crawl homepage -> evidence -> positioning/CRO/performance checks -> findings -> ICE -> report JSON -> UI.

## Repository

- `apps/web` — Next.js user interface and API
- `apps/worker` — background audit worker
- `packages/domain` — shared schemas and domain types
- `packages/crawler` — website crawling and extraction
- `packages/audit-engine` — audit modules and finding generation
- `packages/scoring` — confidence, ICE and priority calculations
- `packages/ai` — AI provider abstraction

## Planned infrastructure

- PostgreSQL
- Redis + BullMQ
- S3-compatible artifact storage
- OpenAI API
- Railway deployment
