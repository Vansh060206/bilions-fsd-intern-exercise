# AI Tool-Use Log

## 1. Assistants Used

* **OpenAI ChatGPT:** Used for planning, reviewing findings, challenging implementation decisions, designing test cases, and sanity-checking Antigravity's proposed diffs.
* **Google Antigravity:** Used as a repository coding assistant for codebase exploration, targeted implementation, running checks, and validating API/browser behaviour under my direction and review.

## 2. How I Used AI

I used AI to accelerate codebase comprehension, brainstorm edge cases, and perform routine code edits. Rather than trusting AI output blindly, I treated every proposal as a draft that needed validation against the codebase, the assignment brief, and live runtime behavior.

Specifically, I used AI to:
* Navigate the starter codebase and locate security vulnerabilities across frontend and backend.
* Rank findings based on impact, exploitability, and application-specific consequences.
* Draft minimal, targeted fixes for the top five findings.
* Work through ambiguous SLA specifications and document concrete decisions.
* Run targeted validation and regression checks.

## 3. Examples Where I Caught Problems in AI Output

### Example 1 — Finding #2 (Invite Endpoint)
The initial proposal used a signed stateless JWT identifying the invited user. During review, I checked the repository and noticed that there was no invitation issuance mechanism, no email or link generation flow, no database state tracking pending invitations, and no frontend acceptance flow. A stateless token alone could not guarantee single-use. Because a complete invitation lifecycle did not exist in the starter, I changed the approach to safely disable the unfinished endpoint with HTTP `501 Not Implemented`.

### Example 2 — Finding #4 (SQL Sort Whitelist)
The first proposed whitelist implementation used standard JavaScript object literals (`const COLUMNS = { created_at: 't.created_at', ... }`). During review, I questioned whether that was a strict finite whitelist because standard objects inherit prototype properties (such as `toString` and `constructor`), which could still be resolved. I also noticed that passing non-string query values could cause unhandled runtime type errors during `.toLowerCase()` evaluation. I changed the approach to use prototype-less lookup tables (`Object.assign(Object.create(null), ...)`), trimmed inputs, and added defensive fallbacks to default sort values.

### Example 3 — Part 2 SLA Logic Contradiction
During the initial design phase for Part 2, an early proposal contained a logical contradiction: it stated both that ticket status does not pause the SLA clock and that a ticket closed before its deadline without response remains non-breached. I noticed that those rules could not both be true. I resolved this before implementation by defining the SLA strictly as First Response Time (FRT): status changes do not pause or satisfy the clock. If the response target elapses without a qualifying agent comment, the ticket is breached regardless of whether it is open or closed. I documented this in `decision-notes.md` before starting backend work.

### Example 4 — Part 2 Timezone Shift in mysql2
The initial SLA backend verification appeared correct. I then compared the raw MySQL timestamp values with the timestamps returned by the API and found an exact 5.5-hour difference. For a ticket created at `14:48:54 UTC`, the database stored `2026-09-11 14:48:54`, but the API returned `2026-09-11T09:18:54.000Z`.

I investigated the conversion path and found that `mysql2` was interpreting MySQL `DATETIME` values using the local timezone (`+05:30`) because the connection pool did not specify a timezone. When Express serialized `Date` objects via `toISOString()`, it subtracted 5 hours and 30 minutes. I corrected this by adding `timezone: 'Z'` to `server/src/db/pool.js`, re-ran the checks, and confirmed that database UTC values matched API responses down to the second.

## 4. How I Verified AI Output

I did not rely solely on the assistant's written reports. My verification included:
* **Source inspection:** reviewing `git diff` and commit history before and after each change.
* **Database reset baseline:** running `npm run db:reset` and verifying exact seed counts (2 organizations, 30 users, 240 tickets, 551 comments).
* **Targeted API checks:** querying endpoints with targeted scripts to verify status codes, payloads, and response headers.
* **Direct database comparisons:** comparing raw MySQL `DATE_FORMAT` values against API JSON responses to verify timestamp precision.
* **Boundary testing:** checking SLA boundary cases (`target` vs. `target + 1 second`).
* **Browser verification:** manually verifying the React UI at `http://localhost:5173` for badge rendering, checkbox filtering, and page reset behavior.
* **Regression checks:** re-testing all Part 1 security fixes after backend and frontend changes.

## 5. Scope Discipline

The exercise explicitly required fixing only the five highest-priority Part 1 findings.

I maintained strict scope boundaries throughout:
* Exactly five Part 1 findings were fixed and committed.
* Findings #6 through #11 were documented in `review.md` and intentionally left untouched (including the pagination off-by-one bug, general filter reactivity, claim race, internal comments, N+1 query pattern, and development secrets).
* In the frontend Part 2 implementation, I ensured the assistant added the `breachedOnly` dependency without generally fixing Finding #7 (general filter reactivity). The `useEffect` dependency array was updated strictly to `[page, breachedOnly]`, allowing the SLA filter to work while preserving the existing starter behavior for search, status, priority, and sort.

## 6. What I Learned About Using AI for Engineering Work

AI saved time during repository exploration and helped generate implementation ideas and test cases, but the important part was checking those suggestions against the actual code and runtime. In this exercise, the most useful corrections came from comparing AI proposals with the repository, database values, Git history, and browser behaviour. Using AI effectively required treating its output as a starting proposal to verify rather than an answer to accept.
