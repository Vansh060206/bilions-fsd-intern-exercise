# Meridian Helpdesk — Part 1 Code Review

## 1. Executive Summary

This code review was performed as a formal pull-request sign-off for the Meridian Helpdesk multi-tenant ticketing platform. The review evaluates the starter baseline codebase against production engineering standards of security, authorization, tenant isolation, data integrity, and functional correctness. Following the exercise requirements, a comprehensive audit identified eleven concrete findings spanning both backend services and client components. Exactly five highest-priority findings—representing critical cross-organisation tenant isolation failure, unauthenticated account takeover, missing role-based access control, SQL expression injection, and stored cross-site scripting—were remediated and verified with minimal, zero-collateral commits. The remaining six findings were deliberately preserved and documented without code modifications in accordance with the exercise's strict prioritization mandate.

---

## 2. Priority Ranking

| Rank | Finding | Severity | Status |
| :--- | :--- | :--- | :--- |
| **1** | Cross-Organisation Tenant Isolation Failure / IDOR on Single-Ticket Operations | Critical | **FIXED** |
| **2** | Unauthenticated Account Takeover and Denial of Service via `/api/auth/invite/accept` | Critical | **FIXED** |
| **3** | Missing Role-Based Authorization on Ticket Deletion and Assignment | High | **FIXED** |
| **4** | SQL Expression Injection via Dynamic `ORDER BY` | High | **FIXED** |
| **5** | Stored Cross-Site Scripting (XSS) via Unsanitized Comment Body | High | **FIXED** |
| **6** | Ticket Pagination Off-By-One Bug Skipping Initial 20 Tickets | Medium | **DOCUMENTED, NOT FIXED** |
| **7** | Broken Frontend Search, Filter, and Sort Reactivity | Medium | **DOCUMENTED, NOT FIXED** |
| **8** | Concurrency Race Condition (TOCTOU) During Ticket Claiming | Medium | **DOCUMENTED, NOT FIXED** |
| **9** | Unrestricted Internal Comment Creation and Exposure | Low / Medium Confidence | **DOCUMENTED, NOT FIXED** |
| **10** | N+1 Query Anti-Pattern on Comment Count Retrieval | Low | **DOCUMENTED, NOT FIXED** |
| **11** | Committed Environment Secrets and Static Fallback JWT Secret | Low (in exercise context) | **DOCUMENTED, NOT FIXED** |

---

## 3. Detailed Findings

### Finding 1 — Cross-Organisation Tenant Isolation Failure / IDOR on Single-Ticket Operations

* **Rank:** 1
* **Severity:** Critical
* **Confidence:** High
* **Status:** FIXED
* **Location:**
  * `server/src/routes/tickets.js:31-41` (starter baseline)
  * `server/src/routes/tickets.js:62-73` (starter baseline)
  * `server/src/routes/tickets.js:75-84` (starter baseline)
  * `server/src/services/ticketService.js:57-67` (starter baseline)
* **What is wrong:** In the starter baseline, `getTicketById(id)` selected ticket records by primary key alone (`WHERE t.id = ?`) without scoping queries to the caller's `org_id`. Consequently, single-ticket retrieval (`GET /api/tickets/:id`), assignment (`PATCH /api/tickets/:id/assign`), and deletion (`DELETE /api/tickets/:id`) failed to verify that the target ticket belonged to the authenticated user's organization. (Note: Unlike ticket routes, the comment creation route `POST /api/tickets/:ticketId/comments` already checked `ticket.org_id !== req.user.orgId` in the baseline, but relied on the unscoped service lookup).
* **Why it matters here:** Meridian Helpdesk explicitly isolates discrete corporate customers (e.g., Northwind Trading vs. Cobalt Logistics). Without tenant checks on single-ticket operations, any authenticated user from Cobalt Logistics could view, claim, or permanently delete Northwind Trading's private support tickets simply by supplying known or sequential ticket IDs.
* **How it can be triggered/reached:** Send `GET /api/tickets/1` or `DELETE /api/tickets/1` with an `Authorization` header containing a valid JWT for an authenticated Cobalt Logistics user. In the starter baseline, both requests succeeded against Northwind Trading's ticket ID 1.
* **Recommended fix:** Update `getTicketById(id, orgId)` to require `orgId` and filter queries with `WHERE t.id = ? AND t.org_id = ?`. Ensure route handlers for `GET /:id`, `PATCH /:id/assign`, `DELETE /:id`, and `POST /:ticketId/comments` pass `req.user.orgId` and return HTTP 404 whenever no matching record exists within the caller's organization.
* **Related findings:** Related to Finding #3 (authorization), but fundamentally distinct: Finding #1 represents horizontal authorization (inter-tenant isolation), whereas Finding #3 represents vertical authorization (intra-tenant role-based permissions).

