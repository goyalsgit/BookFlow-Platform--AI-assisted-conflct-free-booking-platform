<div align="center">

# BookFlow

### AI-Assisted Conflict-Safe Resource Booking Platform

Find resources, understand live availability, and reserve time without allowing
concurrent requests to create overlapping bookings.

[![React](https://img.shields.io/badge/React-18-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/license-MIT-22c55e)](LICENSE)

</div>

## Overview

BookFlow is a full-stack, multi-tenant scheduling workspace for businesses
that manage bookable resources. A resource can be a room, sports court, staff
member, lab instrument, or any other capacity that needs a schedule.

Customers can browse resources, use the optional AI assistant, see ranked live
availability, place a five-minute hold, confirm or reschedule a booking, and
join a waitlist. Business owners manage isolated workspaces, locations,
resources, services, weekly schedules, time off, operations, notifications, and
CSV exports. They can also publish adjacent-seat pools with a request deadline
while retaining ordinary customer-choice booking for other sessions.
Owner signup asks for the business name and type (for example salon, clinic, or
sports turf). Each owner account is tied to its own organization; owner actions
are checked against that organization, while customers use a separate booking
account.

## Screenshots

### Resource catalog

Customers can search and browse active resources across sports courts,
clinicians, lab equipment, and meeting rooms.

<p align="center">
  <img src="assets/screenshots/space.png" alt="BookFlow resource catalog" width="92%" />
</p>

### Operations dashboard

Business owners can monitor confirmed sessions, active holds, waitlist demand,
lead time, resource commitment, and reservation outcomes from one workspace.

<p align="center">
  <img src="assets/screenshots/operations.png" alt="BookFlow operations dashboard" width="92%" />
</p>

## What makes it special

### Three layers against double-booking

Two customers requesting the same slot at the same time cannot both win:

1. A PostgreSQL advisory transaction lock serializes attempts for one resource.
2. Availability is recomputed inside the booking transaction.
3. A PostgreSQL GiST exclusion constraint rejects overlapping active time ranges.

Different resources can still be booked concurrently. Preparation and cleanup
buffers are included in the protected range, while adjacent half-open ranges
remain bookable.

### AI that cannot bypass booking safety

The optional Gemini integration converts messages such as “a court tomorrow at
6 PM for an hour” into structured resource, service, date, time, and duration
preferences. Zod validates the response and the server verifies the result
against the real catalog.

The assistant only prepares search preferences. It cannot claim that a slot is
available or create, confirm, cancel, or reschedule a booking. The normal
transactional booking flow remains the only authority. Deterministic mock and
disabled fallbacks allow local development without an AI key.

### Optional adjacent-seat allocation

An owner can publish an exact row map, a request deadline, and a confirmation
window for one session. Customers submit group sizes before the deadline. After
it passes, an exact branch-and-bound search maximizes allocated seats, then
minimizes separate empty seat runs, then favors older requests. Each group gets
consecutive seats in one row. Offers reserve their exact seats until confirmed
or expired; released seats are allocated again. The search never sends offers
when it cannot prove the optimum within its search limit. Database
constraints prevent two active offers from claiming the same seat and prevent
ordinary bookings from overlapping a published pool. Owners can withdraw an
unconfirmed pool, which restores ordinary availability and notifies waiting
customers.

## Features

### Customer experience

- Registration, email verification, login, password recovery and changes, session revocation, profile, and booking history
- Resource catalog with services, locations, durations, prices, and schedules
- Ranked recommendations based on resource, service, date, time, flexibility, and demand
- Timezone-aware availability with breaks, time off, buffers, lead time, and booking horizon
- Five-minute holds, confirmation, cancellation, and version-checked rescheduling
- Waitlist requests with expiry-aware promotion after capacity is released
- Optional group seat requests, adjacent-seat offers, and confirmation after a publisher deadline
- In-app notifications and booking-event history

### Business workspace

- Organization and location management with tenant isolation
- Resource and service creation and editing
- Weekly schedule windows and dated time-off blocks
- Resource activation and operational booking status updates
- Seat-pool publication with exact rows, blocked seats, and configurable confirmation hours
- Notifications, utilization data, audit events, and CSV export
- Optional address suggestions through the Photon geocoding API

## Architecture

```mermaid
flowchart LR
    Browser[React + Vite] -->|JSON REST| API[Express + TypeScript]
    API -->|parameterized SQL| DB[(PostgreSQL)]
    API --> Auth[JWT + bcrypt]
    API --> AI[Optional Gemini assistant]
    API --> Geo[Optional Photon geocoding]
    DB --> Rules[Advisory locks + GiST constraints]
```

The active API is mounted at `/api/flow`. It uses raw parameterized SQL through
`pg` and Zod schemas at the request boundary. PostgreSQL also stores shared
rate-limit counters, so the running application does not depend on Redis.
Redis is included only as an optional Compose learning service.

## Technology

| Area | Tools |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, React Router |
| Backend | Node.js, Express, TypeScript, REST APIs |
| Data | PostgreSQL, `pg`, raw parameterized SQL, migrations |
| Reliability | Advisory locks, GiST exclusion constraints, transactions |
| Validation and security | Zod, JWT, bcrypt, organization authorization |
| Optional integrations | Google Gemini, Photon geocoding |
| Operations | Docker Compose, npm workspaces, maintenance worker |

## Run locally

### Requirements

- Node.js 22 or newer
- Docker with Compose

### Setup

```bash
git clone https://github.com/goyalsgit/BookFlow-AI-Assisted-Conflict-Safe-Booking-Platform.git
cd BookFlow-AI-Assisted-Conflict-Safe-Booking-Platform
npm install
cp server/.env.example server/.env
docker compose up -d db
npm run db:setup
npm run dev
```

Open the client at `http://localhost:5175`. The API runs at
`http://localhost:4170`. Configure `AI_PROVIDER=gemini` and
`GEMINI_API_KEY` only when Gemini assistance is needed. Chat can be used before
sign-in; holding a slot or requesting seats requires an account. Customer
sessions last 30 days and owner sessions last seven days unless revoked.

## Verification

```bash
npm run typecheck
npm run build
npm test
```

The integration suite uses a disposable PostgreSQL database. It covers 20-way
hold contention, direct SQL overlap rejection, buffers, hold expiry,
confirmation, cancellation, rescheduling, waitlist promotion, adjacent-seat
allocation, authorization, organization isolation, resource setup,
recommendations, and DST behavior.

## Backups and deployment

With `DATABASE_URL` set in `server/.env`, run `npm run db:backup` to create a
timestamped custom-format archive in `backups/`. The command uses installed
PostgreSQL client tools, or the running Docker Compose `db` container for
the default localhost database. Set `BOOKFLOW_DB_CONTAINER` to use a different
container.
To restore, create an **empty** PostgreSQL database and run
`RESTORE_DATABASE_URL=postgres://... npm run db:restore -- backups/your-file.dump`.
The restore command refuses to write into a database that already has tables.
Keep archives in private, access-controlled storage and verify a restore before
relying on them. See [deployment steps](docs/DEPLOYMENT.md).

## Scope notes

- Prices are informational in the active BookFlow flow; payment collection is not active.
- Notifications are in-app by default. SMTP email delivery can be enabled and must be verified with the chosen provider; SMS is not implemented.
- Redis is optional and is not used by the running application.
- The assistant provides preferences only and never performs booking actions.
- Large seat-pool instances may exceed the exact search limit; in that case no new offers are sent and the owner can retry. Seat-pool pricing is informational, as with ordinary bookings.

## Documentation

- [Beginner architecture, LLD, and local run guide](docs/ARCHITECTURE_AND_RUNNING.md)
- [Architecture and request flow](docs/ARCHITECTURE.md)
- [Verified flow and schema](docs/VERIFIED_FLOW_AND_SCHEMA.md)
- [Audit and known limitations](docs/AUDIT.md)
- [Interview guide](docs/INTERVIEW_GUIDE.md)
- [Scaling and Redis notes](docs/SCALING_AND_REDIS.md)
- [Deployment steps](docs/DEPLOYMENT.md)

## Author

**Devansh Goyal**

[GitHub: goyalsgit](https://github.com/goyalsgit)

## License

This project is available under the [MIT License](LICENSE).
