# ADR 004: HMAC-signed ticket QR payload

## Context

The QR cannot rely on a predictable ticket ID, while owners and shared-ticket
viewers must be able to render the ticket again.

## Decision

Encode a versioned ticket public identifier and an HMAC signature in the QR
payload. Store ticket state in PostgreSQL and verify the signature server side
before use.

## Alternatives

- Put a predictable ticket ID in the QR.
- Save only a hash of an opaque random QR token.
- Use a JWT as the validation credential.

## Tradeoffs

The HMAC secret must be protected and rotating it invalidates older QR payloads
unless versioned keys are introduced. The solution is simpler than encrypted
storage of opaque raw tokens.

## Reasoning

HMAC makes a ticket reference unforgeable and permits deterministic QR
rendering without retaining a raw validation credential in the database.
