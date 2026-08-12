# ADR 002: PostgreSQL and Prisma

## Context

Seat allocation and single-use ticket validation require database-enforced
consistency under concurrent requests.

## Decision

Use PostgreSQL with Prisma migrations and a real PostgreSQL service in Docker
Compose for local development and integration tests.

## Alternatives

- SQLite for development and a different production database.
- In-memory repositories or mocked persistence for concurrency tests.

## Tradeoffs

PostgreSQL and Docker add local setup work. They provide the same relational
constraints and transaction behavior that protect the delivered system.

## Reasoning

Testing concurrency against the target database is more credible than proving
only application logic with mocks.
