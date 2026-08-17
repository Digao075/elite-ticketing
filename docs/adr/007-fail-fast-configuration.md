# ADR 007: Fail-fast configuration validation

Status: accepted, with a packaging correction.

## Context

The API needs several secrets and an external API key. A service that starts
with half of them missing fails later, in production, in a confusing place —
typically as a `500` on an unrelated request.

## Decision

Required configuration is validated at construction time. A missing
`TMDB_API_KEY`, `AUTH_JWT_SECRET` or `TICKET_QR_SECRET` prevents the application
from starting at all.

## Alternatives

- **Validate lazily, at first use.** The service starts, and only the affected
  feature fails. Nicer for partially configured environments; worse because the
  failure appears far from its cause.
- **Fall back to defaults.** Unacceptable for signing secrets: a default secret
  is equivalent to no secret, and it fails silently rather than loudly.

## Tradeoffs

The cost showed up in practice. An empty `TMDB_API_KEY` stopped the **whole**
application from booting — including discovery, reservation, payment, tickets
and the gate, none of which touch TMDb. A reviewer without a TMDb account would
have been unable to run anything.

The policy is still right; the packaging was wrong. `.env.example` now ships a
non-empty placeholder, so `cp .env.example .env` yields a bootable application,
and the README explains that only organizer film search needs a real key.

## Reasoning

Loud early failure beats quiet late failure, but a strict policy has to come
with defaults that let a newcomer past the front door. Correctness for the
operator and a working first run are not in conflict — they were simply two
separate problems, and only one of them was solved initially.
