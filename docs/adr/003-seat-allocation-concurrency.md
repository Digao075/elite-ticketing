# ADR 003: Database-enforced seat allocation

Status: accepted and implemented (revised after implementation).

## Context

Two customers may request the same available seat at the same time. Reading
availability in application memory cannot safely decide ownership: any check
performed before the write has a race window, and the window cannot be closed by
ordering the code differently.

A seat also has to become available again when a hold expires or a payment is
refused, so ownership is not permanent.

## Decision

Allocate seats as `SeatAllocation` rows and enforce the invariant with a
**partial** unique index:

```sql
CREATE UNIQUE INDEX "SeatAllocation_eventSeatId_live_key"
    ON "SeatAllocation"("eventSeatId") WHERE "releasedAt" IS NULL;
```

Releasing a seat sets `releasedAt` rather than deleting the row. Reservation
creation runs in a transaction that first locks the event row, so concurrent
requests serialize; the index is what actually refuses the second sale.

Expired holds are reclaimed lazily inside that same transaction.

## Alternatives

- **Read availability, then insert.** The race window is exactly the defect.
- **In-memory lock per seat.** Does not survive a second API process.
- **A plain `UNIQUE` on `eventSeatId`, deleting rows on release.** This was the
  original plan in this ADR and it is wrong in two ways: deleting destroys the
  audit trail, and a non-partial unique constraint would forbid a seat from ever
  being allocated again after a refused payment.
- **Conditional update on an `EventSeat.reserved` flag.** Works for the sale, but
  keeps no record of who attempted what, and mixes inventory with allocation.
- **`SERIALIZABLE` isolation.** Correct, but pushes the failure into retry
  handling on every caller for an invariant one index expresses directly.

## Tradeoffs

Unique-constraint violations surface as Prisma `P2002` and must be translated
into a `409` with a useful message — a real cost, paid in one place.

Released rows accumulate. At this scale that is irrelevant; a periodic archival
job would be the answer if it ever mattered.

Lazy expiry means an expired hold still occupies its row until somebody wants
the seat. Availability counts exclude it only after that sweep, so a listing may
briefly under-report free seats. Accepted: the alternative is a scheduler.

## Reasoning

The database is the only authority shared by concurrent API requests. Encoding
the invariant as an index means it holds regardless of how many processes run,
which code path executes, or what a future contributor forgets.

Both concurrent cases are proven in the suite with genuinely parallel requests,
not mocks: exactly one `201` and one `409`.
