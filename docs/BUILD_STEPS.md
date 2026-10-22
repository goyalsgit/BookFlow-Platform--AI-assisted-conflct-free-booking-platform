# BookFlow completion checklist

1. [x] Preserve the database transaction design and MIT license.
2. [x] Add versioned PostgreSQL migrations and a disposable integration-test database.
3. [x] Implement timezone-aware availability and database-enforced buffered conflicts.
4. [x] Implement holds, confirmation, rescheduling, cancellation, and waitlist offers.
5. [x] Add editable business details, locations, resources, services, weekly hours, and time off.
6. [x] Add password changes, recovery, email verification, and server-side token revocation.
7. [x] Build the client and API into one deployable image; add backup and empty-target restore commands.
8. [x] Run the 20-test integration suite against a disposable local PostgreSQL database.
9. [ ] Inspect complete customer and owner journeys on desktop and mobile; run accessibility checks.
10. [ ] Deploy to staging and verify monitoring and load behavior. A local backup/restore drill passed.
11. [ ] Verify account email and booking notification delivery with a real SMTP provider before public registration.
