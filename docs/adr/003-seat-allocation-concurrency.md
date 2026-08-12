# ADR 003: Database-enforced seat allocation

## Context

Two customers may request the same available seat at the same time. A read of
availability in application memory cannot safely decide ownership.

## Decision

Allocate seats through `ReservationSeat` records with a unique constraint on
`eventSeatId`, inside a PostgreSQL transaction.

## Alternatives

- Read availability, then insert later.
- Keep an in-memory lock per seat.
- Mark a seat as reserved through conditional updates only.

## Tradeoffs

Unique-constraint conflicts must be translated into a clear `409` response.
Declined and expired reservations must release their allocation transactionally.

## Reasoning

The database is the only shared authority across concurrent API requests. Its
constraint guarantees that one seat cannot have two active allocations.
