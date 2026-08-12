# Architecture

## Purpose

Elite Ticketing is a small event and ticketing platform for the Elite Dev 2026
challenge. The project deliberately prioritizes one reliable end-to-end journey
over a broad feature list:

organizer catalog selection -> event creation -> customer seat reservation ->
simulated payment -> ticket -> gate validation.

## Architecture style

The backend is a modular monolith. Modules own their HTTP endpoints, use cases,
DTOs and persistence rules, while one NestJS process and one PostgreSQL database
are deployed together.

Planned modules are `auth`, `users`, `catalog`, `events`, `seats`,
`reservations`, `payments`, `tickets` and `gate`. Shared code is restricted to
framework concerns such as database configuration, error handling and RBAC.

## Core boundaries

- TMDb is accessed only through the backend catalog module.
- An event stores a local content snapshot at creation time. Public event views
  never depend on a live TMDb request.
- PostgreSQL is the source of truth for seat allocation and ticket consumption.
- The frontend provides role-appropriate views but the backend enforces every
  authorization decision.

## Approved MVP constraints

- The catalog contains films only.
- Events are cinema sessions with marked seats.
- Capacity is derived from generated `EventSeat` records, not trusted as a
  freely editable number after publication.
- A shared ticket link is an unguessable bearer link that can display the ticket
  to its recipient.
- The QR payload is a versioned HMAC-signed ticket reference. It can be rendered
  again without storing a raw validation credential.

## Test strategy

Vitest is the test runner. Supertest exercises the NestJS HTTP boundary. The
highest-risk behaviors will use PostgreSQL integration tests, including two
simultaneous seat reservations and two simultaneous ticket scans.

The `tests/` directory is separate from `apps/` so the development pipeline can
enforce test and implementation boundaries.