---

### Finding 2 — Unauthenticated Account Takeover and Denial of Service via `/api/auth/invite/accept`

* **Rank:** 2
* **Severity:** Critical
* **Confidence:** High
* **Status:** FIXED
* **Location:**
  * `server/src/routes/auth.js:42-54` (starter baseline)
* **What is wrong:** The starter baseline registered an unauthenticated endpoint `POST /api/auth/invite/accept` that accepted an arbitrary `userId` and `password` without verifying an invitation token, cryptographic signature, timestamp, or prior invitation state. It directly executed `UPDATE users SET password_hash = ? WHERE id = ?`.
* **Why it matters here:** Any external, unauthenticated actor could invoke this endpoint with `userId: 1` (the tenant administrator) and supply a precomputed bcrypt hash (or arbitrary plaintext string). This allowed an instant complete takeover of any user or administrator account, or a denial of service locking legitimate users out of the system.
* **How it can be triggered/reached:** Send `POST /api/auth/invite/accept` with JSON payload `{ "userId": 1, "password": "$2a$10$attackerControlledBcryptHash..." }`. In the starter baseline, this immediately overwrote the administrator's password hash with no authentication or token required.
* **Recommended fix:** The repository contains no invitation token generation, no invitation database records, no invitation email infrastructure, and no invitation UI. Because the endpoint was an incomplete and unsafe stub rather than a functional feature, the appropriate minimal remediation is to disable the unimplemented operation by returning HTTP 501 (`{ error: 'Invitation acceptance is not implemented' }`). This closes the critical vulnerability without fabricating an unrequested invitation subsystem or altering existing authentication flows.
* **Related findings:** Independent authentication vulnerability. Distinct from login credential verification in `POST /api/auth/login`.

---

### Finding 3 — Missing Role-Based Authorization on Ticket Deletion and Assignment

* **Rank:** 3
* **Severity:** High
* **Confidence:** High
* **Status:** FIXED
* **Location:**
  * `server/src/routes/tickets.js:62-73` (starter baseline)
  * `server/src/routes/tickets.js:75-84` (starter baseline)
  * `client/src/features/tickets/TicketDetail.jsx:56` (starter baseline)
* **What is wrong:** The backend routes `DELETE /api/tickets/:id` and `PATCH /api/tickets/:id/assign` applied only `requireAuth` without checking the caller's role. Furthermore, the frontend displayed the "Claim this ticket" button to all authenticated users regardless of role.
* **Why it matters here:** Under Meridian Helpdesk's business rules, ticket assignment is reserved for agents and administrators, while ticket deletion is strictly reserved for administrators. In the starter baseline, unprivileged requesters could delete tickets or assign tickets to themselves, violating operational separation of duties.
* **How it can be triggered/reached:** Authenticate as a user with role `requester` (e.g., `user1@northwind.test`) and issue a direct HTTP call `DELETE /api/tickets/2` or `PATCH /api/tickets/2/assign`. In the starter code, both calls succeeded with HTTP 204 or HTTP 200.
* **Recommended fix:** Attach `requireRole('admin')` to `DELETE /api/tickets/:id` and `requireRole('agent', 'admin')` to `PATCH /api/tickets/:id/assign` in the Express router. On the frontend, conditionally render the "Claim this ticket" button only for agent and admin roles (`user?.role !== 'requester'`).
* **Related findings:** Related to Finding #1 (tenant boundaries) and Finding #8 (claim concurrency race). RBAC determines *who* has authorization to execute the operation; Finding #8 determines *how* concurrent authorized claims are serialized.

---

### Finding 4 — SQL Expression Injection via Dynamic `ORDER BY`

* **Rank:** 4
* **Severity:** High
* **Confidence:** High
* **Status:** FIXED
* **Location:**
  * `server/src/routes/tickets.js:22-23` (starter baseline)
  * `server/src/services/ticketService.js:38` (starter baseline)
