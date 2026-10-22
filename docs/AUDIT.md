# BookFlow audit — 25 September 2026

BookFlow is a working local MVP. The active API is `/api/flow`; older BookIt
payment and admin routes are not mounted.

## Current code checks

- `npm run typecheck`: passed after the latest code changes.
- `npm run build`: passed after the latest code changes.
- `npm test`: all 25 integration tests passed in a disposable PostgreSQL
  database, including 20-way hold contention, session revocation, email
  verification, and password recovery.
- The app now has a production Dockerfile, same-origin frontend serving,
  production JWT-secret validation, compiled SQL migration assets, streaming
  CSV export, complete service editing, and owner settings controls.
- Customer and owner password changes, password recovery, and sign-out increment
  a stored session version. Every protected request compares it with the token.
- New public signups require email verification. Account links are one-time and
  time-limited. SMTP delivery is implemented but has not been verified with a
  live provider.
- Backup and restore commands passed a local drill using Docker's PostgreSQL
  clients. A custom archive restored into an empty temporary database with six
  migrations, nine bookings, and two customers. Repeating the restore against
  populated tables was rejected. The temporary database was removed.
- The existing local database was backed up before migrations 004 and 005 were
  applied. A post-migration backup was also saved in the ignored `backups/`
  directory. The built app's `/api/health` returned database up.
- Migrations 006 and 007 add publisher seat pools, exact adjacent-seat allocation,
  and safe withdrawal before any group confirms.
  The local database was backed up before applying them. The new integration
  tests cover three-group allocation, direct-booking conflicts, guest chat,
  and session preservation after a wrong current password.
- The local website was checked in Chrome: seat-pool navigation rendered and
  the chatbot responded to booking questions. A live Gemini request and
  follow-up produced a validated search suggestion after correcting the JSON
  output enum. Tests use a mock key and never call the live Gemini API.

## Still open for a public deployment

1. Live account email and booking notification delivery need SMTP credentials
   and end-to-end verification. SMS delivery is not implemented.
2. A cloud deployment, managed database, backups in private external storage,
   and monitoring have not been verified. The restore drill was local only.
3. Complete browser journeys, mobile layout, accessibility, and sustained-load
   checks remain unverified. The seat-pool and chatbot pages received a visual
   check in Chrome.
4. Live Gemini worked locally with the supplied key, but provider quotas,
   long-term reliability, and production behavior remain unverified. Prices
   are informational; payment collection is outside the active flow.
5. No original SRS is present, so full SRS completion cannot be certified.

See [deployment steps](DEPLOYMENT.md) and the [completion checklist](BUILD_STEPS.md).
