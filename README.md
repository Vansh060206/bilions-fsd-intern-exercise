# Meridian Helpdesk

A small internal support-desk application. Organisations raise tickets, agents claim
and answer them, everyone comments.

This repository is the starting point for the Bilions Full Stack Developer internship
exercise. It runs. Read the brief for what to do with it.

---

## Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Client   | React 18, Vite, React Router, Redux Toolkit           |
| API      | Node 18+, Express 4, JSON Web Tokens                  |
| Database | MySQL 8                                               |

## Running it

You need Node 18 or newer, and either Docker or a local MySQL 8.

### 1. Database

```bash
docker compose up -d          # starts MySQL 8 on port 3306
```

Not using Docker? Create a database called `helpdesk` and a user that can reach it,
then edit `server/.env` to match. The Docker environment uses `+05:30` for local runtime
behaviour. SLA calculations treat SLA-relevant timestamps consistently as UTC.

### 2. API

```bash
cd server
npm install
npm run db:reset              # creates the schema and loads seed data
npm run dev                   # http://localhost:4000
```

`npm run db:reset` is safe to re-run at any time. It drops everything and rebuilds
from `db/schema.sql`, so you can always get back to a known state.

### 3. Client

```bash
cd client
npm install
npm run dev                   # http://localhost:5173
```

Vite proxies `/api` to the server on port 4000.

## Signing in

Every seeded account uses the password `Password123!`.

| Email                    | Role      | Organisation      |
| ------------------------ | --------- | ----------------- |
| `admin@northwind.test`   | admin     | Northwind Trading |
| `agent1@northwind.test`  | agent     | Northwind Trading |
| `agent2@northwind.test`  | agent     | Northwind Trading |
| `user1@northwind.test`   | requester | Northwind Trading |
| `admin@cobalt.test`      | admin     | Cobalt Logistics  |
| `agent1@cobalt.test`     | agent     | Cobalt Logistics  |
| `user1@cobalt.test`      | requester | Cobalt Logistics  |

There are two organisations in the seed data. They are separate customers and must
not be able to see each other's tickets.

## Roles

| Role        | Can                                                            |
| ----------- | -------------------------------------------------------------- |
| `requester` | Raise tickets, comment on their own organisation's tickets      |
| `agent`     | Everything a requester can, plus claim and answer any ticket    |
| `admin`     | Everything an agent can, plus delete tickets                    |

## SLA Breach Tracking (Part 2)

Tickets compute and expose First Response Time (FRT) SLA metrics dynamically:

* `sla_target_hours`: response window based on priority (P1 = 4h, P2 = 24h, P3 = 72h)
* `sla_deadline`: target timestamp derived from `created_at`
* `first_response_at`: timestamp of earliest public agent/admin comment (or `null`)
* `is_breached`: boolean indicating if the ticket has missed its SLA window
* `sla_status`: `'pending'`, `'met'`, or `'breached'`

The API supports `GET /api/tickets?breached=true` to filter breached tickets across all statuses.

The client provides:
* Red `SLA Breached` badge on ticket list rows
* Red `SLA Breached` badge on ticket detail header
* A "Breached only" filter checkbox on the ticket list

## API

| Method | Path                             | Notes                                              |
| ------ | -------------------------------- | -------------------------------------------------- |
| POST   | `/api/auth/login`                | Returns a JWT                                      |
| POST   | `/api/auth/invite/accept`        | Disabled (returns 501)                             |
| GET    | `/api/tickets`                   | Paginated, 20 per page (supports `?breached=true`) |
| GET    | `/api/tickets/:id`               | Ticket plus its comments and SLA fields            |
| POST   | `/api/tickets`                   | Raise a ticket                                     |
| PATCH  | `/api/tickets/:id/assign`        | Claim a ticket (agent/admin only)                  |
| DELETE | `/api/tickets/:id`               | Admin only                                         |
| POST   | `/api/tickets/:id/comments`      | Add a comment                                      |

## Layout

```
db/schema.sql                     tables
server/src/config.js              configuration and SLA targets
server/src/db/pool.js             mysql2 connection pool
server/src/middleware/auth.js     requireAuth, requireRole
server/src/routes/                auth, tickets, comments
server/src/services/              ticketService — all ticket SQL
server/scripts/reset-db.js        schema + deterministic seed
client/src/app/                   store, api helper
client/src/features/tickets/      TicketList, TicketDetail
client/src/features/auth/         Login
```

## Known state

The starter codebase was intentionally provided as an unreviewed application for the exercise. It works well enough to demo, serving as the baseline for the code review and SLA implementation.