* **What is wrong:** In `listTickets()`, query parameters `sortBy` and `order` were interpolated directly into the SQL query template (`ORDER BY t.${sortBy} ${order}`) without validation against an approved set of column identifiers or directions.
* **Why it matters here:** An authenticated user could inject arbitrary SQL expressions into the `ORDER BY` clause. While the default MySQL connection pool does not enable stacked statement execution (`multipleStatements: false`, preventing injected statements such as `DROP TABLE`), SQL expression injection permits blind data extraction via subqueries (e.g., boolean-based or time-based blind queries using `SLEEP()`) and database resource abuse.
* **How it can be triggered/reached:** Send `GET /api/tickets?sortBy=(SELECT%20IF(version()%20LIKE%20'8%25',SLEEP(2),0))&order=asc`. In the starter baseline, this expression was interpolated directly into the executed SQL string.
* **Recommended fix:** Map user input strictly against finite, prototype-free lookup dictionaries created with `Object.create(null)` (columns mapped strictly to `t.created_at`, `t.updated_at`, `t.priority`, `t.status`, and directions mapped to `ASC`, `DESC`). Type-check parameters to prevent runtime crashes on non-string inputs, and safely fall back to default hardcoded constants (`t.created_at DESC`) for any unmapped value.
* **Related findings:** Database query layer vulnerability. Distinct from client-side rendering injection (Finding #5).

---

### Finding 5 — Stored Cross-Site Scripting (XSS) via Unsanitized Comment Body

* **Rank:** 5
* **Severity:** High
* **Confidence:** High
* **Status:** FIXED
* **Location:**
  * `client/src/features/tickets/TicketDetail.jsx:65` (starter baseline)
* **What is wrong:** Comment bodies were rendered into the DOM using React's raw HTML injection sink:
  ```jsx
  <div dangerouslySetInnerHTML={{ __html: c.body }} />
  ```
* **Why it matters here:** Any authenticated user (including low-privilege requesters) could submit a comment containing malicious HTML or JavaScript (such as `<script>` tags, `<img onerror=...>`, or SVG event handlers). When an agent or administrator inspected the ticket, the script executed within their authenticated session context. Because Meridian Helpdesk stores authentication tokens in `localStorage.getItem('helpdesk.session')`, stored XSS enables complete credential exfiltration and administrative account takeover.
* **How it can be triggered/reached:** Submit a comment with body `<img src=x onerror="fetch('/leak?c='+localStorage.getItem('helpdesk.session'))">`. When another user opens the ticket detail page, the script executes immediately in their browser.
* **Recommended fix:** Because comments throughout the application are authored in plain text via standard `<textarea>` elements and the repository contains no requirement or parser for rich HTML/Markdown, replace `dangerouslySetInnerHTML` with standard React JSX text interpolation `<div>{c.body}</div>`. React's native text node escaping neutralizes all HTML tags and event handlers at zero dependency cost.
* **Related findings:** Client-side rendering vulnerability. Distinct from backend database expression injection (Finding #4).

---

### Finding 6 — Ticket Pagination Off-By-One Bug Skipping Initial 20 Tickets

* **Rank:** 6
* **Severity:** Medium
* **Confidence:** High
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `server/src/services/ticketService.js:29` (starter baseline)
* **What is wrong:** The pagination offset calculation was implemented as `const offset = page * PAGE_SIZE;` where `PAGE_SIZE = 20`.
* **Why it matters here:** For the initial page (`page = 1`), `offset` evaluates to `20`. As a result, rows 0 through 19 (the 20 most recent tickets) are skipped entirely and never displayed on page 1.
* **How it can be triggered/reached:** Request `GET /api/tickets?page=1`. The query executes with `LIMIT 20 OFFSET 20` instead of `OFFSET 0`.
* **Recommended fix:** Calculate offset using 1-based page indexing: `const offset = Math.max(0, (page - 1) * PAGE_SIZE);`.
* **Related findings:** Related to pagination controls in `client/src/features/tickets/TicketList.jsx:97-101`. Left unfixed as it is a non-security functional defect below the top-five cutoff.

---

### Finding 7 — Broken Frontend Search, Filter, and Sort Reactivity

* **Rank:** 7
* **Severity:** Medium
* **Confidence:** High
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `client/src/features/tickets/TicketList.jsx:21-31` (starter baseline)
* **What is wrong:** The React `useEffect` hook that triggers the ticket listing API call specified only `[page]` in its dependency array:
  ```javascript
  useEffect(() => {
    // ... api call ...
  }, [page]);
  ```
* **Why it matters here:** When users interact with the subject search input, status dropdown, priority dropdown, or sort dropdown, component state updates but `useEffect` does not re-fire. The list fails to update until the user manually changes the page number.
* **How it can be triggered/reached:** Select a different status or type a search string in the UI; observe that the table contents remain static until clicking "Next" or "Previous".
* **Recommended fix:** Include `search`, `status`, `priority`, and `sortBy` in the `useEffect` dependency array, and reset `page` to 1 whenever a filter or search criterion changes.
* **Related findings:** Frontend UI state synchronization defect. Left unfixed as a usability issue below the top-five security and authorization cutoff.

---

### Finding 8 — Concurrency Race Condition (TOCTOU) During Ticket Claiming

* **Rank:** 8
* **Severity:** Medium
* **Confidence:** High
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `server/src/services/ticketService.js:89-102` (starter baseline)
* **What is wrong:** `assignTicket` implements a non-atomic "check-then-act" pattern: it first reads `ticket.assignee_id`, checks if it is falsy, and subsequently executes `UPDATE tickets SET assignee_id = ? WHERE id = ?`.
* **Why it matters here:** If two support agents attempt to claim the same unassigned ticket simultaneously, both read transactions can observe `assignee_id = NULL`. Both subsequent update queries succeed, resulting in the second agent silently overwriting the first agent's assignment without a conflict notification.
* **How it can be triggered/reached:** Send two concurrent HTTP `PATCH /api/tickets/:id/assign` requests simultaneously from two different agent sessions for the same unassigned ticket.
* **Recommended fix:** Use an atomic update with conditional row matching: `UPDATE tickets SET assignee_id = ?, status = 'pending' WHERE id = ? AND assignee_id IS NULL`. If `affectedRows === 0`, return HTTP 409 Conflict.
* **Related findings:** Related to Finding #3 (authorization to claim). Left unfixed because it is a concurrency race condition requiring exact timing between authorized agents, carrying narrower operational impact than static authorization bypasses.

---

### Finding 9 — Unrestricted Internal Comment Creation and Exposure

* **Rank:** 9
* **Severity:** Low / Medium Confidence
* **Confidence:** Medium (inferred product requirement)
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `server/src/services/ticketService.js:69-78` (starter baseline)
  * `server/src/routes/comments.js:11-25` (starter baseline)
* **What is wrong:** The comment creation route accepts `isInternal` directly from the client request payload without verifying that the author is an agent or admin (`isInternal ? 1 : 0`). Furthermore, `listComments` returns all comments (including those flagged `is_internal = 1`) to any user who can view the ticket, including requesters.
* **Why it matters here:** If the application product design intended `is_internal` comments to represent private staff notes (standard helpdesk convention), requesters can both create internal comments and read internal staff discussions.
* **How it can be triggered/reached:** Send `POST /api/tickets/:id/comments` with `{ "body": "private note", "isInternal": true }` as a requester. Read `GET /api/tickets/:id` as a requester to receive all `is_internal = 1` comments.
* **Recommended fix:** Restrict `isInternal: true` creation to users with role `agent` or `admin`. In `listComments`, filter out `is_internal = 1` comments unless `req.user.role` is `agent` or `admin`.
* **Related findings:** Labelled as lower/medium confidence because the repository documentation does not explicitly specify contractual product requirements for internal comment visibility. Left unfixed below the top-five cutoff.

---

### Finding 10 — N+1 Query Anti-Pattern on Comment Count Retrieval

* **Rank:** 10
* **Severity:** Low
* **Confidence:** High
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `server/src/services/ticketService.js:44-47` (starter baseline)
* **What is wrong:** In `listTickets()`, after fetching the page of ticket rows, the service iterates over each row in a `for...of` loop and executes a separate SQL query to count comments:
  ```javascript
  for (const row of rows) {
    const [{ c }] = await query('SELECT COUNT(*) AS c FROM comments WHERE ticket_id = ?', [row.id]);
    row.comment_count = c;
  }
  ```
* **Why it matters here:** For a page size of 20 tickets, each page view triggers 22 distinct database queries (1 ticket query, 20 serial comment count queries, 1 total count query). Under production load, this creates unnecessary database connection contention and query latency.
* **How it can be triggered/reached:** Issue `GET /api/tickets`. Inspect the database query log to observe 20 serial subqueries per page load.
* **Recommended fix:** Join comments with `LEFT JOIN comments c ON c.ticket_id = t.id` and `COUNT(c.id) AS comment_count ... GROUP BY t.id`, or retrieve counts using a single `GROUP BY ticket_id` query for all page IDs.
* **Related findings:** Performance defect. Left unfixed as it does not affect security, authorization, or functional correctness at current data volumes.

---

### Finding 11 — Committed Environment Secrets and Static Fallback JWT Secret

* **Rank:** 11
* **Severity:** Low (in this exercise context)
* **Confidence:** High
* **Status:** DOCUMENTED, NOT FIXED
* **Location:**
  * `server/.env:5-7` (starter baseline)
  * `server/src/config.js:16` (starter baseline)
  * Supporting evidence: `.gitignore` (starter baseline)
* **What is wrong:** Database credentials and a production-like JWT secret (`JWT_SECRET=8f2c1a94e77b4d51a6e0c3b9f4d2178a`) were committed to version control in `server/.env`. In addition, `config.js` provided a static fallback secret (`'dev-secret-change-me'`) if the environment variable was missing.
* **Why it matters here:** In a production deployment, committing secrets or relying on predictable default keys allows anyone with repository access to forge valid JWT tokens and bypass authentication. In this localized internship exercise context, however, these credentials exist to facilitate starter setup. Note that in our submission repository, `server/.env` was locally excluded from git tracking to prevent accidental credential publishing.
* **How it can be triggered/reached:** Inspect the starter baseline files `server/.env` and `server/src/config.js`.
* **Recommended fix:** Add `server/.env` to `.gitignore`, provide only `.env.example`, require secrets to be injected via environment variables in production, and throw a runtime error if `JWT_SECRET` is undefined outside development.
* **Related findings:** Configuration and credential hygiene issue. Ranked below the top five because it represents an environment setup practice rather than an active application logic exploit.

---

## 4. Findings Specifically Fixed

| Rank | Finding | Commit | Summary of Fix |
| :--- | :--- | :--- | :--- |
| **1** | Cross-Organisation Tenant Isolation Failure / IDOR | `0fc2d80` | Scoped single-ticket lookups and mutations to `req.user.orgId` across service and route handlers. |
| **2** | Unauthenticated Account Takeover via Invite Accept | `cb8e50e` | Disabled the unauthenticated, tokenless `/api/auth/invite/accept` stub with HTTP 501. |
| **3** | Missing Role Authorization on Delete and Assign | `a552cb9` | Enforced `requireRole('admin')` on delete and `requireRole('agent', 'admin')` on assign; hid UI claim button for requesters. |
| **4** | SQL Expression Injection via Dynamic `ORDER BY` | `364aab1` | Implemented strict prototype-less whitelists mapping sort parameters to safe SQL constants. |
| **5** | Stored XSS via Unsanitized Comment Body | `e9a3466` | Replaced `dangerouslySetInnerHTML` with standard React text interpolation `<div>{c.body}</div>`. |

---

## 5. Findings Intentionally Left Unfixed

The exercise explicitly required prioritizing and implementing fixes for exactly the top five findings while leaving the remaining findings documented but untouched:

* **Finding 6 (Pagination Off-By-One):** A clear functional bug that causes rows 0–19 to be skipped on page 1. It was excluded from the top five because it does not compromise tenant data boundaries, authentication integrity, or system security.
* **Finding 7 (Frontend Filter Reactivity):** A frontend state-synchronization defect where dropdown filters do not trigger automatic re-fetching. It was excluded because it is a client-side usability flaw with no backend or security impact.
* **Finding 8 (Claiming Concurrency Race):** A check-then-act race condition during simultaneous ticket claiming. It was excluded because it requires exact concurrent timing between two authorized agents and results in an operational assignment overlap rather than an unauthorized privilege escalation.
* **Finding 9 (Internal Comment Visibility):** An inferred privacy concern where `is_internal` comments are accessible to requesters. It was excluded because the starter repository contains no explicit specification defining internal comment visibility rules, making it a lower-confidence design ambiguity compared to definitive security vulnerabilities.
* **Finding 10 (N+1 Comment Count Queries):** A performance anti-pattern executing serial count queries. It was excluded because at the starter application's scale, it causes query inefficiency but does not impair data integrity, system availability, or security.
* **Finding 11 (Committed Secrets & Fallback Key):** A credential hygiene concern where default development secrets are checked into git. It was excluded because in the context of this local internship exercise, default environment files are intended to enable local developer execution and do not constitute an active application logic exploit.

---

## 6. Root-Cause Grouping

### Tenant Isolation vs. RBAC
* **Tenant Isolation (Finding #1 — Horizontal Authorization):** Answers the question: *"Can this user access or mutate a ticket belonging to another organisation?"* Tenant boundaries isolate independent customer organizations (e.g., Northwind Trading vs. Cobalt Logistics). A failure here permits cross-tenant data theft regardless of user role.
* **Role-Based Access Control (Finding #3 — Vertical Authorization):** Answers the question: *"Is this user's role permitted to perform this action?"* RBAC governs permissions within an organization (e.g., requester vs. agent vs. admin). A requester should not delete tickets even within their own organization. Both controls are necessary, orthogonal, and must be enforced in tandem.

### RBAC vs. Claim Race Condition
* **Role-Based Authorization (Finding #3):** Governs *who* is permitted to invoke the assignment endpoint. Requesters are blocked; only agents and administrators may claim tickets.
* **Claim Concurrency Race (Finding #8):** Governs *how* the system handles two authorized agents invoking the claim endpoint simultaneously. RBAC ensures both callers are legitimate agents; concurrency control ensures only one claim succeeds while the second receives an assignment conflict.

### SQL Expression Injection vs. Stored XSS
* **SQL Expression Injection (Finding #4):** Targets the *backend database query layer*. User input entered into the query string (`sortBy`) reached the SQL query text unescaped, threatening database confidentiality and server-side data integrity through subquery evaluation.
* **Stored Cross-Site Scripting (Finding #5):** Targets the *client browser execution context*. User input entered into a comment reached the DOM via `dangerouslySetInnerHTML`, threatening client session tokens (`localStorage`) and browser execution safety.

---

## 7. Fix Verification Summary

| Finding | Commit | Verification Approach & Major Tests | Regression Status |
| :--- | :--- | :--- | :--- |
| **#1 Tenant Isolation** | `0fc2d80` | Verified `GET /:id`, `PATCH /:id/assign`, and `DELETE /:id` reject cross-tenant IDs with HTTP 404. Verified legitimate intra-tenant operations succeed. | **PASS** — No regression on intra-tenant CRUD. |
| **#2 Invite Stub Disabled** | `cb8e50e` | Verified `POST /api/auth/invite/accept` returns HTTP 501. Verified user credentials cannot be overwritten. Normal login (`POST /api/auth/login`) verified intact. | **PASS** — Normal authentication intact. |
| **#3 Role Authorization** | `a552cb9` | Verified `DELETE` returns 403 for requesters and agents, succeeds for admin. Verified `PATCH /assign` returns 403 for requesters, succeeds for agents. Verified UI claim button hidden for requesters. | **PASS** — Admin deletion & agent claiming intact. |
| **#4 SQL Sort Whitelist** | `364aab1` | Tested 36 test cases: legitimate columns (`created_at`, `updated_at`, `priority`, `status`), legitimate directions (`asc`, `desc`), prototype properties (`constructor`, `toString`, `__proto__`), SQL subqueries, and non-string query types. Verified all fall back to safe hardcoded SQL constants without crashes. | **PASS** — List filtering and default sorting intact. |
| **#5 Stored XSS Mitigation** | `e9a3466` | Tested full payload matrix: `<script>`, `<img onerror=...>`, `<svg onload=...>`, `<iframe>`, `javascript:` URLs, CSS injection, and entity-encoded tags. Confirmed React creates standard text DOM nodes with zero script execution. Confirmed `localStorage` session protection. | **PASS** — Detail loading, author, timestamp, and styling intact. |

---

## 8. Pull-Request Sign-Off Conclusion

Part 1 is ready for sign-off: the five highest-priority findings were addressed with minimal, verified changes and separately committed, while the remaining findings were intentionally documented and left untouched in accordance with the exercise requirements. No Part 2 SLA features were implemented.
