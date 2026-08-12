# ADR 006: Explicit simulated payment outcomes

## Context

The challenge requires both approval and refusal but does not require real
financial processing.

## Decision

The checkout sends an explicit demonstration scenario. The backend records an
`APPROVED` or `DECLINED` payment and owns all resulting state transitions.

## Alternatives

- Integrate a live payment provider or its sandbox.
- Always approve and simulate failure only in the interface.

## Tradeoffs

The client can choose the scenario because this is a declared simulation. It
does not model real card authorization or webhooks.

## Reasoning

The approach makes both business paths easy to demonstrate while preserving the
critical invariant: a declined payment cannot issue an active ticket.
