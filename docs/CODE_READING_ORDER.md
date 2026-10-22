# Reading the booking code

Start with the active BookFlow application. Read one request from the browser to
the database before exploring other features.

## Folder map

| Folder/file | Responsibility |
| --- | --- |
| `client/src/main.tsx` | Starts React in the browser |
| `client/src/App.tsx` | Maps page URLs to React components |
| `client/src/flow/` | Active BookFlow pages, state, and HTTP helper |
| `server/src/index.ts` | Starts the HTTP server and maintenance |
| `server/src/app.ts` | Configures Express and mounts `/api/flow` |
| `server/src/flow/router.ts` | Matches API requests, validates input, checks access |
| `server/src/flow/` | Active booking, business, AI, and seat-pool logic |
| `server/src/services/slots.ts` | Queries available session times |
| `server/src/db/pool.ts` | Provides PostgreSQL connections |
| `server/src/db/schema.sql` | Original database structure |
| `server/src/db/migrations/` | Later schema changes, applied in order |
| `server/test/core.test.ts` | Integration tests for booking and access rules |

Older frontend folders (`admin`, `customer`, `pages`) and backend `routes` contain
the earlier application. They are not mounted by the current `App.tsx` and
`app.ts`. Some shared services, particularly `services/slots.ts`, remain active.
Do not infer that every old feature is enabled from its files or tables.

## Follow one search and hold

1. `client/src/flow/Planner.tsx`: form state → `search()` → `createHold()`.
2. `client/src/flow/api.ts`: `request()` sends JSON using `fetch()`.
3. `server/src/app.ts`: `/api/flow` requests reach `flowRouter`.
4. `server/src/flow/router.ts`: `/recommendations` validates search preferences;
   `/holds` also checks the customer token.
5. `server/src/flow/recommendations.ts`: obtains and ranks available slots.
6. `server/src/services/slots.ts`: reads resource/service details, creates
   candidate times, and filters conflicts. Its SQL is separated into numbered steps.
7. `server/src/flow/booking.ts`: `hold()` locks the resource, expires old holds,
   and calls `insertHold()` inside a transaction. Availability is checked again.
8. `server/src/db/migrations/001_bookflow.sql`: defines held bookings, buffered
   ranges, and the database exclusion constraint.
9. `client/src/flow/Bookings.tsx`: shows the hold and sends confirmation actions.
10. `server/src/flow/booking.ts`: `changeBooking()` updates that same booking.

## Keep formatting consistent

Run `npm run format` after editing. Run `npm run format:check` to check formatting
without changing files. SQL inside TypeScript template strings needs manual
formatting; Prettier does not format those queries or the SQL migration files.
