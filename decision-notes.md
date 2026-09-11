# Meridian Helpdesk — Part 2 SLA Decision Notes

## 1. SLA Metric

* **Decision:** The SLA measures First Response Time (FRT), not total ticket resolution time.
* **Reason:** The Bilions exercise brief specifies a response target by priority (P1 = 4 hours, P2 = 24 hours, P3 = 72 hours), not a resolution target. Therefore, the SLA measures the duration from ticket creation until the first qualifying customer-facing staff response occurs.

---

## 2. What Counts as a Response

* **Decision:** A qualifying response is the earliest comment satisfying BOTH:
  1. Author role is `agent` or `admin`.
  2. `is_internal = 0` (customer-facing).
  * Requester comments do **not** satisfy the SLA.
  * Internal staff notes do **not** satisfy the SLA.
* **Reason:** The metric represents how quickly support staff responds to the customer. A customer commenting on their own ticket cannot satisfy a helpdesk response SLA, and an internal staff note is invisible to the customer.

---

## 3. SLA Clock Start

* **Decision:** The SLA clock begins at `ticket.created_at`.
* **Reason:** The customer begins waiting for support when the ticket is raised. Starting the clock at assignment could allow an unassigned ticket to wait indefinitely without consuming SLA time.

---

## 4. Status Behaviour

* **Decision:** Ticket status does NOT pause, stop, or cancel the first-response SLA. This applies to all statuses:
  * `open`
  * `pending`
  * `resolved`
  * `closed`
* **Reason:** The starter application has no "waiting for customer" pause state and no SLA pause/resume mechanism. A workflow status change is not itself a customer-facing response.
* **Important Consequence:** A closed ticket with no staff response remains non-breached (`pending`) only until its deadline passes. After the deadline passes, it becomes permanently `breached`. Closing an unanswered ticket does not evade an SLA response target.

---

## 5. Deadline Boundary

* **Decision:** The deadline boundary is inclusive:
  * Response time $\le$ target $\implies$ `met`
  * Response time $>$ target $\implies$ `breached`
  * Therefore: exactly 4h 00m 00s for P1 is met; 4h 00m 01s is breached.
* **Reason:** This is the most natural interpretation of "respond within $N$ hours" and provides deterministic second-level boundary evaluation in SQL comparisons.

---

## 6. No Response

* **Decision:** When no qualifying response exists:
  * Current time $\le$ deadline $\implies$ `pending`
  * Current time $>$ deadline $\implies$ `breached`
* **Reason:** The ticket remains legitimately in progress within its response window until the deadline passes. Once the deadline passes without a qualifying response, the SLA target has been missed.

---

## 7. Late Response

* **Decision:** A late first response does NOT clear an SLA breach.
  * *Example:* P1 ticket created at 10:00, deadline 14:00, first qualifying response at 16:00 $\implies$ permanently `breached`.
* **Reason:** The response target was already missed. Recording a subsequent response documents when staff finally replied, but does not erase the historical SLA breach.

---

## 8. Priority

* **Decision:** Evaluate targets against the ticket's current priority:
  * `P1` $\implies$ 4 hours
  * `P2` $\implies$ 24 hours
  * `P3` $\implies$ 72 hours
* **Reason:** The existing application does not provide an endpoint or UI to change priority after creation, so current priority is effectively the creation priority. No priority-edit or priority-history functionality will be added.

---

## 9. Breached Filter

* **Decision:** Implement `breached=true` as an independent boolean filter parameter.
  * *Examples:*
    * `breached=true` $\implies$ all breached tickets across all statuses (`open`, `pending`, `resolved`, `closed`).
    * `breached=true&status=open` $\implies$ only open breached tickets.
* **Reason:** SLA state and workflow status answer different questions. Keeping them independent supports both operational queues (open breaches requiring action) and management/audit reporting (all historical breaches).
* **Critical Requirement:** The breached filter must be applied in the SQL `WHERE` clause BEFORE `LIMIT` and `OFFSET` so pagination and total counts remain 100% mathematically correct.

---

## 10. Dynamic vs. Persisted SLA State

* **Decision:** Compute SLA state dynamically in SQL on read. Do not add persisted `is_breached` or `first_response_at` database columns.
* **Reason:** An unanswered ticket can transition into a breached state simply because time passes while the database remains untouched. Persisting the state would require a background cron worker or scheduler to prevent stale values. Dynamic computation eliminates stale data, requires no background workers, and directly satisfies the brief's instruction to "compute and expose" SLA state.

---

## 11. API Representation

* **Decision:** Expose flat SLA fields directly on ticket objects:
  * `sla_target_hours`
  * `sla_deadline`
  * `first_response_at`
  * `is_breached` (boolean)
  * `sla_status` (`'pending' | 'met' | 'breached'`)
