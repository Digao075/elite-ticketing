# ADR 008: Single-use ticket validation at the gate

Status: accepted and implemented.

## Context

A ticket must be admitted exactly once. Two door staff may scan the same QR at
the same instant, and the same person may present a ticket twice deliberately.
Reading `usedAt` and then writing it has the same race window as any
check-then-act.

The gate must also distinguish four outcomes, because the operator behaves
differently for each: `VALID`, `INVALID`, `ALREADY_USED`, `WRONG_EVENT`.

## Decision

Consumption is a single conditional statement:

```sql
UPDATE "Ticket" SET "usedAt" = now() WHERE "id" = $1 AND "usedAt" IS NULL
```

Zero affected rows means the ticket was already consumed. The event match is
checked **before** this statement, so presenting a ticket at the wrong door
never burns it.

Every outcome returns HTTP `200`; the result belongs in the body.

## Alternatives

- **Read, then write.** Two simultaneous scans could both read `null`.
- **A transaction with `SELECT ... FOR UPDATE`.** Correct, but a whole
  transaction to express what one conditional update already guarantees.
- **Deleting the ticket on use.** Destroys the record needed to tell a returning
  holder *when* it was used.
- **HTTP status codes per outcome (`409` for used, `404` for unknown).** Tempting,
  but these are not transport failures — they are normal answers to a normal
  question. The request succeeded; the ticket is simply not admissible.

## Tradeoffs

Returning `200` for `INVALID` means a naive client that only checks status codes
would treat a forged ticket as fine. Documented in the API table, and the
response is a discriminated union that is awkward to ignore.

`now()` is the database clock, not the application clock, so the stamp cannot be
skewed by an application host with a wrong time. That also means it is not
overridable in tests — acceptable, since the assertions care about ordering.

## Reasoning

The wrong-event check ordering is the subtle part. Reversing it would consume a
ticket presented at the wrong door, and the holder would then be refused at the
right one — a silent, unrecoverable failure for a paying customer.

Both properties are proven with genuinely concurrent requests: exactly one
`VALID` and one `ALREADY_USED`.
