# ADR 001: Modular monolith

## Context

The project has several business areas but a seven-day challenge scope and one
end-to-end journey to demonstrate.

## Decision

Use one NestJS application organized into domain modules with explicit module
boundaries.

## Alternatives

- Microservices split by catalog, payment and tickets.
- One generic service layer with no domain modules.

## Tradeoffs

The modular monolith does not independently scale each area. It avoids network
coordination, distributed transactions and operational overhead that are not
justified here.

## Reasoning

Seat allocation, payment settlement and ticket issuance need simple,
transactional consistency. One process and one database make that behavior easy
to understand, test and explain.