* **Reason:** The existing `ticketService.js` already returns flat derived fields such as `assignee_name`, `requester_name`, and `comment_count`. Flat SLA fields preserve existing API conventions and require minimal client changes.

---

## 12. Timezone Decision

* **Decision:** Use UTC consistently for stored timestamps and SLA comparisons.
* **Reason:** The starter codebase currently exhibits a timestamp inconsistency:
  * Seed data (`reset-db.js`) and comment timestamps (`routes/comments.js`) are formatted as UTC strings using `.toISOString()`.
  * New tickets created via `createTicket` omit `created_at`, relying on MySQL's `DEFAULT CURRENT_TIMESTAMP`.
  * Docker MySQL runs in `+05:30` (`Asia/Kolkata`).
  This creates a potential 5.5-hour skew between ticket creation and comment timestamps for newly created tickets.
* **Remediation for Part 2:**
  * New ticket timestamps will be explicitly written in UTC via `new Date().toISOString().slice(0, 19).replace('T', ' ')` in `createTicket`.
  * Real-time SLA comparisons will evaluate against MySQL `UTC_TIMESTAMP()`.
  * Server-side SLA calculations use UTC consistently. Existing UI timestamp formatting will be reviewed during frontend implementation to ensure UTC values are converted correctly for display.
  This keeps all database timestamps and date arithmetic deterministic and environment-independent.

---

## 13. SLA Calculation Architecture

* **Decision:** Compute SLA in the SQL/service layer using a shared calculation approach for list and detail:
  1. Derive the earliest public agent/admin response using a single `LEFT JOIN` on comments with `MIN(comment.created_at)`.
  2. Calculate the deadline from `ticket.created_at + priority target hours`.
  3. Determine `sla_status` and `is_breached` dynamically.
  4. Apply the breach predicate before pagination in both the data and count queries.
  5. Use the exact same SQL projection for `listTickets` and `getTicketById`.
* **Reason:** Guarantees list/detail consistency, exact pagination counts, and zero stale flags. The SLA calculation introduces no additional per-ticket query and avoids adding a new N+1 query pattern. The existing Finding #10 comment-count N+1 remains intentionally unfixed.

---

## 14. Seed-Data Compatibility

* **Decision:** The implementation must work immediately after running:
  ```bash
  npm run db:reset
  ```
* **Reason:** The Bilions brief explicitly states that the feature will be evaluated against the seeded database. The existing seed data naturally contains tickets of varying ages (1–75 days old), unresponded tickets, requester-only comments, internal notes, public responses, and mixed priorities/statuses, providing comprehensive scenarios for immediate verification.

---

## 15. Part 1 Findings That Affect Part 2

The findings resolved in Part 1 directly influence Part 2 implementation:
* **Tenant Isolation (Finding #1):** SLA subqueries and filters must preserve strict `t.org_id = ?` scoping on both list and detail endpoints.
* **Role Authorization (Finding #3):** RBAC remains unchanged; requesters, agents, and admins retain their established permissions.
* **SQL Safety (Finding #4):** Adding the `breached` filter query parameter must follow strict validation patterns, avoiding unescaped string interpolation.
* **Stored XSS (Finding #5):** Renders in ticket detail and badges must adhere strictly to safe React text rendering without raw HTML interpolation.
* **Performance (Finding #10):** While the existing N+1 comment-count query loop is intentionally left unfixed, Part 2 must not introduce another N+1 query. First response timestamps will be derived via a single `LEFT JOIN`.

---

## 16. Remaining Implementation Risks

While the product decisions are now fixed, implementation requires careful attention and testing around:
* **UTC Timestamp Consistency:** Ensuring `createTicket` writes explicit UTC strings so new tickets align with seeded data.
* **Exact Deadline Boundaries:** Verifying inclusive $\le$ vs. $>$ evaluation at the exact target second.
* **Earliest Qualifying Response Selection:** Ensuring internal staff notes and requester replies are strictly excluded from response attribution.
* **Late-Response Permanence:** Ensuring a late response records `first_response_at` while preserving `is_breached = true`.
* **List / Detail Consistency:** Ensuring single-ticket detail matches list view in every scenario.
* **Pagination & Total Counts:** Ensuring `breached=true` properly constrains both the row query and the `COUNT(*)` query.
* **Preservation of Part 1 Fixes:** Ensuring no regression occurs in tenant isolation, role authorization, sort whitelisting, or comment escaping.

---

## Final Statement

These decisions intentionally keep Part 2:
* Within the existing Express + MySQL + React architecture
* Free of schema migrations
* Free of new dependencies
* Dynamically calculated without stale state
* Deterministic and timezone-safe
* Fully compatible with the supplied seed data

The goal is a minimal, robust implementation that directly satisfies the Bilions brief without introducing an unnecessary or fragile SLA subsystem.
