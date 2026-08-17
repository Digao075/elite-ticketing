# ADR 006: Explicit simulated payment outcomes

Status: accepted and implemented (revised after implementation).

## Context

The challenge requires both approval and refusal to be demonstrable, and
explicitly permits simulated charging.

## Decision

`POST /reservations/:id/payment` takes `{ "outcome": "approve" | "decline" }`.
The backend owns every resulting transition:

- `approve` moves the reservation to `PAID` and issues one `Ticket` per seat.
- `decline` moves it to `DECLINED` and releases every seat immediately.

There is no separate `Payment` entity. The reservation's own status is the
settlement record.

## Alternatives

- **A payment provider sandbox.** More faithful, but adds credentials, webhook
  delivery and an asynchronous state machine to a flow whose interesting part is
  the seat invariant, not the card rail.
- **Always approve, fake the refusal in the UI.** Would leave the refusal path —
  including the seat release — completely untested. This is the one the
  challenge is really probing for.
- **A separate `Payment` table.** Justified when there are retries, partial
  captures or refunds. None exist here; it would be structure without a job.

## Tradeoffs

The client chooses the outcome, which would be unacceptable in a real system.
It is acceptable here precisely because the simulation is declared, and it makes
both paths reachable in a demo without special setup.

No card authorization, no webhooks, no idempotency across provider retries.

## Reasoning

The invariant worth protecting is that **a declined payment issues no ticket and
returns the seats to stock**, and that is enforced server-side and covered by
tests. Whether the decision came from a real gateway or a request body does not
change the state machine being demonstrated.
