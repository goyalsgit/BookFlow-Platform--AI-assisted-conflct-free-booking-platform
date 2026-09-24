# BookFlow audit — 24 September 2026

Status: working local application; not yet verified as a complete or production-ready delivery. This audit changes documentation only.

## Verified checks

- `npm run typecheck`: passed.
- `npm run build`: passed for server and client.
- `npm test`: all 14 integration tests passed in a disposable PostgreSQL database. Includes 20 simultaneous hold requests (one success, 19 conflicts), buffered exclusion constraints, confirmation/cancellation/rescheduling, expiry, waitlist offers, permissions, custom resources, ranking and DST slot generation.
- Live `GET http://localhost:4170/api/health`: `{ "ok": true, "db": "up", "product": "BookFlow" }`.
- Live frontend at `http://localhost:5175`: HTTP 200. This is an HTTP check, not visual or end-to-end browser verification.
- PostgreSQL 16.15 is running in Docker container `bookflow-postgres`, exposed locally at port 54329. Database `bookflow` contains 6 resources, 12 services and 8 bookings at audit time.
- Applied migrations: `000_baseline`, `001_bookflow.sql`, `002_workspace.sql`.

## Confirmed issues and incomplete areas

1. **Business timezone is not consistently honored in the UI.** `client/src/flow/Operations.tsx` labels time off as IST and converts entered dates using a fixed `+05:30` offset. Changing business timezone therefore does not change how this form interprets input. Planner, waitlist and reschedule default dates also use helpers defaulting to Asia/Kolkata. Some booking details pass the correct timezone, but cancellation dialogs and operations displays do not. The assistant route calls `parseRequest(text)` without the workspace timezone.
2. **Production API routing is not configured.** The client requests relative `/api/flow` URLs. Vite's proxy handles these only in development. A deployment needs a same-origin reverse proxy/rewrite or a configurable backend base URL and corresponding CORS settings. The Express app does not serve the frontend or its SPA route fallback.
3. **Production configuration does not fail closed on a missing JWT secret.** `server/src/config.ts` falls back to a known development secret. Require a strong deployment secret and reject missing/insecure production configuration.
4. **Compiled migration artifacts are incomplete.** The server build emits `dist/db/migrate.js` but does not copy `schema.sql` or the migrations directory it reads. Source migrations through `npm run db:migrate` work; a deployment containing only compiled output cannot use the compiled migrator as-is. Its connection to the `postgres` maintenance database also needs checking against the chosen managed provider.
5. **Docker runtime differs from Compose configuration.** The running container stores data in an anonymous Docker volume. `compose.yaml` defines a different, named `bookflow_data` volume, and `docker compose ps` lists no container for this project. Preserve the current data before adopting Compose; the file alone does not reproduce the existing runtime/data attachment.
6. **Settings management is partial.** The active API/UI supports business settings, adding locations, adding a resource with its first service, weekly hours, activation and adding time off. It has no active endpoints for editing existing service duration/price/buffers, adding subsequent services, or deleting time-off entries. Resource detail and location editing are also not exposed.
7. **README capabilities do not match the active application.** Only `/api/flow` is mounted by `server/src/app.ts`; legacy BookIt payment/customer/admin routers are not mounted. Payments, refunds, coupons, reviews, loyalty and recurring bookings described in the README are not available through the active BookFlow app. Their absence is a scope/documentation discrepancy, not proof that every legacy feature is required.
8. **Notifications are local/in-app.** The active maintenance task writes HTML files and the UI reads database notifications. It does not dispatch real email/SMS. The optional assistant is disabled or a deterministic mock parser, not an LLM integration.
9. **Exports are limited.** The export endpoint reuses operations data capped at 200 bookings, so it is not a complete export for larger datasets.
10. **Operational preparation is unfinished.** No checked-in frontend/backend Dockerfile, cloud deployment manifest, or backup/restore automation was found. A Dockerfile is optional for managed Node hosting. The maintenance timer needs a running backend for timely expiry processing and waitlist offers.

## Verification limits

- Browser inspection could not run: the in-app browser was unavailable and browser discovery returned no connected browsers. Responsive layout, accessibility and complete click-through journeys remain unverified.
- Passing integration tests does not establish coverage of every route or UI. The existing DST test uses fixed dates and will need maintenance as those dates pass.
- No original SRS is present in the available project text files; full requirement completion cannot be certified.
- No live cloud deployment was verified. Source code and local services alone cannot establish whether an external deployment exists.

## Recommended completion order

1. Correct timezone handling and production secret validation.
2. Decide the intended settings/service-management scope and implement missing required controls.
3. Prepare production routing, migrations, database provisioning and backup/restore; reconcile Docker storage without losing current records.
4. Complete browser/mobile journeys and focused regression tests for the fixes.
5. Update README, architecture and setup guides, then verify a staging deployment against the agreed requirements.
