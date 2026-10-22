# Deploy BookFlow

The checked-in Dockerfile builds the React client and Express API into one
container. Express serves the built frontend and `/api/flow` on the same origin.
Use a PostgreSQL 16 database with persistent storage. Do not use the local demo
database or its sample credentials for a public deployment.

1. Provision an empty PostgreSQL database and a database user allowed to create
   tables, indexes, and extensions required by the migrations. Take a backup
   before applying migrations to an existing installation.
2. Set `NODE_ENV=production`, `DATABASE_URL`, and a unique `JWT_SECRET` of at
   least 32 characters. Set `CLIENT_ORIGIN` to the public HTTPS origin. Set
   `SMTP_HOST` and `MAIL_FROM` for account verification and password recovery;
   add `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` as required by the provider.
   Set `NOTIFICATION_MODE=smtp` to deliver booking notifications by email, or
   leave the default `inbox` for in-app notices only. Set `TRUST_PROXY=1` when
   exactly one trusted reverse proxy sits in front of the app. Leave
   `DEMO_MODE` unset.
3. Build with `docker build -t bookflow .`. Run migrations from the image with
   the same database URL: `docker run --rm --env-file deployment.env bookflow
   node server/dist/db/migrate.js`. The image includes the SQL files. Migration
   `004_session_revocation.sql` makes older JWTs require a new sign-in.
   `005_account_actions.sql` marks existing accounts verified and requires
   verification links for new public signups. `006_seat_pools.sql` adds
   publisher seat pools and their overlap protection.
   `007_seat_pool_withdrawal.sql` allows unconfirmed pools to be withdrawn.
4. Start the web process with `docker run --env-file deployment.env -p 4170:4170
   bookflow`. Route HTTPS traffic to port 4170 and check `/api/health`. The
   web process runs hold expiry, waitlist maintenance, and seat allocation
   every 15 seconds.
   For multiple web instances, set `MAINTENANCE_ENABLED=false` on them and run
   one `node server/dist/flow/worker.js` process with a direct database URL.
5. Install PostgreSQL client tools on an operator machine and schedule
   `npm run db:backup`. The local Docker database also works without host
   PostgreSQL tools. Store production backups outside the app host. Test a restore into
   a separate empty database with `RESTORE_DATABASE_URL` and `npm run
   db:restore -- archive.dump`, then run `/api/health` against that copy.

The current BookFlow flow keeps notifications in-app by default and can write
local HTML outbox files during development. Verify SMTP sender reputation,
delivery, and bounce handling before promising email alerts. SMS is not
implemented. Prices are informational; no payment provider is active in this
flow. Complete browser, accessibility, security, and load checks on a staging
deployment before opening public registration.
