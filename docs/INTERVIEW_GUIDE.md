# BookFlow interview guide and readiness check

## Honest one-minute description

BookFlow is a working local full-stack scheduling application. Customers create accounts, browse resources, hold a slot for five minutes, and confirm or change bookings. Business owners create separate workspaces and publish resources and weekly hours. Express and PostgreSQL handle the API and transactions; React renders the UI. It is a strong project/MVP, but it has not been validated as a production service under real traffic or deployed with the full operational controls a public product needs.

## Questions you should be ready to answer

**How are the two account types separated?** Customer and business credentials are in different tables and receive JWTs with different `kind` claims. Every protected API guard checks the token kind. Business management queries use the owner's organization ID, so one owner cannot edit another owner's resources. The UI offers “Book a slot” and “Publish slots.”

**What can a customer do in their profile?** The active BookFlow profile shows the customer's name, email, phone, and account creation date. They can edit name and phone, change their password, open My bookings, and sign out. Email is read-only because changing a login identifier needs a verified change flow. Profile API requests use the customer ID from the verified token, not an ID submitted by the browser. One-time links support password recovery and verification of new public accounts.

**What does sign out do?** It asks the API to increment the account's session version, then removes the token from browser storage. Every protected request compares the token version against PostgreSQL, so issued tokens stop working after sign-out. A password change also revokes all issued tokens. If the sign-out request cannot reach the server, the browser still clears its local token; server-side revocation then depends on the token's normal expiry.

**How do you prevent double booking?** A booking transaction takes a PostgreSQL advisory lock for the resource, expires stale holds, recomputes available slots, then inserts the hold. A GiST exclusion constraint on active booking time ranges is a final database guard even if an application path makes a mistake. Ranges are half-open, so adjacent bookings can meet at a boundary. A test sends 20 simultaneous hold requests for one slot: one succeeds and 19 receive conflicts.

**What happens if two customers click at once?** The requests queue on the same resource lock. The first valid transaction commits a hold. The second recalculates availability after acquiring the lock and receives a conflict. Different resources can proceed independently. The database exclusion constraint also rejects any overlapping write.

**Where do ACID properties appear?**

- **Atomicity:** `BEGIN`/`COMMIT` groups booking status, audit event, waitlist updates, and in-app notification. An error rolls the transaction back.
- **Consistency:** schema checks, foreign keys, active-state rules, and the overlap exclusion constraint keep invalid data out. Application validation adds clearer errors.
- **Isolation:** resource locks, row locks, and rechecks prevent conflicting booking changes under the default PostgreSQL transaction isolation. The tests exercise concurrent holds. This is not a claim that every read is serializable.
- **Durability:** once PostgreSQL acknowledges a commit, its normal WAL-backed persistence provides durability, subject to the deployment's storage and backup setup. Crash recovery and backups have not been demonstrated in this repository.

**Why not just check availability in JavaScript?** Two requests could both read “free” before either writes. The lock serializes booking attempts, and the database constraint enforces the invariant regardless of request timing.

**What is Redis used for?** Redis is optional and currently only provided as a learning service in Compose. The running app does not depend on Redis. PostgreSQL stores shared rate-limit counters across API instances. A future Redis rate limiter or catalog cache could reduce database work, but live slot availability must still be revalidated in the booking transaction.

**What scales and what can become a bottleneck?** Multiple stateless API instances can share PostgreSQL, and rate limits/maintenance coordination are shared. A bounded connection pool limits each instance. The database, full catalog reads, and hot resources under contention can become bottlenecks. Measure query latency, add pagination/indexes as needed, and keep the booking correctness check in PostgreSQL.

## Readiness: real application or prototype?

It is a **working local application and project MVP**, not merely static screens. Twenty disposable-database integration tests pass across booking lifecycle, concurrency, permissions, timezones, owner signup, and account recovery. A local backup/restore drill also passed. A production claim would require deployed end-to-end testing, live SMTP verification, monitoring, off-host backups, accessibility/security review, and load testing. Payments are not collected; prices are informational. Notifications can be in-app, local files, or SMTP; do not claim live email delivery without configuring and verifying it.

## Useful demonstration

1. Sign up a business, create a resource and weekly hours, and show the published slots.
2. Sign up a customer, hold and confirm a slot, then show that the slot disappears from availability.
3. Run `npm test` and explain the 20-request contention test and the database exclusion test.
4. Sign out and show that a previously issued token is rejected by the API.
