# AI Usage

## How AI is being used

Codex is being used as a senior engineering pair. Its role so far has been to
read the challenge, surface alternatives, explain trade-offs, and turn decisions
explicitly approved by the author into a roadmap and documentation structure.

The development workflow uses a gated pipeline for behavioral tasks: advisory
review, human approval, tests before implementation, independent QA review and
another human decision before a commit.

## Human ownership

The author chooses the scope and approves meaningful design decisions. Current
examples include the React/NestJS/PostgreSQL stack, the films-with-marked-seats
MVP, an HMAC-signed QR approach, and keeping pipeline artifacts outside version
control while preserving durable rationale in `docs/`.

## Ongoing record

This document will be updated as the project progresses. It distinguishes
AI-assisted proposals from author decisions and validation through tests or
manual review.
