# Elite Ticketing

Event and ticketing platform built for the Elite Dev 2026 challenge.

## Current status

Session 0 is establishing the development foundation. The API exposes only a
health endpoint and the web application is a placeholder. Domain features are
intentionally added one capability at a time through a test-first, gated
workflow.

## Technology

- React, TypeScript, Vite and Tailwind CSS
- NestJS, TypeScript and REST
- PostgreSQL and Prisma (introduced with the first persisted domain module)
- Vitest and Supertest
- Docker Compose

## Local setup

Prerequisites: Node.js 24+, pnpm 11+ and Docker Desktop.

Docker Desktop must be running before the database command is executed.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm db:up
pnpm test
pnpm dev
```

After starting the API, `GET http://localhost:3000/health` returns:

```json
{ "status": "ok" }
```

## Documentation

- [Architecture](docs/architecture.md)
- [AI usage](docs/AI_USAGE.md)
- [Architecture decisions](docs/adr)

The workflow artifacts in `.pipeline/` are deliberately local. Durable product
decisions and rationale are maintained in `docs/`.

## Planned MVP journey

Organizer catalog selection -> event creation -> customer discovery -> seat
reservation -> simulated payment -> secure ticket -> ticket sharing -> gate
validation.

The project will seed an organizer, two customers, a gate user and a published
event once the domain schema is introduced.
