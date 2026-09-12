# Meridian Helpdesk — Part 2 SLA Decision Notes

## SLA metric

* **Question:** Does the SLA measure First Response Time (FRT) or total ticket resolution time?
* **Decision:** The SLA measures First Response Time (FRT).
* **Why:** The Bilions exercise brief explicitly specifies a "response target by priority" (P1 = 4h, P2 = 24h, P3 = 72h). FRT measures the interval from ticket creation until the first qualifying customer-facing staff response occurs.

## What counts as a response

* **Question:** Which comments qualify as a valid staff response?
* **Decision:** The earliest public comment authored by a user with role `agent` or `admin` (`is_internal = 0`).
* **Why:** Requester comments cannot satisfy the SLA because the metric measures staff responsiveness to the customer. Internal staff notes (`is_internal = 1`) do not count because they are private discussions invisible to the customer.

## Clock, status, and deadline

* **Question:** How do ticket lifecycle statuses and deadlines interact with the SLA clock?
* **Decision:**
  * The clock begins at `ticket.created_at`.
  * Ticket status (`open`, `pending`, `resolved`, `closed`) does not pause, stop, or reset the SLA clock.
  * The deadline is inclusive: response time $\le$ deadline is `met`; response time $>$ deadline is `breached`.
  * When no response exists: current time $\le$ deadline is `pending`; current time $>$ deadline is `breached`.
  * A late response records `first_response_at` but does not clear a breach.
* **Why:** The starter application has no customer-wait pause state, and workflow status transitions are not customer-facing responses. Closing an unanswered ticket does not satisfy an SLA; if the deadline elapses without staff reply, the ticket is permanently breached.

## Priority and filter

* **Question:** How are priority targets assigned, and how does breached filtering behave?
* **Decision:**
  * Targets follow the brief: P1 = 4h, P2 = 24h, P3 = 72h.
  * Current priority is used because the application provides no feature or endpoint to edit priority after creation.
  * `breached=true` operates as an independent server-side filter combinable with other filters.
  * Breach filtering is applied in SQL before `LIMIT` and `OFFSET`, and matches the `COUNT(*)` query.
* **Why:** Applying breach predicates in the `WHERE` clause guarantees exact pagination offsets and accurate total counts across all statuses.

## Dynamic calculation and UTC

* **Question:** Should SLA state be persisted in database columns, and how are timestamps normalized?
* **Decision:**
  * SLA fields (`sla_target_hours`, `sla_deadline`, `first_response_at`, `is_breached`, `sla_status`) are computed dynamically in SQL rather than persisted.
  * SLA-relevant database timestamps are treated as UTC, and API responses expose them as ISO 8601 UTC timestamps.
  * `timezone: 'Z'` was configured in `server/src/db/pool.js`.
  * The legacy `tickets.updated_at` path was left unchanged.
* **Why:** Unanswered tickets can transition to breached purely through the passage of time without a database write; dynamic calculation prevents stale flags without background cron jobs. Runtime verification exposed an initial 5.5-hour backward shift in API timestamps because `mysql2` parsed `DATETIME` columns as local time (`+05:30`). Configuring `timezone: 'Z'` aligns JavaScript Date serialization with stored UTC values. Part 2 normalizes SLA-relevant timestamp handling around UTC without altering unrelated legacy columns.

## Part 1 constraints

Part 2 strictly preserves all Part 1 security and authorization boundaries: tenant isolation (`t.org_id = ?`) is enforced on all SLA queries, RBAC permissions remain unchanged, sort parameters continue through prototype-less whitelists, user-controlled content continues to use safe React rendering, and the Part 2 breach badge does not introduce raw HTML rendering. Findings #6–#11 remain intentionally untouched.
