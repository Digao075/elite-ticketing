# ADR 004: HMAC-signed ticket QR payload

Status: accepted and implemented (revised after implementation).

## Context

The QR must not be forgeable, and the gate must reject a tampered code without
trusting the client. At the same time, the owner and anyone holding a shared
link must be able to render the ticket again at any moment.

## Decision

The payload is:

```
v1.<ticketId>.<base64url HMAC-SHA256>
```

signed with `TICKET_QR_SECRET`. Only the ticket id travels in the clear. The
gate recomputes the HMAC and compares it in constant time (`timingSafeEqual`)
before touching the database. **No signature is persisted.**

## Alternatives

- **A predictable ticket id alone.** Anyone could mint a valid-looking code.
- **A stored random opaque token.** Requires storing a raw credential that a
  database reader could replay, and complicates re-rendering.
- **A JWT.** Carries claims, expiry and algorithm negotiation that this payload
  does not need, and produces a much denser QR for no benefit.
- **Encrypting the payload.** Confidentiality is not the requirement;
  authenticity is. HMAC is the right primitive.

## Tradeoffs

The secret must be protected, and rotating it invalidates existing QR codes
unless versioned keys are added — the `v1.` prefix exists to make that possible
later without breaking the format.

A non-constant-time comparison would leak signature bytes through timing; this
is why the comparison is explicit rather than `===`.

## Reasoning

Because nothing secret is stored next to the ticket, an attacker with read
access to the database still cannot produce a valid code. And because the
signature is deterministic, the ticket can be re-rendered indefinitely without
retaining a credential — the property that makes the share link safe.
