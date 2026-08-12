# ADR 005: TMDb snapshot at event creation

## Context

TMDb supplies discovery data but it is outside the application's control. An
event must remain renderable when the external API is unavailable or changes.

## Decision

Fetch catalog data through the backend and persist relevant content snapshot
fields when an organizer creates an event.

## Alternatives

- Store only the TMDb ID and fetch content on every event view.
- Copy the entire external API response into an unstructured JSON field.

## Tradeoffs

Snapshots may become stale compared with TMDb. That is expected: the event is a
local, scheduled offering and needs a stable record of what was published.

## Reasoning

Typed snapshot fields keep normal event rendering independent of provider
availability and avoid coupling the product to an external response shape.
